/**
 * User Service — all database operations for the users, sessions,
 * and credit_transactions tables.
 */

import { getDbClient } from './dbClient.js';

// ── Users ─────────────────────────────────────────────────────────────────────

/**
 * Find a user by email address. Returns null if not found.
 */
export async function findUserByEmail(email) {
  const db = getDbClient();
  const { data, error } = await db
    .from('users')
    .select('*')
    .eq('email', email.toLowerCase().trim())
    .maybeSingle();
  // PGRST116 = "no rows returned" — not an actual error
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

/**
 * Find a user by UUID. Returns null if not found.
 */
export async function findUserById(id) {
  const db = getDbClient();
  const { data, error } = await db
    .from('users')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

/**
 * Create a new user record and log the signup_bonus credit transaction.
 * Returns the newly created user row.
 */
export async function createUser({ email, passwordHash, fullName }) {
  const db = getDbClient();

  const { data: user, error: userError } = await db
    .from('users')
    .insert({
      email:         email.toLowerCase().trim(),
      password_hash: passwordHash,
      full_name:     fullName.trim(),
      role:          'user',
      plan:          'free',
      credits:       10,
      is_active:     true
    })
    .select('*')
    .maybeSingle();

  if (userError) throw userError;

  // Log the initial credit grant (non-fatal if this fails)
  try {
    await db.from('credit_transactions').insert({
      user_id:     user.id,
      amount:      10,
      type:        'signup_bonus',
      description: 'Welcome credits awarded on account creation'
    });
  } catch (err) {
    console.warn('[UserService] Failed to log signup credit transaction:', err?.message || err);
  }

  return user;
}

/**
 * Promote a user to admin by email. Used by the createAdmin script.
 */
export async function promoteToAdmin(email) {
  const db = getDbClient();
  const { data, error } = await db
    .from('users')
    .update({ role: 'admin' })
    .eq('email', email.toLowerCase().trim())
    .select('id, email, role')
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Update user profile details (e.g. fullName).
 */
export async function updateUserProfile(userId, { fullName }) {
  const db = getDbClient();
  const updateData = {};
  if (fullName !== undefined) updateData.full_name = fullName.trim();

  const { data, error } = await db
    .from('users')
    .update(updateData)
    .eq('id', userId)
    .select('*')
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Get subscription record for a user.
 */
export async function getUserSubscription(userId) {
  const db = getDbClient();
  const { data, error } = await db
    .from('subscriptions')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') throw error;
  return data || null;
}

/**
 * Update user subscription plan and persist to users and subscriptions tables.
 */
export async function updateUserPlan(userId, plan) {
  const db = getDbClient();
  const validPlans = ['free', 'pro', 'business'];
  if (!validPlans.includes(plan)) {
    throw new Error('Invalid plan selection. Choose free, pro, or business.');
  }

  // 1. Update plan in users table
  const { data: user, error: userError } = await db
    .from('users')
    .update({ plan })
    .eq('id', userId)
    .select('*')
    .maybeSingle();

  if (userError) throw userError;

  // 2. Upsert record in subscriptions table
  const existingSub = await getUserSubscription(userId);
  let subscription = null;

  if (existingSub) {
    const { data: subData } = await db
      .from('subscriptions')
      .update({
        plan,
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
        plan,
        status: 'active',
        started_at: new Date().toISOString()
      })
      .select('*')
      .maybeSingle();
    subscription = subData;
  }

  return { user, subscription };
}

// ── Credits ───────────────────────────────────────────────────────────────────

/**
 * Deduct credits from user account and record usage in credit_transactions table.
 */
export async function deductCredits(userId, amount = 1, description = 'Metadata generation usage') {
  const db = getDbClient();
  const numAmount = Math.max(1, parseInt(amount, 10) || 1);

  // 1. Fetch current balance
  const user = await findUserById(userId);
  if (!user) throw new Error('User not found');

  if (user.credits < numAmount) {
    throw new Error(`Insufficient credits. You have ${user.credits} credits, but ${numAmount} required.`);
  }

  const newBalance = user.credits - numAmount;

  // 2. Update users table balance
  const { data: updatedUser, error: updateError } = await db
    .from('users')
    .update({ credits: newBalance })
    .eq('id', userId)
    .select('*')
    .maybeSingle();

  if (updateError) throw updateError;

  // 3. Record transaction in credit_transactions table
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
  } catch (err) {
    console.warn('[UserService] Failed to insert credit transaction:', err?.message || err);
  }

  return { user: updatedUser, credits: updatedUser.credits, transaction };
}

/**
 * Get credit transaction history for a user.
 */
export async function getCreditHistory(userId, limit = 20) {
  const db = getDbClient();
  const { data, error } = await db
    .from('credit_transactions')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (error) throw error;
  return data || [];
}

/**
 * Set user credits to an exact amount.
 */
export async function adminSetCredits(userId, exactAmount, description = 'Admin set exact credits') {
  const db = getDbClient();
  const targetAmount = parseInt(exactAmount, 10);
  if (isNaN(targetAmount) || targetAmount < 0) throw new Error('Target amount must be a positive integer or zero');

  const user = await findUserById(userId);
  if (!user) throw new Error('User not found');

  const difference = targetAmount - user.credits;
  
  const { data: updatedUser, error: updateError } = await db
    .from('users')
    .update({ credits: targetAmount })
    .eq('id', userId)
    .select('*')
    .maybeSingle();

  if (updateError) throw updateError;

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
    } catch (err) {
      console.warn('[UserService] Failed to log admin set credits transaction:', err?.message || err);
    }
  }

  return { user: updatedUser, credits: updatedUser.credits, transaction };
}

/**
 * Add / Grant credits to user account.
 */
export async function grantCredits(userId, amount, type = 'admin_grant', description = 'Credits added') {
  const db = getDbClient();
  const numAmount = parseInt(amount, 10);
  if (!numAmount || numAmount <= 0) throw new Error('Grant amount must be a positive integer');

  const user = await findUserById(userId);
  if (!user) throw new Error('User not found');

  const newBalance = user.credits + numAmount;

  const { data: updatedUser, error: updateError } = await db
    .from('users')
    .update({ credits: newBalance })
    .eq('id', userId)
    .select('*')
    .maybeSingle();

  if (updateError) throw updateError;

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
  } catch (err) {
    console.warn('[UserService] Failed to log grant transaction:', err?.message || err);
  }

  return { user: updatedUser, credits: updatedUser.credits, transaction };
}

// ── Admin Functions ──────────────────────────────────────────────────────────

/**
 * List all users with optional search query (email or full_name).
 */
export async function listAllUsers({ search = '', limit = 100, offset = 0 } = {}) {
  const db = getDbClient();
  let query = db
    .from('users')
    .select('id, email, full_name, role, plan, credits, is_active, created_at, updated_at', { count: 'exact' });

  if (search && search.trim()) {
    const term = `%${search.trim().toLowerCase()}%`;
    query = query.or(`email.ilike.${term},full_name.ilike.${term}`);
  }

  query = query
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  const { data, error, count } = await query;
  if (error) throw error;
  return { users: data || [], count: count || 0 };
}

/**
 * Toggle user active status (deactivate or reactivate account).
 */
export async function toggleUserActiveStatus(userId, isActive) {
  const db = getDbClient();
  const { data, error } = await db
    .from('users')
    .update({ is_active: !!isActive })
    .eq('id', userId)
    .select('id, email, full_name, role, plan, credits, is_active, created_at')
    .maybeSingle();

  if (error) throw error;
  return data;
}

/**
 * Admin adjustment of user credits (add positive or deduct negative credits).
 */
export async function adminAdjustCredits(userId, amount, description = 'Admin credit adjustment') {
  const db = getDbClient();
  const numAmount = parseInt(amount, 10);
  if (isNaN(numAmount) || numAmount === 0) throw new Error('Adjustment amount must be a non-zero integer');

  const user = await findUserById(userId);
  if (!user) throw new Error('User not found');

  const newBalance = Math.max(0, user.credits + numAmount);

  const { data: updatedUser, error: updateError } = await db
    .from('users')
    .update({ credits: newBalance })
    .eq('id', userId)
    .select('id, email, full_name, role, plan, credits, is_active, created_at')
    .maybeSingle();

  if (updateError) throw updateError;

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
  } catch (err) {
    console.warn('[UserService] Failed to log admin credit adjustment transaction:', err?.message || err);
  }

  return { user: updatedUser, credits: updatedUser.credits, transaction };
}

// ── Sessions ──────────────────────────────────────────────────────────────────

/**
 * Create a new session record associated with a user.
 */
export async function createSession({ userId, tokenHash, expiresAt, ipAddress, userAgent }) {
  const db = getDbClient();
  const { error } = await db.from('sessions').insert({
    user_id:    userId,
    token_hash: tokenHash,
    expires_at: expiresAt,
    ip_address: ipAddress || null,
    user_agent: userAgent || null
  });
  if (error) throw error;
}

/**
 * Delete a specific session by its token hash (on logout).
 */
export async function deleteSession(tokenHash) {
  const db = getDbClient();
  try {
    await db.from('sessions').delete().eq('token_hash', tokenHash);
  } catch (err) {
    console.warn('[UserService] Delete session failed:', err?.message || err);
  }
}

/**
 * Remove all expired sessions for a user (maintenance on login).
 */
export async function cleanExpiredSessions(userId) {
  const db = getDbClient();
  try {
    await db
      .from('sessions')
      .delete()
      .eq('user_id', userId)
      .lt('expires_at', new Date().toISOString());
  } catch (err) {
    console.warn('[UserService] Clean expired sessions failed:', err?.message || err);
  }
}

/**
 * Look up a session by token hash.
 * Returns the session row, or null if not found / expired.
 */
export async function findSession(tokenHash) {
  const db = getDbClient();
  const { data, error } = await db
    .from('sessions')
    .select('id, user_id, expires_at')
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;
  if (!data) return null;
  // Treat expired sessions as not found
  if (new Date(data.expires_at) < new Date()) return null;
  return data;
}
