/**
 * Microstock Metadata Management Tool — Main Application Controller
 * Real Gemini AI BYOK + Batch Processing + CSV Export + Performance Optimizations
 */

import { PLATFORMS } from './platforms.js';
import { generateCsvContent, downloadCsvFile, validateBatch, generateCsvPreviewHtml } from './csvExporter.js';
import { setApiKey, hasApiKey, clearApiKey, getSessionKey, testConnection, generateMetadataForImage, isGeminiAnalyzable } from './geminiClient.js';
import { runBatchQueue } from './batchProcessor.js';
import { checkAuthState, login, signup, logout, getCurrentUser, isLoggedIn, fetchUserProfile, updateProfile, selectUserPlan, deductCredit, adminFetchUsers, adminGetUserDetail, adminUpdateUserPlan, adminToggleUserStatus, adminAdjustCredits, submitManualPayment, adminFetchPayments, adminApprovePayment, adminRejectPayment } from './auth.js';

// ─── Application State ─────────────────────────────────────────────────────
const state = {
  currentPlatform: PLATFORMS.adobe,
  mediaItems: [],
  selectedItemIds: new Set(),
  searchQuery: '',
  statusFilter: 'all',
  viewMode: 'table',
  isGenerating: false,
  stopBatch: false,
  detailItemId: null,
  includeBom: true,
  tutorialStep: 1,
  activeAssetTab: 'images',
  geminiConnected: false,
  activeAppMode: 'metadata',
  settingsEnabled: false,
  // Render throttle
  _renderPending: false,
  _lastStats: null
};

// ─── File type sets ────────────────────────────────────────────────────────
const IMAGE_EXTS  = new Set(['jpg','jpeg','png','webp','tiff','tif']);
const VECTOR_EXTS = new Set(['eps','ai','svg','pdf']);
const VIDEO_EXTS  = new Set(['mp4','mov','avi','webm']);
const ALL_EXTS    = new Set([...IMAGE_EXTS, ...VECTOR_EXTS, ...VIDEO_EXTS]);

// ─── Toast ─────────────────────────────────────────────────────────────────
export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast-item toast-${type}`;
  const icons = { success: '✅', error: '⚠️', info: '✨', warning: '🔔' };
  toast.innerHTML = `<span>${icons[type] || '✨'}</span><span>${escHtml(message)}</span>`;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s ease';
    setTimeout(() => toast.parentNode && toast.parentNode.removeChild(toast), 300);
  }, 3800);
}
window.showToast = showToast;

export function setBtnLoading(btn, isLoading) {
  if (!btn) return;
  if (isLoading) {
    btn.classList.add('btn-loading');
    btn.disabled = true;
  } else {
    btn.classList.remove('btn-loading');
    btn.disabled = false;
  }
}

// ─── Init ──────────────────────────────────────────────────────────────────
export async function initApp() {
  renderPlatforms();
  setupEventListeners();
  updateUI();
  renderTutorialStep();
  updateUploadZoneForTab();
  updateAiStatusBadge();

  // Check for existing session (restores login state after page refresh).
  // Auth is optional — this resolves quickly and never blocks the tool.
  try {
    await checkAuthState();
  } catch (_) {
    // Server may not be running locally — continue without auth
  }
  updateAuthNav();
}

// ─── Platform Selector ─────────────────────────────────────────────────────
function renderPlatforms() {
  const grid = document.getElementById('platform-grid');
  if (!grid) return;
  grid.innerHTML = '';
  Object.values(PLATFORMS).forEach(platform => {
    const isSelected = platform.id === state.currentPlatform.id;
    const tab = document.createElement('button');
    tab.className = isSelected 
      ? 'px-4 py-1.5 rounded-full border-gradient text-white text-xs font-semibold glow-cyan relative overflow-hidden flex items-center gap-1.5 cursor-pointer'
      : 'px-4 py-1.5 rounded-full bg-[#191c1f] border border-[#3b494b] text-on-surface-variant text-xs hover:border-[#00dbe9] hover:text-white transition-colors flex items-center gap-1.5 cursor-pointer';
    tab.dataset.id = platform.id;
    tab.type = 'button';
    tab.title = `${platform.name} — ${platform.description}`;
    tab.innerHTML = `
      <span class="w-3 h-3 flex items-center justify-center">${platform.logoSvg}</span>
      <span class="relative z-10 font-medium">${platform.name}</span>
      ${isSelected ? '<div class="absolute inset-0 bg-[#00dbe9] opacity-20 pointer-events-none"></div>' : ''}
    `;
    tab.addEventListener('click', e => { e.preventDefault(); selectPlatform(platform.id); });
    grid.appendChild(tab);
  });
}

function selectPlatform(id) {
  state.currentPlatform = PLATFORMS[id] || PLATFORMS.adobe;
  renderPlatforms();
  updatePlatformSpecsBanner();
  throttledRender();
  showToast(`Platform: ${state.currentPlatform.name}`, 'info');
}

// ─── AI Status Badge ────────────────────────────────────────────────────────
function updateAiStatusBadge() {
  const badge = document.getElementById('ai-status-badge');
  if (!badge) return;
  if (state.geminiConnected) {
    badge.innerHTML = '<span class="ai-dot ai-dot-connected"></span> AI ON';
    badge.className = 'ai-status-badge connected';
  } else {
    badge.innerHTML = '<span class="ai-dot ai-dot-disconnected"></span> AI OFF';
    badge.className = 'ai-status-badge disconnected';
  }
}

// ─── Auth Nav State ─────────────────────────────────────────────────────────
// Updates header nav to show login/signup (logged out) or username+plan+credits+admin+logout (logged in).
// Called on page load and after any auth/plan/credit action. No visual redesign — just visibility.
function updateAuthNav() {
  const loggedOut      = document.getElementById('auth-logged-out');
  const loggedIn       = document.getElementById('auth-logged-in');
  const nameSpan       = document.getElementById('auth-user-name');
  const planBadge      = document.getElementById('auth-user-plan-badge');
  const creditBadge    = document.getElementById('auth-user-credits-badge');
  const adminBtn       = document.getElementById('btn-admin-panel');
  const sidebarAdminBtn= document.getElementById('btn-sidebar-admin');
  const user           = getCurrentUser();

  if (user && loggedOut && loggedIn) {
    loggedOut.style.display = 'none';
    loggedIn.style.display  = 'flex';
    if (nameSpan)        nameSpan.textContent = user.fullName || user.email;
    if (planBadge)       planBadge.textContent = (user.plan || 'free').toUpperCase();
    if (creditBadge)     creditBadge.textContent = `⚡ ${user.credits ?? 0} Credits`;
    if (adminBtn)        adminBtn.style.display = user.role === 'admin' ? 'inline-flex' : 'none';
    if (sidebarAdminBtn) sidebarAdminBtn.style.display = user.role === 'admin' ? 'flex' : 'none';
  } else if (loggedOut && loggedIn) {
    loggedOut.style.display = 'flex';
    loggedIn.style.display  = 'none';
    if (adminBtn)        adminBtn.style.display = 'none';
    if (sidebarAdminBtn) sidebarAdminBtn.style.display = 'none';
  }
}

// ─── Profile & Plan View Helpers ───────────────────────────────────────────
function openAuthModal(tab = 'login') {
  const modalEl = document.getElementById('modal-auth');
  const tabsContainer = document.getElementById('auth-tabs-container');
  const loginForm = document.getElementById('auth-login-form');
  const signupForm = document.getElementById('auth-signup-form');
  const profileView = document.getElementById('auth-profile-view');
  const user = getCurrentUser();

  if (user) {
    if (tabsContainer) tabsContainer.style.display = 'none';
    if (loginForm)     loginForm.style.display     = 'none';
    if (signupForm)    signupForm.style.display    = 'none';
    if (profileView)   profileView.style.display   = 'flex';
    renderProfileView(user);
  } else {
    if (tabsContainer) tabsContainer.style.display = 'flex';
    if (profileView)   profileView.style.display   = 'none';
    switchAuthTab(tab);
  }
  openModal(modalEl);
}

function renderProfileView(user) {
  if (!user) return;
  const nameDisplay   = document.getElementById('profile-display-name');
  const planTag       = document.getElementById('profile-plan-tag');
  const fullNameInput = document.getElementById('profile-fullname-input');
  const emailInput    = document.getElementById('profile-email-input');
  const planText      = document.getElementById('profile-plan-text');
  const creditsText   = document.getElementById('profile-credits-text');
  const errorEl       = document.getElementById('profile-error');

  if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }
  if (nameDisplay)   nameDisplay.textContent   = user.fullName || user.email;
  if (planTag)       planTag.textContent       = `${(user.plan || 'free').toUpperCase()} PLAN`;
  if (fullNameInput) fullNameInput.value       = user.fullName || '';
  if (emailInput)    emailInput.value          = user.email || '';
  if (planText)      planText.textContent      = (user.plan || 'free').toUpperCase();
  if (creditsText)   creditsText.textContent   = `${user.credits ?? 10} Credits`;
}

function updatePricingModalUI() {
  const user = getCurrentUser();
  const currentPlan = user ? (user.plan || 'free').toLowerCase() : null;

  const plans = [
    { id: 'free',     btnId: 'btn-plan-free',     label: 'Select Free Plan' },
    { id: 'pro',      btnId: 'btn-plan-pro',      label: 'Upgrade to Pro' },
    { id: 'business', btnId: 'btn-plan-business', label: 'Switch to Business' }
  ];

  plans.forEach(p => {
    const btn = document.getElementById(p.btnId);
    if (!btn) return;
    if (currentPlan === p.id) {
      btn.textContent = 'Active Plan ✓';
      btn.className = 'btn btn-secondary';
      btn.style.opacity = '0.8';
    } else {
      btn.style.opacity = '1';
      btn.textContent = p.label;
      btn.className = p.id === 'pro' ? 'btn btn-primary' : 'btn btn-secondary';
    }
  });
}

// ─── Admin Dashboard ───────────────────────────────────────────────────────
async function renderAdminDashboard(search = '') {
  const tbody = document.getElementById('admin-users-list');
  if (!tbody) return;

  tbody.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-secondary)">Loading user database…</div>`;

  const res = await adminFetchUsers(search);
  if (!res.ok) {
    tbody.innerHTML = `<div style="text-align:center;padding:24px;color:var(--accent-rose)">${escHtml(res.message)}</div>`;
    return;
  }

  if (!res.users || res.users.length === 0) {
    tbody.innerHTML = `<div style="text-align:center;padding:24px;color:var(--text-secondary)">No users found matching "${escHtml(search)}"</div>`;
    return;
  }

  tbody.innerHTML = res.users.map(u => `
    <div class="p-3 bg-[#191c1f] border border-[#3b494b] rounded-xl flex flex-wrap items-center justify-between gap-3 shadow-sm">
      <div class="flex-1 min-w-[200px]">
        <strong class="text-sm font-semibold text-on-surface block">${escHtml(u.fullName || 'No Name')}</strong>
        <span class="text-xs text-on-surface-variant">${escHtml(u.email)}</span>
      </div>
      
      <div class="flex items-center gap-2 flex-wrap">
        <span class="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider" style="background:${u.role === 'admin' ? 'rgba(245,158,11,0.2)' : 'rgba(255,255,255,0.06)'};color:${u.role === 'admin' ? '#F59E0B' : 'var(--text-secondary)'}">${u.role.toUpperCase()}</span>
        
        <select class="admin-plan-select bg-surface-container border border-outline-variant text-on-surface rounded text-[11px] py-1 px-2" data-user-id="${u.id}">
          <option value="free" ${u.plan === 'free' ? 'selected' : ''}>FREE</option>
          <option value="pro" ${u.plan === 'pro' ? 'selected' : ''}>PRO</option>
          <option value="business" ${u.plan === 'business' ? 'selected' : ''}>BUSINESS</option>
        </select>
        
        <div class="flex items-center gap-1 bg-[#1d2023] border border-[#3b494b] px-2 py-1 rounded text-[11px]">
          <span class="font-bold text-[#00dbe9]">⚡ ${u.credits}</span>
          <button class="admin-adjust-credits-btn text-on-surface hover:text-[#00dbe9] ml-1" data-user-id="${u.id}" data-user-name="${escHtml(u.fullName || u.email)}" title="Edit credits"><span class="material-symbols-outlined text-[14px]">edit</span></button>
        </div>
        
        <span class="px-2 py-0.5 rounded text-[10px] font-bold tracking-wider" style="background:${u.isActive !== false ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.15)'};color:${u.isActive !== false ? '#10B981' : '#EF4444'}">${u.isActive !== false ? 'ACTIVE' : 'DISABLED'}</span>
        
        <button class="admin-toggle-status-btn px-2 py-1 rounded text-[11px] font-semibold border transition-colors ${u.isActive !== false ? 'bg-[#1d2023] border-[#3b494b] text-error hover:border-error hover:bg-error/10' : 'bg-[#00dbe9] text-[#111417] border-transparent hover:bg-[#00f0ff]'}" data-user-id="${u.id}" data-active="${u.isActive !== false}">
          ${u.isActive !== false ? 'Deactivate' : 'Reactivate'}
        </button>
      </div>
    </div>
  `).join('');

  // Event Delegation for Admin Row Actions
  tbody.querySelectorAll('.admin-plan-select').forEach(select => {
    select.addEventListener('change', async (e) => {
      const userId = e.target.getAttribute('data-user-id');
      const newPlan = e.target.value;
      const r = await adminUpdateUserPlan(userId, newPlan);
      if (r.ok) {
        showToast(r.message || `User plan updated to ${newPlan.toUpperCase()}`, 'success');
        if (userId === getCurrentUser()?.id) updateAuthNav();
        const currentSearch = document.getElementById('admin-search')?.value || '';
        renderAdminDashboard(currentSearch);
      } else {
        showToast(r.message, 'error');
      }
    });
  });

  tbody.querySelectorAll('.admin-toggle-status-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const userId = e.currentTarget.getAttribute('data-user-id');
      const currentActive = e.currentTarget.getAttribute('data-active') === 'true';
      const r = await adminToggleUserStatus(userId, !currentActive);
      if (r.ok) {
        showToast(r.message, 'success');
        renderAdminDashboard(search);
      } else {
        showToast(r.message, 'error');
      }
    });
  });

  tbody.querySelectorAll('.admin-adjust-credits-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const userId = e.currentTarget.getAttribute('data-user-id');
      const userName = e.currentTarget.getAttribute('data-user-name');
      const input = prompt(`Adjust credits for ${userName} (e.g. 50 to add, -10 to remove):`, '10');
      if (input === null) return;
      const amount = parseInt(input, 10);
      if (isNaN(amount) || amount === 0) {
        showToast('Please enter a valid non-zero number of credits', 'warning');
        return;
      }
      const desc = prompt(`Reason / description for adjustment:`, `Admin credit adjustment (${amount > 0 ? '+' : ''}${amount})`);
      const r = await adminAdjustCredits(userId, amount, desc || 'Admin adjustment');
      if (r.ok) {
        showToast(r.message || 'Credits adjusted!', 'success');
        renderAdminDashboard(search);
        if (userId === getCurrentUser()?.id) updateAuthNav();
      } else {
        showToast(r.message, 'error');
      }
    });
  });
}

async function renderAdminPaymentsList(statusFilter = null) {
  const container = document.getElementById('admin-payments-list');
  const badge     = document.getElementById('admin-pending-badge');
  if (!container) return;

  container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-secondary)">Loading payment queue…</div>';

  const res = await adminFetchPayments(statusFilter);
  if (!res.ok) {
    container.innerHTML = `<div style="padding:20px;text-align:center;color:var(--accent-rose)">${escHtml(res.message)}</div>`;
    return;
  }

  const payments = res.payments || [];
  const pendingCount = payments.filter(p => p.status === 'pending').length;
  if (badge) badge.textContent = pendingCount;

  if (payments.length === 0) {
    container.innerHTML = '<div style="padding:20px;text-align:center;color:var(--text-muted)">No payment submissions found in queue.</div>';
    return;
  }

  container.innerHTML = payments.map(p => {
    const isPending = p.status === 'pending';
    const isApproved = p.status === 'approved';
    const statusBadge = isApproved
      ? '<span class="badge-pill" style="background:rgba(34,197,94,0.15);color:#22C55E;font-size:0.7rem">APPROVED</span>'
      : isPending
      ? '<span class="badge-pill" style="background:rgba(234,179,8,0.15);color:#EAB308;font-size:0.7rem">PENDING</span>'
      : '<span class="badge-pill" style="background:rgba(239,68,68,0.15);color:#EF4444;font-size:0.7rem">REJECTED</span>';

    const actionButtons = isPending ? `
      <div class="flex gap-2">
        <button class="admin-approve-pay-btn px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/30 hover:bg-emerald-500 hover:text-white transition-colors" data-pay-id="${p.id}">✅ Approve</button>
        <button class="admin-reject-pay-btn px-3 py-1.5 rounded-lg text-xs font-semibold bg-error/10 text-error border border-error/30 hover:bg-error hover:text-white transition-colors" data-pay-id="${p.id}">✕ Reject</button>
      </div>
    ` : `<span style="font-size:0.75rem;color:var(--text-muted)">${escHtml(p.admin_notes || p.status)}</span>`;

    return `
      <div class="p-3 bg-[#191c1f] border border-[#3b494b] rounded-xl flex flex-col gap-3 shadow-sm">
        <div class="flex items-start justify-between gap-3">
          <div>
            <strong class="text-sm font-semibold text-on-surface block">${escHtml(p.user_name || 'User')}</strong>
            <span class="text-xs text-on-surface-variant">${escHtml(p.user_email || 'N/A')}</span>
          </div>
          <div>${statusBadge}</div>
        </div>
        
        <div class="grid grid-cols-2 gap-2 text-xs">
          <div class="bg-[#1d2023] p-2 rounded border border-[#3b494b]">
            <div class="text-on-surface-variant mb-1 text-[10px] uppercase tracking-wider">Plan requested</div>
            <div class="font-bold text-[#db50ff] uppercase">${escHtml(p.plan)}</div>
          </div>
          <div class="bg-[#1d2023] p-2 rounded border border-[#3b494b]">
            <div class="text-on-surface-variant mb-1 text-[10px] uppercase tracking-wider">Amount Paid</div>
            <div class="font-bold text-[#00dbe9]">৳${p.amount} BDT</div>
          </div>
          <div class="bg-[#1d2023] p-2 rounded border border-[#3b494b]">
            <div class="text-on-surface-variant mb-1 text-[10px] uppercase tracking-wider">Method</div>
            <div class="font-bold text-on-surface uppercase">${escHtml(p.payment_method)}</div>
          </div>
          <div class="bg-[#1d2023] p-2 rounded border border-[#3b494b]">
            <div class="text-on-surface-variant mb-1 text-[10px] uppercase tracking-wider">Sender No.</div>
            <div class="font-mono text-on-surface">${escHtml(p.sender_number)}</div>
          </div>
          <div class="col-span-2 bg-[#1d2023] p-2 rounded border border-[#3b494b]">
            <div class="text-on-surface-variant mb-1 text-[10px] uppercase tracking-wider">Transaction ID</div>
            <div class="font-mono font-bold text-amber-300 tracking-wider">${escHtml(p.trx_id)}</div>
          </div>
        </div>
        
        <div class="flex justify-end pt-1">
          ${actionButtons}
        </div>
      </div>
    `;
  }).join('');

  container.querySelectorAll('.admin-approve-pay-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const payId = e.currentTarget.getAttribute('data-pay-id');
      const notes = prompt('Approval notes / message for user (optional):', 'bKash/Nagad Payment Verified');
      if (notes === null) return;
      btn.disabled = true; btn.textContent = 'Approving…';
      const r = await adminApprovePayment(payId, notes);
      if (r.ok) {
        showToast(r.message || 'Payment approved & user plan updated!', 'success');
        renderAdminPaymentsList(statusFilter);
        renderAdminDashboard();
        updateAuthNav();
      } else {
        btn.disabled = false; btn.textContent = '✅ Approve';
        showToast(r.message, 'error');
      }
    });
  });

  container.querySelectorAll('.admin-reject-pay-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const payId = e.currentTarget.getAttribute('data-pay-id');
      const notes = prompt('Reason for rejecting payment (optional):', 'Invalid Transaction ID or Amount');
      if (notes === null) return;
      btn.disabled = true; btn.textContent = 'Rejecting…';
      const r = await adminRejectPayment(payId, notes);
      if (r.ok) {
        showToast(r.message || 'Payment rejected.', 'info');
        renderAdminPaymentsList(statusFilter);
      } else {
        btn.disabled = false; btn.textContent = '✕ Reject';
        showToast(r.message, 'error');
      }
    });
  });
}

// ─── Asset Tabs ────────────────────────────────────────────────────────────
function switchAssetTab(name) {
  state.activeAssetTab = name;
  const tabs = ['images', 'vectors', 'videos'];
  
  const activeClasses = 'bg-[#00dbe9]/15 border-[#00dbe9] text-[#00dbe9] shadow-[0_0_15px_rgba(0,219,233,0.3)] font-bold';
  const inactiveClasses = 'bg-[#191c1f] border-[#3b494b] text-on-surface-variant font-medium hover:border-[#00dbe9]/50 hover:bg-[#191c1f]/80';
  const baseClasses = 'flex-1 max-w-[140px] py-2.5 rounded-lg flex items-center justify-center gap-2 transition-all border';

  tabs.forEach(t => {
    const el = document.getElementById(`tab-${t}`);
    if (el) {
      el.className = `${baseClasses} ${t === name ? activeClasses : inactiveClasses}`;
    }
  });
  
  updateUploadZoneForTab();
}

function updateUploadZoneForTab() {
  const titleEl    = document.getElementById('upload-title-text');
  const subEl      = document.getElementById('upload-subtitle-text');
  const tagsEl     = document.getElementById('format-tags-container');
  const fileInput  = document.getElementById('file-input');
  const tab = state.activeAssetTab;
  if (tab === 'images') {
    if (titleEl)   titleEl.textContent = 'Drop your images here or browse files';
    if (subEl)     subEl.textContent   = 'JPG, PNG, WEBP, TIFF supported — batch 100+ files';
    if (tagsEl)    tagsEl.innerHTML    = ['JPG','JPEG','PNG','WEBP','TIFF'].map(f=>`<span class="format-tag">${f}</span>`).join('');
    if (fileInput) fileInput.accept    = '.jpg,.jpeg,.png,.webp,.tiff,.tif';
  } else if (tab === 'vectors') {
    if (titleEl)   titleEl.textContent = 'Drop your vector files here or browse files';
    if (subEl)     subEl.textContent   = 'EPS, AI, SVG, PDF — batch upload supported';
    if (tagsEl)    tagsEl.innerHTML    = ['EPS','AI','SVG','PDF'].map(f=>`<span class="format-tag">${f}</span>`).join('');
    if (fileInput) fileInput.accept    = '.eps,.ai,.svg,.pdf';
  } else if (tab === 'videos') {
    if (titleEl)   titleEl.textContent = 'Drop your video files here or browse files';
    if (subEl)     subEl.textContent   = 'MP4, MOV, AVI, WEBP (Max 100MB per video) — batch upload supported';
    if (tagsEl)    tagsEl.innerHTML    = ['MP4','MOV','AVI','WEBM'].map(f=>`<span class="format-tag">${f}</span>`).join('');
    if (fileInput) fileInput.accept    = '.mp4,.mov,.avi,.webm';
  }
}

// ─── File Processing ───────────────────────────────────────────────────────
function classifyFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (IMAGE_EXTS.has(ext))  return { assetType: 'image',  format: ext.toUpperCase(), ext };
  if (VECTOR_EXTS.has(ext)) return { assetType: ext === 'pdf' ? 'pdf' : 'vector', format: ext.toUpperCase(), ext };
  if (VIDEO_EXTS.has(ext))  return { assetType: 'video',  format: ext.toUpperCase(), ext };
  return null;
}

function fileKey(file) { return `${file.name}::${file.size}::${file.lastModified}`; }

const PREVIEWABLE = new Set(['jpg','jpeg','png','webp','gif','svg']);
const THUMBNAILABLE = new Set(['jpg','jpeg','png','webp']);
const THUMB_MAX_DIM = 512;

async function createThumbnailUrl(file) {
  try {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file, {
        resizeWidth: THUMB_MAX_DIM,
        resizeHeight: THUMB_MAX_DIM,
        resizeQuality: 'low'
      });
    } catch (e) {
      bitmap = await createImageBitmap(file);
    }
    const scale = Math.min(1, THUMB_MAX_DIM / (bitmap.width || 1), THUMB_MAX_DIM / (bitmap.height || 1));
    const w = Math.max(1, Math.round((bitmap.width || 1) * scale));
    const h = Math.max(1, Math.round((bitmap.height || 1) * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, w, h);
    if (bitmap.close) bitmap.close();
    const blob = await new Promise((res, rej) => canvas.toBlob(b => b ? res(b) : rej(new Error('toBlob failed')), 'image/jpeg', 0.82));
    return URL.createObjectURL(blob);
  } catch (e) {
    return null;
  }
}

async function processFiles(files) {
  const existingKeys = new Set(state.mediaItems.map(i => i._fileKey));
  const accepted = []; const skippedDup = []; const skippedBad = [];

  for (const file of files) {
    const cls = classifyFile(file);
    if (!cls) { skippedBad.push(file.name); continue; }
    if (state.activeAssetTab === 'images'  && cls.assetType !== 'image')  { skippedBad.push(file.name); continue; }
    if (state.activeAssetTab === 'vectors' && cls.assetType === 'image')  { skippedBad.push(file.name); continue; }
    if (state.activeAssetTab === 'videos'  && cls.assetType !== 'video')  { skippedBad.push(file.name); continue; }

    if (cls.assetType === 'video' && file.size > 100 * 1024 * 1024) {
      showToast(`Skipped ${file.name} - exceeds 100MB video limit`, 'warning');
      continue;
    }

    const k = fileKey(file);
    if (existingKeys.has(k)) { skippedDup.push(file.name); continue; }
    existingKeys.add(k);
    accepted.push({ file, cls, key: k });
  }

  if (skippedBad.length)  showToast(`Unsupported: skipped ${skippedBad.length} file(s)`, 'error');
  if (skippedDup.length)  showToast(`Duplicate: skipped ${skippedDup.length} file(s)`, 'warning');
  if (!accepted.length)   return;

  const BATCH = 10;
  const newItems = [];
  for (let i = 0; i < accepted.length; i += BATCH) {
    const batch = accepted.slice(i, i + BATCH);
    await Promise.all(batch.map(async ({ file, cls, key }) => {
      const { assetType, format, ext } = cls;
      const id = `asset-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
      const item = {
        id, _fileKey: key, file,
        name: file.name, format, assetType, ext,
        size: file.size, type: file.type || `application/${ext}`,
        status: 'waiting', url: null,
        metadata: null,    // null = not yet generated
        _error: null
      };
      if (PREVIEWABLE.has(ext)) {
        if (THUMBNAILABLE.has(ext)) {
          item.url = await createThumbnailUrl(file) || URL.createObjectURL(file);
        } else {
          item.url = URL.createObjectURL(file);
        }
      }
      newItems.push(item);
    }));
    await new Promise(r => setTimeout(r, 0)); // yield
  }

  state.mediaItems.push(...newItems);
  updateUI();
  showToast(`Added ${newItems.length} file(s) — ${state.mediaItems.length} total`, 'success');
}

// ─── AI Generation ─────────────────────────────────────────────────────────
async function triggerAiGeneration() {
  if (state.mediaItems.length === 0 || state.isGenerating) return;

  if (!isLoggedIn()) {
    openAuthModal('login');
    showToast('Please login or sign up to generate metadata with AI.', 'info');
    return;
  }

  if (!hasApiKey()) {
    openModal(document.getElementById('modal-ai-settings'));
    showToast('Please add your Gemini API key first', 'warning');
    return;
  }

  // Determine which items need generation
  const toProcess = state.mediaItems.filter(i => i.status === 'waiting' || i.status === 'failed');
  if (toProcess.length === 0) {
    showToast('All assets already have metadata. Use "Retry Failed" if needed.', 'info');
    return;
  }

  // Check credit balance for logged-in users before starting
  const user = getCurrentUser();
  if (user && (user.credits ?? 0) <= 0) {
    showToast(`Insufficient credits balance (0 credits available). Please switch plans or request credits.`, 'error');
    openModal(document.getElementById('modal-pricing'));
    updatePricingModalUI();
    return;
  }

  state.isGenerating = true;
  state.stopBatch = false;

  const genBtn = document.getElementById('btn-generate-ai');
  const stopBtn = document.getElementById('btn-stop-generation');
  const retryBtn = document.getElementById('btn-retry-failed');
  setBtnLoading(genBtn, true);
  if (stopBtn) stopBtn.style.display = 'inline-flex';

  const progressBar = document.getElementById('progress-bar-container');
  if (progressBar) progressBar.classList.add('active');

  let successCount = 0, failCount = 0;
  const isVideoBatch = state.activeAssetTab === 'videos';

  await runBatchQueue({
    items: toProcess,
    concurrencyLimit: isVideoBatch ? 2 : 3,
    shouldStop: () => state.stopBatch,

    onItemStart: (item) => {
      const stateItem = state.mediaItems.find(i => i.id === item.id);
      if (stateItem) { stateItem.status = 'processing'; stateItem._error = null; }
      throttledRender();
    },

    processFn: async (item) => {
      const settings = state.settingsEnabled ? getActiveSettings() : null;
      return await generateMetadataForImage(item, state.currentPlatform, null, settings, state.activeAppMode);
    },

    onItemDone: async (item, idx, result, err) => {
      const stateItem = state.mediaItems.find(i => i.id === item.id);
      if (!stateItem) return;

      if (err) {
        stateItem.status = 'failed';
        stateItem._error = err.message || 'Generation failed';
        failCount++;
      } else if (result && result._geminiUnsupported) {
        stateItem.status = 'failed';
        stateItem._error = result.reason;
        failCount++;
      } else if (result) {
        stateItem.status = 'ready';
        stateItem.metadata = {
          title:       result.title,
          description: result.description,
          keywords:    result.keywords,
          category:    result.category
        };
        stateItem._error = null;
        successCount++;

        // Deduct 1 credit for logged-in user upon successful metadata generation
        const curUser = getCurrentUser();
        if (curUser) {
          const deductRes = await deductCredit(1, `Metadata generation: ${item.name}`);
          if (deductRes.ok) {
            updateAuthNav();
          } else {
            showToast(deductRes.message || 'Credit deduction failed', 'warning');
            if ((curUser.credits ?? 0) <= 0) {
              state.stopBatch = true;
              showToast('Batch stopped — out of credits!', 'error');
            }
          }
        }
      }
      throttledRender();
    },

    onProgress: (completed, total) => {
      const pct = Math.round((completed / total) * 100);
      const remaining = total - completed;
      const progressText    = document.getElementById('progress-text');
      const progressCounter = document.getElementById('progress-stats-counter');
      const progressPct     = document.getElementById('progress-percent-text');
      const progressFill    = document.getElementById('progress-fill');
      if (progressText)    progressText.textContent    = `Processing ${completed} of ${total}…`;
      if (progressCounter) progressCounter.textContent = `${completed} / ${total} (${remaining} remaining)`;
      if (progressPct)     progressPct.textContent     = `${pct}%`;
      if (progressFill)    progressFill.style.width    = `${pct}%`;
    }
  });

  state.isGenerating = false;
  state.stopBatch = false;

  setBtnLoading(genBtn, false);
  if (stopBtn) stopBtn.style.display = 'none';
  if (retryBtn && failCount > 0) retryBtn.style.display = 'inline-flex';

  const summary = `Done: ${successCount} generated${failCount ? `, ${failCount} failed` : ''}`;
  showToast(summary, failCount > 0 ? 'warning' : 'success');

  setTimeout(() => {
    if (progressBar) progressBar.classList.remove('active');
  }, 2000);

  updateUI();
}

function retryFailed() {
  const failed = state.mediaItems.filter(i => i.status === 'failed');
  if (!failed.length) { showToast('No failed items to retry', 'info'); return; }
  failed.forEach(item => { item.status = 'waiting'; item._error = null; });
  throttledRender();
  triggerAiGeneration();
}

function regenerateSingleItem(id) {
  if (!isLoggedIn()) {
    openAuthModal('login');
    showToast('Please login or sign up to generate metadata with AI.', 'info');
    return;
  }
  if (!hasApiKey()) {
    openModal(document.getElementById('modal-ai-settings'));
    showToast('Add Gemini API key first', 'warning');
    return;
  }
  const curUser = getCurrentUser();
  if (curUser && (curUser.credits ?? 0) <= 0) {
    showToast('Insufficient credits to regenerate metadata (0 credits available).', 'error');
    openModal(document.getElementById('modal-pricing'));
    updatePricingModalUI();
    return;
  }
  const item = state.mediaItems.find(i => i.id === id);
  if (!item || item.status === 'processing') return;
  item.status = 'waiting';
  item._error = null;
  throttledRender();

  // Run single item through the batch system
  (async () => {
    item.status = 'processing';
    throttledRender();
    try {
      const settings = state.settingsEnabled ? getActiveSettings() : null;
      const result = await generateMetadataForImage(item, state.currentPlatform, null, settings, state.activeAppMode);
      if (result && result._geminiUnsupported) {
        item.status = 'failed'; item._error = result.reason;
      } else if (result) {
        item.status = 'ready';
        item.metadata = { title: result.title, description: result.description, keywords: result.keywords, category: result.category };
        item._error = null;
        if (curUser) {
          const deductRes = await deductCredit(1, `Single regen: ${item.name}`);
          if (deductRes.ok) updateAuthNav();
        }
        showToast(`Regenerated: ${item.name}`, 'success');
      }
    } catch (err) {
      item.status = 'failed'; item._error = err.message;
      showToast(`Failed: ${err.message}`, 'error');
    }
    throttledRender();
  })();
}

// ─── Render (throttled, RAF-gated, batched) ───────────────────────────────
// Uses a single queued RAF so multiple synchronous calls in the same tick
// only trigger ONE render pass. A second rAF frame is used as a read barrier
// so we never force a synchronous style recalc before the paint.
function throttledRender() {
  if (state._renderPending) return;
  state._renderPending = true;
  requestAnimationFrame(() => {
    // Yield one more frame so any pending layout from the triggering action
    // is flushed first — prevents forced synchronous layout.
    requestAnimationFrame(() => {
      state._renderPending = false;
      renderMetadata();
      updateStatsBar();
    });
  });
}

function getFilteredItems() {
  return state.mediaItems.filter(item => {
    const matchStatus = state.statusFilter === 'all' || item.status === state.statusFilter;
    const meta = item.metadata || {};
    const q    = state.searchQuery;
    const matchSearch = !q
      || item.name.toLowerCase().includes(q)
      || (meta.title    && meta.title.toLowerCase().includes(q))
      || (meta.keywords && meta.keywords.some(k => k.toLowerCase().includes(q)));
    return matchStatus && matchSearch;
  });
}

function updateStatsBar() {
  const items   = state.mediaItems;
  const counts  = { total: items.length, images: 0, vectors: 0, ready: 0, failed: 0, waiting: 0 };
  items.forEach(i => {
    if (i.assetType === 'image')                 counts.images++;
    if (i.assetType === 'vector' || i.assetType === 'pdf') counts.vectors++;
    if (i.status === 'ready')                    counts.ready++;
    if (i.status === 'failed')                   counts.failed++;
    if (i.status === 'waiting')                  counts.waiting++;
  });
  counts.selected = state.selectedItemIds.size;

  const prev = state._lastStats;
  const setText = (id, v) => {
    if (prev && prev[id] === v) return;
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };
  setText('stat-total',    counts.total);
  setText('stat-images',   counts.images);
  setText('stat-vectors',  counts.vectors);
  setText('stat-ready',    counts.ready);
  setText('stat-selected', counts.selected);
  setText('stat-failed',   counts.failed);

  if (!prev || (prev.failed > 0) !== (counts.failed > 0)) {
    const retryBtn = document.getElementById('btn-retry-failed');
    if (retryBtn) retryBtn.style.display = counts.failed > 0 ? 'inline-flex' : 'none';
  }
  state._lastStats = counts;
}

function updateUI() {
  const hasItems = state.mediaItems.length > 0;
  const emptyState = document.getElementById('empty-state');
  const mainArea   = document.getElementById('main-content-area') || document.getElementById('toolbar-section');
  if (emptyState) emptyState.style.display = hasItems ? 'none' : 'block';
  if (mainArea)   mainArea.style.display   = hasItems ? 'block' : 'none';
  updateStatsBar();
  renderMetadata();
}

// ─── Render Metadata ───────────────────────────────────────────────────────
function renderMetadata() {
  const items = getFilteredItems();
  if (state.viewMode === 'table') renderTableView(items);
  else                             renderGridView(items);
}

// ─── Thumbnail helper ───────────────────────────────────────────────────────
function buildThumbHtml(item, size = 44) {
  if (item.url) {
    if (item.assetType === 'video') {
      return `<video src="${item.url}" muted autoplay loop playsinline style="width:${size}px;height:${size}px;object-fit:cover;border-radius:6px;border:1px solid var(--border-glass);"></video>`;
    }
    return `<img src="${item.url}" alt="" loading="lazy" decoding="async" style="width:${size}px;height:${size}px;object-fit:cover;border-radius:6px;border:1px solid var(--border-glass);">`;
  }
  let col = 'var(--accent-purple)';
  let icon = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"/>`;
  
  if (item.assetType === 'image') col = 'var(--accent-cyan)';
  else if (item.assetType === 'video') {
    col = '#f43f5e'; // rose-500
    icon = `<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"/>`;
  }

  return `<div style="width:${size}px;height:${size}px;border-radius:6px;background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.25);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;"><svg width="18" height="18" fill="none" stroke="${col}" viewBox="0 0 24 24">${icon}</svg><span style="font-size:0.55rem;font-weight:800;color:${col}">${item.format||''}</span></div>`;
}

function buildAssetBadge(item) {
  if (item.assetType === 'image')  return `<span class="asset-type-badge badge-image">IMAGE</span>`;
  if (item.assetType === 'pdf')    return `<span class="asset-type-badge badge-pdf">PDF</span>`;
  if (item.assetType === 'vector') return `<span class="asset-type-badge badge-vector">VECTOR</span>`;
  if (item.assetType === 'video')  return `<span class="asset-type-badge" style="background:rgba(244,63,94,0.1);color:#f43f5e;border:1px solid rgba(244,63,94,0.2)">VIDEO</span>`;
  return '';
}

// ─── Table View — diff-based update ────────────────────────────────────────
// Builds the full row HTML once per item, keyed by item.id.
// On re-render, only rows whose content has changed are replaced.
// New items are appended; removed items are deleted. This eliminates the
// full innerHTML wipe that caused layout thrashing on every batch tick.

// Cache: item.id → last-rendered HTML fingerprint
const _tableRowCache = new Map();

function buildRowHtml(item, index, p, catOptions) {
  const isSelected = state.selectedItemIds.has(item.id);
  const meta = item.metadata || { title: '', description: '', keywords: [], category: '' };
  const kwCount = (meta.keywords || []).length;

  const titleLen = (meta.title || '').length;
  const titleLenClass = titleLen > p.titleMaxLen ? 'exceeded' : (titleLen > p.titleMaxLen * 0.85 ? 'warning' : '');
  const kwClass = kwCount > p.keywordMax ? 'exceeded' : (kwCount < p.keywordMin && kwCount > 0 ? 'warning' : '');

  const selectedCat = catOptions.replace(
    new RegExp(`value="${escHtml(meta.category).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`, 'g'),
    `value="${escHtml(meta.category)}" selected`
  );

  const kwChips = (meta.keywords || []).slice(0, 12).map((kw, ki) =>
    `<span class="inline-flex items-center gap-1 bg-[#191c1f] border border-[#3b494b] text-[10px] px-2 py-0.5 rounded-full text-on-surface-variant hover:border-[#00dbe9] hover:text-on-surface transition-colors group">${escHtml(kw)}<span class="keyword-chip-remove cursor-pointer text-error opacity-0 group-hover:opacity-100 transition-opacity font-bold" data-item-id="${item.id}" data-kw-idx="${ki}">×</span></span>`
  ).join('');
  const kwMore = kwCount > 12 ? `<span class="text-[9px] text-[#db50ff] font-bold px-1">+${kwCount - 12}</span>` : '';

  const errorHtml = item._error
    ? `<div class="text-[10px] text-error mt-1.5 max-w-[150px] leading-tight" title="${escHtml(item._error)}">⚠ ${escHtml(item._error.substring(0, 60))}${item._error.length > 60 ? '…' : ''}</div>`
    : '';

  const rowStyle = item.status === 'failed' ? ' style="background:rgba(239,68,68,0.05)"' : '';
  const selectedBgClass = isSelected ? 'bg-[#00dbe9]/10 border-[#00dbe9]/50' : 'border-[#3b494b]/50';

  return `<tr data-row-id="${item.id}" class="border-b hover:bg-[#191c1f]/50 transition-colors ${item.status === 'failed' ? 'bg-error/5' : ''} ${selectedBgClass}">
    <td class="p-3 align-top">
      <div class="flex items-center gap-3">
        <input type="checkbox" class="row-checkbox w-4 h-4 rounded border-[#3b494b] bg-[#191c1f] text-[#00dbe9] focus:ring-[#00dbe9]" data-id="${item.id}" ${isSelected ? 'checked' : ''}>
        ${buildThumbHtml(item, 48)}
      </div>
    </td>
    <td class="p-3 align-top max-w-[180px]">
      <div class="text-xs font-semibold text-on-surface truncate" title="${escHtml(item.name)}">${escHtml(item.name)}</div>
      <div class="flex items-center gap-2 mt-1.5 flex-wrap">
        ${buildAssetBadge(item)}
        <span class="text-[10px] text-on-surface-variant">${(item.size / 1048576).toFixed(1)} MB</span>
      </div>
      ${errorHtml}
    </td>
    <td class="p-3 align-top min-w-[200px]">
      <div class="relative">
        <textarea class="title-input w-full bg-[#191c1f] border border-[#3b494b] rounded-lg text-xs text-on-surface p-2 focus:border-[#00dbe9] focus:ring-1 focus:ring-[#00dbe9] transition-all resize-none" data-id="${item.id}" placeholder="Enter title…" rows="2" ${item.status === 'processing' ? 'disabled' : ''}>${escHtml(meta.title)}</textarea>
        <div class="char-counter text-[9px] absolute bottom-1 right-2 ${titleLenClass}">${titleLen} / ${p.titleMaxLen}</div>
      </div>
    </td>
    <td class="p-3 align-top min-w-[240px]">
      <textarea class="desc-textarea w-full bg-[#191c1f] border border-[#3b494b] rounded-lg text-xs text-on-surface p-2 focus:border-[#00dbe9] focus:ring-1 focus:ring-[#00dbe9] transition-all resize-y min-h-[50px]" data-id="${item.id}" placeholder="Enter description…" ${item.status === 'processing' ? 'disabled' : ''}>${escHtml(meta.description)}</textarea>
    </td>
    <td class="p-3 align-top min-w-[240px]">
      <div class="flex flex-wrap gap-1 mb-1.5 max-h-[70px] overflow-y-auto custom-scrollbar">${kwChips}${kwMore}</div>
      <div class="flex items-center gap-2">
        <input type="text" class="add-tag-input flex-1 bg-[#191c1f] border border-[#3b494b] rounded-md text-[10px] text-on-surface px-2 py-1 focus:border-[#00dbe9] focus:ring-1 focus:ring-[#00dbe9] transition-all" data-id="${item.id}" placeholder="+ Add Keyword">
      </div>
      <div class="flex justify-between items-center mt-1 text-[9px]">
        <span class="${kwClass} ${kwClass ? 'text-error font-bold' : 'text-on-surface-variant'}">${kwCount}/${p.keywordMax} kw</span>
        <a href="#" class="copy-kw-link text-[#00dbe9] hover:text-[#00f0ff] transition-colors" data-id="${item.id}">Copy All</a>
      </div>
    </td>
    <td class="p-3 align-top min-w-[120px]">
      <select class="category-select w-full bg-[#191c1f] border border-[#3b494b] rounded-lg text-xs text-on-surface p-2 focus:border-[#00dbe9] focus:ring-1 focus:ring-[#00dbe9] transition-all" data-id="${item.id}" ${item.status === 'processing' ? 'disabled' : ''}>
        <option value="">Select…</option>${selectedCat}
      </select>
    </td>
    <td class="p-3 align-top">
      <span class="status-tag status-${item.status} text-[10px] px-2 py-1 rounded-md font-bold uppercase tracking-wider block text-center w-full shadow-sm">${item.status}</span>
    </td>
    <td class="p-3 align-top">
      <div class="flex gap-1.5 flex-wrap">
        <button class="regen-btn w-7 h-7 rounded-md bg-[#191c1f] border border-[#3b494b] text-on-surface hover:text-[#db50ff] hover:border-[#db50ff] flex items-center justify-center transition-all disabled:opacity-50" data-id="${item.id}" title="Regenerate with AI" ${item.status === 'processing' ? 'disabled' : ''}><span class="material-symbols-outlined text-[14px]">autorenew</span></button>
        <button class="view-detail-btn w-7 h-7 rounded-md bg-[#191c1f] border border-[#3b494b] text-on-surface hover:text-[#00dbe9] hover:border-[#00dbe9] flex items-center justify-center transition-all" data-id="${item.id}" title="View Details"><span class="material-symbols-outlined text-[14px]">visibility</span></button>
        <button class="delete-btn w-7 h-7 rounded-md bg-[#191c1f] border border-[#3b494b] text-on-surface hover:text-error hover:border-error flex items-center justify-center transition-all hover:bg-error/10" data-id="${item.id}" title="Remove"><span class="material-symbols-outlined text-[14px]">delete</span></button>
      </div>
    </td>
  </tr>`;
}

function renderTableView(items) {
  const tableBody = document.getElementById('metadata-table-body');
  if (!tableBody) return;

  if (items.length === 0) {
    _tableRowCache.clear();
    tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-muted)">No matching assets found.</td></tr>`;
    return;
  }

  const p = state.currentPlatform;
  const catOptions = (p.categories.length > 0 ? p.categories : ['General', 'Business', 'Technology', 'Nature', 'People', 'Food', 'Architecture', 'Graphic Resources'])
    .map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');

  // Build a set of current item ids for removal detection
  const currentIds = new Set(items.map(i => i.id));

  // 1. Remove rows no longer in the filtered list
  for (const [id] of _tableRowCache) {
    if (!currentIds.has(id)) {
      const oldRow = tableBody.querySelector(`tr[data-row-id="${id}"]`);
      if (oldRow) oldRow.remove();
      _tableRowCache.delete(id);
    }
  }

  // 2. Patch existing rows or insert new ones, in order
  let prevEl = null; // track insertion anchor
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const html = buildRowHtml(item, i, p, catOptions);
    const cached = _tableRowCache.get(item.id);
    const existingRow = tableBody.querySelector(`tr[data-row-id="${item.id}"]`);

    if (cached === html && existingRow) {
      // No change — ensure ordering is correct then skip
      prevEl = existingRow;
      continue;
    }

    // Row needs update or insertion
    const template = document.createElement('template');
    template.innerHTML = html;
    const newRow = template.content.firstElementChild;

    if (existingRow) {
      // Patch in-place: swap out the old row
      tableBody.replaceChild(newRow, existingRow);
    } else {
      // Insert in correct position — add entry animation class
      newRow.classList.add('row-entering');
      if (prevEl && prevEl.nextSibling) {
        tableBody.insertBefore(newRow, prevEl.nextSibling);
      } else if (!prevEl) {
        tableBody.prepend(newRow);
      } else {
        tableBody.appendChild(newRow);
      }
      // Remove entry class after animation completes to free will-change
      newRow.addEventListener('animationend', () => newRow.classList.remove('row-entering'), { once: true });
    }

    // Apply processing row class for the shimmer strip
    if (item.status === 'processing') {
      newRow.classList.add('row-processing');
    }

    _tableRowCache.set(item.id, html);
    prevEl = newRow;
  }
}


function setupTableEventDelegation() {
  const tableContainer = document.getElementById('table-view-container') || document.getElementById('view-table-container');
  if (!tableContainer) return;

  tableContainer.addEventListener('input', (e) => {
    const titleInput = e.target.closest('.title-input');
    if (titleInput) {
      const item = state.mediaItems.find(i => i.id === titleInput.dataset.id);
      if (!item) return;
      if (!item.metadata) item.metadata = {};
      item.metadata.title = titleInput.value;
      _tableRowCache.delete(item.id); // invalidate only this row
      const ctr = titleInput.nextElementSibling;
      if (ctr) {
        const len = titleInput.value.length, max = state.currentPlatform.titleMaxLen;
        ctr.textContent = `${len} / ${max}`;
        ctr.className = `char-counter ${len > max ? 'exceeded' : len > max * 0.85 ? 'warning' : ''}`;
      }
      return;
    }

    const descTextarea = e.target.closest('.desc-textarea');
    if (descTextarea) {
      const item = state.mediaItems.find(i => i.id === descTextarea.dataset.id);
      if (item && item.metadata) {
        item.metadata.description = descTextarea.value;
        _tableRowCache.delete(item.id);
      }
      return;
    }

    const categorySelect = e.target.closest('.category-select');
    if (categorySelect) {
      const item = state.mediaItems.find(i => i.id === categorySelect.dataset.id);
      if (item && item.metadata) {
        item.metadata.category = categorySelect.value;
        _tableRowCache.delete(item.id);
        // No full re-render needed — value is already saved, no DOM change required
      }
      return;
    }
  });

  tableContainer.addEventListener('keydown', (e) => {
    const addTagInput = e.target.closest('.add-tag-input');
    if (!addTagInput) return;
    if (e.key !== 'Enter' && e.key !== ',') return;
    e.preventDefault();
    const tag = addTagInput.value.trim().replace(/^,|,$/g, '');
    if (!tag) return;
    const item = state.mediaItems.find(i => i.id === addTagInput.dataset.id);
    if (item && item.metadata) {
      if (!item.metadata.keywords) item.metadata.keywords = [];
      if (!item.metadata.keywords.map(k => k.toLowerCase()).includes(tag.toLowerCase())) {
        item.metadata.keywords.push(tag);
        _tableRowCache.delete(item.id); // invalidate only this row
        throttledRender();
      }
    }
    addTagInput.value = '';
  });

  tableContainer.addEventListener('click', (e) => {
    const keywordChipRemove = e.target.closest('.keyword-chip-remove');
    if (keywordChipRemove) {
      const item = state.mediaItems.find(i => i.id === keywordChipRemove.dataset.itemId);
      if (item && item.metadata && item.metadata.keywords) {
        item.metadata.keywords.splice(parseInt(keywordChipRemove.dataset.kwIdx, 10), 1);
        _tableRowCache.delete(item.id); // invalidate only this row
      }
      throttledRender();
      return;
    }

    const copyKwLink = e.target.closest('.copy-kw-link');
    if (copyKwLink) {
      e.preventDefault();
      const item = state.mediaItems.find(i => i.id === copyKwLink.dataset.id);
      if (item && item.metadata && item.metadata.keywords) {
        navigator.clipboard.writeText(item.metadata.keywords.join(', '));
        showToast(`Copied ${item.metadata.keywords.length} keywords!`, 'success');
      }
      return;
    }

    const rowCheckbox = e.target.closest('.row-checkbox');
    if (rowCheckbox) {
      const id = rowCheckbox.dataset.id;
      if (rowCheckbox.checked) {
        state.selectedItemIds.add(id);
      } else {
        state.selectedItemIds.delete(id);
      }
      
      // Update the tr class immediately for visual feedback
      const tr = rowCheckbox.closest('tr');
      if (tr) {
        if (rowCheckbox.checked) {
          tr.classList.add('bg-[#00dbe9]/10', 'border-[#00dbe9]/50');
          tr.classList.remove('border-[#3b494b]/50');
        } else {
          tr.classList.remove('bg-[#00dbe9]/10', 'border-[#00dbe9]/50');
          tr.classList.add('border-[#3b494b]/50');
        }
        // Invalidate cache so subsequent renders retain the styling
        _tableRowCache.delete(id);
      }
      
      updateStatsBar();
      return;
    }

    const regenBtn = e.target.closest('.regen-btn');
    if (regenBtn) {
      regenerateSingleItem(regenBtn.dataset.id);
      return;
    }

    const viewDetailBtn = e.target.closest('.view-detail-btn');
    if (viewDetailBtn) {
      openDetailModal(viewDetailBtn.dataset.id);
      return;
    }

    const deleteBtn = e.target.closest('.delete-btn');
    if (deleteBtn) {
      deleteItem(deleteBtn.dataset.id);
      return;
    }
  });
}

function setupGridEventDelegation() {
  const gridEl = document.getElementById('grid-view-container') || document.getElementById('view-grid-container');
  if (!gridEl) return;

  gridEl.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('.card-remove-btn');
    if (removeBtn) {
      e.stopPropagation();
      deleteItem(removeBtn.dataset.id);
      return;
    }

    const card = e.target.closest('.grid-card');
    if (card) {
      // Use data-card-id (new diff-based attribute)
      const id = card.dataset.cardId;
      if (!id) return;
      if (state.selectedItemIds.has(id)) state.selectedItemIds.delete(id);
      else state.selectedItemIds.add(id);
      // Invalidate cache for this card so it re-renders with correct selected class
      _gridCardCache.delete(id);
      card.classList.toggle('selected');
      updateStatsBar();
      return;
    }
  });
}


// ─── Grid View — diff-based update ────────────────────────────────────────
const _gridCardCache = new Map();

function buildGridCardHtml(item, index) {
  const isSelected = state.selectedItemIds.has(item.id);
  const meta = item.metadata || {};
  const kwCount = (meta.keywords || []).length;

  let thumbHtml;
  if (item.url) {
    thumbHtml = `<img src="${item.url}" class="card-thumb-img" alt="${escHtml(item.name)}" loading="lazy" decoding="async">`;
  } else {
    thumbHtml = `<div class="vector-placeholder-box"><svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"/></svg><span class="vector-format-label">${item.format}</span></div>`;
  }

  const borderStyle = item.status === 'failed' ? ` style="border-color:rgba(239,68,68,0.5)"` : '';
  const selectedClass = isSelected ? ' selected border-[#00dbe9] shadow-[0_0_15px_rgba(0,219,233,0.3)] bg-[#00dbe9]/10' : ' border-[#3b494b] bg-[#1d2023]';
  const checkboxHtml = `<input type="checkbox" class="absolute top-2 left-2 w-4 h-4 rounded border-[#3b494b] bg-[#191c1f] text-[#00dbe9] focus:ring-[#00dbe9] z-10 pointer-events-none" ${isSelected ? 'checked' : ''}>`;

  return `<div class="grid-card relative border rounded-xl overflow-hidden flex flex-col transition-all duration-200 hover:-translate-y-0.5 hover:border-[#00dbe9] cursor-pointer ${selectedClass}" data-card-id="${item.id}"${borderStyle}>
    ${checkboxHtml}
    <div class="card-thumb-container relative w-full h-[150px] bg-[#111417] overflow-hidden">
      ${thumbHtml}
      <span class="card-number-badge absolute bottom-2 right-2 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded font-mono backdrop-blur-sm">#${index + 1}</span>
      <div class="card-actions-overlay absolute inset-0 bg-black/50 opacity-0 hover:opacity-100 transition-opacity flex justify-end p-2">
        <button class="card-remove-btn w-6 h-6 rounded-md bg-error text-white hover:bg-error/80 flex items-center justify-center transition-colors" data-id="${item.id}">×</button>
      </div>
    </div>
    <div class="card-content p-3 flex-1 flex flex-col justify-between">
      <div class="card-filename" title="${escHtml(item.name)}">${escHtml(item.name)}</div>
      <div class="card-meta-line">
        <span class="status-tag status-${item.status}">${item.status}</span>
        <span style="font-size:0.7rem;color:var(--text-muted)">${(item.size / 1048576).toFixed(1)}MB · ${kwCount}kw</span>
      </div>
      ${item._error ? `<div style="font-size:0.65rem;color:var(--accent-rose);margin-top:4px">⚠ ${escHtml(item._error.substring(0, 60))}</div>` : ''}
    </div></div>`;
}

function renderGridView(items) {
  const gridEl = document.getElementById('grid-view-container');
  if (!gridEl) return;

  if (items.length === 0) {
    _gridCardCache.clear();
    gridEl.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted)">No matching assets.</div>`;
    return;
  }

  const currentIds = new Set(items.map(i => i.id));

  // Remove stale cards
  for (const [id] of _gridCardCache) {
    if (!currentIds.has(id)) {
      const old = gridEl.querySelector(`[data-card-id="${id}"]`);
      if (old) old.remove();
      _gridCardCache.delete(id);
    }
  }

  // Patch or insert cards
  let prevEl = null;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const html = buildGridCardHtml(item, i);
    const cached = _gridCardCache.get(item.id);
    const existingCard = gridEl.querySelector(`[data-card-id="${item.id}"]`);

    if (cached === html && existingCard) {
      prevEl = existingCard;
      continue;
    }

    const template = document.createElement('template');
    template.innerHTML = html;
    const newCard = template.content.firstElementChild;

    if (existingCard) {
      gridEl.replaceChild(newCard, existingCard);
    } else {
      // New card — add entry animation
      newCard.classList.add('card-entering');
      if (prevEl && prevEl.nextSibling) {
        gridEl.insertBefore(newCard, prevEl.nextSibling);
      } else if (!prevEl) {
        gridEl.prepend(newCard);
      } else {
        gridEl.appendChild(newCard);
      }
      newCard.addEventListener('animationend', () => newCard.classList.remove('card-entering'), { once: true });
    }

    // State-specific animation classes on the card
    newCard.classList.remove('card-processing', 'card-just-ready', 'card-just-failed');
    if (item.status === 'processing') {
      newCard.classList.add('card-processing');
    } else if (item.status === 'ready' && !existingCard) {
      // Only flash success halo on first render as ready (new generation)
      newCard.classList.add('card-just-ready');
      newCard.addEventListener('animationend', () => newCard.classList.remove('card-just-ready'), { once: true });
    } else if (item.status === 'failed' && !existingCard) {
      newCard.classList.add('card-just-failed');
      newCard.addEventListener('animationend', () => newCard.classList.remove('card-just-failed'), { once: true });
    }

    _gridCardCache.set(item.id, html);
    prevEl = newCard;
  }
}


// ─── Delete ────────────────────────────────────────────────────────────────
function deleteItem(id) {
  const item = state.mediaItems.find(i => i.id === id);
  if (item && item.url && item.url.startsWith('blob:')) URL.revokeObjectURL(item.url);
  state.mediaItems    = state.mediaItems.filter(i => i.id !== id);
  state.selectedItemIds.delete(id);
  updateUI();
  showToast(`Removed: ${item ? item.name : 'asset'}`, 'info');
}

// ─── Selection ─────────────────────────────────────────────────────────────
function selectAll() { getFilteredItems().forEach(i => state.selectedItemIds.add(i.id)); renderMetadata(); updateStatsBar(); }
function deselectAll() { state.selectedItemIds.clear(); renderMetadata(); updateStatsBar(); }
function removeSelected() {
  if (!state.selectedItemIds.size) { showToast('No assets selected', 'info'); return; }
  const count = state.selectedItemIds.size;
  state.mediaItems.filter(i => state.selectedItemIds.has(i.id)).forEach(i => {
    if (i.url && i.url.startsWith('blob:')) URL.revokeObjectURL(i.url);
    _tableRowCache.delete(i.id);
    _gridCardCache.delete(i.id);
  });
  state.mediaItems = state.mediaItems.filter(i => !state.selectedItemIds.has(i.id));
  state.selectedItemIds.clear();
  updateUI();
  showToast(`Removed ${count} asset(s)`, 'info');
}
function clearAll() {
  if (!state.mediaItems.length) return;
  if (state.mediaItems.length >= 5 && !confirm(`Clear all ${state.mediaItems.length} assets?`)) return;
  state.mediaItems.forEach(i => { if (i.url && i.url.startsWith('blob:')) URL.revokeObjectURL(i.url); });
  state.mediaItems = []; state.selectedItemIds.clear();
  _tableRowCache.clear(); _gridCardCache.clear();
  updateUI(); showToast('Cleared all assets', 'info');
}

// ─── View Toggle ───────────────────────────────────────────────────────────
function toggleViewMode() {
  state.viewMode = state.viewMode === 'table' ? 'grid' : 'table';
  const btn = document.getElementById('btn-toggle-view');
  const tableEl = document.getElementById('table-view-container');
  const gridEl  = document.getElementById('grid-view-container');
  if (btn) btn.innerHTML = state.viewMode === 'table'
    ? `<svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"></path></svg> Grid View`
    : `<svg width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 6h16M4 10h16M4 14h16M4 18h16"></path></svg> Table View`;
  if (tableEl) tableEl.style.display = state.viewMode === 'table' ? 'block' : 'none';
  if (gridEl)  gridEl.style.display  = state.viewMode === 'grid'  ? 'grid'  : 'none';
  renderMetadata();
}

// ─── CSV Export ─────────────────────────────────────────────────────────────
function openCsvPreviewModal() {
  if (!state.mediaItems.length) { showToast('No assets to preview', 'info'); return; }

  // Validate
  const issues = validateBatch(state.mediaItems, state.currentPlatform);
  const validItems  = state.mediaItems.filter(i => i.status === 'ready');
  const p = state.currentPlatform;

  let warningHtml = '';
  if (issues.length > 0) {
    const names = issues.slice(0,3).map(r=>r.item.name).join(', ');
    const extra  = issues.length > 3 ? ` +${issues.length-3} more` : '';
    warningHtml = `<div class="csv-validation-warning">⚠ ${issues.length} file(s) need attention: ${names}${extra}</div>`;
  }

  const previewHtml = generateCsvPreviewHtml(validItems.length > 0 ? validItems : state.mediaItems, p);

  const body = document.getElementById('csv-preview-modal-body');
  if (body) body.innerHTML = `
    <div class="csv-stats-grid">
      <div class="csv-stat"><span>Platform</span><strong>${p.name}</strong></div>
      <div class="csv-stat"><span>Total Assets</span><strong>${state.mediaItems.length}</strong></div>
      <div class="csv-stat"><span>Ready to Export</span><strong>${validItems.length}</strong></div>
      <div class="csv-stat"><span>Columns</span><strong>${p.csvColumns.length}</strong></div>
    </div>
    ${warningHtml}
    <div style="font-size:0.8125rem;color:var(--text-muted);margin-bottom:8px">Preview (first 8 rows of ready assets):</div>
    <div style="overflow-x:auto">${previewHtml}</div>`;

  openModal(document.getElementById('modal-csv-preview'));
}

function exportCsv() {
  if (!state.mediaItems.length) { showToast('No assets to export', 'info'); return; }
  const issues = validateBatch(state.mediaItems, state.currentPlatform);
  if (issues.length > 0) {
    const names = issues.slice(0,3).map(r=>r.item.name).join(', ');
    const extra = issues.length > 3 ? ` +${issues.length-3} more` : '';
    const proceed = confirm(`${issues.length} file(s) have validation issues:\n${names}${extra}\n\nExport anyway?`);
    if (!proceed) return;
  }
  const readyItems = state.mediaItems.filter(i => i.status === 'ready');
  if (!readyItems.length) { showToast('No ready assets to export. Generate metadata first.', 'warning'); return; }
  downloadCsvFile(readyItems, state.currentPlatform);
  showToast(`Exported CSV for ${state.currentPlatform.name} (${readyItems.length} rows)`, 'success');
  closeModal(document.getElementById('modal-csv-preview'));
}

// ─── Detail Modal ──────────────────────────────────────────────────────────
function openDetailModal(id) {
  const item = state.mediaItems.find(i => i.id === id);
  if (!item) return;
  state.detailItemId = id;
  const meta = item.metadata || { title:'', description:'', keywords:[], category:'' };
  const p = state.currentPlatform;

  const previewHtml = item.url
    ? `<img src="${item.url}" style="width:100%;max-height:300px;object-fit:contain;border-radius:12px;border:1px solid var(--border-glass)">`
    : `<div style="height:180px;border-radius:12px;border:1px solid var(--border-glass);background:rgba(139,92,246,0.08);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;color:var(--accent-purple)"><svg width="48" height="48" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"/></svg><span style="font-size:0.875rem;font-weight:700">${item.format} — No browser preview</span></div>`;

  const detailBody = document.getElementById('detail-body');
  if (!detailBody) return;
  detailBody.innerHTML = `
    <div style="display:flex;gap:24px;flex-wrap:wrap">
      <div style="flex:1;min-width:240px">${previewHtml}
        <div style="margin-top:12px;font-size:0.8125rem;color:var(--text-secondary);display:flex;flex-direction:column;gap:4px">
          <div><strong>File:</strong> ${escHtml(item.name)}</div>
          <div><strong>Type:</strong> ${buildAssetBadge(item)} ${item.format}</div>
          <div><strong>Size:</strong> ${(item.size/1048576).toFixed(2)} MB</div>
          <div><strong>Status:</strong> <span class="status-tag status-${item.status}">${item.status}</span></div>
          ${item._error ? `<div style="color:var(--accent-rose);font-size:0.75rem"><strong>Error:</strong> ${escHtml(item._error)}</div>` : ''}
        </div>
      </div>
      <div style="flex:1.5;min-width:280px;display:flex;flex-direction:column;gap:16px">
        <div>
          <label style="font-size:0.8125rem;font-weight:700;color:var(--text-secondary)">Title (max ${p.titleMaxLen})</label>
          <input type="text" id="detail-title-input" class="inline-input" style="margin-top:6px" value="${escHtml(meta.title)}">
        </div>
        <div>
          <label style="font-size:0.8125rem;font-weight:700;color:var(--text-secondary)">Description</label>
          <textarea id="detail-desc-input" class="inline-textarea" style="margin-top:6px;min-height:80px">${escHtml(meta.description)}</textarea>
        </div>
        <div>
          <label style="font-size:0.8125rem;font-weight:700;color:var(--text-secondary)">Keywords (${(meta.keywords||[]).length} tags)</label>
          <textarea id="detail-kw-input" class="inline-textarea" style="margin-top:6px;min-height:90px">${meta.keywords?(meta.keywords.join(', ')):''}
</textarea>
        </div>
      </div>
    </div>`;

  const ti = document.getElementById('detail-title-input');
  const di = document.getElementById('detail-desc-input');
  const ki = document.getElementById('detail-kw-input');
  ti.addEventListener('input', () => { if (!item.metadata) item.metadata={}; item.metadata.title = ti.value; });
  di.addEventListener('input', () => { if (item.metadata) item.metadata.description = di.value; });
  ki.addEventListener('input', () => { if (item.metadata) item.metadata.keywords = ki.value.split(',').map(k=>k.trim()).filter(k=>k); });

  openModal(document.getElementById('modal-detail'));
}

// ─── Batch Edit ────────────────────────────────────────────────────────────
function applyBatchEdits() {
  const rawTags = document.getElementById('batch-append-keywords')?.value.trim() || '';
  const catVal  = document.getElementById('batch-set-category')?.value || '';
  const targets = state.selectedItemIds.size > 0
    ? state.mediaItems.filter(i => state.selectedItemIds.has(i.id))
    : state.mediaItems;
  if (!targets.length) return;
  const tagsToAdd = rawTags.split(',').map(t=>t.trim()).filter(t=>t);
  targets.forEach(item => {
    if (!item.metadata) item.metadata = {};
    if (tagsToAdd.length) {
      if (!item.metadata.keywords) item.metadata.keywords = [];
      const existing = new Set(item.metadata.keywords.map(k=>k.toLowerCase()));
      tagsToAdd.forEach(t => { if (!existing.has(t.toLowerCase())) { item.metadata.keywords.push(t); existing.add(t.toLowerCase()); } });
    }
    if (catVal) item.metadata.category = catVal;
  });
  closeModal(document.getElementById('modal-batch-edit'));
  throttledRender();
  showToast(`Applied batch edits to ${targets.length} item(s)`, 'success');
}

// ─── Tutorial ──────────────────────────────────────────────────────────────
function renderTutorialStep() {
  const steps = [
    { num:1, title:'Step 1: Select Platform', desc:'Choose your target agency. Title limits, keyword caps, and CSV columns adjust automatically.' },
    { num:2, title:'Step 2: Add Gemini API Key', desc:'Click the AI Settings button to add your Gemini API key. Your key stays in memory only — never stored permanently.' },
    { num:3, title:'Step 3: Upload & Generate', desc:'Upload images (JPG, PNG, WEBP, TIFF) or vectors (EPS, AI, SVG). Click "Generate Metadata" to analyze each image with Gemini AI.' },
    { num:4, title:'Step 4: Review & Export CSV', desc:'Edit any generated metadata inline, then preview and download your platform-ready CSV file.' }
  ];
  const cur = steps[state.tutorialStep - 1];
  const body = document.getElementById('tutorial-step-body');
  if (!body) return;
  body.innerHTML = `
    <div style="display:flex;gap:8px;margin-bottom:16px">
      ${steps.map(s=>`<div style="flex:1;height:6px;border-radius:3px;background:${s.num<=state.tutorialStep?'var(--gradient-brand)':'rgba(255,255,255,0.1)'}"></div>`).join('')}
    </div>
    <div class="tutorial-step-card">
      <div class="step-number-badge">${cur.num}</div>
      <div><h4 style="font-size:1.125rem;font-weight:800;margin-bottom:6px">${cur.title}</h4>
      <p style="font-size:0.875rem;color:var(--text-secondary);line-height:1.6">${cur.desc}</p></div>
    </div>`;
  const prevBtn = document.getElementById('btn-tutorial-prev');
  const nextBtn = document.getElementById('btn-tutorial-next');
  if (prevBtn) prevBtn.style.display = state.tutorialStep === 1 ? 'none' : 'inline-flex';
  if (nextBtn) nextBtn.textContent = state.tutorialStep === 4 ? 'Got it!' : 'Next Step';
}

// ─── Auth tab switch ────────────────────────────────────────────────────────
function switchAuthTab(tab) {
  const loginTab   = document.getElementById('auth-tab-login');
  const signupTab  = document.getElementById('auth-tab-signup');
  const loginForm  = document.getElementById('auth-login-form');
  const signupForm = document.getElementById('auth-signup-form');
  
  const activeClasses = ['font-bold', 'text-background', 'bg-[#00dbe9]', 'shadow-[0_0_15px_rgba(0,219,233,0.3)]'];
  const inactiveClasses = ['font-medium', 'text-on-surface-variant', 'hover:text-on-surface'];

  if (tab === 'login') {
    if (loginTab) {
      loginTab.classList.remove(...inactiveClasses);
      loginTab.classList.add(...activeClasses);
    }
    if (signupTab) {
      signupTab.classList.remove(...activeClasses);
      signupTab.classList.add(...inactiveClasses);
    }
    if (loginForm)  loginForm.style.display  = 'flex';
    if (signupForm) signupForm.style.display = 'none';
  } else {
    if (loginTab) {
      loginTab.classList.remove(...activeClasses);
      loginTab.classList.add(...inactiveClasses);
    }
    if (signupTab) {
      signupTab.classList.remove(...inactiveClasses);
      signupTab.classList.add(...activeClasses);
    }
    if (loginForm)  loginForm.style.display  = 'none';
    if (signupForm) signupForm.style.display = 'flex';
  }
}

// ─── Modal helpers ──────────────────────────────────────────────────────────
function openModal(el)  { el && el.classList.add('active'); }
function closeModal(el) { el && el.classList.remove('active'); }

// ─── Settings ──────────────────────────────────────────────────────────────
function getActiveSettings() {
  return {
    titleMin: parseInt(document.getElementById('setting-title-min-words')?.value) || 5,
    titleMax: parseInt(document.getElementById('setting-title-max-words')?.value) || 20,
    kwMin: parseInt(document.getElementById('setting-kw-min')?.value) || 15,
    kwMax: parseInt(document.getElementById('setting-kw-max')?.value) || 49,
    customPrompt: document.getElementById('setting-custom-prompt')?.value || ''
  };
}

function saveSettings() {
  const bom = document.getElementById('setting-bom-check');
  if (bom) state.includeBom = bom.checked;
  closeModal(document.getElementById('modal-settings'));
  showToast('Settings saved', 'success');
}

// ─── Event Listeners ────────────────────────────────────────────────────────
function setupEventListeners() {
  // Hamburger
  document.getElementById('hamburger-btn')?.addEventListener('click', () =>
    document.getElementById('mobile-nav-drawer')?.classList.toggle('active'));

  // Nav
  const modal = id => document.getElementById(id);
  document.getElementById('nav-btn-tutorial')?.addEventListener('click', () => openModal(modal('modal-tutorial')));
  document.getElementById('nav-btn-contact')?.addEventListener('click',  (e) => {
    e.preventDefault();
    window.open('https://wa.me/8801741783521', '_blank', 'noopener,noreferrer');
  });
  document.getElementById('nav-btn-pricing')?.addEventListener('click',  () => { openModal(modal('modal-pricing')); updatePricingModalUI(); });
  document.getElementById('nav-btn-login')?.addEventListener('click',    () => openAuthModal('login'));
  document.getElementById('nav-btn-signup')?.addEventListener('click',   () => openAuthModal('signup'));
  document.getElementById('btn-user-profile')?.addEventListener('click', () => openAuthModal('profile'));

  // AI Settings button in header/nav (Requires Auth)
  document.getElementById('nav-btn-ai-settings')?.addEventListener('click', () => {
    if (!isLoggedIn()) {
      openAuthModal('login');
      showToast('Please login or sign up to access Gemini API key settings.', 'info');
      return;
    }
    openModal(modal('modal-ai-settings'));
  });

  // Mobile drawer
  document.getElementById('mobile-nav-tutorial')?.addEventListener('click', () => {
    modal('mobile-nav-drawer')?.classList.remove('active');
    openModal(modal('modal-tutorial'));
  });
  document.getElementById('mobile-nav-contact')?.addEventListener('click', () => {
    modal('mobile-nav-drawer')?.classList.remove('active');
    window.open('https://wa.me/8801741783521', '_blank', 'noopener,noreferrer');
  });
  document.getElementById('mobile-nav-pricing')?.addEventListener('click', () => {
    modal('mobile-nav-drawer')?.classList.remove('active');
    openModal(modal('modal-pricing'));
    updatePricingModalUI();
  });
  document.getElementById('mobile-nav-login')?.addEventListener('click', () => {
    modal('mobile-nav-drawer')?.classList.remove('active');
    openAuthModal('login');
  });

  // Profile & Plan event listeners
  document.getElementById('profile-update-form')?.addEventListener('submit', handleProfileSave);
  document.getElementById('btn-manage-plan-from-profile')?.addEventListener('click', () => {
    closeModal(modal('modal-auth'));
    openModal(modal('modal-pricing'));
    updatePricingModalUI();
  });

  // Sidebar buttons
  document.getElementById('btn-sidebar-admin')?.addEventListener('click', () => {
    openModal(modal('modal-admin-drawer'));
    renderAdminDashboard();
  });
  document.getElementById('btn-sidebar-upgrade')?.addEventListener('click', () => {
    openModal(modal('modal-pricing'));
  });
  document.getElementById('nav-btn-sidebar-help')?.addEventListener('click', () => {
    openModal(modal('modal-tutorial'));
  });
  document.getElementById('btn-sidebar-logout')?.addEventListener('click', async () => {
    await logout();
    updateAuthNav();
    showToast('Logged out successfully', 'info');
  });
  document.getElementById('btn-close-profile-done')?.addEventListener('click', () => {
    closeModal(modal('modal-user-profile'));
  });

  // Admin Panel listeners
  document.getElementById('btn-admin-panel')?.addEventListener('click', () => {
    openModal(modal('modal-admin-drawer'));
    renderAdminDashboard();
  });
  document.getElementById('btn-close-admin')?.addEventListener('click', () => closeModal(document.getElementById('modal-admin-drawer')));
  document.getElementById('btn-admin-refresh')?.addEventListener('click', () => {
    const searchVal = document.getElementById('admin-user-search')?.value || '';
    renderAdminDashboard(searchVal);
  });
  document.getElementById('btn-admin-refresh-payments')?.addEventListener('click', () => {
    renderAdminPaymentsList();
  });
  document.getElementById('admin-user-search')?.addEventListener('input', e => {
    renderAdminDashboard(e.target.value);
  });
  document.getElementById('admin-tab-users')?.addEventListener('click', () => {
    document.getElementById('admin-tab-users')?.classList.add('active');
    document.getElementById('admin-tab-payments')?.classList.remove('active');
    document.getElementById('admin-section-users').style.display = 'block';
    document.getElementById('admin-section-payments').style.display = 'none';
  });
  document.getElementById('admin-tab-payments')?.addEventListener('click', () => {
    document.getElementById('admin-tab-payments')?.classList.add('active');
    document.getElementById('admin-tab-users')?.classList.remove('active');
    document.getElementById('admin-section-payments').style.display = 'block';
    document.getElementById('admin-section-users').style.display = 'none';
    renderAdminPaymentsList();
  });

  // Mode selection listeners (Metadata vs Image to Prompt)
  document.getElementById('sidebar-mode-metadata')?.addEventListener('click', () => switchAppMode('metadata'));
  document.getElementById('sidebar-mode-img2prompt')?.addEventListener('click', () => switchAppMode('img2prompt'));

  // Image to Prompt event listeners
  document.getElementById('btn-browse-img2prompt')?.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('img2prompt-file-input')?.click();
  });
  document.getElementById('img2prompt-file-input')?.addEventListener('change', async (e) => {
    const files = e.target.files;
    if (files && files.length) handleImageToPromptUploadBatch(files);
    e.target.value = ''; // reset for re-selection
  });
  document.getElementById('btn-generate-all-img2prompt')?.addEventListener('click', () => {
    processImg2PromptQueue();
  });
  document.getElementById('btn-copy-all-img2prompt')?.addEventListener('click', () => {
    const readyItems = img2promptState.items.filter(i => i.status === 'ready' && i.prompt);
    if (!readyItems.length) {
      showToast('No generated prompts to copy', 'info');
      return;
    }
    const allText = readyItems.map(i => `// ${i.name}\n${i.prompt}`).join('\n\n');
    navigator.clipboard.writeText(allText);
    showToast(`Copied ${readyItems.length} prompts to clipboard!`, 'success');
  });
  document.getElementById('btn-clear-img2prompt')?.addEventListener('click', () => {
    img2promptState.items.forEach(i => { if (i.url && i.url.startsWith('blob:')) URL.revokeObjectURL(i.url); });
    img2promptState.items = [];
    renderImg2PromptCards();
    showToast('Cleared all image prompts', 'info');
  });
  document.getElementById('img2prompt-cards-list')?.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.btn-copy-single-prompt');
    if (copyBtn) {
      const item = img2promptState.items.find(i => i.id === copyBtn.dataset.id);
      if (item && item.prompt) {
        navigator.clipboard.writeText(item.prompt);
        showToast(`Copied prompt for ${item.name}!`, 'success');
      }
      return;
    }

    const removeBtn = e.target.closest('.btn-remove-prompt');
    if (removeBtn) {
      const id = removeBtn.dataset.id;
      const item = img2promptState.items.find(i => i.id === id);
      if (item && item.url && item.url.startsWith('blob:')) URL.revokeObjectURL(item.url);
      img2promptState.items = img2promptState.items.filter(i => i.id !== id);
      renderImg2PromptCards();
    }
  });

  // Customization sliders listeners & value badge sync
  const sliderMap = {
    'setting-title-min-words': 'val-title-min-words',
    'setting-title-max-words': 'val-title-max-words',
    'setting-kw-min': 'val-kw-min',
    'setting-kw-max': 'val-kw-max',
    'setting-desc-min-words': 'val-desc-min-words',
    'setting-desc-max-words': 'val-desc-max-words'
  };

  Object.entries(sliderMap).forEach(([inputId, badgeId]) => {
    const inputEl = document.getElementById(inputId);
    const badgeEl = document.getElementById(badgeId);
    if (!inputEl) return;

    const updateBadge = () => {
      if (badgeEl) badgeEl.textContent = inputEl.value;
    };

    inputEl.addEventListener('input', updateBadge);
    updateBadge(); // Init
    inputEl.addEventListener('change', () => {
      updateBadge();
      const val = parseInt(inputEl.value, 10);
      showToast(`Customization updated: ${inputId.replace('setting-', '')} = ${val}`, 'info');
    });
  });

  const settingsToggle = document.getElementById('settings-toggle');
  if (settingsToggle) {
    settingsToggle.addEventListener('change', (e) => {
      state.settingsEnabled = e.target.checked;
      const bg = document.getElementById('settings-toggle-bg');
      const dot = document.getElementById('settings-toggle-dot');
      const text = document.getElementById('settings-toggle-text');
      
      if (state.settingsEnabled) {
        bg.classList.replace('bg-[#191c1f]', 'bg-[#00dbe9]/20');
        bg.classList.replace('border-[#3b494b]', 'border-[#00dbe9]');
        dot.classList.replace('bg-on-surface-variant', 'bg-[#00dbe9]');
        dot.classList.add('translate-x-4');
        text.textContent = 'ON';
        text.classList.replace('text-on-surface-variant', 'text-[#00dbe9]');
      } else {
        bg.classList.replace('bg-[#00dbe9]/20', 'bg-[#191c1f]');
        bg.classList.replace('border-[#00dbe9]', 'border-[#3b494b]');
        dot.classList.replace('bg-[#00dbe9]', 'bg-on-surface-variant');
        dot.classList.remove('translate-x-4');
        text.textContent = 'OFF';
        text.classList.replace('text-[#00dbe9]', 'text-on-surface-variant');
      }
    });
  }

  // Manual Payment Modal listeners
  document.getElementById('btn-close-manual-payment')?.addEventListener('click', () => closeModal(modal('modal-manual-payment')));
  document.getElementById('manual-payment-form')?.addEventListener('submit', handleManualPaymentSubmit);

  // Tutorial
  document.getElementById('btn-close-tutorial')?.addEventListener('click', () => closeModal(modal('modal-tutorial')));
  document.getElementById('btn-tutorial-prev')?.addEventListener('click', () => {
    if (state.tutorialStep > 1) { state.tutorialStep--; renderTutorialStep(); }
  });
  document.getElementById('btn-tutorial-next')?.addEventListener('click', () => {
    if (state.tutorialStep < 4) { state.tutorialStep++; renderTutorialStep(); }
    else { closeModal(modal('modal-tutorial')); showToast('Tutorial complete!', 'success'); }
  });

  // Contact
  document.getElementById('btn-close-contact')?.addEventListener('click', () => closeModal(modal('modal-contact')));
  document.getElementById('contact-form')?.addEventListener('submit', e => {
    e.preventDefault(); closeModal(modal('modal-contact'));
    showToast('Message sent! We\'ll respond within 24h.', 'success');
    document.getElementById('contact-form').reset();
  });

  // Pricing, Auth
  document.getElementById('btn-close-pricing')?.addEventListener('click', () => closeModal(modal('modal-pricing')));
  document.getElementById('btn-close-auth')?.addEventListener('click',    () => closeModal(modal('modal-auth')));

  // Pricing Plan buttons & cards click handlers
  ['free', 'pro', 'business'].forEach(planId => {
    document.getElementById(`btn-plan-${planId}`)?.addEventListener('click', (e) => {
      e.stopPropagation();
      handleSelectPlan(planId);
    });
    document.getElementById(`pricing-card-${planId}`)?.addEventListener('click', () => {
      handleSelectPlan(planId);
    });
  });

  document.getElementById('auth-tab-login')?.addEventListener('click',    () => switchAuthTab('login'));
  document.getElementById('auth-tab-signup')?.addEventListener('click',   () => switchAuthTab('signup'));
  document.getElementById('auth-login-form')?.addEventListener('submit',  handleLoginSubmit);
  document.getElementById('auth-signup-form')?.addEventListener('submit', handleSignupSubmit);

  // AI Settings Modal
  document.getElementById('btn-close-ai-settings')?.addEventListener('click', () => closeModal(modal('modal-ai-settings')));
  document.getElementById('btn-test-connection')?.addEventListener('click', handleTestConnection);
  document.getElementById('btn-save-api-key')?.addEventListener('click', handleSaveApiKey);
  document.getElementById('btn-clear-api-key')?.addEventListener('click', handleClearApiKey);

  // Show/hide API key toggle
  document.getElementById('btn-toggle-key-visibility')?.addEventListener('click', () => {
    const input = document.getElementById('gemini-api-key-input');
    if (!input) return;
    input.type = input.type === 'password' ? 'text' : 'password';
  });

  // Asset Tabs
  document.getElementById('tab-images')?.addEventListener('click',  () => switchAssetTab('images'));
  document.getElementById('tab-vectors')?.addEventListener('click', () => switchAssetTab('vectors'));
  document.getElementById('tab-videos')?.addEventListener('click',  () => switchAssetTab('videos'));

  // Drag & Drop
  let dragCounter = 0;
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop',     e => e.preventDefault());
  const dropZone = document.getElementById('drop-zone');
  if (dropZone) {
    dropZone.addEventListener('dragenter', e => { e.preventDefault(); dragCounter++; dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragover',  e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
    dropZone.addEventListener('dragleave', e => { dragCounter--; if (dragCounter<=0){dragCounter=0;dropZone.classList.remove('drag-over');} });
    dropZone.addEventListener('drop', e => {
      e.preventDefault(); e.stopPropagation(); dragCounter=0; dropZone.classList.remove('drag-over');
      processFiles(Array.from(e.dataTransfer.files));
    });
    dropZone.addEventListener('click', e => {
      // Prevent double trigger if they clicked the existing button or info cards
      if (e.target.closest('#btn-browse-files') || e.target.closest('.info-card')) return;
      document.getElementById('file-input')?.click();
    });
  }

  // File input
  document.getElementById('btn-browse-files')?.addEventListener('click', (e) => {
    e.stopPropagation(); // prevent bubbling to dropZone
    document.getElementById('file-input')?.click();
  });
  document.getElementById('btn-upload-more')?.addEventListener('click', () => {
    updateUploadZoneForTab();
    document.getElementById('file-input')?.click();
  });
  document.getElementById('file-input')?.addEventListener('change', e => {
    const files = Array.from(e.target.files);
    if (files.length) processFiles(files);
    e.target.value = '';
  });

  // Toolbar
  document.getElementById('btn-generate-ai')?.addEventListener('click',     triggerAiGeneration);
  document.getElementById('btn-stop-generation')?.addEventListener('click',  () => { state.stopBatch = true; showToast('Stopping after current item…', 'info'); });
  document.getElementById('btn-retry-failed')?.addEventListener('click',     retryFailed);
  document.getElementById('btn-clear-all')?.addEventListener('click',        clearAll);
  document.getElementById('btn-select-all')?.addEventListener('click',       selectAll);
  document.getElementById('btn-deselect-all')?.addEventListener('click',     deselectAll);
  document.getElementById('btn-remove-selected')?.addEventListener('click',  removeSelected);
  document.getElementById('btn-toggle-view')?.addEventListener('click',      toggleViewMode);
  document.getElementById('btn-batch-edit')?.addEventListener('click',       () => openModal(modal('modal-batch-edit')));

  let searchDebounce;
  document.getElementById('search-input')?.addEventListener('input', e => {
    clearTimeout(searchDebounce);
    searchDebounce = setTimeout(() => {
      state.searchQuery = e.target.value.toLowerCase();
      throttledRender();
    }, 150);
  });
  document.getElementById('status-filter-select')?.addEventListener('change', e => {
    state.statusFilter = e.target.value; throttledRender();
  });

  // Logout
  document.getElementById('btn-logout')?.addEventListener('click', handleLogout);

  // Delegated event listeners
  setupTableEventDelegation();
  setupGridEventDelegation();

  // CSV
  document.getElementById('btn-preview-csv')?.addEventListener('click',       openCsvPreviewModal);
  document.getElementById('btn-export-csv')?.addEventListener('click',        exportCsv);
  document.getElementById('btn-download-csv-modal')?.addEventListener('click', exportCsv);
  document.getElementById('btn-close-csv-modal')?.addEventListener('click',   () => closeModal(modal('modal-csv-preview')));

  // Settings
  document.getElementById('btn-save-settings')?.addEventListener('click', saveSettings);

  // Batch Edit
  document.getElementById('btn-close-batch-edit')?.addEventListener('click',  () => closeModal(modal('modal-batch-edit')));
  document.getElementById('btn-apply-batch-edit')?.addEventListener('click',  applyBatchEdits);

  // Detail
  document.getElementById('btn-close-detail')?.addEventListener('click', () => closeModal(modal('modal-detail')));

  // Close modals on overlay click
  document.querySelectorAll('.modal-overlay').forEach(overlay => {
    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(overlay); });
  });
}

// ─── Gemini API Key Handlers ───────────────────────────────────────────────
function handleSaveApiKey() {
  const input = document.getElementById('gemini-api-key-input');
  if (!input || !input.value.trim()) { showToast('Please enter a Gemini API key', 'error'); return; }
  setApiKey(input.value.trim());
  input.value = ''; // clear from DOM
  input.type = 'password';
  state.geminiConnected = true;
  updateAiStatusBadge();
  // Flash the badge with the just-connected radiate animation
  const badge = document.getElementById('ai-status-badge');
  if (badge) {
    badge.classList.remove('just-connected');
    void badge.offsetWidth; // force reflow to restart animation
    badge.classList.add('just-connected');
    badge.addEventListener('animationend', () => badge.classList.remove('just-connected'), { once: true });
  }
  showToast('API key saved for this session — Gemini ready!', 'success');
  updateConnectionStatus('connected');
}

function handleClearApiKey() {
  clearApiKey();
  const input = document.getElementById('gemini-api-key-input');
  if (input) { input.value = ''; input.type = 'password'; }
  state.geminiConnected = false;
  updateAiStatusBadge();
  updateConnectionStatus('disconnected');
  showToast('API key cleared', 'info');
}

async function handleTestConnection() {
  const input = document.getElementById('gemini-api-key-input');
  const keyToTest = (input && input.value.trim()) ? input.value.trim() : null;

  if (!keyToTest && !hasApiKey()) {
    showToast('Enter a Gemini API key first', 'error');
    return;
  }

  const btn = document.getElementById('btn-test-connection');
  setBtnLoading(btn, true);

  updateConnectionStatus('testing');

  try {
    const result = await testConnection(keyToTest);
    if (result.ok) {
      if (keyToTest) { setApiKey(keyToTest); if (input) { input.value=''; input.type='password'; } }
      state.geminiConnected = true;
      updateConnectionStatus('connected');
      updateAiStatusBadge();
      // Flash just-connected radiate animation
      const badge = document.getElementById('ai-status-badge');
      if (badge) {
        badge.classList.remove('just-connected');
        void badge.offsetWidth;
        badge.classList.add('just-connected');
        badge.addEventListener('animationend', () => badge.classList.remove('just-connected'), { once: true });
      }
      showToast('✓ Gemini Connected!', 'success');
    } else {
      state.geminiConnected = false;
      updateConnectionStatus('failed', result.message);
      updateAiStatusBadge();
      showToast(result.message, 'error');
    }
  } catch (err) {
    state.geminiConnected = false;
    updateConnectionStatus('failed', 'Connection test failed');
    updateAiStatusBadge();
  } finally {
    setBtnLoading(btn, false);
  }
}

function updateConnectionStatus(state_str, message) {
  const el = document.getElementById('connection-status-text');
  if (!el) return;
  if (state_str === 'connected') {
    el.innerHTML = '<span style="color:#10B981">✓ Gemini Connected</span>';
  } else if (state_str === 'failed') {
    el.innerHTML = `<span style="color:#EF4444">✕ ${escHtml(message || 'Not Connected')}</span>`;
  } else if (state_str === 'testing') {
    el.innerHTML = '<span style="color:#F59E0B">○ Testing connection…</span>';
  } else if (state_str === 'saved') {
    el.innerHTML = '<span style="color:#F59E0B">○ Key saved — click Test Connection to verify</span>';
  } else {
    el.innerHTML = '<span style="color:var(--text-muted)">● Not Connected</span>';
  }
}

// ─── Auth Handlers (real API calls) ────────────────────────────────────────

async function handleLoginSubmit(e) {
  e.preventDefault();
  const emailEl    = document.getElementById('login-email');
  const passEl     = document.getElementById('login-password');
  const errorEl    = document.getElementById('login-error');
  const submitBtn  = document.getElementById('btn-login-submit') || e.target.querySelector('button[type="submit"]');

  const emailVal = emailEl?.value.trim()    || '';
  const passVal  = passEl?.value            || '';

  if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }
  setBtnLoading(submitBtn, true);

  const result = await login({ email: emailVal, password: passVal });

  setBtnLoading(submitBtn, false);

  if (result.ok) {
    closeModal(document.getElementById('modal-auth'));
    updateAuthNav();
    showToast(`Welcome back, ${result.user.fullName || result.user.email}!`, 'success');
    if (emailEl) emailEl.value = '';
    if (passEl)  passEl.value  = '';
  } else {
    if (errorEl) { errorEl.textContent = result.message; errorEl.style.display = 'block'; }
    showToast(result.message, 'error');
  }
}

async function handleSignupSubmit(e) {
  e.preventDefault();
  const nameEl    = document.getElementById('signup-fullname') || document.getElementById('signup-name');
  const emailEl   = document.getElementById('signup-email');
  const passEl    = document.getElementById('signup-password');
  const errorEl   = document.getElementById('signup-error');
  const submitBtn = document.getElementById('btn-signup-submit') || e.target.querySelector('button[type="submit"]');

  const nameVal  = nameEl?.value.trim()  || '';
  const emailVal = emailEl?.value.trim() || '';
  const passVal  = passEl?.value         || '';

  if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }
  setBtnLoading(submitBtn, true);

  const result = await signup({ fullName: nameVal, email: emailVal, password: passVal });

  setBtnLoading(submitBtn, false);

  if (result.ok) {
    closeModal(document.getElementById('modal-auth'));
    updateAuthNav();
    showToast(`Account created! Welcome, ${result.user.fullName || result.user.email}! 🎉`, 'success');
    if (nameEl)  nameEl.value  = '';
    if (emailEl) emailEl.value = '';
    if (passEl)  passEl.value  = '';
  } else {
    if (errorEl) { errorEl.textContent = result.message; errorEl.style.display = 'block'; }
    showToast(result.message, 'error');
  }
}

async function handleLogout() {
  await logout();
  updateAuthNav();
  showToast('Logged out successfully.', 'info');
}

async function handleProfileSave(e) {
  e.preventDefault();
  const inputEl  = document.getElementById('profile-fullname-input');
  const errorEl  = document.getElementById('profile-error');
  const btn      = document.getElementById('btn-save-profile');
  const val      = inputEl?.value.trim() || '';

  if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }
  setBtnLoading(btn, true);

  const res = await updateProfile({ fullName: val });
  setBtnLoading(btn, false);

  if (res.ok) {
    updateAuthNav();
    renderProfileView(res.user);
    showToast('Profile updated successfully!', 'success');
  } else {
    if (errorEl) { errorEl.textContent = res.message; errorEl.style.display = 'block'; }
    showToast(res.message, 'error');
  }
}

async function handleSelectPlan(plan) {
  const user = getCurrentUser();
  if (!user) {
    closeModal(document.getElementById('modal-pricing'));
    openAuthModal('login');
    showToast('Please login or sign up to select a subscription plan.', 'info');
    return;
  }

  if (user.plan === plan) {
    showToast(`You are currently on the ${plan.toUpperCase()} plan.`, 'info');
    return;
  }

  if (plan === 'free') {
    const res = await selectUserPlan('free');
    if (res.ok) {
      updateAuthNav();
      updatePricingModalUI();
      showToast('Switched to Free plan.', 'success');
    } else {
      showToast(res.message || 'Failed to switch to Free plan.', 'error');
    }
    return;
  }

  // Open Manual bKash/Nagad Payment Submission Modal for Pro & Business plans
  openManualPaymentModal(plan);
}

function openManualPaymentModal(plan) {
  const planDisplay = document.getElementById('manual-plan-display');
  const planInput   = document.getElementById('manual-plan-input');
  const amountInput = document.getElementById('manual-amount-input');
  const errorEl     = document.getElementById('manual-payment-error');

  const targetPlan = String(plan || 'pro').toLowerCase();
  const price = targetPlan === 'business' ? 300 : 150;

  if (planDisplay) planDisplay.value = `${targetPlan.toUpperCase()} Plan — ৳${price} BDT`;
  if (planInput) planInput.value = targetPlan;
  if (amountInput) amountInput.value = price;
  if (errorEl) { errorEl.textContent = ''; errorEl.style.display = 'none'; }

  closeModal(document.getElementById('modal-pricing'));
  openModal(document.getElementById('modal-manual-payment'));
}

async function handleManualPaymentSubmit(e) {
  e.preventDefault();
  const plan          = document.getElementById('manual-plan-input')?.value;
  const paymentMethod = document.getElementById('manual-method-select')?.value;
  const senderNumber  = document.getElementById('manual-sender-input')?.value;
  const amount        = document.getElementById('manual-amount-input')?.value;
  const trxId         = document.getElementById('manual-trx-input')?.value;
  const btn           = document.getElementById('btn-submit-manual-payment');
  const errorEl       = document.getElementById('manual-payment-error');

  if (errorEl) { errorEl.textContent = ''; errorEl.style.display = 'none'; }
  setBtnLoading(btn, true);

  const res = await submitManualPayment({ plan, paymentMethod, senderNumber, amount, trxId });

  setBtnLoading(btn, false);

  if (res.ok) {
    closeModal(document.getElementById('modal-manual-payment'));
    const form = document.getElementById('manual-payment-form');
    if (form) form.reset();
    showToast(res.message || 'Payment submitted successfully! Admin will verify your payment.', 'success');
  } else {
    if (errorEl) { errorEl.textContent = res.message; errorEl.style.display = 'block'; }
    showToast(res.message, 'error');
  }
}

// ─── Escape HTML ────────────────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}

// ─── Mode Switcher & Image to Prompt ───────────────────────────────────────
function switchAppMode(mode) {
  state.activeAppMode = mode;
  const metaBtn   = document.getElementById('sidebar-mode-metadata');
  const promptBtn = document.getElementById('sidebar-mode-img2prompt');
  const metaPanel   = document.getElementById('workspace-metadata');
  const promptPanel = document.getElementById('workspace-img2prompt');

  const activeClasses = 'bg-[#00dbe9]/15 border-[#00dbe9] text-[#00dbe9] shadow-[0_0_15px_rgba(0,219,233,0.2)] hover:bg-[#00dbe9]/20';
  const inactiveClasses = 'bg-[#1d2023] border-[#3b494b] text-on-surface-variant hover:border-[#00dbe9]/50 hover:bg-[#191c1f]';
  const baseClasses = 'flex-1 flex flex-col items-center justify-center gap-1 rounded-lg py-3 transition-all cursor-pointer text-center border';

  if (mode === 'img2prompt') {
    if (metaBtn) metaBtn.className = `${baseClasses} ${inactiveClasses}`;
    if (promptBtn) promptBtn.className = `${baseClasses} ${activeClasses}`;
    if (metaPanel) metaPanel.style.display = 'none';
    if (promptPanel) promptPanel.style.display = 'block';
  } else {
    if (promptBtn) promptBtn.className = `${baseClasses} ${inactiveClasses}`;
    if (metaBtn) metaBtn.className = `${baseClasses} ${activeClasses}`;
    if (promptPanel) promptPanel.style.display = 'none';
    if (metaPanel) metaPanel.style.display = 'block';
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = err => reject(err);
    reader.readAsDataURL(file);
  });
}

// ─── Image to Prompt Batch & Clipboard Paste System ──────────────────────
const img2promptState = {
  items: []
};

// Global Clipboard Paste Listener (Ctrl+V for image files)
window.addEventListener('paste', async (e) => {
  const items = e.clipboardData?.items;
  if (!items || !items.length) return;

  const pastedFiles = [];
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    if (item.type && item.type.startsWith('image/')) {
      const fileObj = item.getAsFile();
      if (fileObj) {
        const ext = fileObj.type.split('/')[1] || 'png';
        const file = new File([fileObj], `pasted-image-${Date.now()}-${i + 1}.${ext}`, { type: fileObj.type });
        pastedFiles.push(file);
      }
    }
  }

  if (pastedFiles.length > 0) {
    if (state.currentAppMode === 'img2prompt') {
      showToast(`Pasted ${pastedFiles.length} image(s) from clipboard!`, 'info');
      handleImageToPromptUploadBatch(pastedFiles);
    } else {
      showToast(`Pasted ${pastedFiles.length} image(s) from clipboard into workspace!`, 'info');
      handleFileInput(pastedFiles);
    }
  }
});

async function handleImageToPromptUploadBatch(files) {
  if (!files || !files.length) return;
  const fileArray = Array.from(files).filter(f => f && f.type && f.type.startsWith('image/'));
  if (!fileArray.length) {
    showToast('Please select valid image files (JPG, PNG, WEBP, TIFF)', 'warning');
    return;
  }

  if (!hasApiKey()) {
    openModal(document.getElementById('modal-ai-settings'));
    showToast('Please add your Gemini API key first.', 'warning');
    return;
  }

  const newItems = fileArray.map(file => ({
    id: `img2prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    file,
    name: file.name,
    size: file.size,
    url: URL.createObjectURL(file),
    status: 'waiting',
    prompt: null,
    error: null
  }));

  img2promptState.items.push(...newItems);
  renderImg2PromptCards();
}

async function processImg2PromptQueue() {
  if (!hasApiKey()) {
    openModal(document.getElementById('modal-ai-settings'));
    showToast('Please add your Gemini API key first.', 'warning');
    return;
  }

  const itemsToProcess = img2promptState.items.filter(i => i.status === 'waiting');
  if (!itemsToProcess.length) return;

  for (const item of itemsToProcess) {
    item.status = 'processing';
    renderImg2PromptCards();

    try {
      const base64Image = await fileToBase64(item.file);
      const mimeType = item.file.type || 'image/jpeg';

      const platformSpec = PLATFORMS.general || {
        id: 'general', name: 'General',
        keywordMax: 50, keywordMin: 5, titleMaxLen: 200, categories: []
      };

      const res = await fetch('/api/gemini/generate', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          'x-gemini-api-key': getSessionKey()
        },
        body: JSON.stringify({
          apiKey: getSessionKey(),
          base64Image,
          mimeType,
          filename: item.name,
          platform: platformSpec,
          mode: 'img2prompt'
        })
      });

      const data = await res.json();
      if (data.ok && data.data) {
        const d = data.data;
        const kwStr = Array.isArray(d.keywords) ? d.keywords.slice(0, 25).join(', ') : '';

        const promptParts = [];
        if (d.title) promptParts.push(d.title);
        if (d.description && d.description !== d.title) promptParts.push(d.description);
        if (d.category && d.category !== 'General') promptParts.push(`Style: ${d.category}`);
        if (kwStr) promptParts.push(`Visual details: ${kwStr}`);

        item.prompt = promptParts.join('. ') + '.';
        item.status = 'ready';
        item.error = null;
      } else {
        item.status = 'failed';
        item.error = data.message || 'Generation failed';
      }
    } catch (err) {
      item.status = 'failed';
      item.error = err.message || 'Image to prompt conversion failed';
    }

    renderImg2PromptCards();
  }
}

function renderImg2PromptCards() {
  const container = document.getElementById('img2prompt-cards-list');
  const wrapper = document.getElementById('img2prompt-results-wrapper');
  const titleEl = document.getElementById('img2prompt-results-title');

  if (!container || !wrapper) return;

  if (img2promptState.items.length === 0) {
    wrapper.style.display = 'none';
    container.innerHTML = '';
    return;
  }

  wrapper.style.display = 'block';
  if (titleEl) titleEl.textContent = `Generated Prompts (${img2promptState.items.length} ${img2promptState.items.length === 1 ? 'image' : 'images'})`;

  const btnGenerateAll = document.getElementById('btn-generate-all-img2prompt');
  const hasWaiting = img2promptState.items.some(i => i.status === 'waiting');
  if (btnGenerateAll) {
    if (hasWaiting) {
      btnGenerateAll.style.display = 'inline-block';
      const waitingCount = img2promptState.items.filter(i => i.status === 'waiting').length;
      btnGenerateAll.textContent = `✨ Generate Prompts (${waitingCount})`;
    } else {
      btnGenerateAll.style.display = 'none';
    }
  }

  container.innerHTML = img2promptState.items.map(item => {
    const isProcessing = item.status === 'processing';
    const isReady = item.status === 'ready';
    const isFailed = item.status === 'failed';

    let statusBadgeHtml;
    if (isProcessing) {
      statusBadgeHtml = `<span class="status-tag status-processing">Analyzing…</span>`;
    } else if (isReady) {
      statusBadgeHtml = `<span class="status-tag status-ready">✓ Ready</span>`;
    } else if (isFailed) {
      statusBadgeHtml = `<span class="status-tag status-failed">✕ Failed</span>`;
    } else {
      statusBadgeHtml = `<span class="status-tag status-waiting">Waiting</span>`;
    }

    let promptContentHtml;
    if (isProcessing) {
      promptContentHtml = `<span class="img2prompt-analyzing">Analyzing image visual features &amp; engineering detailed AI prompt <span class="loading-dots"><span></span><span></span><span></span></span></span>`;
    } else if (isFailed) {
      promptContentHtml = `<span style="color:var(--accent-rose)">Error: ${escHtml(item.error || 'Failed to generate prompt')}</span>`;
    } else {
      promptContentHtml = escHtml(item.prompt || 'No prompt generated');
    }

    return `<div class="img2prompt-card glass-panel" data-id="${item.id}" style="padding:16px;background:rgba(21, 32, 54, 0.88)">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;flex-wrap:wrap">
        <div style="display:flex;align-items:center;gap:10px">
          <img src="${item.url}" alt="${escHtml(item.name)}" style="width:44px;height:44px;object-fit:cover;border-radius:6px;border:1px solid var(--glass-border)">
          <div>
            <div style="font-size:0.85rem;font-weight:700;color:var(--text-primary);word-break:break-all">${escHtml(item.name)}</div>
            <div style="font-size:0.725rem;color:var(--text-muted)">${(item.size / 1048576).toFixed(2)} MB</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          ${statusBadgeHtml}
          ${isReady ? `<button class="btn btn-secondary btn-sm btn-copy-single-prompt" data-id="${item.id}">📋 Copy</button>` : ''}
          <button class="btn btn-icon-only btn-sm btn-remove-prompt" data-id="${item.id}" title="Remove">🗑️</button>
        </div>
      </div>
      <div class="prompt-text-box" style="font-size:0.85rem;line-height:1.6;color:var(--text-secondary);background:var(--bg-main);padding:12px 14px;border-radius:8px;border:1px solid var(--glass-border);user-select:all;white-space:pre-wrap">${promptContentHtml}</div>
    </div>`;
  }).join('');
}

// Drag and Drop listener for Image-to-Prompt drop zone
setTimeout(() => {
  const img2dropZone = document.getElementById('img2prompt-drop-zone');
  if (img2dropZone) {
    ['dragenter', 'dragover'].forEach(evt => {
      img2dropZone.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); img2dropZone.classList.add('drag-over'); });
    });
    ['dragleave', 'drop'].forEach(evt => {
      img2dropZone.addEventListener(evt, (e) => { e.preventDefault(); e.stopPropagation(); img2dropZone.classList.remove('drag-over'); });
    });
    img2dropZone.addEventListener('drop', (e) => {
      const files = e.dataTransfer?.files;
      if (files && files.length) handleImageToPromptUploadBatch(files);
    });
    img2dropZone.addEventListener('click', (e) => {
      if (e.target.closest('#btn-browse-img2prompt')) return;
      document.getElementById('img2prompt-file-input')?.click();
    });
  }
}, 0);

// ─── Auto Initialization ───────────────────────────────────────────────────
if (typeof window !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initApp);
  } else {
    initApp();
  }
}
