/**
 * Manual Payment Service (bKash & Nagad)
 * Collects manual payment submissions (sender number, TrxID, amount, method)
 * and queues them for admin verification.
 * User plan and credits are ONLY updated after explicit admin approval.
 */

import { getDbClient, isDbConfigured } from './dbClient.js';
import { getPlanDetails } from '../config/plans.js';
import { updateUserPlan, grantCredits, findUserById } from './userService.js';
import { readCollection, writeCollection } from './localStore.js';

export const MANUAL_PAYMENT_NUMBER = '+8801741783521';

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
    try {
      const db = getDbClient();
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
      }
    } catch (err) {
      console.warn('[PaymentService] Supabase manual_payments insert failed:', err.message);
    }
  }

  // Always persist to local collection
  const payments = readCollection('payments');
  payments.push({
    ...paymentRecord,
    user_email: user.email,
    user_name: user.full_name
  });
  writeCollection('payments', payments);

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

  // Fallback persistent store array
  const items = readCollection('payments');
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
    try {
      const db = getDbClient();
      const { data: dbPayment } = await db.from('manual_payments').select('*').eq('id', paymentId).maybeSingle();
      if (dbPayment) payment = dbPayment;
    } catch (_) {}
  }

  const payments = readCollection('payments');
  const localPayment = payments.find(p => p.id === paymentId);
  if (!payment && localPayment) {
    payment = localPayment;
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
    try {
      const db = getDbClient();
      await db.from('manual_payments').update({
        status: 'approved',
        admin_notes: adminNotes || 'Approved by admin'
      }).eq('id', paymentId);
    } catch (_) {}
  }

  if (localPayment) {
    localPayment.status = 'approved';
    localPayment.admin_notes = adminNotes || 'Approved by admin';
    localPayment.updated_at = new Date().toISOString();
    writeCollection('payments', payments);
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
    try {
      const db = getDbClient();
      const { data: dbPayment } = await db.from('manual_payments').select('*').eq('id', paymentId).maybeSingle();
      if (dbPayment) payment = dbPayment;
    } catch (_) {}
  }

  const payments = readCollection('payments');
  const localPayment = payments.find(p => p.id === paymentId);
  if (!payment && localPayment) {
    payment = localPayment;
  }

  if (!payment) {
    throw new Error('Payment submission record not found.');
  }

  if (payment.status === 'rejected') {
    throw new Error('This payment submission has already been rejected.');
  }

  if (payment.status === 'approved') {
    throw new Error('This payment has already been approved and cannot be rejected.');
  }

  // Update status to rejected
  if (isDbConfigured()) {
    try {
      const db = getDbClient();
      await db.from('manual_payments').update({
        status: 'rejected',
        admin_notes: adminNotes || 'Rejected by admin'
      }).eq('id', paymentId);
    } catch (_) {}
  }

  if (localPayment) {
    localPayment.status = 'rejected';
    localPayment.admin_notes = adminNotes || 'Rejected by admin';
    localPayment.updated_at = new Date().toISOString();
    writeCollection('payments', payments);
  }

  return {
    ok: true,
    message: `Payment submission (TrxID: ${payment.trx_id}) rejected.`
  };
}
