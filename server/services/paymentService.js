/**
 * Manual Payment Service (bKash & Nagad)
 * Collects manual payment submissions (sender number, TrxID, amount, method)
 * and queues them for admin verification.
 * User plan and credits are ONLY updated after explicit admin approval.
 */

import { getDbClient, isDbConfigured } from './dbClient.js';
import { getPlanDetails } from '../config/plans.js';
import { updateUserPlan, grantCredits, findUserById } from './userService.js';

export const MANUAL_PAYMENT_NUMBER = '+8801741783521';

// Fallback in-memory store for manual payments if table isn't created in DB
const fallbackPaymentsStore = new Map();

/**
 * Submit manual bKash/Nagad payment details for admin review.
 */
export async function submitManualPayment({ userId, plan: planId, amount, paymentMethod, senderNumber, trxId }) {
  const plan = getPlanDetails(planId);
  const user = await findUserById(userId);
  if (!user) throw new Error('User account not found.');

  const method = String(paymentMethod || 'bkash').toLowerCase();
  if (!['bkash', 'nagad'].includes(method)) {
    throw new Error('Invalid payment method. Only bKash and Nagad are supported.');
  }

  if (!senderNumber || String(senderNumber).trim().length < 6) {
    throw new Error('Please enter a valid sender phone number.');
  }

  if (!trxId || String(trxId).trim().length < 4) {
    throw new Error('Please enter a valid Transaction ID (TrxID).');
  }

  const numAmount = parseInt(amount, 10) || plan.price;

  const paymentRecord = {
    id: `mp_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`,
    user_id: userId,
    plan: plan.id,
    amount: numAmount,
    payment_method: method,
    sender_number: String(senderNumber).trim(),
    trx_id: String(trxId).trim().toUpperCase(),
    status: 'pending',
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  // 1. Persist in database
  if (isDbConfigured()) {
    const db = getDbClient();

    // Try inserting into manual_payments table
    const { data, error } = await db
      .from('manual_payments')
      .insert({
        user_id: userId,
        plan: plan.id,
        amount: numAmount,
        payment_method: method,
        sender_number: String(senderNumber).trim(),
        trx_id: String(trxId).trim().toUpperCase(),
        status: 'pending'
      })
      .select()
      .maybeSingle();

    if (!error && data) {
      paymentRecord.id = data.id;
    } else {
      // Fallback: update subscriptions to pending and log audit transaction
      await db.from('subscriptions').upsert({
        user_id: userId,
        plan: plan.id,
        status: 'pending'
      });

      await db.from('credit_transactions').insert({
        user_id: userId,
        amount: 0,
        type: 'purchase',
        description: `MANUAL_PAYMENT_PENDING [${method.toUpperCase()}] Sender: ${senderNumber} | TrxID: ${trx_id_format(trxId)} | Plan: ${plan.id.toUpperCase()} | Amount: ৳${numAmount}`
      });

      fallbackPaymentsStore.set(paymentRecord.id, {
        ...paymentRecord,
        user_email: user.email,
        user_name: user.full_name
      });
    }
  } else {
    fallbackPaymentsStore.set(paymentRecord.id, {
      ...paymentRecord,
      user_email: user.email,
      user_name: user.full_name
    });
  }

  return {
    ok: true,
    payment: paymentRecord,
    paymentNumber: MANUAL_PAYMENT_NUMBER,
    message: `Payment submitted successfully! Admin will verify your ${method.toUpperCase()} payment (TrxID: ${String(trxId).trim().toUpperCase()}).`
  };
}

function trx_id_format(id) {
  return String(id || '').trim().toUpperCase();
}

/**
 * Admin: List pending & recent manual payment submissions.
 */
export async function listPaymentsAdmin({ status } = {}) {
  if (isDbConfigured()) {
    const db = getDbClient();
    try {
      let query = db.from('manual_payments').select('*, users(email, full_name)');
      if (status) query = query.eq('status', status);
      const { data, error } = await query.order('created_at', { ascending: false });

      if (!error && Array.isArray(data)) {
        return data.map(p => ({
          ...p,
          user_email: p.users?.email || 'N/A',
          user_name:  p.users?.full_name || 'N/A'
        }));
      }
    } catch (_) {
      // Table missing fallback below
    }
  }

  // Fallback memory store array
  const items = Array.from(fallbackPaymentsStore.values());
  if (status) return items.filter(i => i.status === status);
  return items;
}

/**
 * Admin: Approve a manual payment submission.
 * Upgrades user plan, activates subscription, and awards credits.
 */
export async function approveManualPaymentAdmin(paymentId, adminNotes = '') {
  let payment = null;

  if (isDbConfigured()) {
    const db = getDbClient();
    const { data: dbPayment } = await db.from('manual_payments').select('*').eq('id', paymentId).maybeSingle();
    if (dbPayment) payment = dbPayment;
  }

  if (!payment && fallbackPaymentsStore.has(paymentId)) {
    payment = fallbackPaymentsStore.get(paymentId);
  }

  if (!payment) {
    throw new Error('Payment submission record not found.');
  }

  if (payment.status === 'approved') {
    throw new Error('This payment has already been approved.');
  }

  const userId = payment.user_id;
  const planDetails = getPlanDetails(payment.plan);

  // 1. Upgrade user plan in users table and active subscription
  const { user: updatedUser, subscription } = await updateUserPlan(userId, planDetails.id);

  // 2. Award credits & log 'purchase' audit record
  const creditResult = await grantCredits(
    userId,
    planDetails.creditsPerCycle,
    'purchase',
    `Manual ${payment.payment_method?.toUpperCase()} Payment Approved (TrxID: ${payment.trx_id})`
  );

  // 3. Update payment record status in database
  if (isDbConfigured()) {
    const db = getDbClient();
    await db.from('manual_payments').update({
      status: 'approved',
      admin_notes: adminNotes || 'Approved by admin'
    }).eq('id', paymentId);
  }

  if (fallbackPaymentsStore.has(paymentId)) {
    const item = fallbackPaymentsStore.get(paymentId);
    item.status = 'approved';
    item.admin_notes = adminNotes || 'Approved by admin';
  }

  return {
    ok: true,
    user: creditResult.user,
    subscription,
    credits: creditResult.credits,
    message: `Payment approved! Upgraded ${creditResult.user.email} to ${planDetails.name} plan (+${planDetails.creditsPerCycle} credits).`
  };
}

/**
 * Admin: Reject a manual payment submission.
 */
export async function rejectManualPaymentAdmin(paymentId, adminNotes = '') {
  let payment = null;

  if (isDbConfigured()) {
    const db = getDbClient();
    const { data: dbPayment } = await db.from('manual_payments').select('*').eq('id', paymentId).maybeSingle();
    if (dbPayment) payment = dbPayment;
  }

  if (!payment && fallbackPaymentsStore.has(paymentId)) {
    payment = fallbackPaymentsStore.get(paymentId);
  }

  if (!payment) {
    throw new Error('Payment submission record not found.');
  }

  // Update status to rejected
  if (isDbConfigured()) {
    const db = getDbClient();
    await db.from('manual_payments').update({
      status: 'rejected',
      admin_notes: adminNotes || 'Rejected by admin'
    }).eq('id', paymentId);
  }

  if (fallbackPaymentsStore.has(paymentId)) {
    const item = fallbackPaymentsStore.get(paymentId);
    item.status = 'rejected';
    item.admin_notes = adminNotes || 'Rejected by admin';
  }

  return {
    ok: true,
    message: `Payment submission (TrxID: ${payment.trx_id}) rejected.`
  };
}
