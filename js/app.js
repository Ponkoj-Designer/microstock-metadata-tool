/**
 * Microstock Metadata Management Tool — Main Application Controller
 * Real Gemini AI BYOK + Batch Processing + CSV Export + Performance Optimizations
 */

import { PLATFORMS } from './platforms.js';
import { SAMPLE_IMAGES } from './sampleData.js';
import { generateMockMetadataForFile } from './mockGenerator.js'; // fallback for samples
import { generateCsvContent, downloadCsvFile, validateBatch, generateCsvPreviewHtml } from './csvExporter.js';
import { setApiKey, hasApiKey, clearApiKey, testConnection, generateMetadataForImage, isGeminiAnalyzable } from './geminiClient.js';
import { runBatchQueue } from './batchProcessor.js';

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
  // Render throttle
  _renderPending: false,
  _lastStats: null
};

// ─── File type sets ────────────────────────────────────────────────────────
const IMAGE_EXTS  = new Set(['jpg','jpeg','png','webp','tiff','tif']);
const VECTOR_EXTS = new Set(['eps','ai','svg','pdf']);
const ALL_EXTS    = new Set([...IMAGE_EXTS, ...VECTOR_EXTS]);

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

// ─── Init ──────────────────────────────────────────────────────────────────
export function initApp() {
  renderPlatforms();
  setupEventListeners();
  updatePlatformSpecsBanner();
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
    tab.className = `platform-pill-tab${isSelected ? ' selected' : ''}`;
    tab.dataset.id = platform.id;
    tab.type = 'button';
    tab.title = `${platform.name} — ${platform.description}`;
    if (isSelected && platform.color) {
      tab.style.borderColor = platform.color;
      tab.style.boxShadow = `0 0 16px ${platform.colorBg}`;
    }
    tab.innerHTML = `
      <span class="pill-logo-box">${platform.logoSvg}</span>
      <span class="pill-platform-name">${platform.name}</span>
      ${isSelected ? `<span class="pill-check-dot" style="background:${platform.color}">✓</span>` : ''}`;
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

function updatePlatformSpecsBanner() {
  const el = document.getElementById('platform-spec-banner');
  if (!el) return;
  const p = state.currentPlatform;
  el.innerHTML = `
    <div class="platform-spec-item">Selected: <strong style="color:${p.color}">${p.name}</strong></div>
    <div class="platform-spec-item">Title: <strong>${p.titleMaxLen} chars max</strong></div>
    <div class="platform-spec-item">Keywords: <strong>${p.keywordMin}–${p.keywordMax}</strong></div>
    <div class="platform-spec-item">CSV: <strong>${p.csvColumns.join(', ')}</strong></div>`;
}

// ─── AI Status Badge ────────────────────────────────────────────────────────
function updateAiStatusBadge() {
  const badge = document.getElementById('ai-status-badge');
  if (!badge) return;
  if (state.geminiConnected) {
    badge.innerHTML = '<span class="ai-dot ai-dot-connected"></span> Gemini Connected';
    badge.className = 'ai-status-badge connected';
  } else {
    badge.innerHTML = '<span class="ai-dot ai-dot-disconnected"></span> AI Not Connected';
    badge.className = 'ai-status-badge disconnected';
  }
}

// ─── Asset Tabs ────────────────────────────────────────────────────────────
function switchAssetTab(name) {
  state.activeAssetTab = name;
  ['images','vectors','videos'].forEach(t => {
    const el = document.getElementById(`tab-${t}`);
    if (el) el.classList.remove('active');
  });
  const activeEl = document.getElementById(`tab-${name}`);
  if (activeEl) activeEl.classList.add('active');
  if (name === 'videos') showToast('Video support is coming soon!', 'info');
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
  } else {
    if (titleEl)   titleEl.textContent = 'Video support coming soon';
    if (subEl)     subEl.textContent   = 'MP4, MOV footage metadata engine in development';
    if (tagsEl)    tagsEl.innerHTML    = ['MP4','MOV'].map(f=>`<span class="format-tag" style="opacity:0.5">${f}</span>`).join('');
    if (fileInput) fileInput.accept    = '';
  }
}

// ─── File Processing ───────────────────────────────────────────────────────
function classifyFile(file) {
  const ext = file.name.split('.').pop().toLowerCase();
  if (IMAGE_EXTS.has(ext))  return { assetType: 'image',  format: ext.toUpperCase(), ext };
  if (VECTOR_EXTS.has(ext)) return { assetType: ext === 'pdf' ? 'pdf' : 'vector', format: ext.toUpperCase(), ext };
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
  if (state.activeAssetTab === 'videos') { showToast('Video support coming soon!', 'info'); return; }
  const existingKeys = new Set(state.mediaItems.map(i => i._fileKey));
  const accepted = []; const skippedDup = []; const skippedBad = [];

  for (const file of files) {
    const cls = classifyFile(file);
    if (!cls) { skippedBad.push(file.name); continue; }
    if (state.activeAssetTab === 'images'  && cls.assetType !== 'image')  { skippedBad.push(file.name); continue; }
    if (state.activeAssetTab === 'vectors' && cls.assetType === 'image')  { skippedBad.push(file.name); continue; }
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

// ─── Sample Batch ──────────────────────────────────────────────────────────
function loadSampleBatch() {
  const samples = JSON.parse(JSON.stringify(SAMPLE_IMAGES));
  samples.forEach(s => {
    s.assetType = s.assetType || 'image';
    s.format    = s.format    || s.name.split('.').pop().toUpperCase();
    s._fileKey  = `${s.name}::${s.size}::0`;
    s.status    = 'ready';
    s.ext       = s.name.split('.').pop().toLowerCase();
    s._error    = null;
  });
  const existingKeys = new Set(state.mediaItems.map(i => i._fileKey));
  const fresh = samples.filter(s => !existingKeys.has(s._fileKey));
  if (!fresh.length) { showToast('Sample batch already loaded!', 'info'); return; }
  state.mediaItems.push(...fresh);
  updateUI();
  showToast(`Loaded ${fresh.length} sample assets (demo mode)`, 'success');
}

// ─── AI Generation ─────────────────────────────────────────────────────────
async function triggerAiGeneration() {
  if (state.mediaItems.length === 0 || state.isGenerating) return;

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

  state.isGenerating = true;
  state.stopBatch = false;

  const genBtn = document.getElementById('btn-generate-ai');
  const stopBtn = document.getElementById('btn-stop-generation');
  const retryBtn = document.getElementById('btn-retry-failed');
  if (genBtn)  { genBtn.disabled = true;  genBtn.innerHTML  = `<svg class="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10" stroke-width="3" stroke-dasharray="30 30"></circle></svg> Generating…`; }
  if (stopBtn) stopBtn.style.display = 'inline-flex';

  const progressBar = document.getElementById('progress-bar-container');
  if (progressBar) progressBar.classList.add('active');

  let successCount = 0, failCount = 0;

  await runBatchQueue({
    items: toProcess,
    shouldStop: () => state.stopBatch,

    onItemStart: (item) => {
      const stateItem = state.mediaItems.find(i => i.id === item.id);
      if (stateItem) { stateItem.status = 'processing'; stateItem._error = null; }
      throttledRender();
    },

    processFn: async (item) => {
      return await generateMetadataForImage(item, state.currentPlatform);
    },

    onItemDone: (item, idx, result, err) => {
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

  if (genBtn)  { genBtn.disabled = false; genBtn.innerHTML = `<svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg> Generate Metadata`; }
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
  if (!hasApiKey()) {
    openModal(document.getElementById('modal-ai-settings'));
    showToast('Add Gemini API key first', 'warning');
    return;
  }
  const item = state.mediaItems.find(i => i.id === id);
  if (!item) return;
  item.status = 'waiting';
  item._error = null;
  throttledRender();

  // Run single item through the batch system
  (async () => {
    item.status = 'processing';
    throttledRender();
    try {
      const result = await generateMetadataForImage(item, state.currentPlatform);
      if (result && result._geminiUnsupported) {
        item.status = 'failed'; item._error = result.reason;
      } else if (result) {
        item.status = 'ready';
        item.metadata = { title: result.title, description: result.description, keywords: result.keywords, category: result.category };
        item._error = null;
        showToast(`Regenerated: ${item.name}`, 'success');
      }
    } catch (err) {
      item.status = 'failed'; item._error = err.message;
      showToast(`Failed: ${err.message}`, 'error');
    }
    throttledRender();
  })();
}

// ─── Render (throttled to avoid layout thrashing) ──────────────────────────
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
  const mainArea   = document.getElementById('main-content-area');
  if (emptyState) emptyState.style.display = hasItems ? 'none' : 'flex';
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
    return `<img src="${item.url}" alt="" loading="lazy" decoding="async" style="width:${size}px;height:${size}px;object-fit:cover;border-radius:6px;border:1px solid var(--border-glass);">`;
  }
  const col = item.assetType === 'image' ? 'var(--accent-cyan)' : 'var(--accent-purple)';
  return `<div style="width:${size}px;height:${size}px;border-radius:6px;background:rgba(139,92,246,0.1);border:1px solid rgba(139,92,246,0.25);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;"><svg width="18" height="18" fill="none" stroke="${col}" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"/></svg><span style="font-size:0.55rem;font-weight:800;color:${col}">${item.format||''}</span></div>`;
}

function buildAssetBadge(item) {
  if (item.assetType === 'image')  return `<span class="asset-type-badge badge-image">IMAGE</span>`;
  if (item.assetType === 'pdf')    return `<span class="asset-type-badge badge-pdf">PDF</span>`;
  if (item.assetType === 'vector') return `<span class="asset-type-badge badge-vector">VECTOR</span>`;
  return '';
}

// ─── Table View ────────────────────────────────────────────────────────────
function renderTableView(items) {
  const tableBody = document.getElementById('metadata-table-body');
  if (!tableBody) return;

  if (items.length === 0) {
    tableBody.innerHTML = `<tr><td colspan="8" style="text-align:center;padding:40px;color:var(--text-muted)">No matching assets found.</td></tr>`;
    return;
  }

  const p = state.currentPlatform;
  const catOptions = (p.categories.length > 0 ? p.categories : ['General','Business','Technology','Nature','People','Food','Architecture','Graphic Resources'])
    .map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');

  // Use DocumentFragment for performance
  const frag = document.createDocumentFragment();

  items.forEach(item => {
    const isSelected = state.selectedItemIds.has(item.id);
    const meta = item.metadata || { title:'', description:'', keywords:[], category:'' };
    const kwCount = (meta.keywords || []).length;
    const tr = document.createElement('tr');

    const titleLen = (meta.title || '').length;
    const titleLenClass = titleLen > p.titleMaxLen ? 'exceeded' : (titleLen > p.titleMaxLen * 0.85 ? 'warning' : '');
    const kwClass = kwCount > p.keywordMax ? 'exceeded' : (kwCount < p.keywordMin && kwCount > 0 ? 'warning' : '');

    // Error row styling
    if (item.status === 'failed') tr.style.background = 'rgba(239,68,68,0.05)';

    const selectedCat = catOptions.replace(
      new RegExp(`value="${escHtml(meta.category).replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}"`, 'g'),
      `value="${escHtml(meta.category)}" selected`
    );

    const kwChips = (meta.keywords || []).slice(0, 12).map((kw, ki) =>
      `<span class="keyword-chip">${escHtml(kw)}<span class="keyword-chip-remove" data-item-id="${item.id}" data-kw-idx="${ki}">×</span></span>`
    ).join('');
    const kwMore = kwCount > 12 ? `<span style="font-size:0.7rem;color:var(--text-muted);padding:2px 6px">+${kwCount-12} more</span>` : '';

    const errorHtml = item._error
      ? `<div style="font-size:0.7rem;color:var(--accent-rose);margin-top:4px;max-width:140px;word-break:break-word" title="${escHtml(item._error)}">⚠ ${escHtml(item._error.substring(0,80))}${item._error.length>80?'…':''}</div>`
      : '';

    tr.innerHTML = `
      <td class="col-thumb">
        <div style="display:flex;align-items:center;gap:8px;">
          <input type="checkbox" class="row-checkbox" data-id="${item.id}" ${isSelected?'checked':''}>
          ${buildThumbHtml(item,44)}
        </div>
      </td>
      <td class="col-filename">
        <div style="font-size:0.8125rem;font-weight:600;word-break:break-all">${escHtml(item.name)}</div>
        <div style="display:flex;align-items:center;gap:6px;margin-top:4px;flex-wrap:wrap">
          ${buildAssetBadge(item)}
          <span style="font-size:0.7rem;color:var(--text-muted)">${(item.size/1048576).toFixed(1)} MB</span>
        </div>
        ${errorHtml}
      </td>
      <td class="col-title">
        <input type="text" class="inline-input title-input" data-id="${item.id}" value="${escHtml(meta.title)}" placeholder="Enter title…" ${item.status==='processing'?'disabled':''}>
        <div class="char-counter ${titleLenClass}">${titleLen} / ${p.titleMaxLen}</div>
      </td>
      <td class="col-desc">
        <textarea class="inline-textarea desc-textarea" data-id="${item.id}" placeholder="Enter description…" ${item.status==='processing'?'disabled':''}>${escHtml(meta.description)}</textarea>
      </td>
      <td class="col-keywords">
        <div class="keywords-chip-container">${kwChips}${kwMore}<input type="text" class="add-tag-input" data-id="${item.id}" placeholder="+ Tag…"></div>
        <div style="font-size:0.6875rem;color:var(--text-muted);margin-top:4px;display:flex;justify-content:space-between;align-items:center">
          <span class="${kwClass}" style="font-weight:${kwClass?'700':'400'}">${kwCount}/${p.keywordMax} kw</span>
          <a href="#" class="copy-kw-link" data-id="${item.id}" style="color:var(--accent-primary);text-decoration:none">Copy All</a>
        </div>
      </td>
      <td class="col-category">
        <select class="inline-select category-select" data-id="${item.id}" ${item.status==='processing'?'disabled':''}>
          <option value="">Select…</option>${selectedCat}
        </select>
      </td>
      <td class="col-status">
        <span class="status-tag status-${item.status}">${item.status}</span>
      </td>
      <td class="col-actions">
        <div style="display:flex;gap:4px;flex-wrap:wrap">
          <button class="btn btn-icon-only btn-sm regen-btn" data-id="${item.id}" title="Regenerate with AI" ${item.status==='processing'?'disabled':''}>🤖</button>
          <button class="btn btn-icon-only btn-sm view-detail-btn" data-id="${item.id}" title="View Details">👁️</button>
          <button class="btn btn-icon-only btn-sm delete-btn" data-id="${item.id}" title="Remove">🗑️</button>
        </div>
      </td>`;

    frag.appendChild(tr);
  });

  tableBody.innerHTML = '';
  tableBody.appendChild(frag);
}

function setupTableEventDelegation() {
  const tableContainer = document.getElementById('table-view-container');
  if (!tableContainer) return;

  tableContainer.addEventListener('input', (e) => {
    const titleInput = e.target.closest('.title-input');
    if (titleInput) {
      const item = state.mediaItems.find(i => i.id === titleInput.dataset.id);
      if (!item) return;
      if (!item.metadata) item.metadata = {};
      item.metadata.title = titleInput.value;
      const ctr = titleInput.nextElementSibling;
      if (ctr) {
        const len = titleInput.value.length, max = state.currentPlatform.titleMaxLen;
        ctr.textContent = `${len} / ${max}`;
        ctr.className = `char-counter ${len>max?'exceeded':len>max*0.85?'warning':''}`;
      }
      return;
    }

    const descTextarea = e.target.closest('.desc-textarea');
    if (descTextarea) {
      const item = state.mediaItems.find(i => i.id === descTextarea.dataset.id);
      if (item && item.metadata) item.metadata.description = descTextarea.value;
      return;
    }

    const categorySelect = e.target.closest('.category-select');
    if (categorySelect) {
      const item = state.mediaItems.find(i => i.id === categorySelect.dataset.id);
      if (item && item.metadata) item.metadata.category = categorySelect.value;
      throttledRender();
      return;
    }
  });

  tableContainer.addEventListener('keydown', (e) => {
    const addTagInput = e.target.closest('.add-tag-input');
    if (!addTagInput) return;
    if (e.key !== 'Enter' && e.key !== ',') return;
    e.preventDefault();
    const tag = addTagInput.value.trim().replace(/^,|,$/g,'');
    if (!tag) return;
    const item = state.mediaItems.find(i => i.id === addTagInput.dataset.id);
    if (item && item.metadata) {
      if (!item.metadata.keywords) item.metadata.keywords = [];
      if (!item.metadata.keywords.map(k=>k.toLowerCase()).includes(tag.toLowerCase())) {
        item.metadata.keywords.push(tag);
        throttledRender();
      }
    }
    addTagInput.value = '';
  });

  tableContainer.addEventListener('click', (e) => {
    const keywordChipRemove = e.target.closest('.keyword-chip-remove');
    if (keywordChipRemove) {
      const item = state.mediaItems.find(i => i.id === keywordChipRemove.dataset.itemId);
      if (item && item.metadata && item.metadata.keywords)
        item.metadata.keywords.splice(parseInt(keywordChipRemove.dataset.kwIdx, 10), 1);
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
      rowCheckbox.checked ? state.selectedItemIds.add(rowCheckbox.dataset.id) : state.selectedItemIds.delete(rowCheckbox.dataset.id);
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
  const gridEl = document.getElementById('grid-view-container');
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
      if (state.selectedItemIds.has(card.dataset.id)) state.selectedItemIds.delete(card.dataset.id);
      else state.selectedItemIds.add(card.dataset.id);
      card.classList.toggle('selected');
      updateStatsBar();
      return;
    }
  });
}

// ─── Grid View ─────────────────────────────────────────────────────────────
function renderGridView(items) {
  const gridEl = document.getElementById('grid-view-container');
  if (!gridEl) return;

  if (items.length === 0) {
    gridEl.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-muted)">No matching assets.</div>`;
    return;
  }

  const frag = document.createDocumentFragment();
  items.forEach((item, index) => {
    const isSelected = state.selectedItemIds.has(item.id);
    const meta = item.metadata || {};
    const card = document.createElement('div');
    card.className = `grid-card${isSelected?' selected':''}`;
    card.dataset.id = item.id;
    if (item.status === 'failed') card.style.borderColor = 'rgba(239,68,68,0.5)';

    let thumbHtml;
    if (item.url) {
      thumbHtml = `<img src="${item.url}" class="card-thumb-img" alt="${escHtml(item.name)}" loading="lazy" decoding="async">`;
    } else {
      thumbHtml = `<div class="vector-placeholder-box"><svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01"/></svg><span class="vector-format-label">${item.format}</span></div>`;
    }
    const kwCount = (meta.keywords || []).length;
    card.innerHTML = `
      <div class="card-thumb-container">
        ${thumbHtml}
        <span class="card-number-badge">#${index+1}</span>
        <div class="card-actions-overlay"><button class="card-remove-btn" data-id="${item.id}">×</button></div>
      </div>
      <div class="card-content">
        <div class="card-filename" title="${escHtml(item.name)}">${escHtml(item.name)}</div>
        <div class="card-meta-line">
          <span class="status-tag status-${item.status}">${item.status}</span>
          <span style="font-size:0.7rem;color:var(--text-muted)">${(item.size/1048576).toFixed(1)}MB · ${kwCount}kw</span>
        </div>
        ${item._error ? `<div style="font-size:0.65rem;color:var(--accent-rose);margin-top:4px">⚠ ${escHtml(item._error.substring(0,60))}</div>` : ''}
      </div>`;

    frag.appendChild(card);
  });

  gridEl.innerHTML = '';
  gridEl.appendChild(frag);
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
  state.mediaItems.filter(i => state.selectedItemIds.has(i.id)).forEach(i => { if (i.url && i.url.startsWith('blob:')) URL.revokeObjectURL(i.url); });
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
  if (tab === 'login') {
    loginTab?.classList.add('active');  signupTab?.classList.remove('active');
    if (loginForm)  loginForm.style.display  = 'flex';
    if (signupForm) signupForm.style.display = 'none';
  } else {
    loginTab?.classList.remove('active'); signupTab?.classList.add('active');
    if (loginForm)  loginForm.style.display  = 'none';
    if (signupForm) signupForm.style.display = 'flex';
  }
}

// ─── Modal helpers ──────────────────────────────────────────────────────────
function openModal(el)  { el && el.classList.add('active'); }
function closeModal(el) { el && el.classList.remove('active'); }

// ─── Settings ──────────────────────────────────────────────────────────────
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
  document.getElementById('nav-btn-contact')?.addEventListener('click',  () => openModal(modal('modal-contact')));
  document.getElementById('nav-btn-pricing')?.addEventListener('click',  () => openModal(modal('modal-pricing')));
  document.getElementById('nav-btn-login')?.addEventListener('click',    () => { switchAuthTab('login');  openModal(modal('modal-auth')); });
  document.getElementById('nav-btn-signup')?.addEventListener('click',   () => { switchAuthTab('signup'); openModal(modal('modal-auth')); });

  // AI Settings button in header/nav
  document.getElementById('nav-btn-ai-settings')?.addEventListener('click', () => openModal(modal('modal-ai-settings')));

  // Mobile drawer
  ['tutorial','contact','pricing'].forEach(key => {
    document.getElementById(`mobile-nav-${key}`)?.addEventListener('click', () => {
      modal('mobile-nav-drawer')?.classList.remove('active');
      openModal(modal(`modal-${key}`));
    });
  });
  document.getElementById('mobile-nav-login')?.addEventListener('click', () => {
    modal('mobile-nav-drawer')?.classList.remove('active');
    switchAuthTab('login'); openModal(modal('modal-auth'));
  });

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
  document.getElementById('auth-tab-login')?.addEventListener('click',    () => switchAuthTab('login'));
  document.getElementById('auth-tab-signup')?.addEventListener('click',   () => switchAuthTab('signup'));
  document.getElementById('auth-login-form')?.addEventListener('submit',  e => { e.preventDefault(); closeModal(modal('modal-auth')); showToast('Logged in!', 'success'); });
  document.getElementById('auth-signup-form')?.addEventListener('submit', e => { e.preventDefault(); closeModal(modal('modal-auth')); showToast('Account created!', 'success'); });

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
      if (state.activeAssetTab === 'videos') { showToast('Video support coming soon!','info'); return; }
      processFiles(Array.from(e.dataTransfer.files));
    });
  }

  // File input
  document.getElementById('btn-browse-files')?.addEventListener('click', () => {
    if (state.activeAssetTab==='videos'){showToast('Video support coming soon!','info');return;}
    document.getElementById('file-input')?.click();
  });
  document.getElementById('btn-upload-more')?.addEventListener('click', () => {
    if (state.activeAssetTab==='videos'){showToast('Video support coming soon!','info');return;}
    updateUploadZoneForTab();
    document.getElementById('file-input')?.click();
  });
  document.getElementById('file-input')?.addEventListener('change', e => {
    const files = Array.from(e.target.files);
    if (files.length) processFiles(files);
    e.target.value = '';
  });
  document.getElementById('btn-load-samples')?.addEventListener('click', loadSampleBatch);

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
  showToast('API key saved for this session', 'success');
  updateConnectionStatus('saved');
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
  if (btn) { btn.disabled = true; btn.innerHTML = '<svg class="spin" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="12" cy="12" r="10" stroke-width="3" stroke-dasharray="30 30"></circle></svg> Testing…'; }

  updateConnectionStatus('testing');

  try {
    const result = await testConnection(keyToTest);
    if (result.ok) {
      if (keyToTest) { setApiKey(keyToTest); if (input) { input.value=''; input.type='password'; } }
      state.geminiConnected = true;
      updateConnectionStatus('connected');
      updateAiStatusBadge();
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
    if (btn) { btn.disabled = false; btn.innerHTML = 'Test Connection'; }
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

// ─── Escape HTML ────────────────────────────────────────────────────────────
function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#039;');
}
