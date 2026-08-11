/**
 * Real Authentication Client — js/auth.js
 *
 * Talks to the backend /api/auth/* endpoints.
 * Auth is OPTIONAL — unauthenticated users can still use the full tool.
 * Logged-in users get persistent accounts, credits, and future subscription features.
 *
 * Token security: the JWT lives in an httpOnly cookie managed by the server.
 * This file never touches the token directly — it just calls the API.
 */

// ── In-memory session state (cleared on page refresh, restored by checkAuthState) ──
let _currentUser = null;

export function getCurrentUser() { return _currentUser; }
export function isLoggedIn()     { return !!_currentUser; }

/**
 * Called on page load — asks the server if the browser's cookie is valid.
 * Returns the user object if authenticated, or null if not.
 * Silently degrades to null if the backend is unreachable.
 */
export async function checkAuthState() {
  try {
    const res = await fetch('/api/auth/me', {
      method:      'GET',
      credentials: 'same-origin',
      headers:     { 'Content-Type': 'application/json' }
    });
    if (res.ok) {
      const data = await res.json();
      if (data.ok && data.user) {
        _currentUser = data.user;
        return data.user;
      }
    }
  } catch (_) {
    // Network error or server not running — treat as not logged in
  }
  _currentUser = null;
  return null;
}

/**
 * Sign up with name, email, and password.
 * On success, sets the in-memory user and returns { ok: true, user }.
 * On failure, returns { ok: false, message }.
 */
export async function signup({ fullName, email, password }) {
  try {
    const res = await fetch('/api/auth/signup', {
      method:      'POST',
      credentials: 'same-origin',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({ fullName, email, password })
    });
    const data = await res.json();
    if (res.ok && data.ok && data.user) {
      _currentUser = data.user;
      return { ok: true, user: data.user };
    }
    return { ok: false, message: data.message || 'Signup failed. Please try again.' };
  } catch (_) {
    return { ok: false, message: 'Network error. Please check your connection and try again.' };
  }
}

/**
 * Log in with email and password.
 * On success, sets the in-memory user and returns { ok: true, user }.
 * On failure, returns { ok: false, message }.
 */
export async function login({ email, password }) {
  try {
    const res = await fetch('/api/auth/login', {
      method:      'POST',
      credentials: 'same-origin',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (res.ok && data.ok && data.user) {
      _currentUser = data.user;
      return { ok: true, user: data.user };
    }
    return { ok: false, message: data.message || 'Login failed. Please try again.' };
  } catch (_) {
    return { ok: false, message: 'Network error. Please check your connection and try again.' };
  }
}

/**
 * Log out — tells the server to delete the session (immediately invalidates
 * the token), then clears in-memory user state.
 */
export async function logout() {
  _currentUser = null;
  try {
    await fetch('/api/auth/logout', {
      method:      'POST',
      credentials: 'same-origin',
      headers:     { 'Content-Type': 'application/json' }
    });
  } catch (_) {
    // Even if the request fails, clear local state
  }
}

/**
 * Fetch full profile and subscription details from GET /api/user/profile.
 */
export async function fetchUserProfile() {
  try {
    const res = await fetch('/api/user/profile', {
      method:      'GET',
      credentials: 'same-origin',
      headers:     { 'Content-Type': 'application/json' }
    });
    if (res.ok) {
      const data = await res.json();
      if (data.ok && data.user) {
        _currentUser = data.user;
        return data;
      }
    }
  } catch (_) {}
  return null;
}

/**
 * Update user full name via PUT /api/user/profile.
 */
export async function updateProfile({ fullName }) {
  try {
    const res = await fetch('/api/user/profile', {
      method:      'PUT',
      credentials: 'same-origin',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({ fullName })
    });
    const data = await res.json();
    if (res.ok && data.ok && data.user) {
      _currentUser = data.user;
      return { ok: true, user: data.user };
    }
    return { ok: false, message: data.message || 'Failed to update profile.' };
  } catch (_) {
    return { ok: false, message: 'Network error. Please try again.' };
  }
}

/**
 * Switch/update subscription plan (free, pro, business) via POST /api/user/plan.
 */
export async function selectUserPlan(plan) {
  try {
    const res = await fetch('/api/user/plan', {
      method:      'POST',
      credentials: 'same-origin',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({ plan })
    });
    const data = await res.json();
    if (res.ok && data.ok && data.user) {
      _currentUser = data.user;
      return { ok: true, user: data.user, subscription: data.subscription, message: data.message };
    }
    return { ok: false, message: data.message || 'Failed to update plan.' };
  } catch (_) {
    return { ok: false, message: 'Network error. Please try again.' };
  }
}

/**
 * Deduct credits for logged-in user via POST /api/user/credits/deduct.
 */
export async function deductCredit(amount = 1, description = 'Metadata generation') {
  try {
    const res = await fetch('/api/user/credits/deduct', {
      method:      'POST',
      credentials: 'same-origin',
      headers:     { 'Content-Type': 'application/json' },
      body:        JSON.stringify({ amount, description })
    });
    const data = await res.json();
    if (res.ok && data.ok && data.user) {
      _currentUser = data.user;
      return { ok: true, user: data.user, credits: data.credits };
    }
    return { ok: false, message: data.message || 'Credit deduction failed.' };
  } catch (_) {
    return { ok: false, message: 'Network error during credit deduction.' };
  }
}

// ── Admin Client Functions ───────────────────────────────────────────────────

export async function adminFetchUsers(search = '') {
  try {
    const q = search ? `?search=${encodeURIComponent(search)}` : '';
    const res = await fetch(`/api/admin/users${q}`, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (res.ok && data.ok) return { ok: true, users: data.users, count: data.count };
    return { ok: false, message: data.message || 'Failed to fetch users' };
  } catch (err) {
    return { ok: false, message: 'Network error' };
  }
}

export async function adminGetUserDetail(userId) {
  try {
    const res = await fetch(`/api/admin/users/${userId}`, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    if (res.ok && data.ok) return { ok: true, user: data.user, subscription: data.subscription, transactions: data.transactions };
    return { ok: false, message: data.message || 'Failed to fetch user details' };
  } catch (err) {
    return { ok: false, message: 'Network error' };
  }
}

export async function adminUpdateUserPlan(userId, plan) {
  try {
    const res = await fetch(`/api/admin/users/${userId}/plan`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan })
    });
    const data = await res.json();
    if (res.ok && data.ok) return { ok: true, user: data.user, subscription: data.subscription, message: data.message };
    return { ok: false, message: data.message || 'Failed to update plan' };
  } catch (err) {
    return { ok: false, message: 'Network error' };
  }
}

export async function adminToggleUserStatus(userId, isActive) {
  try {
    const res = await fetch(`/api/admin/users/${userId}/status`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ isActive })
    });
    const data = await res.json();
    if (res.ok && data.ok) return { ok: true, user: data.user, message: data.message };
    return { ok: false, message: data.message || 'Failed to toggle status' };
  } catch (err) {
    return { ok: false, message: 'Network error' };
  }
}

export async function adminAdjustCredits(userId, amount, description) {
  try {
    const res = await fetch(`/api/admin/users/${userId}/credits`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount, description })
    });
    const data = await res.json();
    if (res.ok && data.ok) return { ok: true, user: data.user, credits: data.credits, transaction: data.transaction, message: data.message };
    return { ok: false, message: data.message || 'Failed to adjust credits' };
  } catch (err) {
    return { ok: false, message: 'Network error' };
  }
}

// ── Payment & Subscription Functions ──────────────────────────────────────────

export async function fetchPricingPlans() {
  try {
    const res = await fetch('/api/payment/plans');
    const data = await res.json();
    if (res.ok && data.ok) return { ok: true, plans: data.plans };
    return { ok: false, message: data.message || 'Failed to load plans' };
  } catch (err) {
    return { ok: false, message: 'Network error' };
  }
}

export async function initiateCheckout(plan, paymentMethod = 'bkash') {
  try {
    const res = await fetch('/api/payment/checkout', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan, paymentMethod })
    });
    const data = await res.json();
    if (res.ok && data.ok) return data;
    return { ok: false, message: data.message || 'Checkout failed' };
  } catch (err) {
    return { ok: false, message: 'Network error' };
  }
}

export async function submitManualPayment(data) {
  try {
    const res = await fetch('/api/payment/submit', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
    const result = await res.json();
    if (res.ok && result.ok) return result;
    return { ok: false, message: result.message || 'Payment submission failed' };
  } catch (err) {
    return { ok: false, message: 'Network error submitting payment' };
  }
}

export async function adminFetchPayments(status) {
  try {
    const url = status ? `/api/admin/payments?status=${status}` : '/api/admin/payments';
    const res = await fetch(url, { credentials: 'same-origin' });
    const data = await res.json();
    if (res.ok && data.ok) return { ok: true, payments: data.payments, count: data.count };
    return { ok: false, message: data.message || 'Failed to fetch payments' };
  } catch (err) {
    return { ok: false, message: 'Network error' };
  }
}

export async function adminApprovePayment(paymentId, adminNotes = '') {
  try {
    const res = await fetch(`/api/admin/payments/${paymentId}/approve`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminNotes })
    });
    const data = await res.json();
    if (res.ok && data.ok) return data;
    return { ok: false, message: data.message || 'Payment approval failed' };
  } catch (err) {
    return { ok: false, message: 'Network error' };
  }
}

export async function adminRejectPayment(paymentId, adminNotes = '') {
  try {
    const res = await fetch(`/api/admin/payments/${paymentId}/reject`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminNotes })
    });
    const data = await res.json();
    if (res.ok && data.ok) return data;
    return { ok: false, message: data.message || 'Payment rejection failed' };
  } catch (err) {
    return { ok: false, message: 'Network error' };
  }
}





