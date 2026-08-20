/**
 * Auth Middleware
 *
 * Extracts the JWT from the httpOnly cookie on every request.
 * Verifies the signature AND checks the sessions table so that
 * logout truly invalidates tokens (server-side revocation).
 *
 * Sets req.user = { userId, email, role, plan, fullName, credits }
 * or req.user = null if no valid session exists.
 * NEVER blocks a request — call requireAuth() on protected routes.
 */

import jwt              from 'jsonwebtoken';
import { createHash }   from 'crypto';
import { config }       from '../config/config.js';
import { isDbConfigured } from '../services/dbClient.js';
import { findSession, findUserById } from '../services/userService.js';

export async function authMiddleware(req, res, next) {
  req.user = null;

  let token = req.cookies?.auth_token;
  if (!token && req.headers.authorization) {
    const parts = req.headers.authorization.split(' ');
    if (parts.length === 2 && /^Bearer$/i.test(parts[0])) {
      token = parts[1];
    }
  }

  if (!token) return next();

  try {
    // 1. Verify JWT signature and expiry
    const payload = jwt.verify(token, config.jwtSecret);

    // 2. In DB mode, confirm the session is not revoked in the database
    if (isDbConfigured()) {
      const tokenHash = createHash('sha256').update(token).digest('hex');
      const session = await findSession(tokenHash);

      if (!session) {
        // Session was revoked on server
        res.clearCookie('auth_token', { path: '/' });
        return next();
      }
    }

    // 3. Fetch fresh user data or fallback to verified JWT payload
    let dbUser = null;
    try {
      dbUser = await findUserById(payload.userId);
    } catch (_) {}

    if (dbUser && !dbUser.is_active) {
      res.clearCookie('auth_token', { path: '/' });
      return next();
    }

    // Attach user info to request (from DB or verified JWT claims)
    req.user = {
      userId:   dbUser ? dbUser.id : payload.userId,
      email:    dbUser ? dbUser.email : payload.email,
      role:     dbUser ? dbUser.role : (payload.role || 'user'),
      plan:     dbUser ? dbUser.plan : (payload.plan || 'free'),
      fullName: dbUser ? (dbUser.full_name || dbUser.fullName) : (payload.fullName || payload.email),
      credits:  dbUser ? (dbUser.credits ?? 10) : (payload.credits ?? 10)
    };
  } catch (err) {
    // Invalid or expired JWT
    res.clearCookie('auth_token', { path: '/' });
  }

  next();
}

/**
 * Middleware: require an authenticated user.
 * Returns 401 if req.user is null.
 */
export function requireAuth(req, res, next) {
  if (!req.user) {
    return res.status(401).json({ ok: false, message: 'Authentication required.' });
  }
  next();
}

/**
 * Middleware: require admin role.
 * Returns 403 if the user is not an admin.
 */
export function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== 'admin') {
    return res.status(403).json({ ok: false, message: 'Admin access required.' });
  }
  next();
}
