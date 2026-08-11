/**
 * Admin API Routes — Server-Side Protected
 * All routes require authentication AND admin role (requireAuth + requireAdmin).
 */

import { Router } from 'express';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import {
  listAllUsers,
  findUserById,
  getUserSubscription,
  updateUserPlan,
  toggleUserActiveStatus,
  adminAdjustCredits,
  getCreditHistory,
  grantCredits,
  adminSetCredits
} from '../services/userService.js';
import { listPaymentsAdmin, approveManualPaymentAdmin, rejectManualPaymentAdmin } from '../services/paymentService.js';
import { getPlanDetails } from '../config/plans.js';

export const adminRouter = Router();

// Protect ALL admin routes
adminRouter.use(requireAuth);
adminRouter.use(requireAdmin);

function safeUser(user) {
  return {
    id:        user.id,
    email:     user.email,
    fullName:  user.full_name,
    role:      user.role,
    plan:      user.plan,
    credits:   user.credits,
    isActive:  user.is_active,
    createdAt: user.created_at
  };
}

// ── GET /api/admin/users — List / search users ────────────────────────────────
adminRouter.get('/users', async (req, res) => {
  try {
    const search = req.query.search || '';
    const limit  = parseInt(req.query.limit, 10) || 100;
    const offset = parseInt(req.query.offset, 10) || 0;

    const { users, count } = await listAllUsers({ search, limit, offset });
    return res.status(200).json({
      ok: true,
      users: users.map(safeUser),
      count
    });
  } catch (err) {
    console.error('[Admin /users GET]', err.message);
    return res.status(500).json({ ok: false, message: 'Failed to list users.' });
  }
});

// ── GET /api/admin/users/:id — User details ───────────────────────────────────
adminRouter.get('/users/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const user = await findUserById(id);
    if (!user) return res.status(404).json({ ok: false, message: 'User not found.' });

    const subscription  = await getUserSubscription(id);
    const transactions  = await getCreditHistory(id, 20);

    return res.status(200).json({
      ok: true,
      user: safeUser(user),
      subscription: subscription || { plan: user.plan, status: 'active' },
      transactions
    });
  } catch (err) {
    console.error('[Admin /users/:id GET]', err.message);
    return res.status(500).json({ ok: false, message: 'Failed to fetch user details.' });
  }
});

// ── PUT /api/admin/users/:id/plan — Manage plan ──────────────────────────────
adminRouter.post('/users/:id/plan', async (req, res) => {
  try {
    const { id } = req.params;
    const { plan } = req.body || {};
    const validPlans = ['free', 'pro', 'business'];
    if (!plan || !validPlans.includes(String(plan).toLowerCase())) {
      return res.status(400).json({ ok: false, message: 'Invalid plan choice. Choose free, pro, or business.' });
    }
    const { user, subscription } = await updateUserPlan(id, String(plan).toLowerCase());
    
    // Automatically apply EXACT plan credits
    const planDetails = getPlanDetails(plan);
    let updatedUser = user;
    let newCreditBalance = user.credits;
    
    if (planDetails && typeof planDetails.creditsPerCycle === 'number') {
      const creditResult = await adminSetCredits(id, planDetails.creditsPerCycle, `Admin assigned ${planDetails.name} plan`);
      updatedUser = creditResult.user;
      newCreditBalance = updatedUser.credits;
    }

    return res.status(200).json({
      ok: true,
      user: safeUser(updatedUser),
      subscription,
      message: `User plan updated to ${updatedUser.plan.toUpperCase()} (credits set to ${newCreditBalance}).`
    });
  } catch (err) {
    console.error('[Admin /users/:id/plan POST]', err.message);
    return res.status(500).json({ ok: false, message: err.message || 'Failed to update plan.' });
  }
});

// ── PUT /api/admin/users/:id/status — Activate / Deactivate account ─────────
adminRouter.post('/users/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { isActive } = req.body || {};
    if (typeof isActive !== 'boolean') {
      return res.status(400).json({ ok: false, message: 'isActive boolean flag required.' });
    }
    const updatedUser = await toggleUserActiveStatus(id, isActive);
    return res.status(200).json({
      ok: true,
      user: safeUser(updatedUser),
      message: `User account ${isActive ? 'activated' : 'deactivated'} successfully.`
    });
  } catch (err) {
    console.error('[Admin /users/:id/status POST]', err.message);
    return res.status(500).json({ ok: false, message: 'Failed to update user status.' });
  }
});

// ── POST /api/admin/users/:id/credits — Adjust credits ───────────────────────
adminRouter.post('/users/:id/credits', async (req, res) => {
  try {
    const { id } = req.params;
    const { amount, description } = req.body || {};
    const numAmount = parseInt(amount, 10);
    if (isNaN(numAmount) || numAmount === 0) {
      return res.status(400).json({ ok: false, message: 'Amount must be a non-zero integer.' });
    }
    const result = await adminAdjustCredits(id, numAmount, description);
    return res.status(200).json({
      ok: true,
      user: safeUser(result.user),
      credits: result.credits,
      transaction: result.transaction,
      message: `Adjusted user credits by ${numAmount > 0 ? '+' : ''}${numAmount}.`
    });
  } catch (err) {
    console.error('[Admin /users/:id/credits POST]', err.message);
    return res.status(500).json({ ok: false, message: err.message || 'Failed to adjust credits.' });
  }
});

// ── GET /api/admin/users/:id/transactions — View transaction history ─────────
adminRouter.get('/users/:id/transactions', async (req, res) => {
  try {
    const { id } = req.params;
    const limit = parseInt(req.query.limit, 10) || 50;
    const transactions = await getCreditHistory(id, limit);
    return res.status(200).json({ ok: true, transactions });
  } catch (err) {
    console.error('[Admin /users/:id/transactions GET]', err.message);
    return res.status(500).json({ ok: false, message: 'Failed to fetch user transaction history.' });
  }
});

// ── MANUAL PAYMENTS MANAGEMENT (bKash & Nagad) ────────────────────────────────

// GET /api/admin/payments — List manual payments
adminRouter.get('/payments', async (req, res) => {
  try {
    const status = req.query.status || null;
    const payments = await listPaymentsAdmin({ status });
    return res.status(200).json({ ok: true, payments, count: payments.length });
  } catch (err) {
    console.error('[Admin /payments GET]', err.message);
    return res.status(500).json({ ok: false, message: 'Failed to list payment submissions.' });
  }
});

// POST /api/admin/payments/:id/approve — Approve payment & upgrade plan + credits
adminRouter.post('/payments/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const { adminNotes } = req.body || {};
    const result = await approveManualPaymentAdmin(id, adminNotes);
    return res.status(200).json(result);
  } catch (err) {
    console.error('[Admin /payments/:id/approve POST]', err.message);
    return res.status(400).json({ ok: false, message: err.message || 'Payment approval failed.' });
  }
});

// POST /api/admin/payments/:id/reject — Reject payment
adminRouter.post('/payments/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const { adminNotes } = req.body || {};
    const result = await rejectManualPaymentAdmin(id, adminNotes);
    return res.status(200).json(result);
  } catch (err) {
    console.error('[Admin /payments/:id/reject POST]', err.message);
    return res.status(400).json({ ok: false, message: err.message || 'Payment rejection failed.' });
  }
});

