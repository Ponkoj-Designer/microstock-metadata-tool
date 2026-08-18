/**
 * Manual Payment Routes (bKash / Nagad)
 * GET  /api/payment/plans   — Get pricing plans & payment instructions (public)
 * POST /api/payment/submit  — Submit manual payment transaction for admin review (protected)
 */

import { Router } from 'express';
import { PLANS } from '../config/plans.js';
import { requireAuth } from '../middleware/auth.js';
import { MANUAL_PAYMENT_NUMBER, submitManualPayment } from '../services/paymentService.js';

export const paymentRouter = Router();

// ── GET /api/payment/plans — Public plans and payment instructions ────────────
paymentRouter.get('/plans', (req, res) => {
  return res.status(200).json({
    ok: true,
    plans: PLANS,
    paymentNumber: MANUAL_PAYMENT_NUMBER,
    instructions: {
      number: MANUAL_PAYMENT_NUMBER,
      methods: ['bKash', 'Nagad'],
      type: 'Personal (Send Money / Cash In)',
      // BUG FIX #7: Read prices from PLANS config instead of hardcoded values
      proPrice:      PLANS.pro.price,
      businessPrice: PLANS.business.price
    }
  });
});

// ── POST /api/payment/submit — Submit manual payment details ─────────────────
paymentRouter.post('/submit', requireAuth, async (req, res) => {
  try {
    const { plan, amount, paymentMethod, senderNumber, trxId } = req.body || {};
    const result = await submitManualPayment({
      userId: req.user.userId,
      plan,
      amount,
      paymentMethod,
      senderNumber,
      trxId
    });
    return res.status(201).json(result);
  } catch (err) {
    console.error('[Payment /submit POST]', err.message);
    return res.status(400).json({ ok: false, message: err.message || 'Payment submission failed.' });
  }
});
