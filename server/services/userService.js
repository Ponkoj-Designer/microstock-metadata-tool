/**
 * User Service — all database operations for the users, sessions,
 * subscriptions, and credit_transactions tables.
 *
 * Fully supports dual mode:
 * 1. Supabase Postgres (when SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are set)
 * 2. Local persistent JSON store (for offline / dev / self-hosted mode)
 */

import crypto from 'crypto';
import { getDbClient, isDbConfigured } from './dbClient.js';
import { readCollection, writeCollection } from './localStore.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateId(prefix = 'usr') {
  return `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
}

// ── Users ─────────────────────────────────────────────────────────────────────

/**
 * Find a user by email address. Returns null if not found.
 */
export async function findUserByEmail(email) {
  if (!email) return null;
  const cleanEmail = email.toLowerCase().trim();

  if (isDbConfigured()) {
    try {
      const db = getDbClient();
      const { data, error } = await db
        .from('users')
        .select('*')
        .eq('email', cleanEmail)
        .maybeSingle();
      if (error && error.code !== 'PGRST116') throw error;
      if (data) return data;
    } catch (err) {
      console.warn('[UserService] Supabase findUserByEmail failed, checking local store:', err.message);
    }
  }

  // Fallback to local store
  const users = readCollection('users');
  return users.find(u => u.email?.toLowerCase().trim() === cleanEmail) || null;
}

/**
 * Find a user by UUID / ID. Returns null if not found.
 */
export async function findUserById(id) {
  if (!id) return null;

  if (isDbConfigured()) {
    try {
      const db = getDbClient();
      const { data, error } = await db
        .from('users')
        .select('*')
        .eq('id', id)
        .maybeSingle();
      if (error && error.code !== 'PGRST116') throw error;
      if (data) return data;
    } catch (err) {
      console.warn('[UserService] Supabase findUserById failed, checking local store:', err.message);
    }
  }

  // Fallback to local store
  const users = readCollection('users');
  return users.find(u => String(u.id) === String(id)) || null;
}

/**
 * Create a new user record and log the signup_bonus credit transaction.
 * Returns the newly created user row.
 */
export async function createUser({ email, passwordHash, fullName }) {
  const cleanEmail = email.toLowerCase().trim();
  const cleanName = fullName.trim();

  if (isDbConfigured()) {
    try {
      const db = getDbClient();
      const { data: user, error: userError } = await db
        .from('users')
        .insert({
          email:         cleanEmail,
          password_hash: passwordHash,
          full_name:     cleanName,
          role:          'user',
          plan:          'free',
          credits:       10,
          is_active:     true
        })
        .select('*')
        .maybeSingle();

      if (!userError && user) {
        // Log credit transaction
        try {
          await db.from('credit_transactions').insert({
            user_id:     user.id,
            amount:      10,
            type:        'signup_bonus',
            description: 'Welcome credits awarded on account creation'
          });
        } catch (_) {}
        return user;
      }
    } catch (err) {
      console.warn('[UserService] Supabase createUser failed, using local store:', err.message);
    }
  }

  // Fallback to local store
  const users = readCollection('users');
  const newUser = {
    id:            generateId('usr'),
    email:         cleanEmail,
    password_hash: passwordHash,
    full_name:     cleanName,
    role:          'user',
    plan:          'free',
    credits:       10,
    is_active:     true,
    created_at:    new Date().toISOString(),
    updated_at:    new Date().toISOString()
  };

  users.push(newUser);
  writeCollection('users', users);

  // Log transaction locally
  const txns = readCollection('credit_transactions');
  txns.push({
    id:          generateId('ctx'),
    user_id:     newUser.id,
    amount:      10,
    type:        'signup_bonus',
    description: 'Welcome credits awarded on account creation',
    created_at:  new Date().toISOString()
  });
  writeCollection('credit_transactions', txns);

  return newUser;
}

/**
 * Promote a user to admin by email.
 */
export async function promoteToAdmin(email) {
  const cleanEmail = email.toLowerCase().trim();

  if (isDbConfigured()) {
    try {
      const db = getDbClient();
      const { data, error } = await db
        .from('users')
        .update({ role: 'admin' })
        .eq('email', cleanEmail)
        .select('id, email, role')
        .maybeSingle();
      if (!error && data) return data;
    } catch (err) {
      console.warn('[UserService] Supabase promoteToAdmin failed, using local store:', err.message);
    }
  }

  // Fallback to local store
  const users = readCollection('users');
  const user = users.find(u => u.email?.toLowerCase().trim() === cleanEmail);
  if (!user) throw new Error('User not found');
  user.role = 'admin';
  user.updated_at = new Date().toISOString();
  writeCollection('users', users);
  return { id: user.id, email: user.email, role: user.role };
}

/**
 * Update user profile details (e.g. fullName).
 */
export async function updateUserProfile(userId, { fullName }) {
  const cleanName = fullName !== undefined ? fullName.trim() : undefined;

  if (isDbConfigured()) {
    try {
      const db = getDbClient();
      const updateData = {};
      if (cleanName !== undefined) updateData.full_name = cleanName;

      const { data, error } = await db
        .from('users')
        .update(updateData)
        .eq('id', userId)
        .select('*')
        .maybeSingle();

      if (!error && data) return data;
    } catch (err) {
      console.warn('[UserService] Supabase updateUserProfile failed, using local store:', err.message);
    }
  }

  // Fallback to local store
  const users = readCollection('users');
  const user = users.find(u => String(u.id) === String(userId));
  if (!user) throw new Error('User not found');
  if (cleanName !== undefined) user.full_name = cleanName;
  user.updated_at = new Date().toISOString();
  writeCollection('users', users);
  return user;
}

/**
 * Get subscription record for a user.
 */
export async function getUserSubscription(userId) {
  if (isDbConfigured()) {
    try {
      const db = getDbClient();
      const { data, error } = await db
        .from('subscriptions')
        .select('*')
        .eq('user_id', userId)
        .maybeSingle();
      if (error && error.code !== 'PGRST116') throw error;
      if (data) return data;
    } catch (err) {
      console.warn('[UserService] Supabase getUserSubscription failed, using local store:', err.message);
    }
  }

  // Fallback to local store
  const subs = readCollection('subscriptions');
  return subs.find(s => String(s.user_id) === String(userId)) || null;
}

/**
 * Update user subscription plan and persist to users and subscriptions tables.
 */
export async function updateUserPlan(userId, plan) {
  const validPlans = ['free', 'pro', 'business'];
  const targetPlan = String(plan || 'free').toLowerCase();
  if (!validPlans.includes(targetPlan)) {
    throw new Error('Invalid plan selection. Choose free, pro, or business.');
  }

  if (isDbConfigured()) {
    try {
      const db = getDbClient();
      const { data: user, error: userError } = await db
        .from('users')
        .update({ plan: targetPlan })
        .eq('id', userId)
        .select('*')
        .maybeSingle();

      if (!userError && user) {
        const existingSub = await getUserSubscription(userId);
        let subscription = null;
        if (existingSub) {
          const { data: subData } = await db
            .from('subscriptions')
            .update({
              plan: targetPlan,
              status: 'active',
              started_at: new Date().toISOString()
            })
            .eq('user_id', userId)
            .select('*')
            .maybeSingle();
          subscription = subData;
        } else {
          const { data: subData } = await db
            .from('subscriptions')
            .insert({
              user_id: userId,
              plan: targetPlan,
              status: 'active',
              started_at: new Date().toISOString()
            })
            .select('*')
            .maybeSingle();
          subscription = subData;
        }
        return { user, subscription };
      }
    } catch (err) {
      console.warn('[UserService] Supabase updateUserPlan failed, using local store:', err.message);
    }
  }

  // Fallback to local store
  const users = readCollection('users');
  const user = users.find(u => String(u.id) === String(userId));
  if (!user) throw new Error('User not found');
  user.plan = targetPlan;
  user.updated_at = new Date().toISOString();
  writeCollection('users', users);

  const subs = readCollection('subscriptions');
  let sub = subs.find(s => String(s.user_id) === String(userId));
  if (sub) {
    sub.plan = targetPlan;
    sub.status = 'active';
    sub.started_at = new Date().toISOString();
  } else {
    sub = {
      id: generateId('sub'),
      user_id: userId,
      plan: targetPlan,
      status: 'active',
      started_at: new Date().toISOString()
    };
    subs.push(sub);
  }
  writeCollection('subscriptions', subs);

  return { user, subscription: sub };
}

// ── Credits ───────────────────────────────────────────────────────────────────

/**
 * Deduct credits from user account and record usage in credit_transactions table.
 */
export async function deductCredits(userId, amount = 1, description = 'Metadata generation usage') {
  const numAmount = Math.max(1, parseInt(amount, 10) || 1);
  const user = await findUserById(userId);
  if (!user) throw new Error('User not found');

  if (user.credits < numAmount) {
    throw new Error(`Insufficient credits. You have ${user.credits} credits, but ${numAmount} required.`);
  }

  const newBalance = user.credits - numAmount;

  if (isDbConfigured()) {
    try {
      const db = getDbClient();
      const { data: updatedUser, error: updateError } = await db
        .from('users')
        .update({ credits: newBalance })
        .eq('id', userId)
        .select('*')
        .maybeSingle();

      if (!updateError && updatedUser) {
        let transaction = null;
        try {
          const { data: txnData } = await db
            .from('credit_transactions')
            .insert({
              user_id: userId,
              amount: -numAmount,
              type: 'usage',
              description: description || 'Metadata generation'
            })
            .select('*')
            .maybeSingle();
          transaction = txnData;
        } catch (_) {}
        return { user: updatedUser, credits: updatedUser.credits, transaction };
      }
    } catch (err) {
      console.warn('[UserService] Supabase deductCredits failed, using local store:', err.message);
    }
  }

  // Fallback to local store
  const users = readCollection('users');
  const localUser = users.find(u => String(u.id) === String(userId));
  if (!localUser) throw new Error('User not found');
  localUser.credits = newBalance;
  localUser.updated_at = new Date().toISOString();
  writeCollection('users', users);

  const txns = readCollection('credit_transactions');
  const txn = {
    id: generateId('ctx'),
    user_id: userId,
    amount: -numAmount,
    type: 'usage',
    description: description || 'Metadata generation',
    created_at: new Date().toISOString()
  };
  txns.push(txn);
  writeCollection('credit_transactions', txns);

  return { user: localUser, credits: localUser.credits, transaction: txn };
}

/**
 * Get credit transaction history for a user.
 */
export async function getCreditHistory(userId, limit = 20) {
  if (isDbConfigured()) {
    try {
      const db = getDbClient();
      const { data, error } = await db
        .from('credit_transactions')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(limit);
      if (!error && data) return data;
    } catch (err) {
      console.warn('[UserService] Supabase getCreditHistory failed, using local store:', err.message);
    }
  }

  // Fallback to local store
  const txns = readCollection('credit_transactions');
  return txns
    .filter(t => String(t.user_id) === String(userId))
    .sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0))
    .slice(0, limit);
}

/**
 * Set user credits to an exact amount.
 */
export async function adminSetCredits(userId, exactAmount, description = 'Admin set exact credits') {
  const targetAmount = parseInt(exactAmount, 10);
  if (isNaN(targetAmount) || targetAmount < 0) throw new Error('Target amount must be a positive integer or zero');

  const user = await findUserById(userId);
  if (!user) throw new Error('User not found');

  const difference = targetAmount - user.credits;

  if (isDbConfigured()) {
    try {
      const db = getDbClient();
      const { data: updatedUser, error: updateError } = await db
        .from('users')
        .update({ credits: targetAmount })
        .eq('id', userId)
        .select('*')
        .maybeSingle();

      if (!updateError && updatedUser) {
        let transaction = null;
        if (difference !== 0) {
          try {
            const { data: txnData } = await db
              .from('credit_transactions')
              .insert({
                user_id: userId,
                amount: difference,
                type: 'admin_grant',
                description: description || `Admin set credits to ${targetAmount}`
              })
              .select('*')
              .maybeSingle();
            transaction = txnData;
          } catch (_) {}
        }
        return { user: updatedUser, credits: updatedUser.credits, transaction };
      }
    } catch (err) {
      console.warn('[UserService] Supabase adminSetCredits failed, using local store:', err.message);
    }
  }

  // Fallback to local store
  const users = readCollection('users');
  const localUser = users.find(u => String(u.id) === String(userId));
  if (!localUser) throw new Error('User not found');
  localUser.credits = targetAmount;
  localUser.updated_at = new Date().toISOString();
  writeCollection('users', users);

  let transaction = null;
  if (difference !== 0) {
    const txns = readCollection('credit_transactions');
    transaction = {
      id: generateId('ctx'),
      user_id: userId,
      amount: difference,
      type: 'admin_grant',
      description: description || `Admin set credits to ${targetAmount}`,
      created_at: new Date().toISOString()
    };
    txns.push(transaction);
    writeCollection('credit_transactions', txns);
  }

  return { user: localUser, credits: localUser.credits, transaction };
}

/**
 * Add / Grant credits to user account.
 */
export async function grantCredits(userId, amount, type = 'admin_grant', description = 'Credits added') {
  const numAmount = parseInt(amount, 10);
  if (!numAmount || numAmount <= 0) throw new Error('Grant amount must be a positive integer');

  const user = await findUserById(userId);
  if (!user) throw new Error('User not found');

  const newBalance = user.credits + numAmount;

  if (isDbConfigured()) {
    try {
      const db = getDbClient();
      const { data: updatedUser, error: updateError } = await db
        .from('users')
        .update({ credits: newBalance })
        .eq('id', userId)
        .select('*')
        .maybeSingle();

      if (!updateError && updatedUser) {
        let transaction = null;
        try {
          const { data: txnData } = await db
            .from('credit_transactions')
            .insert({
              user_id: userId,
              amount: numAmount,
              type: type || 'admin_grant',
              description: description || 'Credits granted'
            })
            .select('*')
            .maybeSingle();
          transaction = txnData;
        } catch (_) {}
        return { user: updatedUser, credits: updatedUser.credits, transaction };
      }
    } catch (err) {
      console.warn('[UserService] Supabase grantCredits failed, using local store:', err.message);
    }
  }

  // Fallback to local store
  const users = readCollection('users');
  const localUser = users.find(u => String(u.id) === String(userId));
  if (!localUser) throw new Error('User not found');
  localUser.credits = newBalance;
  localUser.updated_at = new Date().toISOString();
  writeCollection('users', users);

  const txns = readCollection('credit_transactions');
  const txn = {
    id: generateId('ctx'),
    user_id: userId,
    amount: numAmount,
    type: type || 'admin_grant',
    description: description || 'Credits granted',
    created_at: new Date().toISOString()
  };
  txns.push(txn);
  writeCollection('credit_transactions', txns);

  return { user: localUser, credits: localUser.credits, transaction: txn };
}

// ── Admin Functions ──────────────────────────────────────────────────────────

/**
 * List all users with optional search query (email or full_name).
 */
export async function listAllUsers({ search = '', limit = 100, offset = 0 } = {}) {
  const searchTerm = String(search || '').trim().toLowerCase();

  if (isDbConfigured()) {
    try {
      const db = getDbClient();
      let query = db
        .from('users')
        .select('id, email, full_name, role, plan, credits, is_active, created_at, updated_at', { count: 'exact' });

      if (searchTerm) {
        // Safe sanitization for PostgREST
        const safeTerm = searchTerm.replace(/[^a-zA-Z0-9@._-]/g, '');
        if (safeTerm) {
          query = query.or(`email.ilike.%${safeTerm}%,full_name.ilike.%${safeTerm}%`);
        }
      }

      query = query
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1);

      const { data, error, count } = await query;
      if (!error && data) {
        return { users: data, count: count || data.length };
      }
    } catch (err) {
      console.warn('[UserService] Supabase listAllUsers failed, querying local store:', err.message);
    }
  }

  // Fallback to local store
  const users = readCollection('users');
  let filtered = users;
  if (searchTerm) {
    filtered = users.filter(u => {
      const em = (u.email || '').toLowerCase();
      const fn = (u.full_name || '').toLowerCase();
      return em.includes(searchTerm) || fn.includes(searchTerm);
    });
  }

  filtered.sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
  const paged = filtered.slice(offset, offset + limit);
  return { users: paged, count: filtered.length };
}

/**
 * Toggle user active status (deactivate or reactivate account).
 */
export async function toggleUserActiveStatus(userId, isActive) {
  if (isDbConfigured()) {
    try {
      const db = getDbClient();
      const { data, error } = await db
        .from('users')
        .update({ is_active: !!isActive })
        .eq('id', userId)
        .select('id, email, full_name, role, plan, credits, is_active, created_at')
        .maybeSingle();

      if (!error && data) return data;
    } catch (err) {
      console.warn('[UserService] Supabase toggleUserActiveStatus failed, using local store:', err.message);
    }
  }

  // Fallback to local store
  const users = readCollection('users');
  const user = users.find(u => String(u.id) === String(userId));
  if (!user) throw new Error('User not found');
  user.is_active = !!isActive;
  user.updated_at = new Date().toISOString();
  writeCollection('users', users);
  return user;
}

/**
 * Admin adjustment of user credits (add positive or deduct negative credits).
 */
export async function adminAdjustCredits(userId, amount, description = 'Admin credit adjustment') {
  const numAmount = parseInt(amount, 10);
  if (isNaN(numAmount) || numAmount === 0) throw new Error('Adjustment amount must be a non-zero integer');

  const user = await findUserById(userId);
  if (!user) throw new Error('User not found');

  const newBalance = Math.max(0, user.credits + numAmount);

  if (isDbConfigured()) {
    try {
      const db = getDbClient();
      const { data: updatedUser, error: updateError } = await db
        .from('users')
        .update({ credits: newBalance })
        .eq('id', userId)
        .select('id, email, full_name, role, plan, credits, is_active, created_at')
        .maybeSingle();

      if (!updateError && updatedUser) {
        let transaction = null;
        try {
          const { data: txnData } = await db
            .from('credit_transactions')
            .insert({
              user_id: userId,
              amount: numAmount,
              type: 'admin_grant',
              description: description || `Admin adjustment (${numAmount > 0 ? '+' : ''}${numAmount})`
            })
            .select('*')
            .maybeSingle();
          transaction = txnData;
        } catch (_) {}
        return { user: updatedUser, credits: updatedUser.credits, transaction };
      }
    } catch (err) {
      console.warn('[UserService] Supabase adminAdjustCredits failed, using local store:', err.message);
    }
  }

  // Fallback to local store
  const users = readCollection('users');
  const localUser = users.find(u => String(u.id) === String(userId));
  if (!localUser) throw new Error('User not found');
  localUser.credits = newBalance;
  localUser.updated_at = new Date().toISOString();
  writeCollection('users', users);

  const txns = readCollection('credit_transactions');
  const transaction = {
    id: generateId('ctx'),
    user_id: userId,
    amount: numAmount,
    type: 'admin_grant',
    description: description || `Admin adjustment (${numAmount > 0 ? '+' : ''}${numAmount})`,
    created_at: new Date().toISOString()
  };
  txns.push(transaction);
  writeCollection('credit_transactions', txns);

  return { user: localUser, credits: localUser.credits, transaction };
}

// ── Sessions ──────────────────────────────────────────────────────────────────

/**
 * Create a new session record associated with a user.
 */
export async function createSession({ userId, tokenHash, expiresAt, ipAddress, userAgent }) {
  if (isDbConfigured()) {
    try {
      const db = getDbClient();
      const { error } = await db.from('sessions').insert({
        user_id:    userId,
        token_hash: tokenHash,
        expires_at: expiresAt,
        ip_address: ipAddress || null,
        user_agent: userAgent || null
      });
      if (!error) return;
    } catch (err) {
      console.warn('[UserService] Supabase createSession failed, using local store:', err.message);
    }
  }

  // Fallback to local store
  const sessions = readCollection('sessions');
  sessions.push({
    id:         generateId('ses'),
    user_id:    userId,
    token_hash: tokenHash,
    expires_at: expiresAt,
    ip_address: ipAddress || null,
    user_agent: userAgent || null,
    created_at: new Date().toISOString()
  });
  writeCollection('sessions', sessions);
}

/**
 * Delete a specific session by its token hash (on logout).
 */
export async function deleteSession(tokenHash) {
  if (isDbConfigured()) {
    try {
      const db = getDbClient();
      await db.from('sessions').delete().eq('token_hash', tokenHash);
      return;
    } catch (err) {
      console.warn('[UserService] Supabase deleteSession failed, using local store:', err.message);
    }
  }

  // Fallback to local store
  const sessions = readCollection('sessions');
  const filtered = sessions.filter(s => s.token_hash !== tokenHash);
  writeCollection('sessions', filtered);
}

/**
 * Remove all expired sessions for a user (maintenance on login).
 */
export async function cleanExpiredSessions(userId) {
  if (isDbConfigured()) {
    try {
      const db = getDbClient();
      await db
        .from('sessions')
        .delete()
        .eq('user_id', userId)
        .lt('expires_at', new Date().toISOString());
      return;
    } catch (_) {}
  }

  // Fallback to local store
  const sessions = readCollection('sessions');
  const now = new Date();
  const filtered = sessions.filter(s => {
    if (String(s.user_id) === String(userId)) {
      return new Date(s.expires_at) >= now;
    }
    return true;
  });
  writeCollection('sessions', filtered);
}

/**
 * Look up a session by token hash.
 * Returns the session row, or null if not found / expired.
 */
export async function findSession(tokenHash) {
  if (isDbConfigured()) {
    try {
      const db = getDbClient();
      const { data, error } = await db
        .from('sessions')
        .select('id, user_id, expires_at')
        .eq('token_hash', tokenHash)
        .maybeSingle();
      if (!error && data) {
        if (new Date(data.expires_at) < new Date()) return null;
        return data;
      }
    } catch (err) {
      console.warn('[UserService] Supabase findSession failed, using local store:', err.message);
    }
  }

  // Fallback to local store
  const sessions = readCollection('sessions');
  const session = sessions.find(s => s.token_hash === tokenHash);
  if (!session) return null;
  if (new Date(session.expires_at) < new Date()) return null;
  return session;
}
