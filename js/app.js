/**
 * Microstock Metadata Management Tool — Main Application Controller
 * Real Gemini AI BYOK + Batch Processing + CSV Export + Performance Optimizations
 */

import { PLATFORMS } from './platforms.js';
import { generateCsvContent, downloadCsvFile, validateBatch, generateCsvPreviewHtml } from './csvExporter.js';
import { setApiKey, hasApiKey, clearApiKey, clearAllApiKeys, getSessionKey, getRedactedKey, testConnection, generateMetadataForImage, isGeminiAnalyzable, rasterizeSvgToJpegBase64, optimizeImageForAi, compressImageFile, setAiProvider, getActiveProvider, setProviderModel, getProviderModel, AI_PROVIDERS_CONFIG } from './geminiClient.js';
import { runBatchQueue } from './batchProcessor.js';
import { checkAuthState, login, signup, logout, getCurrentUser, isLoggedIn, fetchUserProfile, updateProfile, selectUserPlan, deductCredit, adminFetchUsers, adminGetUserDetail, adminUpdateUserPlan, adminToggleUserStatus, adminAdjustCredits, submitManualPayment, adminFetchPayments, adminApprovePayment, adminRejectPayment } from './auth.js';

// ─── Application State ─────────────────────────────────────────────────────
const state = {
  currentPlatform: PLATFORMS.adobe,
  mediaItems: [],
  selectedItemIds: new Set(),
  searchQuery: '',
  statusFilter: 'all',
  formatFilter: 'all',
  viewMode: 'detail',
  isGenerating: false,
  stopBatch: false,
  detailItemId: null,
  includeBom: true,
  tutorialStep: 1,
  activeAssetTab: 'images',
  geminiConnected: false,
  activeAppMode: 'metadata',
  settingsEnabled: false,
  // Render throttle & Cancellation
  _renderPending: false,
  _lastStats: null,
  activeBatchAbortController: null,
  _uploadSessionId: 0,
  _uploadSessionCounter: 0
};

// ─── File type sets ────────────────────────────────────────────────────────
const IMAGE_EXTS  = new Set(['jpg','jpeg','png','webp','tiff','tif']);
const VECTOR_EXTS = new Set(['eps','ai','svg','pdf']);
const VIDEO_EXTS  = new Set(['mp4','mov','avi','webm']);
const ALL_EXTS    = new Set([...IMAGE_EXTS, ...VECTOR_EXTS, ...VIDEO_EXTS]);

// ─── Toast System ──────────────────────────────────────────────────────────
export function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;
  const toast = document.createElement('div');
  toast.className = `toast-item toast-${type}`;
  
  const iconConfig = {
    success: { icon: 'check_circle', color: 'text-emerald-400' },
    error:   { icon: 'error',        color: 'text-red-400' },
    info:    { icon: 'info',         color: 'text-[#00dbe9]' },
    warning: { icon: 'warning',      color: 'text-amber-400' }
  };
  const cfg = iconConfig[type] || iconConfig.info;

  toast.innerHTML = `
    <span class="material-symbols-outlined ${cfg.color} text-[20px] flex-shrink-0" aria-hidden="true">${cfg.icon}</span>
    <span class="toast-message text-on-surface text-xs font-semibold leading-snug flex-1">${escHtml(message)}</span>
    <button type="button" class="toast-close-btn text-on-surface-variant hover:text-white transition-colors ml-2 text-[14px] cursor-pointer" onclick="this.parentElement.remove()" title="Close notification">✕</button>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('toast-leaving');
    setTimeout(() => toast.parentNode && toast.parentNode.removeChild(toast), 320);
  }, 4200);
}
window.showToast = showToast;
window.getActiveProvider = getActiveProvider;
window.AI_PROVIDERS_CONFIG = AI_PROVIDERS_CONFIG;

export function setBtnLoading(btn, isLoading, loadingHtml = '') {
  if (!btn) return;
  if (isLoading) {
    if (!btn.dataset.originalHtml) btn.dataset.originalHtml = btn.innerHTML;
    if (loadingHtml) btn.innerHTML = loadingHtml;
    btn.classList.add('btn-loading');
    btn.setAttribute('aria-busy', 'true');
    btn.disabled = true;
  } else {
    btn.classList.remove('btn-loading');
    btn.removeAttribute('aria-busy');
    btn.disabled = false;
    if (btn.dataset.originalHtml) {
      btn.innerHTML = btn.dataset.originalHtml;
      delete btn.dataset.originalHtml;
    }
  }
}

function ensureAiWorkspaceOverlay() {
  let overlay = document.getElementById('ai-workspace-overlay');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'ai-workspace-overlay';
  overlay.className = 'ai-workspace-overlay';
  overlay.setAttribute('aria-live', 'polite');
  overlay.setAttribute('aria-hidden', 'true');
  overlay.innerHTML = `
    <div class="ai-workspace-stage">
      <div class="ai-workspace-core" aria-hidden="true">
        <span class="ai-core-ring ai-core-ring-one"></span>
        <span class="ai-core-ring ai-core-ring-two"></span>
        <span class="material-symbols-outlined ai-core-icon">auto_awesome</span>
      </div>
      <div class="ai-workspace-copy">
        <h2 id="ai-overlay-title">Processing Metadata...</h2>
      </div>
      <div class="ai-workspace-progress">
        <div class="ai-workspace-progress-top">
          <span id="ai-overlay-status">Analyzing assets...</span>
          <strong id="ai-overlay-counter">0%</strong>
        </div>
        <div class="ai-workspace-progress-track">
          <div id="ai-overlay-fill" class="ai-workspace-progress-fill"></div>
        </div>
      </div>
      <button id="btn-overlay-stop" type="button" class="ai-overlay-stop-btn">
        <span class="material-symbols-outlined text-[16px]">stop_circle</span> Stop Processing
      </button>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById('btn-overlay-stop')?.addEventListener('click', () => {
    stopAllGenerations();
  });

  return overlay;
}

function showAiWorkspaceOverlay({ mode = 'metadata', total = 0 } = {}) {
  const overlay = ensureAiWorkspaceOverlay();
  const isPrompt = mode === 'prompt';
  overlay.classList.toggle('mode-prompt', isPrompt);
  overlay.classList.toggle('mode-metadata', !isPrompt);
  overlay.setAttribute('aria-hidden', 'false');
  overlay.classList.remove('is-leaving');
  document.body.classList.add('ai-workspace-overlay-open');

  const title = document.getElementById('ai-overlay-title');
  if (title) title.textContent = isPrompt ? 'Generating AI Prompts...' : 'Processing Metadata...';
  updateAiWorkspaceOverlay(0, total, isPrompt ? 'Preparing prompt generation...' : 'Preparing metadata...');
}

function updateAiWorkspaceOverlay(completed, total, statusText = '') {
  const overlay = document.getElementById('ai-workspace-overlay');
  if (!overlay || !document.body.classList.contains('ai-workspace-overlay-open')) return;
  const safeTotal = Math.max(0, Number(total) || 0);
  const safeCompleted = Math.min(Math.max(0, Number(completed) || 0), safeTotal || Number(completed) || 0);
  const pct = safeTotal > 0 ? Math.round((safeCompleted / safeTotal) * 100) : 0;

  const status = document.getElementById('ai-overlay-status');
  const counter = document.getElementById('ai-overlay-counter');
  const fill = document.getElementById('ai-overlay-fill');
  if (status) status.textContent = statusText || (safeTotal > 0 ? `Processing ${safeCompleted} of ${safeTotal}` : 'Processing...');
  if (counter) counter.textContent = `${pct}%`;
  if (fill) fill.style.width = `${pct}%`;
}

function hideAiWorkspaceOverlay() {
  const overlay = document.getElementById('ai-workspace-overlay');
  if (!overlay) return;
  overlay.setAttribute('aria-hidden', 'true');
  overlay.classList.add('is-leaving');
  document.body.classList.remove('ai-workspace-overlay-open');
  setTimeout(() => overlay.classList.remove('is-leaving'), 260);
}

function stopAllGenerations() {
  state.stopBatch = true;
  img2promptState.stopBatch = true;
  state.isGenerating = false;
  img2promptState.isProcessing = false;
  img2promptState._batchSessionId = ++img2promptState._batchSessionCounter;

  if (state.activeBatchAbortController) {
    try { state.activeBatchAbortController.abort(); } catch (_) {}
    state.activeBatchAbortController = null;
  }
  if (img2promptState.abortController) {
    try { img2promptState.abortController.abort(); } catch (_) {}
    img2promptState.abortController = null;
  }

  const genBtn = document.getElementById('btn-generate-ai');
  const stopBtn = document.getElementById('btn-stop-generation');
  const mainArea = document.getElementById('main-content-area');
  const progressBar = document.getElementById('progress-bar-container');

  if (genBtn) {
    setBtnLoading(genBtn, false);
    genBtn.classList.remove('ai-action-running');
  }
  if (stopBtn) stopBtn.style.display = 'none';
  if (mainArea) mainArea.classList.remove('ai-batch-running');
  if (progressBar) {
    progressBar.classList.remove('active');
    progressBar.style.display = 'none';
  }

  const promptBtn = document.getElementById('btn-generate-all-img2prompt');
  if (promptBtn) {
    setBtnLoading(promptBtn, false);
    promptBtn.classList.remove('ai-action-running');
  }

  hideAiWorkspaceOverlay();

  state.mediaItems.forEach(i => {
    if (i.status === 'processing') {
      i.status = 'waiting';
      i._error = null;
    }
  });

  img2promptState.items.forEach(i => {
    if (i.status === 'processing') {
      i.status = 'waiting';
      i.error = null;
      i.prompt = null;
    }
  });

  updateUI();
  renderImg2PromptCards();
  showToast('Generation stopped', 'info');
}

// ─── AI Status Badge ────────────────────────────────────────────────────────
function updateAiStatusBadge() {
  const badge = document.getElementById('ai-status-badge');
  if (!badge) return;
  const provider = getActiveProvider();
  const providerConfig = AI_PROVIDERS_CONFIG[provider] || AI_PROVIDERS_CONFIG.gemini;

  if (hasApiKey(provider)) {
    badge.innerHTML = `<span class="ai-dot ai-dot-connected"></span> ${providerConfig.name} ON`;
    badge.className = 'ai-status-badge connected hidden md:inline-flex';
  } else {
    badge.innerHTML = `<span class="ai-dot ai-dot-disconnected"></span> AI OFF`;
    badge.className = 'ai-status-badge disconnected hidden md:inline-flex';
  }
}

// ─── Init ──────────────────────────────────────────────────────────────────
export async function initApp() {
  renderPlatforms();
  setupEventListeners();
  initAiSettingsModal();
  updateUI();
  renderTutorialStep();
  updateUploadZoneForTab();
  updateAiStatusBadge();
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
      ? 'bg-[#222442] border-2 border-[#6366f1] text-white px-4 py-2 rounded-xl text-xs font-semibold shadow-[0_0_15px_rgba(99,102,241,0.4)] flex items-center gap-2 cursor-pointer transition-all hover:brightness-110'
      : 'bg-[#0f172a]/95 hover:bg-[#1e293b] border border-[#1e293b] hover:border-[#334155] text-[#cbd5e1] hover:text-white px-4 py-2 rounded-xl text-xs font-medium transition-all flex items-center gap-2 cursor-pointer';
    tab.dataset.id = platform.id;
    tab.type = 'button';
    tab.title = `${platform.name} — ${platform.description}`;
    tab.innerHTML = `
      <span class="flex items-center justify-center">${platform.logoSvg}</span>
      <span class="font-medium tracking-tight">${platform.name}</span>
    `;
    tab.addEventListener('click', e => { e.preventDefault(); selectPlatform(platform.id); });
    grid.appendChild(tab);
  });
}

function selectPlatform(id) {
  state.currentPlatform = PLATFORMS[id] || PLATFORMS.adobe;
  renderPlatforms();
  throttledRender();
  showToast(`Platform: ${state.currentPlatform.name}`, 'info');
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
  
  // Mobile / Sidebar Elements
  const sidebarLoggedOut = document.getElementById('sidebar-logged-out');
  const sidebarLoggedIn  = document.getElementById('sidebar-logged-in');
  const sidebarUserName  = document.getElementById('sidebar-user-name');
  const sidebarUserCreds = document.getElementById('sidebar-user-credits');
  const sidebarLogoutBtn = document.getElementById('btn-sidebar-logout');
  
  const user           = getCurrentUser();

  if (user) {
    if (loggedOut) {
      loggedOut.classList.add('hidden');
      loggedOut.classList.remove('md:flex');
      loggedOut.style.display = 'none';
    }

    if (loggedIn) {
      loggedIn.classList.remove('hidden');
      loggedIn.classList.add('md:flex');
      loggedIn.style.display = window.innerWidth >= 768 ? 'flex' : 'none';
    }

    if (sidebarLoggedOut) sidebarLoggedOut.style.display = 'none';
    if (sidebarLoggedIn)  sidebarLoggedIn.style.display  = 'flex';
    if (sidebarUserName)  sidebarUserName.textContent  = user.fullName || user.email;
    if (sidebarUserCreds) sidebarUserCreds.textContent = `⚡ ${user.credits ?? 0} Credits (${(user.plan || 'free').toUpperCase()})`;
    if (sidebarLogoutBtn) sidebarLogoutBtn.style.display = 'flex';

    if (nameSpan)        nameSpan.textContent = user.fullName || user.email;
    if (planBadge)       planBadge.textContent = (user.plan || 'free').toUpperCase();
    if (creditBadge)     creditBadge.textContent = `⚡ ${user.credits ?? 0} Credits`;
    if (adminBtn)        adminBtn.style.display = user.role === 'admin' ? 'inline-flex' : 'none';
    if (sidebarAdminBtn) sidebarAdminBtn.style.display = user.role === 'admin' ? 'flex' : 'none';
  } else {
    if (loggedOut) {
      loggedOut.classList.remove('hidden');
      loggedOut.classList.add('md:flex');
      loggedOut.style.display = ''; // Respects md:flex (hidden on mobile, flex on desktop)
    }

    if (loggedIn) {
      loggedIn.classList.add('hidden');
      loggedIn.classList.remove('md:flex');
      loggedIn.style.display = 'none';
    }

    if (sidebarLoggedOut) sidebarLoggedOut.style.display = 'flex';
    if (sidebarLoggedIn)  sidebarLoggedIn.style.display  = 'none';
    if (sidebarLogoutBtn) sidebarLogoutBtn.style.display = 'none';

    if (adminBtn)        adminBtn.style.display = 'none';
    if (sidebarAdminBtn) sidebarAdminBtn.style.display = 'none';
  }
}

// ─── Profile & Plan View Helpers ───────────────────────────────────────────
function openAuthModal(tab = 'login') {
  if (tab === 'profile') {
    const user = getCurrentUser();
    if (user) {
      renderProfileView(user);
      openModal(document.getElementById('modal-user-profile'));
      return;
    }
    tab = 'login';
  }

  const modalEl = document.getElementById('modal-auth');
  const tabsContainer = document.getElementById('auth-tabs-container');
  const profileView = document.getElementById('auth-profile-view');
  const loginErr = document.getElementById('login-error');
  const signupErr = document.getElementById('signup-error');

  if (loginErr)  { loginErr.style.display  = 'none'; loginErr.textContent  = ''; }
  if (signupErr) { signupErr.style.display = 'none'; signupErr.textContent = ''; }
  if (tabsContainer) tabsContainer.style.display = 'flex';
  if (profileView)   profileView.style.display   = 'none';

  switchAuthTab(tab);
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
        const currentSearch = document.getElementById('admin-user-search')?.value || '';
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

let dropZoneResetTimer = null;

function bindFileInputListener() {
  const fileInput = document.getElementById('file-input');
  if (fileInput) {
    fileInput.onchange = (e) => {
      const files = Array.from(e.target.files);
      if (files.length) processFiles(files);
      e.target.value = '';
    };
  }
  const btnBrowse = document.getElementById('btn-browse-files');
  if (btnBrowse) {
    btnBrowse.onclick = (e) => {
      e.stopPropagation();
      document.getElementById('file-input')?.click();
    };
  }
}

function setDropZoneUploadingState(isUploading, current = 0, total = 0, currentName = '') {
  const dropZone = document.getElementById('drop-zone');
  if (!dropZone) return;

  if (dropZoneResetTimer) {
    clearTimeout(dropZoneResetTimer);
    dropZoneResetTimer = null;
  }

  if (isUploading) {
    dropZone.classList.add('dropzone-uploading');
    dropZone.classList.remove('dropzone-success');
    const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;

    const existingBar = dropZone.querySelector('#upload-progress-fill');
    if (existingBar) {
      existingBar.style.width = `${pct}%`;
      const nameEl = dropZone.querySelector('#upload-current-name');
      const countEl = dropZone.querySelector('#upload-current-count');
      if (nameEl) nameEl.textContent = currentName || 'Optimizing size to ~450KB...';
      if (countEl) countEl.textContent = `${current} / ${total} (${pct}%)`;
      return;
    }

    dropZone.innerHTML = `
      <div class="relative w-16 h-16 flex items-center justify-center">
        <div class="absolute inset-0 rounded-full border-2 border-transparent border-t-[#00dbe9] border-r-[#db50ff] animate-upload-spin-ring"></div>
        <div class="w-12 h-12 rounded-full bg-[#191c1f] border border-[#00dbe9]/50 flex items-center justify-center animate-upload-pulse">
          <span class="material-symbols-outlined text-[26px] text-[#00dbe9]">cloud_upload</span>
        </div>
      </div>
      <div class="flex flex-col items-center gap-1.5 w-full max-w-md px-4">
        <h2 class="text-title-md font-bold text-white flex items-center gap-2">
          <span>Compressing & Uploading ${total} File${total === 1 ? '' : 's'}...</span>
        </h2>
        <div class="w-full bg-[#12161c] h-2.5 rounded-full overflow-hidden border border-[#2d3748] mt-1 relative">
          <div id="upload-progress-fill" class="bg-gradient-to-r from-[#00dbe9] to-[#db50ff] h-full transition-all duration-300 ease-out rounded-full" style="width: ${pct}%"></div>
        </div>
        <div class="flex justify-between w-full text-[11px] text-on-surface-variant mt-0.5 font-mono">
          <span id="upload-current-name" class="truncate max-w-[240px] text-[#00dbe9]">${currentName ? escHtml(currentName) : 'Optimizing size to ~450KB...'}</span>
          <span id="upload-current-count">${current} / ${total} (${pct}%)</span>
        </div>
      </div>
      <p class="text-[10px] font-bold text-outline uppercase tracking-wider">Fast-Track AI Compression Active</p>
      <input type="file" id="file-input" class="hidden" multiple accept=".jpg,.jpeg,.png,.webp,.tiff,.tif,.eps,.ai,.svg,.pdf,.mp4">
    `;
    bindFileInputListener();
  }
}

function setDropZoneSuccessState(count = 1) {
  const dropZone = document.getElementById('drop-zone');
  if (!dropZone) return;

  if (dropZoneResetTimer) {
    clearTimeout(dropZoneResetTimer);
  }

  dropZone.classList.remove('dropzone-uploading');
  dropZone.classList.add('dropzone-success');

  dropZone.innerHTML = `
    <div class="w-16 h-16 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center animate-success-check">
      <span class="material-symbols-outlined text-[38px] text-emerald-400 font-bold">check_circle</span>
    </div>
    <div class="flex flex-col items-center gap-1">
      <h2 class="text-title-lg font-bold text-emerald-400 flex items-center gap-1.5">
        <span>✓ ${count} File${count === 1 ? '' : 's'} Uploaded Successfully!</span>
      </h2>
      <p class="text-body-sm text-on-surface-variant">
        Auto-compressed to ~450KB · Ready to generate metadata
      </p>
    </div>
    <p class="text-[11px] font-bold text-emerald-400/90 bg-emerald-500/10 border border-emerald-500/30 px-3.5 py-1 rounded-full uppercase tracking-wider">
      Upload Complete · Ready to Process
    </p>
    <input type="file" id="file-input" class="hidden" multiple accept=".jpg,.jpeg,.png,.webp,.tiff,.tif,.eps,.ai,.svg,.pdf,.mp4">
  `;
  bindFileInputListener();

  dropZoneResetTimer = setTimeout(() => {
    resetDropZoneToDefault();
  }, 3500);
}

function resetDropZoneToDefault() {
  const dropZone = document.getElementById('drop-zone');
  if (!dropZone) return;
  dropZone.classList.remove('dropzone-uploading', 'dropzone-success');
  updateUploadZoneForTab();
}

function updateUploadZoneForTab() {
  const dropZone = document.getElementById('drop-zone');
  if (!dropZone) return;

  dropZone.classList.remove('dropzone-uploading', 'dropzone-success');

  const tab = state.activeAssetTab;
  let title = 'Drop your images here or browse files';
  let sub = 'JPG, PNG, WEBP, TIFF, SVG supported — batch 100+ files';
  let tags = ['JPG','JPEG','PNG','WEBP','TIFF','SVG'];
  let accept = '.jpg,.jpeg,.png,.webp,.tiff,.tif,.svg';

  if (tab === 'vectors') {
    title = 'Drop your vector files here or browse files';
    sub = 'EPS, AI, SVG, PDF — batch upload supported';
    tags = ['EPS','AI','SVG','PDF'];
    accept = '.eps,.ai,.svg,.pdf';
  } else if (tab === 'videos') {
    title = 'Drop your video files here or browse files';
    sub = 'MP4, MOV, AVI, WEBP (Max 100MB per video) — batch upload supported';
    tags = ['MP4','MOV','AVI','WEBM'];
    accept = '.mp4,.mov,.avi,.webm';
  }

  dropZone.innerHTML = `
    <div class="w-16 h-16 rounded-full bg-surface-container-highest border border-outline-variant flex items-center justify-center group-hover:border-primary-fixed-dim group-hover:glow-cyan transition-all">
      <span class="material-symbols-outlined text-[32px] text-primary-fixed-dim">cloud_upload</span>
    </div>
    <div class="flex flex-col gap-1">
      <h2 class="text-title-lg font-bold text-on-surface" id="upload-title-text">${title}</h2>
      <p class="text-body-sm text-on-surface-variant" id="upload-subtitle-text">${sub}</p>
    </div>
    <p class="text-[10px] font-bold text-outline uppercase tracking-wider" id="format-tags-container">${tags.join(' • ')}</p>
    
    <div class="flex gap-3 mt-4 relative z-10">
      <button class="bg-primary-fixed-dim text-background px-5 py-2.5 rounded-lg text-label-md font-label-md hover:bg-primary-container transition-all flex items-center gap-2 glow-cyan" id="btn-browse-files">
        <span class="material-symbols-outlined text-[18px]">folder_open</span> Browse Files
      </button>
    </div>
    <input type="file" id="file-input" class="hidden" multiple accept="${accept}">
  `;

  bindFileInputListener();
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

const PREVIEWABLE = new Set(['jpg','jpeg','png','webp','gif','svg','mp4','mov','webm','avi','pdf','eps','ai']);
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
  const currentSessionId = ++state._uploadSessionId;
  const existingKeys = new Set(state.mediaItems.map(i => i._fileKey));
  const accepted = []; const skippedDup = []; const skippedBad = [];

  for (const file of files) {
    const cls = classifyFile(file);
    if (!cls) { skippedBad.push(file.name); continue; }
    if (state.activeAssetTab === 'images'  && cls.assetType !== 'image' && cls.ext !== 'svg')  { skippedBad.push(file.name); continue; }
    if (state.activeAssetTab === 'vectors' && cls.assetType === 'image' && cls.ext !== 'svg')  { skippedBad.push(file.name); continue; }
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

  // Trigger Dropzone Upload & Compression Animation
  setDropZoneUploadingState(true, 0, accepted.length, 'Optimizing files...');

  const BATCH = 5;
  const THUMB_CONCURRENCY = 3; // max parallel thumbnail creates (createImageBitmap+canvas)
  const newItems = [];
  let processedCount = 0;

  // Semaphore for thumbnail concurrency
  let _thumbRunning = 0;
  const _thumbQueue = [];
  function runWithThumbSemaphore(fn) {
    return new Promise((resolve, reject) => {
      const task = () => {
        _thumbRunning++;
        fn().then(
          val => { _thumbRunning--; if (_thumbQueue.length) _thumbQueue.shift()(); resolve(val); },
          err => { _thumbRunning--; if (_thumbQueue.length) _thumbQueue.shift()(); reject(err); }
        );
      };
      if (_thumbRunning < THUMB_CONCURRENCY) task();
      else _thumbQueue.push(task);
    });
  }

  for (let i = 0; i < accepted.length; i += BATCH) {
    // If the user cleared all assets during upload, abort processing immediately
    if (state._uploadSessionId !== currentSessionId) return;

    const batch = accepted.slice(i, i + BATCH);
    await Promise.all(batch.map(async ({ file, cls, key }) => {
      if (state._uploadSessionId !== currentSessionId) return;

      const { assetType, format, ext } = cls;
      const id = `asset-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;

      // Auto-compress high-resolution images to ~400-500KB on upload for instant processing
      let uploadFile = file;
      if (assetType === 'image' && ext !== 'svg') {
        const compressed = await compressImageFile(file);
        if (compressed && compressed.size < file.size) {
          uploadFile = compressed;
        }
      }

      processedCount++;
      setDropZoneUploadingState(true, processedCount, accepted.length, file.name);

      const item = {
        id, _fileKey: key, file: uploadFile, originalFile: file,
        name: file.name, format, assetType, ext,
        size: file.size, type: file.type || `application/${ext}`,
        status: 'waiting', url: null,
        metadata: null,    // null = not yet generated
        _error: null
      };
      if (PREVIEWABLE.has(ext)) {
        if (THUMBNAILABLE.has(ext)) {
          // Use semaphore: max 3 simultaneous createImageBitmap+canvas+toBlob ops
          item.url = await runWithThumbSemaphore(() => createThumbnailUrl(uploadFile)).catch(() => null)
                     || URL.createObjectURL(uploadFile);
        } else {
          item.url = URL.createObjectURL(uploadFile);
        }
      }
      newItems.push(item);
    }));
    await new Promise(r => setTimeout(r, 10)); // yield
  }

  // Final check: did user clear items while batch was processing?
  if (state._uploadSessionId !== currentSessionId) return;

  state.mediaItems.push(...newItems);
  updateUI();

  // Reset file inputs in DOM so cleared/previous selections never persist
  document.querySelectorAll('input[type="file"]').forEach(inp => { inp.value = ''; });

  // Show Checkmark Success State in Dropzone!
  setDropZoneSuccessState(newItems.length);
  showToast(`Added ${newItems.length} file(s) — ${state.mediaItems.length} total`, 'success');
}

// ─── AI Generation ─────────────────────────────────────────────────────────
async function triggerAiGeneration() {
  if (state.mediaItems.length === 0 || state.isGenerating) return;

  const provider = getActiveProvider();
  const inputEl = document.getElementById('gemini-api-key-input');
  if (!hasApiKey(provider) && inputEl && inputEl.value.trim()) {
    setApiKey(inputEl.value.trim(), provider);
  }

  if (!hasApiKey(provider)) {
    openModal(document.getElementById('modal-ai-settings'));
    showToast(`Please connect your ${AI_PROVIDERS_CONFIG[provider]?.name || provider} API key first to generate metadata.`, 'warning');
    return;
  }

  // Determine which items need generation
  const toProcess = state.mediaItems.filter(i => i.status === 'waiting' || i.status === 'failed');
  if (toProcess.length === 0) {
    showToast('All assets already have metadata. Use "Retry Failed" if needed.', 'info');
    return;
  }

  state.isGenerating = true;
  state.stopBatch = false;
  state.activeBatchAbortController = new AbortController();
  const batchSignal = state.activeBatchAbortController.signal;

  const genBtn = document.getElementById('btn-generate-ai');
  const stopBtn = document.getElementById('btn-stop-generation');
  const retryBtn = document.getElementById('btn-retry-failed');
  const mainArea = document.getElementById('main-content-area');
  setBtnLoading(genBtn, true, '<span class="ai-action-spinner" aria-hidden="true"></span><span>Processing Metadata...</span>');
  genBtn?.classList.add('ai-action-running');
  mainArea?.classList.add('ai-batch-running');
  if (stopBtn) stopBtn.style.display = 'inline-flex';

  const progressBar = document.getElementById('progress-bar-container');
  if (progressBar) {
    progressBar.style.display = 'block';
    progressBar.classList.add('active');
  }
  const progressText    = document.getElementById('progress-text');
  const progressCounter = document.getElementById('progress-stats-counter');
  const progressPct     = document.getElementById('progress-percent-text');
  const progressFill    = document.getElementById('progress-fill');
  if (progressText)    progressText.textContent    = `Preparing ${toProcess.length} asset${toProcess.length === 1 ? '' : 's'}...`;
  if (progressCounter) progressCounter.textContent = `0 / ${toProcess.length}`;
  if (progressPct)     progressPct.textContent     = '0%';
  if (progressFill)    progressFill.style.width    = '0%';
  showAiWorkspaceOverlay({ mode: 'metadata', total: toProcess.length });

  let successCount = 0, failCount = 0;
  const isVideoBatch = state.activeAssetTab === 'videos';

  await runBatchQueue({
    items: toProcess,
    concurrencyLimit: isVideoBatch ? 1 : 2,
    shouldStop: () => state.stopBatch,

    onItemStart: (item) => {
      const stateItem = state.mediaItems.find(i => i.id === item.id);
      if (stateItem) { stateItem.status = 'processing'; stateItem._error = null; }
      updateAiWorkspaceOverlay(successCount + failCount, toProcess.length, `Generating metadata for ${item.name}`);
      throttledRender();
    },

    processFn: async (item) => {
      const settings = state.settingsEnabled ? getActiveSettings() : null;
      return await generateMetadataForImage(item, state.currentPlatform, null, settings, state.activeAppMode, batchSignal);
    },

    onItemDone: async (item, idx, result, err) => {
      const stateItem = state.mediaItems.find(i => i.id === item.id);
      if (!stateItem) return;

      if (state.stopBatch || img2promptState.stopBatch) {
        stateItem.status = 'waiting';
        stateItem._error = null;
        stateItem.metadata = null;
        return;
      }

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
      }
      throttledRender();
    },

    onProgress: (completed, total) => {
      // DOM refs are captured in closure above — no repeated getElementById
      const pct = Math.round((completed / total) * 100);
      const remaining = total - completed;
      if (progressText)    progressText.textContent    = `Processing ${completed} of ${total}…`;
      if (progressCounter) progressCounter.textContent = `${completed} / ${total} (${remaining} remaining)`;
      if (progressPct)     progressPct.textContent     = `${pct}%`;
      if (progressFill)    progressFill.style.width    = `${pct}%`;
      updateAiWorkspaceOverlay(completed, total, remaining ? `${remaining} remaining...` : 'Finishing up...');
    }
  });

  state.isGenerating = false;
  state.stopBatch = false;

  setBtnLoading(genBtn, false);
  genBtn?.classList.remove('ai-action-running');
  mainArea?.classList.remove('ai-batch-running');
  hideAiWorkspaceOverlay();
  if (stopBtn) stopBtn.style.display = 'none';
  if (retryBtn && failCount > 0) retryBtn.style.display = 'inline-flex';

  const summary = `Done: ${successCount} generated${failCount ? `, ${failCount} failed` : ''}`;
  showToast(summary, failCount > 0 ? 'warning' : 'success');

  setTimeout(() => {
    if (progressBar) {
      progressBar.classList.remove('active');
      progressBar.style.display = 'none';
    }
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
  const provider = getActiveProvider();
  if (!hasApiKey(provider)) {
    openModal(document.getElementById('modal-ai-settings'));
    showToast(`Add ${provider} API key first`, 'warning');
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
// ─── Render (throttled, RAF-gated, batched) ───────────────────────────────
// Single RAF gate: multiple synchronous calls in the same tick trigger ONE
// render pass. Using a single rAF is sufficient for non-blocking updates
// and avoids the extra 16ms latency of the previous double-RAF approach.
function throttledRender() {
  if (state._renderPending) return;
  state._renderPending = true;
  requestAnimationFrame(() => {
    state._renderPending = false;
    renderMetadata();
    updateStatsBar();
  });
}

function getFilteredItems() {
  const formatFilter = state.formatFilter || 'all';
  return state.mediaItems.filter(item => {
    const matchStatus = state.statusFilter === 'all' || item.status === state.statusFilter;
    const matchFormat = formatFilter === 'all' || (item.format && item.format.toUpperCase() === formatFilter.toUpperCase());
    const meta = item.metadata || {};
    const q    = state.searchQuery;
    const matchSearch = !q
      || item.name.toLowerCase().includes(q)
      || (meta.title    && meta.title.toLowerCase().includes(q))
      || (meta.keywords && meta.keywords.some(k => k.toLowerCase().includes(q)));
    return matchStatus && matchFormat && matchSearch;
  });
}

function updateStatsBar() {
  const items   = state.mediaItems;
  const counts  = { total: items.length, images: 0, vectors: 0, ready: 0, processing: 0, failed: 0, waiting: 0 };
  items.forEach(i => {
    if (i.assetType === 'image')                           counts.images++;
    if (i.assetType === 'vector' || i.assetType === 'pdf') counts.vectors++;
    if (i.status === 'ready')                              counts.ready++;
    if (i.status === 'processing')                         counts.processing++;
    if (i.status === 'failed')                             counts.failed++;
    if (i.status === 'waiting')                            counts.waiting++;
  });
  counts.selected = state.selectedItemIds.size;

  const prev = state._lastStats;
  const setText = (id, v) => {
    if (prev && prev[id] === v) return;
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };
  setText('stat-total',      counts.total);
  setText('stat-images',     counts.images);
  setText('stat-vectors',    counts.vectors);
  setText('stat-ready',      String(counts.ready).padStart(2, '0'));
  setText('stat-processing', String(counts.processing).padStart(2, '0'));
  setText('stat-failed',     String(counts.failed).padStart(2, '0'));
  setText('stat-selected',   counts.selected);

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

// ─── Render Metadata (Details View) ─────────────────────────────────────────
function renderMetadata() {
  const items = getFilteredItems();
  renderDetailView(items);
}

// ─── Detailed Cards View (Matches UI Reference Screenshot) ─────────────────
const _detailCardCache = new Map();

function buildDetailCardHtml(item, index, p) {
  const isProcessing = item.status === 'processing';
  const meta = item.metadata || { title: '', description: '', keywords: [], category: '' };
  const kwCount = (meta.keywords || []).length;

  let previewMediaHtml;
  if (item.url) {
    if (item.assetType === 'video') {
      previewMediaHtml = `<video src="${item.url}" controls class="max-h-[360px] max-w-full object-contain rounded-lg shadow-lg"></video>`;
    } else {
      previewMediaHtml = `<img src="${item.url}" class="max-h-[360px] max-w-full object-contain rounded-lg shadow-lg" alt="${escHtml(item.name)}" loading="lazy" decoding="async">`;
    }
  } else {
    previewMediaHtml = `
      <div class="flex flex-col items-center justify-center gap-3 text-secondary py-12">
        <svg width="64" height="64" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"/>
        </svg>
        <span class="text-sm font-bold text-on-surface-variant">${item.format} Vector File</span>
      </div>`;
  }

  const statusBadgeColor = item.status === 'ready'
    ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-400'
    : (item.status === 'processing'
      ? 'bg-cyan-950/60 border-cyan-500/40 text-[#00dbe9] animate-pulse'
      : (item.status === 'failed' ? 'bg-rose-950/60 border-rose-500/40 text-rose-400' : 'bg-slate-800 border-slate-700 text-slate-300'));

  const keywordPillsHtml = (meta.keywords || []).map((kw, ki) => `
    <span class="bg-[#2563eb] hover:bg-[#1d4ed8] text-white text-xs px-3.5 py-1 rounded-full font-medium transition-all shadow-sm flex items-center gap-1.5 cursor-pointer group" data-single-kw="${escHtml(kw)}" title="Click to copy '${escHtml(kw)}'">
      ${escHtml(kw)}
      <button type="button" class="remove-kw-btn text-white/50 hover:text-white ml-0.5 text-xs font-bold leading-none" data-item-id="${item.id}" data-kw-idx="${ki}" title="Remove keyword">×</button>
    </span>
  `).join('');

  return `
    <div class="bg-[#0b132b]/90 border border-[#1e293b] rounded-2xl p-6 shadow-2xl backdrop-blur-md transition-all hover:border-[#334155]" data-detail-card-id="${item.id}">
      <div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        <!-- Left: Image Preview -->
        <div class="lg:col-span-5 flex flex-col">
          <div class="flex items-center justify-between mb-3">
            <h3 class="text-amber-400 font-bold text-sm tracking-wide uppercase flex items-center gap-2">
              <span class="material-symbols-outlined text-[18px]">image</span> Image Preview
            </h3>
            <span class="border ${statusBadgeColor} px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider">
              ${item.status}
            </span>
          </div>

          <div class="w-full min-h-[300px] max-h-[440px] bg-[#050811] border border-[#1e293b] rounded-xl flex items-center justify-center p-4 relative overflow-hidden group">
            ${previewMediaHtml}
            ${isProcessing ? '<div class="absolute inset-0 bg-black/60 backdrop-blur-xs flex flex-col items-center justify-center gap-2 text-[#00dbe9] font-bold text-xs"><span class="ai-action-spinner"></span> Analyzing visual metadata...</div>' : ''}
            <div class="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 bg-black/60 backdrop-blur-sm p-1 rounded-lg">
              <button class="text-xs bg-error hover:bg-error/80 text-white px-2 py-1 rounded transition-colors card-remove-btn cursor-pointer" data-id="${item.id}" title="Remove asset">✕</button>
            </div>
          </div>
          <div class="flex items-center justify-between text-[11px] text-on-surface-variant mt-2 px-1">
            <span>Format: <strong class="text-white">${item.format}</strong></span>
            <span>Size: <strong class="text-white">${(item.size / 1048576).toFixed(2)} MB</strong></span>
          </div>
        </div>

        <!-- Right: Generated Metadata -->
        <div class="lg:col-span-7 flex flex-col gap-3">
          <div class="flex items-center justify-between pb-2 border-b border-[#1e293b]">
            <h3 class="text-amber-400 font-bold text-base tracking-wide flex items-center gap-2">
              <span class="material-symbols-outlined text-[20px]">dataset</span> Generated Metadata
            </h3>
            <button class="btn-download-single-csv bg-[#00dbe9] hover:bg-[#00c4d4] text-[#002022] font-bold text-xs px-3.5 py-1.5 rounded-lg flex items-center gap-1.5 shadow-[0_0_12px_rgba(0,219,233,0.3)] transition-all cursor-pointer" data-id="${item.id}">
              <span class="material-symbols-outlined text-[16px]">download</span> Download CSV
            </button>
          </div>

          <!-- Filename -->
          <div>
            <div class="flex items-center justify-between text-amber-400 font-semibold text-xs mb-1">
              <span>Filename:</span>
              <button class="btn-copy-field text-on-surface-variant hover:text-amber-400 transition-colors p-1 cursor-pointer" data-copy-text="${escHtml(item.name)}" title="Copy Filename">
                <span class="material-symbols-outlined text-[16px]">content_copy</span>
              </button>
            </div>
            <div class="text-white text-sm font-medium bg-[#050811]/80 border border-[#1e293b] rounded-lg p-2.5 break-all font-mono select-all">
              ${escHtml(item.name)}
            </div>
          </div>

          <!-- Title -->
          <div>
            <div class="flex items-center justify-between text-amber-400 font-semibold text-xs mb-1">
              <span>Title:</span>
              <button class="btn-copy-field text-on-surface-variant hover:text-amber-400 transition-colors p-1 cursor-pointer" data-copy-text="${escHtml(meta.title)}" title="Copy Title">
                <span class="material-symbols-outlined text-[16px]">content_copy</span>
              </button>
            </div>
            <div class="text-white text-sm font-medium leading-relaxed bg-[#050811]/80 border border-[#1e293b] rounded-lg p-2.5 outline-none focus:border-[#00dbe9] editable-title" data-item-id="${item.id}" contenteditable="true" spellcheck="false">
              ${escHtml(meta.title || (isProcessing ? 'Generating high SEO title...' : 'Enter or generate title...'))}
            </div>
          </div>

          <!-- Description -->
          <div>
            <div class="flex items-center justify-between text-amber-400 font-semibold text-xs mb-1">
              <span>Description:</span>
              <button class="btn-copy-field text-on-surface-variant hover:text-amber-400 transition-colors p-1 cursor-pointer" data-copy-text="${escHtml(meta.description)}" title="Copy Description">
                <span class="material-symbols-outlined text-[16px]">content_copy</span>
              </button>
            </div>
            <div class="text-slate-200 text-xs leading-relaxed bg-[#050811]/80 border border-[#1e293b] rounded-lg p-2.5 outline-none focus:border-[#00dbe9] editable-desc" data-item-id="${item.id}" contenteditable="true" spellcheck="false">
              ${escHtml(meta.description || (isProcessing ? 'Analyzing visual details & SEO summary...' : 'Enter or generate description...'))}
            </div>
          </div>

          <!-- Keywords -->
          <div>
            <div class="flex items-center justify-between text-amber-400 font-semibold text-xs mb-1.5">
              <span>Keywords: <strong class="text-white font-mono ml-1">(${kwCount})</strong></span>
              <button class="btn-copy-field text-on-surface-variant hover:text-amber-400 transition-colors p-1 cursor-pointer" data-copy-text="${escHtml((meta.keywords || []).join(', '))}" title="Copy All Keywords">
                <span class="material-symbols-outlined text-[16px]">content_copy</span>
              </button>
            </div>
            <div class="flex flex-wrap gap-2 max-h-[170px] overflow-y-auto p-3 bg-[#050811]/80 border border-[#1e293b] rounded-lg custom-scrollbar">
              ${keywordPillsHtml.length ? keywordPillsHtml : `<span class="text-xs text-on-surface-variant italic">${isProcessing ? 'Extracting keywords...' : 'No keywords generated yet.'}</span>`}
            </div>
          </div>

        </div>

      </div>
    </div>
  `;
}

function renderDetailView(items) {
  const container = document.getElementById('detail-view-container');
  if (!container) return;

  if (!items || items.length === 0) {
    _detailCardCache.clear();
    container.innerHTML = '';
    return;
  }

  const p = state.currentPlatform;
  const currentIds = new Set(items.map(i => i.id));

  // 1. Remove DOM cards that are not in current items
  Array.from(container.children).forEach(child => {
    const cardId = child.getAttribute('data-detail-card-id');
    if (!cardId || !currentIds.has(cardId)) {
      child.remove();
      if (cardId) _detailCardCache.delete(cardId);
    }
  });

  // 2. Prune cache of deleted items
  for (const [id, el] of _detailCardCache.entries()) {
    if (!currentIds.has(id)) {
      el.remove();
      _detailCardCache.delete(id);
    }
  }

  // 3. Render or update cards in exact sequence
  let prevEl = null;
  items.forEach((item, index) => {
    const meta = item.metadata || {};
    const fp = `${item.id}::${item.status}::${item.name}::${item.size}::${meta.title || ''}::${meta.description || ''}::${(meta.keywords || []).join(',')}::${p.id}`;

    let cached = _detailCardCache.get(item.id);
    if (!cached || cached._fp !== fp || !container.contains(cached)) {
      const cardHtml = buildDetailCardHtml(item, index, p);
      const temp = document.createElement('div');
      temp.innerHTML = cardHtml.trim();
      const newEl = temp.firstElementChild;
      newEl._fp = fp;

      if (cached && cached.parentNode === container) {
        container.replaceChild(newEl, cached);
      } else if (prevEl && prevEl.nextSibling) {
        container.insertBefore(newEl, prevEl.nextSibling);
      } else if (!prevEl) {
        container.prepend(newEl);
      } else {
        container.appendChild(newEl);
      }
      _detailCardCache.set(item.id, newEl);
      prevEl = newEl;
    } else {
      prevEl = cached;
    }
  });
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

// ─── Delete ────────────────────────────────────────────────────────────────
function deleteItem(id) {
  const item = state.mediaItems.find(i => i.id === id);
  if (item && item.url && item.url.startsWith('blob:')) URL.revokeObjectURL(item.url);
  state.mediaItems = state.mediaItems.filter(i => i.id !== id);
  state.selectedItemIds.delete(id);

  // Directly remove cached element & DOM node
  const cached = _detailCardCache.get(id);
  if (cached) {
    cached.remove();
    _detailCardCache.delete(id);
  }
  const domCard = document.querySelector(`[data-detail-card-id="${id}"]`);
  if (domCard) domCard.remove();

  document.querySelectorAll('input[type="file"]').forEach(inp => { inp.value = ''; });
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
    const cached = _detailCardCache.get(i.id);
    if (cached) {
      cached.remove();
      _detailCardCache.delete(i.id);
    }
    const domCard = document.querySelector(`[data-detail-card-id="${i.id}"]`);
    if (domCard) domCard.remove();
  });
  state.mediaItems = state.mediaItems.filter(i => !state.selectedItemIds.has(i.id));
  state.selectedItemIds.clear();
  document.querySelectorAll('input[type="file"]').forEach(inp => { inp.value = ''; });
  updateUI();
  showToast(`Removed ${count} asset(s)`, 'info');
}
function clearAll() {
  if (!state.mediaItems.length) return;
  if (state.mediaItems.length >= 5 && !confirm(`Clear all ${state.mediaItems.length} assets?`)) return;

  // Invalidate any ongoing asynchronous upload sessions
  state._uploadSessionId = ++state._uploadSessionCounter;

  // Cancel any active generation
  if (state.isGenerating) {
    stopAllGenerations();
  }

  // Clear all DOM file inputs so browser never holds references to cleared files
  document.querySelectorAll('input[type="file"]').forEach(inp => {
    inp.value = '';
  });

  // Reset Dropzone timers and visual state
  if (dropZoneResetTimer) {
    clearTimeout(dropZoneResetTimer);
    dropZoneResetTimer = null;
  }
  resetDropZoneToDefault();

  // Revoke all blob URLs and clear items list
  state.mediaItems.forEach(i => { if (i.url && i.url.startsWith('blob:')) URL.revokeObjectURL(i.url); });
  state.mediaItems = [];
  state.selectedItemIds.clear();
  _detailCardCache.clear();

  // Explicitly wipe the DOM container
  const detailContainer = document.getElementById('detail-view-container');
  if (detailContainer) detailContainer.innerHTML = '';

  state._lastStats = null;
  updateUI();
  showToast('Cleared all assets', 'info');
}

function setupDetailViewEventDelegation() {
  const container = document.getElementById('detail-view-container');
  if (!container) return;

  // Single item copy field buttons & click handlers
  container.addEventListener('click', (e) => {
    const copyBtn = e.target.closest('.btn-copy-field');
    if (copyBtn) {
      const text = copyBtn.dataset.copyText || '';
      if (text) {
        navigator.clipboard.writeText(text).then(() => {
          showToast('Copied to clipboard!', 'success');
        }).catch(() => {
          showToast('Failed to copy to clipboard', 'error');
        });
      }
      return;
    }

    // Single item keyword click to copy
    const singleKw = e.target.closest('[data-single-kw]');
    if (singleKw && !e.target.closest('.remove-kw-btn')) {
      const kw = singleKw.dataset.singleKw;
      if (kw) {
        navigator.clipboard.writeText(kw).then(() => {
          showToast(`Copied keyword: "${kw}"`, 'success');
        });
      }
      return;
    }

    // Remove single keyword from item
    const remKwBtn = e.target.closest('.remove-kw-btn');
    if (remKwBtn) {
      const itemId = remKwBtn.dataset.itemId;
      const kwIdx  = parseInt(remKwBtn.dataset.kwIdx, 10);
      const item = state.mediaItems.find(i => i.id === itemId);
      if (item && item.metadata && Array.isArray(item.metadata.keywords)) {
        item.metadata.keywords.splice(kwIdx, 1);
        _detailCardCache.delete(itemId);
        throttledRender();
      }
      return;
    }

    // Single item CSV download
    const dlSingleBtn = e.target.closest('.btn-download-single-csv');
    if (dlSingleBtn) {
      if (_isExportingCsv) return;
      const itemId = dlSingleBtn.dataset.id;
      const item = state.mediaItems.find(i => i.id === itemId);
      if (item) {
        _isExportingCsv = true;
        try {
          const cleanName = item.name.replace(/\.[^/.]+$/, '');
          const platformId = state.currentPlatform?.id || 'metadata';
          downloadCsvFile([item], state.currentPlatform, `${cleanName}_${platformId}.csv`);
          showToast(`Downloaded CSV for ${item.name}`, 'success');
        } finally {
          setTimeout(() => { _isExportingCsv = false; }, 800);
        }
      }
      return;
    }

    // Single item remove button
    const remCardBtn = e.target.closest('.card-remove-btn');
    if (remCardBtn) {
      const itemId = remCardBtn.dataset.id;
      deleteItem(itemId);
      return;
    }
  });

  // Inline editing for Title and Description
  container.addEventListener('blur', (e) => {
    const target = e.target;
    if (target.classList.contains('editable-title')) {
      const itemId = target.dataset.itemId;
      const item = state.mediaItems.find(i => i.id === itemId);
      if (item) {
        if (!item.metadata) item.metadata = {};
        item.metadata.title = target.textContent.trim();
        _detailCardCache.delete(itemId);
      }
    } else if (target.classList.contains('editable-desc')) {
      const itemId = target.dataset.itemId;
      const item = state.mediaItems.find(i => i.id === itemId);
      if (item) {
        if (!item.metadata) item.metadata = {};
        item.metadata.description = target.textContent.trim();
        _detailCardCache.delete(itemId);
      }
    }
  }, true);
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

let _isExportingCsv = false;

function exportCsv() {
  if (_isExportingCsv) return;
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
  
  _isExportingCsv = true;
  try {
    downloadCsvFile(readyItems, state.currentPlatform);
    showToast(`Exported CSV for ${state.currentPlatform.name} (${readyItems.length} rows)`, 'success');
    closeModal(document.getElementById('modal-csv-preview'));
  } finally {
    setTimeout(() => { _isExportingCsv = false; }, 800);
  }
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

  // State is updated immediately on each keystroke for correctness.
  // The render is debounced (250ms) to avoid a full DOM re-render per character.
  let _detailEditRenderTimer = null;
  const debouncedDetailRender = () => {
    clearTimeout(_detailEditRenderTimer);
    _detailEditRenderTimer = setTimeout(() => {
      _detailCardCache.delete(item.id);
      throttledRender();
    }, 250);
  };

  ti.addEventListener('input', () => {
    if (!item.metadata) item.metadata = {};
    item.metadata.title = ti.value;
    debouncedDetailRender();
  });
  di.addEventListener('input', () => {
    if (item.metadata) item.metadata.description = di.value;
    debouncedDetailRender();
  });
  ki.addEventListener('input', () => {
    if (item.metadata) item.metadata.keywords = ki.value.split(',').map(k => k.trim()).filter(k => k);
    debouncedDetailRender();
  });

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
  const loginErr   = document.getElementById('login-error');
  const signupErr  = document.getElementById('signup-error');

  if (loginErr)  { loginErr.style.display  = 'none'; loginErr.textContent  = ''; }
  if (signupErr) { signupErr.style.display = 'none'; signupErr.textContent = ''; }
  
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

  // AI Settings button in header/nav, sidebar, and status badge
  const openAiSettingsHandler = () => {
    openModal(modal('modal-ai-settings'));
  };
  document.getElementById('ai-status-badge')?.addEventListener('click', openAiSettingsHandler);
  document.getElementById('nav-btn-ai-settings')?.addEventListener('click', openAiSettingsHandler);
  document.getElementById('sidebar-btn-add-api')?.addEventListener('click', openAiSettingsHandler);

  // Mobile drawer
  document.getElementById('mobile-nav-tutorial')?.addEventListener('click', () => {
    modal('mobile-nav-drawer')?.classList.remove('active');
    openModal(modal('modal-tutorial'));
  });
  document.getElementById('mobile-nav-contact')?.addEventListener('click', () => {
    modal('mobile-nav-drawer')?.classList.remove('active');
    window.open('https://wa.me/8801741783521', '_blank', 'noopener,noreferrer');
  });

  // Sidebar help & tutorial button
  document.getElementById('nav-btn-sidebar-help')?.addEventListener('click', () => {
    openModal(modal('modal-tutorial'));
  });

  // Mode selection listeners (Metadata vs Image to Prompt)
  document.getElementById('sidebar-mode-metadata')?.addEventListener('click', () => switchAppMode('metadata'));
  document.getElementById('sidebar-mode-img2prompt')?.addEventListener('click', () => switchAppMode('img2prompt'));

  // Image to Prompt event listeners
  renderImg2PromptTypeToggle(); // initialize toggle state on load

  // Delegated click for the Photo/Video type toggle (works after drop-zone re-renders)
  document.getElementById('img2prompt-drop-zone')?.addEventListener('click', (e) => {
    const typeBtn = e.target.closest('.img2prompt-type-btn');
    if (typeBtn) {
      e.stopPropagation();
      img2promptState.promptType = typeBtn.dataset.type;
      renderImg2PromptTypeToggle();
    }
  });

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
    if (img2promptState.isProcessing) {
      stopImg2PromptGeneration();
      return;
    }
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
    img2promptState._uploadSessionId = ++img2promptState._uploadSessionCounter;
    if (img2promptState.isProcessing) {
      img2promptState.stopBatch = true;
      img2promptState.isProcessing = false;
    }
    document.querySelectorAll('#img2prompt-file-input').forEach(inp => { inp.value = ''; });
    img2promptState.items.forEach(i => { if (i.url && i.url.startsWith('blob:')) URL.revokeObjectURL(i.url); });
    img2promptState.items = [];
    _img2promptCardCache.clear(); // clear DOM cache to free memory
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

    const retryBtn = e.target.closest('.btn-retry-single-prompt');
    if (retryBtn) {
      const item = img2promptState.items.find(i => i.id === retryBtn.dataset.id);
      if (item) {
        item.status = 'waiting';
        item.error = null;
        renderImg2PromptCards();
        processImg2PromptQueue();
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
  document.getElementById('btn-stop-generation')?.addEventListener('click',  () => { stopAllGenerations(); });
  document.getElementById('btn-retry-failed')?.addEventListener('click',     retryFailed);
  document.getElementById('btn-clear-all')?.addEventListener('click',        clearAll);
  document.getElementById('btn-select-all')?.addEventListener('click',       selectAll);
  document.getElementById('btn-deselect-all')?.addEventListener('click',     deselectAll);
  document.getElementById('btn-remove-selected')?.addEventListener('click',  removeSelected);
  document.getElementById('btn-batch-edit')?.addEventListener('click',       () => openModal(modal('modal-batch-edit')));

  // Header Export & Format filter
  document.getElementById('btn-export-csv-header')?.addEventListener('click', exportCsv);
  document.getElementById('export-format-filter')?.addEventListener('change', (e) => {
    state.formatFilter = e.target.value;
    throttledRender();
  });

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
  setupDetailViewEventDelegation();

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

// ─── AI Engine & Provider Settings Handlers ──────────────────────────────────
function initAiSettingsModal() {
  const providerTabs = document.querySelectorAll('.ai-provider-tab');
  providerTabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const providerId = tab.dataset.provider;
      selectAiProvider(providerId);
    });
  });

  const modelSelect = document.getElementById('ai-model-select');
  if (modelSelect) {
    modelSelect.addEventListener('change', (e) => {
      setProviderModel(e.target.value);
    });
  }

  document.getElementById('btn-done-ai-settings')?.addEventListener('click', () => {
    closeModal(document.getElementById('modal-ai-settings'));
  });

  const initialProvider = getActiveProvider() || 'gemini';
  selectAiProvider(initialProvider);
}

function selectAiProvider(providerId) {
  setAiProvider(providerId);
  const config = AI_PROVIDERS_CONFIG[providerId] || AI_PROVIDERS_CONFIG.gemini;

  // Update Top Tabs styling
  document.querySelectorAll('.ai-provider-tab').forEach(tab => {
    const isThis = tab.dataset.provider === providerId;
    if (isThis) {
      tab.className = 'ai-provider-tab active flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold transition-all cursor-pointer bg-[#00dbe9] text-background shadow-[0_0_15px_rgba(0,219,233,0.3)]';
    } else {
      tab.className = 'ai-provider-tab flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-medium text-on-surface-variant hover:text-on-surface hover:bg-[#19202c] transition-all cursor-pointer';
    }
  });

  // Populate Model Selection Dropdown
  const modelSelect = document.getElementById('ai-model-select');
  if (modelSelect) {
    modelSelect.innerHTML = '';
    const activeModel = getProviderModel(providerId);
    (config.models || []).forEach(m => {
      const opt = document.createElement('option');
      opt.value = m.id;
      opt.textContent = m.name;
      if (m.id === activeModel) opt.selected = true;
      modelSelect.appendChild(opt);
    });
  }

  // Update Key Label
  const labelEl = document.getElementById('ai-provider-key-label');
  if (labelEl) labelEl.textContent = config.label || `${config.name} API Key`;

  // Update Big Get API Key link button
  const linkEl = document.getElementById('ai-provider-get-key-link');
  if (linkEl) {
    linkEl.href = config.getKeyUrl;
    linkEl.innerHTML = `<span class="material-symbols-outlined text-[16px]">key</span> ${config.getKeyLabel || `Get API Key from ${config.name}`}`;
  }

  // Update Input & Placeholder
  const inputEl = document.getElementById('gemini-api-key-input');
  if (inputEl) {
    inputEl.placeholder = config.placeholder || 'API Key...';
    inputEl.value = getSessionKey(providerId) || '';
  }

  // Render Stored Keys List for right column
  renderStoredKeys(providerId);

  // Update Status Indicator
  if (hasApiKey(providerId)) {
    state.geminiConnected = true;
    updateConnectionStatus('connected');
  } else {
    state.geminiConnected = false;
    updateConnectionStatus('disconnected');
  }
  updateAiStatusBadge();
}

function renderStoredKeys(providerId = getActiveProvider()) {
  const container = document.getElementById('stored-keys-container');
  if (!container) return;

  const key = getSessionKey(providerId);
  const config = AI_PROVIDERS_CONFIG[providerId] || AI_PROVIDERS_CONFIG.gemini;

  if (key) {
    const redacted = getRedactedKey(key, providerId);
    container.innerHTML = `
      <div class="w-full flex items-center justify-between p-3.5 rounded-xl bg-[#161c27] border border-[#00dbe9]/40 shadow-sm">
        <div class="flex items-center gap-3">
          <div class="w-8 h-8 rounded-lg bg-[#00dbe9]/10 border border-[#00dbe9]/30 flex items-center justify-center text-[#00dbe9]">
            <span class="material-symbols-outlined text-[18px]">vpn_key</span>
          </div>
          <div class="flex flex-col text-left">
            <span class="text-xs font-bold text-on-surface font-mono">${escHtml(redacted)}</span>
            <span class="text-[10px] text-emerald-400 font-medium">● Connected (${escHtml(config.name)})</span>
          </div>
        </div>
        <button type="button" id="btn-remove-stored-key" class="text-on-surface-variant hover:text-red-400 p-2 rounded-lg hover:bg-red-500/10 transition-colors cursor-pointer" title="Disconnect key">
          <span class="material-symbols-outlined text-[18px]">delete</span>
        </button>
      </div>
    `;

    document.getElementById('btn-remove-stored-key')?.addEventListener('click', handleClearApiKey);
  } else {
    container.innerHTML = `
      <div class="flex flex-col items-center justify-center py-6 text-center text-on-surface-variant/60">
        <span class="material-symbols-outlined text-[36px] text-outline mb-1">key_off</span>
        <span class="text-xs font-semibold text-slate-300">No Key Connected</span>
        <span class="text-[11px] text-slate-500 mt-0.5">Enter your ${escHtml(config.name)} API key to connect</span>
      </div>
    `;
  }
}

async function handleSaveApiKey() {
  const provider = getActiveProvider();
  const config = AI_PROVIDERS_CONFIG[provider] || AI_PROVIDERS_CONFIG.gemini;
  const input = document.getElementById('gemini-api-key-input');
  const btn = document.getElementById('btn-save-api-key');
  
  const key = input ? input.value.trim() : '';
  if (!key) {
    showToast(`Please enter a valid ${config.name} API key`, 'warning');
    return;
  }

  setBtnLoading(btn, true);
  updateConnectionStatus('testing');

  try {
    // Strictly verify key against official API server before saving
    const res = await testConnection(key, provider);

    if (res.ok) {
      clearAllApiKeys();
      setApiKey(key, provider);
      input.type = 'password';
      state.geminiConnected = true;
      updateAiStatusBadge();
      renderStoredKeys(provider);
      updateConnectionStatus('connected');
      showToast(`✓ Connected to ${config.name} API!`, 'success');
    } else {
      // Rejects fake/invalid keys and displays exact error
      clearApiKey(provider);
      state.geminiConnected = false;
      updateAiStatusBadge();
      renderStoredKeys(provider);
      updateConnectionStatus('failed', res.message);
      showToast(`✕ Invalid API Key: ${res.message}`, 'error');
    }
  } catch (err) {
    updateConnectionStatus('failed', err.message);
    showToast(`✕ ${config.name} API Key verification failed.`, 'error');
  } finally {
    setBtnLoading(btn, false);
  }
}

function handleClearApiKey() {
  const provider = getActiveProvider();
  const config = AI_PROVIDERS_CONFIG[provider] || AI_PROVIDERS_CONFIG.gemini;
  clearApiKey(provider);

  const input = document.getElementById('gemini-api-key-input');
  if (input) { input.value = ''; input.type = 'password'; }

  state.geminiConnected = false;
  updateAiStatusBadge();
  renderStoredKeys(provider);
  updateConnectionStatus('disconnected');
  showToast(`${config.name} API key cleared`, 'info');
}

async function handleTestConnection() {
  const provider = getActiveProvider();
  const config = AI_PROVIDERS_CONFIG[provider] || AI_PROVIDERS_CONFIG.gemini;
  const input = document.getElementById('gemini-api-key-input');
  const btn = document.getElementById('btn-test-connection');
  
  const key = input ? input.value.trim() : getSessionKey(provider);
  if (!key) {
    showToast(`Please enter a ${config.name} API key to test`, 'warning');
    return;
  }

  setBtnLoading(btn, true);
  updateConnectionStatus('testing');

  try {
    const res = await testConnection(key, provider);
    if (res.ok) {
      if (key) setApiKey(key, provider);
      state.geminiConnected = true;
      updateAiStatusBadge();
      renderStoredKeys(provider);
      updateConnectionStatus('connected');
      showToast(`✓ ${res.message || `Connected to ${config.name} API!`}`, 'success');
    } else {
      updateConnectionStatus('failed', res.message);
      showToast(`✕ Test Failed: ${res.message}`, 'error');
    }
  } catch (err) {
    updateConnectionStatus('failed', err.message);
    showToast(`✕ Connection Error: ${err.message}`, 'error');
  } finally {
    setBtnLoading(btn, false);
  }
}

function updateConnectionStatus(state_str, message) {
  const provider = getActiveProvider();
  const config = AI_PROVIDERS_CONFIG[provider] || AI_PROVIDERS_CONFIG.gemini;
  const el = document.getElementById('connection-status-text');
  if (!el) return;
  if (state_str === 'connected') {
    el.innerHTML = `<span style="color:#10B981">✓ ${escHtml(config.name)} Connected</span>`;
  } else if (state_str === 'failed') {
    el.innerHTML = `<span style="color:#EF4444">✕ ${escHtml(message || 'Not Connected')}</span>`;
  } else if (state_str === 'testing') {
    el.innerHTML = `<span style="color:#00dbe9">Testing ${escHtml(config.name)} connection…</span>`;
  } else {
    el.innerHTML = '<span style="color:#9CA3AF">● Not Connected</span>';
  }
}

let _authIsSubmitting = false;

async function handleLoginSubmit(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (_authIsSubmitting) return;

  const emailEl    = document.getElementById('login-email');
  const passEl     = document.getElementById('login-password');
  const errorEl    = document.getElementById('login-error');
  const submitBtn  = document.getElementById('btn-login-submit') || document.querySelector('#auth-login-form button[type="submit"]');

  const emailVal = (emailEl?.value || '').trim();
  const passVal  = passEl?.value || '';

  if (!emailVal || !passVal) {
    if (errorEl) {
      errorEl.textContent = 'Please enter both email and password.';
      errorEl.style.display = 'block';
    }
    return;
  }

  if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }
  _authIsSubmitting = true;
  setBtnLoading(submitBtn, true);

  try {
    const result = await login({ email: emailVal, password: passVal });
    setBtnLoading(submitBtn, false);
    _authIsSubmitting = false;

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
  } catch (err) {
    setBtnLoading(submitBtn, false);
    _authIsSubmitting = false;
    if (errorEl) { errorEl.textContent = err.message || 'Login failed.'; errorEl.style.display = 'block'; }
  }
}

async function handleSignupSubmit(e) {
  if (e && e.preventDefault) e.preventDefault();
  if (_authIsSubmitting) return;

  const nameEl    = document.getElementById('signup-name') || document.getElementById('signup-fullname');
  const emailEl   = document.getElementById('signup-email');
  const passEl    = document.getElementById('signup-password');
  const errorEl   = document.getElementById('signup-error');
  const submitBtn = document.getElementById('btn-signup-submit') || document.querySelector('#auth-signup-form button[type="submit"]');

  const nameVal  = (nameEl?.value || '').trim();
  const emailVal = (emailEl?.value || '').trim();
  const passVal  = passEl?.value || '';

  if (!nameVal || !emailVal || !passVal) {
    if (errorEl) {
      errorEl.textContent = 'Please fill in all fields.';
      errorEl.style.display = 'block';
    }
    return;
  }

  if (errorEl) { errorEl.style.display = 'none'; errorEl.textContent = ''; }
  _authIsSubmitting = true;
  setBtnLoading(submitBtn, true);

  try {
    const result = await signup({ fullName: nameVal, email: emailVal, password: passVal });
    setBtnLoading(submitBtn, false);
    _authIsSubmitting = false;

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
  } catch (err) {
    setBtnLoading(submitBtn, false);
    _authIsSubmitting = false;
    if (errorEl) { errorEl.textContent = err.message || 'Signup failed.'; errorEl.style.display = 'block'; }
  }
}

async function handleLogout() {
  await logout();
  clearAllApiKeys();
  state.geminiConnected = false;
  updateAiStatusBadge();
  updateConnectionStatus('disconnected');
  const input = document.getElementById('gemini-api-key-input');
  if (input) input.value = '';
  renderStoredKeys(getActiveProvider());
  updateAuthNav();
  showToast('Logged out & API keys disconnected successfully.', 'info');
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
// ─── Fast HTML Escaper (reuses a single shared node — no regex chains) ───────
const _escNode = (typeof document !== 'undefined') ? document.createElement('div') : null;
function escHtml(str) {
  if (!str && str !== 0) return '';
  if (!_escNode) {
    // SSR/Node fallback
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
  }
  _escNode.textContent = String(str);
  return _escNode.innerHTML;
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
    if (promptPanel) promptPanel.style.display = 'flex';
  } else {
    if (promptBtn) promptBtn.className = `${baseClasses} ${inactiveClasses}`;
    if (metaBtn) metaBtn.className = `${baseClasses} ${activeClasses}`;
    if (promptPanel) promptPanel.style.display = 'none';
    if (metaPanel) metaPanel.style.display = 'flex';
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
  items: [],
  isProcessing: false,
  stopBatch: false,
  abortController: null,
  promptType: 'photo',  // 'photo' | 'video'
  _uploadSessionId: 0,
  _uploadSessionCounter: 0,
  _batchSessionId: 0,
  _batchSessionCounter: 0
};

function stopImg2PromptGeneration() {
  img2promptState.stopBatch = true;
  img2promptState.isProcessing = false;
  img2promptState._batchSessionId = ++img2promptState._batchSessionCounter;

  if (img2promptState.abortController) {
    try {
      img2promptState.abortController.abort();
    } catch (_) {}
    img2promptState.abortController = null;
  }

  // Immediately reset any processing item back to waiting
  img2promptState.items.forEach(i => {
    if (i.status === 'processing') {
      i.status = 'waiting';
      i.error = null;
      i.prompt = null;
    }
  });

  const btnGenerateAll = document.getElementById('btn-generate-all-img2prompt');
  if (btnGenerateAll) {
    btnGenerateAll.classList.remove('ai-action-running');
  }

  renderImg2PromptCards();
  showToast('Image prompt generation stopped', 'info');
}

// Global Clipboard Paste Listener (Ctrl+V for image files)
window.addEventListener('paste', async (e) => {
  // If focus is inside a text input / textarea and there's text in clipboard, don't intercept unless an image file is present
  const targetTag = e.target?.tagName?.toLowerCase();
  const isTextInput = targetTag === 'input' || targetTag === 'textarea' || e.target?.isContentEditable;

  const items = e.clipboardData?.items;
  const files = e.clipboardData?.files;
  const pastedFiles = [];

  if (items && items.length) {
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
  }

  // Fallback to e.clipboardData.files if items did not yield files
  if (pastedFiles.length === 0 && files && files.length) {
    for (let i = 0; i < files.length; i++) {
      const fileObj = files[i];
      if (fileObj.type && fileObj.type.startsWith('image/')) {
        pastedFiles.push(fileObj);
      }
    }
  }

  if (pastedFiles.length > 0) {
    const isImg2Prompt = state.activeAppMode === 'img2prompt' || (document.getElementById('workspace-img2prompt')?.style.display !== 'none');
    if (isImg2Prompt) {
      e.preventDefault();
      showToast(`Pasted ${pastedFiles.length} image(s) from clipboard!`, 'info');
      handleImageToPromptUploadBatch(pastedFiles, false);
    }
    // If in Metadata mode, image paste is completely disabled.
  }
});

let img2dropResetTimer = null;

function bindImg2PromptFileInput() {
  const fileInput = document.getElementById('img2prompt-file-input');
  if (fileInput) {
    fileInput.onchange = (e) => {
      const files = Array.from(e.target.files);
      if (files.length) handleImageToPromptUploadBatch(files);
      e.target.value = '';
    };
  }
}

function setImg2PromptDropZoneUploading(isUploading, current = 0, total = 0, currentName = '') {
  const dz = document.getElementById('img2prompt-drop-zone');
  if (!dz) return;
  if (img2dropResetTimer) { clearTimeout(img2dropResetTimer); img2dropResetTimer = null; }

  if (isUploading) {
    dz.classList.add('dropzone-uploading');
    dz.classList.remove('dropzone-success');
    const pct = total > 0 ? Math.min(100, Math.round((current / total) * 100)) : 0;

    const existingBar = dz.querySelector('#img2prompt-upload-fill');
    if (existingBar) {
      existingBar.style.width = `${pct}%`;
      const nameEl = dz.querySelector('#img2prompt-current-name');
      const countEl = dz.querySelector('#img2prompt-current-count');
      if (nameEl) nameEl.textContent = currentName || 'Optimizing size to ~450KB...';
      if (countEl) countEl.textContent = `${current} / ${total} (${pct}%)`;
      return;
    }

    dz.innerHTML = `
      <div class="relative w-16 h-16 flex items-center justify-center">
        <div class="absolute inset-0 rounded-full border-2 border-transparent border-t-[#00dbe9] border-r-[#db50ff] animate-upload-spin-ring"></div>
        <div class="w-12 h-12 rounded-full bg-[#191c1f] border border-[#00dbe9]/50 flex items-center justify-center animate-upload-pulse">
          <span class="material-symbols-outlined text-[26px] text-[#00dbe9]">image_search</span>
        </div>
      </div>
      <div class="flex flex-col items-center gap-1.5 w-full max-w-md px-4">
        <h2 class="text-title-md font-bold text-white">Compressing & Adding ${total} Image${total === 1 ? '' : 's'}...</h2>
        <div class="w-full bg-[#12161c] h-2.5 rounded-full overflow-hidden border border-[#2d3748] mt-1 relative">
          <div id="img2prompt-upload-fill" class="bg-gradient-to-r from-[#00dbe9] to-[#db50ff] h-full transition-all duration-300 ease-out rounded-full" style="width: ${pct}%"></div>
        </div>
        <div class="flex justify-between w-full text-[11px] text-on-surface-variant mt-0.5 font-mono">
          <span id="img2prompt-current-name" class="truncate max-w-[240px] text-[#00dbe9]">${currentName ? escHtml(currentName) : 'Optimizing size to ~450KB...'}</span>
          <span id="img2prompt-current-count">${current} / ${total} (${pct}%)</span>
        </div>
      </div>
      <input type="file" id="img2prompt-file-input" class="hidden" multiple accept=".jpg,.jpeg,.png,.webp,.svg">
    `;
    bindImg2PromptFileInput();
  }
}

function setImg2PromptDropZoneSuccess(count = 1) {
  const dz = document.getElementById('img2prompt-drop-zone');
  if (!dz) return;
  if (img2dropResetTimer) clearTimeout(img2dropResetTimer);

  dz.classList.remove('dropzone-uploading');
  dz.classList.add('dropzone-success');

  dz.innerHTML = `
    <div class="w-16 h-16 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center animate-success-check">
      <span class="material-symbols-outlined text-[38px] text-emerald-400 font-bold">check_circle</span>
    </div>
    <div class="flex flex-col items-center gap-1">
      <h2 class="text-title-lg font-bold text-emerald-400">✓ ${count} Image${count === 1 ? '' : 's'} Added Successfully!</h2>
      <p class="text-xs text-on-surface-variant">Auto-compressed to ~450KB · Ready to generate prompts</p>
    </div>
    <input type="file" id="img2prompt-file-input" class="hidden" multiple accept=".jpg,.jpeg,.png,.webp,.svg">
  `;
  bindImg2PromptFileInput();

  img2dropResetTimer = setTimeout(() => {
    resetImg2PromptDropZone();
  }, 3500);
}

function renderImg2PromptTypeToggle() {
  const toggle = document.getElementById('img2prompt-type-toggle');
  if (!toggle) return;
  const isPhoto = img2promptState.promptType === 'photo';
  toggle.innerHTML = `
    <button id="btn-type-photo" class="img2prompt-type-btn${isPhoto ? ' active' : ''}" data-type="photo" title="Generate AI photo prompts">
      <span class="material-symbols-outlined" style="font-size:16px">photo_camera</span> Photo
    </button>
    <button id="btn-type-video" class="img2prompt-type-btn${!isPhoto ? ' active' : ''}" data-type="video" title="Generate AI video prompts">
      <span class="material-symbols-outlined" style="font-size:16px">videocam</span> Video
    </button>
  `;
  toggle.querySelectorAll('.img2prompt-type-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      img2promptState.promptType = btn.dataset.type;
      renderImg2PromptTypeToggle();
    });
  });
}

function resetImg2PromptDropZone() {
  const dz = document.getElementById('img2prompt-drop-zone');
  if (!dz) return;
  dz.classList.remove('dropzone-uploading', 'dropzone-success');
  dz.innerHTML = `
    <span class="material-symbols-outlined text-[40px] text-primary-fixed-dim">image_search</span>
    <h2 class="text-title-lg font-bold text-on-surface">Image to Prompt</h2>
    <p class="text-xs text-on-surface-variant max-w-[80%] mx-auto">Drop images or vectors here, paste (Ctrl+V), or click to browse. Supported: JPG, PNG, WEBP, SVG.</p>
    <div id="img2prompt-type-toggle" class="img2prompt-type-toggle"></div>
    <button id="btn-browse-img2prompt" class="bg-primary-fixed-dim text-background px-5 py-2 rounded-lg text-sm font-semibold mt-2 transition-colors group-hover:bg-primary-container">Browse Files</button>
    <input type="file" id="img2prompt-file-input" class="hidden" multiple accept=".jpg,.jpeg,.png,.webp,.svg">
  `;
  renderImg2PromptTypeToggle();
  bindImg2PromptFileInput();
}

async function handleImageToPromptUploadBatch(files, clearPrevious = false) {
  if (!files || !files.length) return;
  const currentSessionId = ++img2promptState._uploadSessionId;
  const fileArray = Array.from(files).filter(f => f && (
    (f.type && f.type.startsWith('image/')) ||
    (f.name && /\.(jpe?g|png|webp|tiff?|svg|eps|ai)$/i.test(f.name))
  ));
  if (!fileArray.length) {
    showToast('Please select valid image or vector files (JPG, PNG, WEBP, TIFF, SVG, EPS)', 'warning');
    return;
  }

  // Clear previous items and generated prompts only if explicitly requested
  if (clearPrevious && img2promptState.items.length > 0) {
    img2promptState.items.forEach(i => {
      if (i.url && i.url.startsWith('blob:')) URL.revokeObjectURL(i.url);
    });
    img2promptState.items = [];
  }

  setImg2PromptDropZoneUploading(true, 0, fileArray.length, 'Optimizing images...');

  let processedCount = 0;
  const currentPromptType = img2promptState.promptType || 'photo';
  const newItems = await Promise.all(fileArray.map(async file => {
    if (img2promptState._uploadSessionId !== currentSessionId) return null;
    const compressed = await compressImageFile(file);
    const useFile = (compressed && compressed.size < file.size) ? compressed : file;
    processedCount++;
    setImg2PromptDropZoneUploading(true, processedCount, fileArray.length, file.name);

    return {
      id: `img2prompt-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      file: useFile,
      originalFile: file,
      name: file.name,
      size: file.size,
      url: URL.createObjectURL(useFile),
      status: 'waiting',
      promptType: currentPromptType,
      prompt: null,
      error: null
    };
  }));

  if (img2promptState._uploadSessionId !== currentSessionId) return;

  const validNewItems = newItems.filter(Boolean);
  img2promptState.items.push(...validNewItems);
  renderImg2PromptCards();
  document.querySelectorAll('#img2prompt-file-input').forEach(inp => { inp.value = ''; });
  setImg2PromptDropZoneSuccess(validNewItems.length);

  // Auto-start parallel generation immediately on upload/paste
  processImg2PromptQueue();
}

async function processImg2PromptQueue() {
  if (img2promptState.isProcessing) return;

  const provider = getActiveProvider();
  const inputEl = document.getElementById('gemini-api-key-input');
  if (!hasApiKey(provider) && inputEl && inputEl.value.trim()) {
    setApiKey(inputEl.value.trim(), provider);
  }

  const config = AI_PROVIDERS_CONFIG[provider] || AI_PROVIDERS_CONFIG.gemini;
  if (!hasApiKey(provider)) {
    openModal(document.getElementById('modal-ai-settings'));
    showToast(`Please connect your ${config.name} API key first to generate prompts.`, 'warning');
    return;
  }

  const hasWaiting = img2promptState.items.some(i => i.status === 'waiting');
  if (!hasWaiting) return;

  img2promptState.isProcessing = true;
  img2promptState.stopBatch = false;
  const currentBatchSession = ++img2promptState._batchSessionId;
  img2promptState._batchSessionCounter = currentBatchSession;

  if (img2promptState.abortController) {
    try { img2promptState.abortController.abort(); } catch (_) {}
  }
  img2promptState.abortController = new AbortController();
  const promptSignal = img2promptState.abortController.signal;
  
  renderImg2PromptCards();

  const isBatchStopped = () => img2promptState.stopBatch || state.stopBatch || img2promptState._batchSessionId !== currentBatchSession;

  const processSingleItem = async (item) => {
    if (isBatchStopped()) {
      if (item.status === 'processing') {
        item.status = 'waiting';
        item.error = null;
        item.prompt = null;
      }
      return;
    }

    let attempts = 0;
    const maxAttempts = 3;
    let lastErr = null;

    while (attempts < maxAttempts) {
      if (isBatchStopped()) break;

      try {
        const platformSpec = PLATFORMS.general || {
          id: 'general', name: 'General',
          keywordMax: 50, keywordMin: 5, titleMaxLen: 200, categories: []
        };

        const itemMode = (item.promptType || img2promptState.promptType) === 'video' ? 'img2prompt-video' : 'img2prompt-photo';
        const key = getSessionKey(provider);
        const d = await generateMetadataForImage(item, platformSpec, key, null, itemMode, promptSignal);

        if (isBatchStopped()) break;

        if (d) {
          const kwStr = Array.isArray(d.keywords) ? d.keywords.slice(0, 25).join(', ') : '';

          const promptParts = [];
          if (d.title) promptParts.push(d.title);
          if (d.description && d.description !== d.title) promptParts.push(d.description);
          if (d.category && d.category !== 'General') promptParts.push(`Style: ${d.category}`);
          if (kwStr) promptParts.push(`Visual details: ${kwStr}`);

          item.prompt = promptParts.join('. ') + '.';
          item.status = 'ready';
          item.error = null;
          lastErr = null;
          break;
        } else {
          lastErr = new Error('Generation returned no data');
          attempts++;
          if (attempts < maxAttempts && !isBatchStopped()) {
            await new Promise(r => setTimeout(r, 1200 * attempts));
          }
        }
      } catch (err) {
        lastErr = err;
        if (err.name === 'AbortError' || isBatchStopped()) {
          break;
        }
        attempts++;
        if (attempts < maxAttempts && !isBatchStopped()) {
          await new Promise(r => setTimeout(r, 1200 * attempts));
        }
      }
    }

    if (isBatchStopped()) {
      if (item.status === 'processing') {
        item.status = 'waiting';
        item.error = null;
        item.prompt = null;
      }
      return;
    }

    if (lastErr && item.status !== 'ready') {
      item.status = 'failed';
      item.error = lastErr.message || 'Image to prompt conversion failed';
    }

    if (!isBatchStopped()) {
      renderImg2PromptCards();
    }
  };

  // Run 2 parallel concurrent workers for optimal throughput within API limits
  const CONCURRENCY = 2;
  const worker = async () => {
    while (!isBatchStopped()) {
      // Synchronously reserve next waiting item
      const item = img2promptState.items.find(i => i.status === 'waiting');
      if (!item) break;

      item.status = 'processing';
      renderImg2PromptCards();

      await processSingleItem(item);
    }
  };

  try {
    const workers = Array.from({ length: CONCURRENCY }, () => worker());
    await Promise.all(workers);
  } finally {
    if (img2promptState._batchSessionId === currentBatchSession) {
      img2promptState.items.forEach(i => {
        if (i.status === 'processing' && (img2promptState.stopBatch || state.stopBatch)) {
          i.status = 'waiting';
          i.error = null;
          i.prompt = null;
        }
      });
      img2promptState.isProcessing = false;
      renderImg2PromptCards();
    }
  }
}

// ─── Img2Prompt Card Cache — incremental DOM diffing (no full innerHTML rebuild) ─
const _img2promptCardCache = new Map();

function buildImg2PromptCardHtml(item) {
  const isProcessing = item.status === 'processing';
  const isReady = item.status === 'ready';
  const isFailed = item.status === 'failed';
  const isWaiting = item.status === 'waiting';

  const isVideo = (item.promptType || 'photo') === 'video';
  const typeBadge = isVideo
    ? `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-purple-500/15 text-purple-400 border border-purple-500/30">🎬 Video</span>`
    : `<span class="px-2 py-0.5 rounded text-[11px] font-bold bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">📷 Photo</span>`;

  let statusBadgeHtml;
  if (isProcessing) {
    statusBadgeHtml = `<span class="status-tag status-processing">Analyzing…</span>`;
  } else if (isReady) {
    statusBadgeHtml = `<span class="status-tag status-ready">✓ Ready</span>`;
  } else if (isFailed) {
    statusBadgeHtml = `<span class="status-tag status-failed">✕ Failed</span>`;
  } else {
    statusBadgeHtml = `<span class="status-tag status-waiting">In Queue</span>`;
  }

  let promptContentHtml;
  if (isProcessing) {
    promptContentHtml = `<span class="img2prompt-analyzing">Analyzing ${isVideo ? 'video' : 'photo'} visual features &amp; engineering detailed AI prompt <span class="loading-dots"><span></span><span></span><span></span></span></span>`;
  } else if (isFailed) {
    promptContentHtml = `<span style="color:var(--accent-rose)">Error: ${escHtml(item.error || 'Failed to generate prompt')}</span>`;
  } else if (isWaiting) {
    promptContentHtml = `<span style="color:var(--text-muted);font-style:italic">Waiting in generation queue...</span>`;
  } else {
    promptContentHtml = escHtml(item.prompt || 'No prompt generated');
  }

  const cardStateClass = isProcessing ? ' is-processing' : (isReady ? ' is-ready' : (isFailed ? ' is-failed' : ' is-waiting'));

  return `<div class="img2prompt-card glass-panel${cardStateClass}" data-id="${item.id}" style="padding:16px;background:rgba(21, 32, 54, 0.88)">
    <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:10px;flex-wrap:wrap">
      <div style="display:flex;align-items:center;gap:10px">
        <div class="img2prompt-thumb-wrap">
          <img src="${item.url}" alt="${escHtml(item.name)}" loading="lazy" decoding="async" style="width:44px;height:44px;object-fit:cover;border-radius:6px;border:1px solid var(--glass-border)">
        </div>
        <div>
          <div style="font-size:0.85rem;font-weight:700;color:var(--text-primary);word-break:break-all">${escHtml(item.name)}</div>
          <div style="font-size:0.725rem;color:var(--text-muted);display:flex;align-items:center;gap:6px;margin-top:2px">
            <span>${(item.size / 1048576).toFixed(2)} MB</span>
            <span>•</span>
            ${typeBadge}
          </div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px">
        ${statusBadgeHtml}
        ${isReady ? `<button class="btn btn-secondary btn-sm btn-copy-single-prompt" data-id="${item.id}">📋 Copy</button>` : ''}
        ${isFailed ? `<button class="btn btn-secondary btn-sm btn-retry-single-prompt" data-id="${item.id}">🔄 Retry</button>` : ''}
        <button class="btn btn-icon-only btn-sm btn-remove-prompt" data-id="${item.id}" title="Remove">🗑️</button>
      </div>
    </div>
    <div class="prompt-text-box" style="font-size:0.85rem;line-height:1.6;color:var(--text-secondary);background:var(--bg-main);padding:12px 14px;border-radius:8px;border:1px solid var(--glass-border);user-select:all;white-space:pre-wrap">${promptContentHtml}</div>
  </div>`;
}

function renderImg2PromptCards() {
  const container = document.getElementById('img2prompt-cards-list');
  const wrapper = document.getElementById('img2prompt-results-wrapper');
  const titleEl = document.getElementById('img2prompt-results-title');

  if (!container || !wrapper) return;

  if (img2promptState.items.length === 0) {
    wrapper.style.display = 'none';
    container.innerHTML = '';
    _img2promptCardCache.clear();
    return;
  }

  wrapper.style.display = 'block';

  const waitingCount = img2promptState.items.filter(i => i.status === 'waiting').length;
  const processingCount = img2promptState.items.filter(i => i.status === 'processing').length;
  const readyCount = img2promptState.items.filter(i => i.status === 'ready').length;

  if (titleEl) {
    if (img2promptState.isProcessing) {
      titleEl.innerHTML = `Generated Prompts <span class="text-xs font-normal text-cyan-400 ml-2 animate-pulse">● Processing (${readyCount}/${img2promptState.items.length} done, ${waitingCount} queued)...</span>`;
    } else {
      titleEl.textContent = `Generated Prompts (${img2promptState.items.length} ${img2promptState.items.length === 1 ? 'image' : 'images'})`;
    }
  }

  const btnGenerateAll = document.getElementById('btn-generate-all-img2prompt');
  if (btnGenerateAll) {
    if (img2promptState.isProcessing) {
      btnGenerateAll.style.display = 'inline-flex';
      btnGenerateAll.innerHTML = `<span class="ai-action-spinner" aria-hidden="true"></span><span>Generating (${processingCount + waitingCount} in queue) — Stop</span>`;
      btnGenerateAll.classList.add('ai-action-running');
      btnGenerateAll.disabled = false;
      btnGenerateAll.title = "Click to stop prompt generation";
    } else if (waitingCount > 0) {
      btnGenerateAll.style.display = 'inline-flex';
      btnGenerateAll.innerHTML = `<span class="material-symbols-outlined text-[20px]">bolt</span> Generate Prompts (${waitingCount})`;
      btnGenerateAll.classList.remove('ai-action-running');
      btnGenerateAll.disabled = false;
      btnGenerateAll.title = "Start generating prompts for waiting items";
    } else {
      btnGenerateAll.style.display = 'none';
      btnGenerateAll.classList.remove('ai-action-running');
      btnGenerateAll.disabled = false;
    }
  }

  // ── Incremental DOM diffing: only rebuild cards whose fingerprint changed ──
  const currentIds = new Set(img2promptState.items.map(i => i.id));

  // Remove cards no longer in the list
  for (const [id, el] of _img2promptCardCache.entries()) {
    if (!currentIds.has(id)) {
      el.remove();
      _img2promptCardCache.delete(id);
    }
  }
  Array.from(container.children).forEach(child => {
    const id = child.getAttribute('data-id');
    if (id && !currentIds.has(id)) child.remove();
  });

  // Insert/update cards in correct order
  let prevEl = null;
  img2promptState.items.forEach(item => {
    const fp = `${item.id}::${item.status}::${item.prompt || ''}::${item.error || ''}::${item.promptType || 'photo'}`;
    let cached = _img2promptCardCache.get(item.id);

    if (!cached || cached._fp !== fp || !container.contains(cached)) {
      const html = buildImg2PromptCardHtml(item);
      const temp = document.createElement('div');
      temp.innerHTML = html.trim();
      const newEl = temp.firstElementChild;
      newEl._fp = fp;

      if (cached && cached.parentNode === container) {
        container.replaceChild(newEl, cached);
      } else if (prevEl && prevEl.nextSibling) {
        container.insertBefore(newEl, prevEl.nextSibling);
      } else if (!prevEl) {
        container.prepend(newEl);
      } else {
        container.appendChild(newEl);
      }
      _img2promptCardCache.set(item.id, newEl);
      prevEl = newEl;
    } else {
      prevEl = cached;
    }
  });
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
