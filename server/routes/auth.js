/**
 * Auth Routes — POST /api/auth/signup, POST /api/auth/login,
 *               POST /api/auth/logout, GET /api/auth/me
 *
 * All authentication happens server-side.
 * Passwords are never stored — only bcrypt hashes.
 * Sessions are tracked in the DB so logout is instant and permanent.
 * Tokens travel only in httpOnly cookies — invisible to JavaScript.
 */

import { Router }       from 'express';
import bcrypt           from 'bcryptjs';
import jwt              from 'jsonwebtoken';
import { createHash }   from 'crypto';
import { config }       from '../config/config.js';
import { isDbConfigured } from '../services/dbClient.js';
import {
  findUserByEmail,
  findUserById,
  createUser,
  createSession,
  deleteSession,
  cleanExpiredSessions
} from '../services/userService.js';

export const authRouter = Router();

// ── Constants ─────────────────────────────────────────────────────────────────
const BCRYPT_COST   = 12;           // ~300 ms per hash — strong against brute force
const COOKIE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days in milliseconds

const COOKIE_OPTIONS = {
  httpOnly: true,                               // JS cannot read this cookie
  secure:   config.nodeEnv === 'production',    // HTTPS only in production
  sameSite: config.nodeEnv === 'production' ? 'none' : 'lax',
  maxAge:   COOKIE_TTL_MS,
  path:     '/'
};

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build a JWT and its DB-storable SHA-256 hash. */
function buildToken(user) {
  const token = jwt.sign(
    {
      userId:   user.id,
      email:    user.email,
      role:     user.role,
      plan:     user.plan,
      fullName: user.full_name,
      credits:  user.credits
    },
    config.jwtSecret,
    { expiresIn: config.jwtExpiresIn }
  );
  const tokenHash = createHash('sha256').update(token).digest('hex');
  return { token, tokenHash };
}

/** Strip sensitive fields before sending user data to the client. */
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

/** Simple email format check. */
function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// ── POST /api/auth/signup ─────────────────────────────────────────────────────
authRouter.post('/signup', async (req, res) => {
  try {
    const { email = '', password = '', fullName = '' } = req.body || {};

    // Input validation
    if (!fullName.trim())          return res.status(400).json({ ok: false, message: 'Full name is required.' });
    if (!isValidEmail(email))      return res.status(400).json({ ok: false, message: 'Please enter a valid email address.' });
    if (password.length < 8)       return res.status(400).json({ ok: false, message: 'Password must be at least 8 characters long.' });
    if (fullName.trim().length < 2) return res.status(400).json({ ok: false, message: 'Please enter your full name (at least 2 characters).' });

    // Check for duplicate
    const existing = await findUserByEmail(email);
    if (existing) return res.status(409).json({ ok: false, message: 'An account with this email address already exists.' });

    // Hash password and create user
    const passwordHash = await bcrypt.hash(password, BCRYPT_COST);
    const user = await createUser({ email, passwordHash, fullName });

    // Create session
    const { token, tokenHash } = buildToken(user);
    await createSession({
      userId:    user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + COOKIE_TTL_MS).toISOString(),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.cookie('auth_token', token, COOKIE_OPTIONS);
    return res.status(201).json({ ok: true, user: safeUser(user), token });

  } catch (err) {
    console.error('[Auth /signup]', err.message);
    return res.status(500).json({ ok: false, message: 'Failed to create account. Please try again.' });
  }
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────
authRouter.post('/login', async (req, res) => {
  try {
    const { email = '', password = '' } = req.body || {};

    if (!email || !password) {
      return res.status(400).json({ ok: false, message: 'Email and password are required.' });
    }

    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(401).json({ ok: false, message: 'Invalid email or password.' });
    }
    if (!user.is_active) {
      return res.status(403).json({ ok: false, message: 'This account has been deactivated. Contact support.' });
    }

    const passwordMatch = await bcrypt.compare(password, user.password_hash);
    if (!passwordMatch) {
      return res.status(401).json({ ok: false, message: 'Invalid email or password.' });
    }

    // Tidy up old sessions in the background (non-blocking)
    cleanExpiredSessions(user.id).catch(() => {});

    // Issue new session
    const { token, tokenHash } = buildToken(user);
    await createSession({
      userId:    user.id,
      tokenHash,
      expiresAt: new Date(Date.now() + COOKIE_TTL_MS).toISOString(),
      ipAddress: req.ip,
      userAgent: req.headers['user-agent']
    });

    res.cookie('auth_token', token, COOKIE_OPTIONS);
    return res.status(200).json({ ok: true, user: safeUser(user), token });

  } catch (err) {
    console.error('[Auth /login]', err.message);
    return res.status(500).json({ ok: false, message: 'Login failed. Please try again.' });
  }
});

// ── POST /api/auth/logout ─────────────────────────────────────────────────────
authRouter.post('/logout', async (req, res) => {
  let token = req.cookies?.auth_token;
  if (!token && req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && /^Bearer$/i.test(parts[0])) {
      token = parts[1];
    }
  }

  if (token) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    await deleteSession(tokenHash).catch(() => {}); // Non-fatal
  }

  res.clearCookie('auth_token', { path: '/' });
  return res.status(200).json({ ok: true, message: 'Logged out successfully.' });
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────
authRouter.get('/me', async (req, res) => {
  // req.user is populated by authMiddleware if a valid session cookie exists
  if (!req.user) {
    return res.status(401).json({ ok: false, message: 'Not authenticated.' });
  }

  try {
    // Always fetch fresh data from DB (credits/plan may have changed)
    const user = await findUserById(req.user.userId);

    if (!user || !user.is_active) {
      res.clearCookie('auth_token', { path: '/' });
      return res.status(401).json({ ok: false, message: 'Account not found or inactive.' });
    }

    return res.status(200).json({ ok: true, user: safeUser(user) });

  } catch (err) {
    console.error('[Auth /me]', err.message);
    return res.status(500).json({ ok: false, message: 'Could not retrieve account data.' });
  }
});
