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

function getApiBase() {
  if (typeof window === 'undefined') return '';
  const port = window.location.port;
  if (port && port !== '3000' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return `http://${window.location.hostname}:3000`;
  }
  return '';
}

// ── Persistent (localStorage) + In-memory session state ──────────────────────
function getSavedUser() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem('pk_auth_user');
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function saveUser(user) {
  if (typeof localStorage === 'undefined') return;
  try {
    if (user) {
      localStorage.setItem('pk_auth_user', JSON.stringify(user));
    } else {
      localStorage.removeItem('pk_auth_user');
      localStorage.removeItem('pk_auth_token');
    }
  } catch (_) {}
}

function getSavedToken() {
  if (typeof localStorage === 'undefined') return null;
  try {
    return localStorage.getItem('pk_auth_token') || null;
  } catch (_) {
    return null;
  }
}

function saveToken(token) {
  if (typeof localStorage === 'undefined') return;
  try {
    if (token) {
      localStorage.setItem('pk_auth_token', token);
    } else {
      localStorage.removeItem('pk_auth_token');
    }
  } catch (_) {}
}

function getAuthHeaders(extraHeaders = {}) {
  const headers = { 'Content-Type': 'application/json', ...extraHeaders };
  const token = getSavedToken();
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

let _currentUser = getSavedUser();

export function getCurrentUser() { return _currentUser; }
export function isLoggedIn()     { return !!_currentUser; }

/**
 * Called on page load — asks the server if the browser's cookie is valid.
 * Returns the user object if authenticated, or null if not.
 * Preserves cached user if server is temporarily unreachable.
 */
export async function checkAuthState() {
  _currentUser = getSavedUser();
  try {
    const res = await fetch(`${getApiBase()}/api/auth/me`, {
      method:      'GET',
      credentials: 'include',
      headers:     getAuthHeaders()
    });
    if (res.ok) {
      const data = await res.json();
      if (data.ok && data.user) {
        _currentUser = data.user;
        saveUser(data.user);
        if (data.token) saveToken(data.token);
        return data.user;
      }
    } else if (res.status === 401 || res.status === 403) {
      _currentUser = null;
      saveUser(null);
      return null;
    }
  } catch (_) {
    // Network error or local mode — retain cached session from localStorage
  }
  return _currentUser;
}

/**
 * Sign up with name, email, and password.
 * On success, sets the in-memory user and returns { ok: true, user }.
 * On failure, returns { ok: false, message }.
 */
export async function signup({ fullName, email, password }) {
  try {
    const res = await fetch(`${getApiBase()}/api/auth/signup`, {
      method:      'POST',
      credentials: 'include',
      headers:     getAuthHeaders(),
      body:        JSON.stringify({ fullName, email, password })
    });
    const data = await res.json();
    if (res.ok && data.ok && data.user) {
      _currentUser = data.user;
      saveUser(data.user);
      if (data.token) saveToken(data.token);
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
    const res = await fetch(`${getApiBase()}/api/auth/login`, {
      method:      'POST',
      credentials: 'include',
      headers:     getAuthHeaders(),
      body:        JSON.stringify({ email, password })
    });
    const data = await res.json();
    if (res.ok && data.ok && data.user) {
      _currentUser = data.user;
      saveUser(data.user);
      if (data.token) saveToken(data.token);
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
  saveUser(null);
  try {
    await fetch(`${getApiBase()}/api/auth/logout`, {
      method:      'POST',
      credentials: 'include',
      headers:     getAuthHeaders()
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
    const res = await fetch(`${getApiBase()}/api/user/profile`, {
      method:      'GET',
      credentials: 'include',
      headers:     getAuthHeaders()
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
    const res = await fetch(`${getApiBase()}/api/user/profile`, {
      method:      'PUT',
      credentials: 'include',
      headers:     getAuthHeaders(),
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
    const res = await fetch(`${getApiBase()}/api/user/plan`, {
      method:      'POST',
      credentials: 'include',
      headers:     getAuthHeaders(),
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
    const res = await fetch(`${getApiBase()}/api/user/credits/deduct`, {
      method:      'POST',
      credentials: 'include',
      headers:     getAuthHeaders(),
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
    const res = await fetch(`${getApiBase()}/api/admin/users${q}`, {
      method: 'GET',
      credentials: 'include',
      headers: getAuthHeaders()
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
    const res = await fetch(`${getApiBase()}/api/admin/users/${userId}`, {
      method: 'GET',
      credentials: 'include',
      headers: getAuthHeaders()
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
    const res = await fetch(`${getApiBase()}/api/admin/users/${userId}/plan`, {
      method: 'POST',
      credentials: 'include',
      headers: getAuthHeaders(),
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
    const res = await fetch(`${getApiBase()}/api/admin/users/${userId}/status`, {
      method: 'POST',
      credentials: 'include',
      headers: getAuthHeaders(),
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
    const res = await fetch(`${getApiBase()}/api/admin/users/${userId}/credits`, {
      method: 'POST',
      credentials: 'include',
      headers: getAuthHeaders(),
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
    const res = await fetch(`${getApiBase()}/api/payment/plans`, {
      credentials: 'include',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (res.ok && data.ok) return { ok: true, plans: data.plans };
    return { ok: false, message: data.message || 'Failed to load plans' };
  } catch (err) {
    return { ok: false, message: 'Network error' };
  }
}

export async function initiateCheckout(plan, paymentMethod = 'bkash') {
  try {
    const res = await fetch(`${getApiBase()}/api/payment/checkout`, {
      method: 'POST',
      credentials: 'include',
      headers: getAuthHeaders(),
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
    const res = await fetch(`${getApiBase()}/api/payment/submit`, {
      method: 'POST',
      credentials: 'include',
      headers: getAuthHeaders(),
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
    const url = status ? `${getApiBase()}/api/admin/payments?status=${status}` : `${getApiBase()}/api/admin/payments`;
    const res = await fetch(url, {
      credentials: 'include',
      headers: getAuthHeaders()
    });
    const data = await res.json();
    if (res.ok && data.ok) return { ok: true, payments: data.payments, count: data.count };
    return { ok: false, message: data.message || 'Failed to fetch payments' };
  } catch (err) {
    return { ok: false, message: 'Network error' };
  }
}

export async function adminApprovePayment(paymentId, adminNotes = '') {
  try {
    const res = await fetch(`${getApiBase()}/api/admin/payments/${paymentId}/approve`, {
      method: 'POST',
      credentials: 'include',
      headers: getAuthHeaders(),
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
    const res = await fetch(`${getApiBase()}/api/admin/payments/${paymentId}/reject`, {
      method: 'POST',
      credentials: 'include',
      headers: getAuthHeaders(),
      body: JSON.stringify({ adminNotes })
    });
    const data = await res.json();
    if (res.ok && data.ok) return data;
    return { ok: false, message: data.message || 'Payment rejection failed' };
  } catch (err) {
    return { ok: false, message: 'Network error' };
  }
}





