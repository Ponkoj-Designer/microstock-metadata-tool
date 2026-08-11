/**
 * User Profile & Subscription Routes
 * GET  /api/user/profile  — Get persistent profile + subscription details
 * PUT  /api/user/profile  — Update profile details (e.g. fullName)
 * POST /api/user/plan     — Switch/update subscription plan (free, pro, business)
 */

import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import {
  findUserById,
  updateUserProfile,
  getUserSubscription,
  updateUserPlan,
  deductCredits,
  getCreditHistory
} from '../services/userService.js';

export const userRouter = Router();

function safeUser(user) {
  return {
    id:        user.id,
    email:     user.email,
    fullName:  user.full_name,
    role:      user.role,
    plan:      user.plan,
    credits:   user.credits,
    createdAt: user.created_at
  };
}

// All user endpoints require authentication
userRouter.use(requireAuth);

// ── GET /api/user/profile ─────────────────────────────────────────────────────
userRouter.get('/profile', async (req, res) => {
  try {
    const user = await findUserById(req.user.userId);
    if (!user || !user.is_active) {
      return res.status(404).json({ ok: false, message: 'User account not found or inactive.' });
    }
    const subscription = await getUserSubscription(req.user.userId);
    return res.status(200).json({
      ok: true,
      user: safeUser(user),
      subscription: subscription || { plan: user.plan, status: 'active', started_at: user.created_at }
    });
  } catch (err) {
    console.error('[User /profile GET]', err.message);
    return res.status(500).json({ ok: false, message: 'Failed to fetch user profile.' });
  }
});

// ── PUT /api/user/profile ─────────────────────────────────────────────────────
userRouter.put('/profile', async (req, res) => {
  try {
    const { fullName } = req.body || {};
    if (!fullName || fullName.trim().length < 2) {
      return res.status(400).json({ ok: false, message: 'Full name must be at least 2 characters.' });
    }
    const updatedUser = await updateUserProfile(req.user.userId, { fullName });
    return res.status(200).json({ ok: true, user: safeUser(updatedUser) });
  } catch (err) {
    console.error('[User /profile PUT]', err.message);
    return res.status(500).json({ ok: false, message: 'Failed to update user profile.' });
  }
});

// ── POST /api/user/plan ───────────────────────────────────────────────────────
userRouter.post('/plan', async (req, res) => {
  try {
    const { plan } = req.body || {};
    const validPlans = ['free', 'pro', 'business'];
    if (!plan || !validPlans.includes(String(plan).toLowerCase())) {
      return res.status(400).json({ ok: false, message: 'Invalid plan selection. Choose free, pro, or business.' });
    }
    const targetPlan = String(plan).toLowerCase();
    const { user, subscription } = await updateUserPlan(req.user.userId, targetPlan);
    return res.status(200).json({
      ok: true,
      user: safeUser(user),
      subscription,
      message: `Plan updated to ${targetPlan.toUpperCase()}.`
    });
  } catch (err) {
    console.error('[User /plan POST]', err.message);
    return res.status(500).json({ ok: false, message: err.message || 'Failed to update plan.' });
  }
});

// ── GET /api/user/credits ─────────────────────────────────────────────────────
userRouter.get('/credits', async (req, res) => {
  try {
    const user = await findUserById(req.user.userId);
    if (!user) return res.status(404).json({ ok: false, message: 'User not found.' });
    const transactions = await getCreditHistory(req.user.userId);
    return res.status(200).json({
      ok: true,
      credits: user.credits,
      transactions
    });
  } catch (err) {
    console.error('[User /credits GET]', err.message);
    return res.status(500).json({ ok: false, message: 'Failed to fetch credit balance.' });
  }
});

// ── POST /api/user/credits/deduct ──────────────────────────────────────────────
userRouter.post('/credits/deduct', async (req, res) => {
  try {
    const { amount = 1, description } = req.body || {};
    const result = await deductCredits(req.user.userId, amount, description);
    return res.status(200).json({
      ok: true,
      user: safeUser(result.user),
      credits: result.credits,
      transaction: result.transaction
    });
  } catch (err) {
    const isInsufficient = err.message && err.message.includes('Insufficient credits');
    return res.status(isInsufficient ? 402 : 400).json({
      ok: false,
      message: err.message || 'Credit deduction failed.'
    });
  }
});

