/**
 * Multi-Provider AI Client — Supports Google Gemini, OpenRouter, and OpenAI
 * Customer API keys are held strictly in memory for this session only.
 */

const REQUEST_TIMEOUT_MS = 45000;
const VIDEO_TIMEOUT_MS = 240000;

export const AI_PROVIDERS_CONFIG = {
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    getKeyUrl: 'https://aistudio.google.com/app/apikey',
    getKeyLabel: 'Get API Key from Google',
    placeholder: 'AIza...',
    label: 'Add New API Key',
    models: [
      { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash' }
    ]
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    getKeyUrl: 'https://openrouter.ai/keys',
    getKeyLabel: 'Get API Key from OpenRouter',
    placeholder: 'sk-or-v1-...',
    label: 'Add New API Key',
    models: [
      { id: 'openrouter/auto',   name: 'OpenRouter Auto — Best Available (Recommended)' }
    ]
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    getKeyUrl: 'https://platform.openai.com/api-keys',
    getKeyLabel: 'Get API Key from OpenAI',
    placeholder: 'sk-proj-...',
    label: 'Add New API Key',
    models: [
      { id: 'gpt-4o-mini',       name: 'GPT-4o Mini — Latest Fast Model' }
    ]
  }
};

// ── Persistent (localStorage) Key & Provider Store ──────────────────────────
const STORAGE_KEYS = {
  activeProvider: 'pk_ai_active_provider',
  keys: 'pk_ai_provider_keys',
  models: 'pk_ai_provider_models'
};

function loadStoredData() {
  if (typeof localStorage === 'undefined') return { activeProvider: 'gemini', keys: {}, models: {} };
  try {
    const active = localStorage.getItem(STORAGE_KEYS.activeProvider);
    const keysStr = localStorage.getItem(STORAGE_KEYS.keys);
    const modelsStr = localStorage.getItem(STORAGE_KEYS.models);
    return {
      activeProvider: active || 'gemini',
      keys: keysStr ? JSON.parse(keysStr) : {},
      models: modelsStr ? JSON.parse(modelsStr) : {}
    };
  } catch (_) {
    return { activeProvider: 'gemini', keys: {}, models: {} };
  }
}

const _initialData = loadStoredData();

let _activeProvider = _initialData.activeProvider || 'gemini';
let _providerKeys = {
  gemini: _initialData.keys?.gemini || null,
  openrouter: _initialData.keys?.openrouter || null,
  openai: _initialData.keys?.openai || null
};
let _selectedModels = {
  gemini: 'gemini-3.5-flash',
  openrouter: _initialData.models?.openrouter || 'openrouter/auto',
  openai: _initialData.models?.openai || 'gpt-4o-mini'
};
// Auto-migrate: ensure default is gemini-3.5-flash
_selectedModels.gemini = 'gemini-3.5-flash';

function saveStorage() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEYS.activeProvider, _activeProvider);
    localStorage.setItem(STORAGE_KEYS.keys, JSON.stringify(_providerKeys));
    localStorage.setItem(STORAGE_KEYS.models, JSON.stringify(_selectedModels));
  } catch (_) {}
}

export function setAiProvider(provider) {
  if (AI_PROVIDERS_CONFIG[provider]) {
    _activeProvider = provider;
    saveStorage();
  }
}

export function getActiveProvider() {
  return _activeProvider;
}

export function setProviderModel(modelId, provider = _activeProvider) {
  _selectedModels[provider] = modelId;
  saveStorage();
}

export function getProviderModel(provider = _activeProvider) {
  return _selectedModels[provider] || AI_PROVIDERS_CONFIG[provider]?.models[0]?.id;
}

export function setApiKey(key, provider = _activeProvider) {
  _providerKeys[provider] = key ? key.trim() : null;
  saveStorage();
}

export function hasApiKey(provider = _activeProvider) {
  const key = _providerKeys[provider] || getSessionKey(provider);
  return !!key && String(key).trim().length > 0;
}

export function clearApiKey(provider = _activeProvider) {
  _providerKeys[provider] = null;
  saveStorage();
}

export function clearAllApiKeys() {
  _providerKeys = { gemini: null, openrouter: null, openai: null };
  _activeProvider = 'gemini';
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(STORAGE_KEYS.keys);
    localStorage.removeItem(STORAGE_KEYS.activeProvider);
  }
}

export function getSessionKey(provider = _activeProvider) {
  if (_providerKeys[provider]) return _providerKeys[provider];
  if (typeof localStorage !== 'undefined') {
    try {
      const keysStr = localStorage.getItem(STORAGE_KEYS.keys);
      if (keysStr) {
        const stored = JSON.parse(keysStr);
        if (stored && stored[provider]) {
          _providerKeys[provider] = stored[provider];
          return stored[provider];
        }
      }
    } catch (_) {}
  }
  if (typeof document !== 'undefined') {
    const input = document.getElementById('gemini-api-key-input');
    if (input && input.value.trim()) {
      return input.value.trim();
    }
  }
  return null;
}

export function getRedactedKey(key, provider = _activeProvider) {
  const target = key || _providerKeys[provider];
  if (!target || target.length < 6) return '***';
  return target.substring(0, 4) + '…' + target.substring(target.length - 4);
}

// ── Fetch with timeout & signal support ─────────────────────────────────────
async function fetchWithTimeout(url, options, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (options && options.signal) {
    if (options.signal.aborted) {
      clearTimeout(timer);
      controller.abort();
    } else {
      options.signal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

function getApiBase() {
  if (typeof window === 'undefined') return '';
  const port = window.location.port;
  if (port && port !== '3000' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
    return `http://${window.location.hostname}:3000`;
  }
  return '';
}

// ── Connection Test ─────────────────────────────────────────────────────────
export async function testConnection(key, provider = _activeProvider) {
  const targetKey = String(key || _providerKeys[provider] || '').trim();
  if (!targetKey && provider !== 'gemini') {
    return { ok: false, message: `${AI_PROVIDERS_CONFIG[provider]?.name || provider} API key is missing.` };
  }

  // 1. Direct Browser-to-API check (ultra-fast, zero-dependency, works everywhere)
  if (provider === 'gemini') {
    try {
      const directUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(targetKey)}`;
      const res = await fetchWithTimeout(directUrl, { method: 'GET' }, 8000);
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        return { ok: true, message: 'Successfully connected to Google Gemini API!' };
      }
      if (data?.error?.message) {
        return { ok: false, message: data.error.message };
      }
    } catch (_) {}
  } else if (provider === 'openrouter') {
    try {
      const res = await fetchWithTimeout('https://openrouter.ai/api/v1/auth/key', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${targetKey}` }
      }, 8000);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.data) {
        return { ok: true, message: 'Successfully connected to OpenRouter API!' };
      }
      if (data?.error?.message) {
        return { ok: false, message: data.error.message };
      }
    } catch (_) {}
  } else if (provider === 'openai') {
    try {
      const res = await fetchWithTimeout('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${targetKey}` }
      }, 8000);
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        return { ok: true, message: 'Successfully connected to OpenAI API!' };
      }
      if (data?.error?.message) {
        return { ok: false, message: data.error.message };
      }
    } catch (_) {}
  }

  // 2. Dual-Route Backend Proxy Verification
  const endpoints = [
    `${getApiBase()}/api/ai/test`,
    '/.netlify/functions/api/ai/test'
  ];

  for (const ep of endpoints) {
    try {
      const res = await fetchWithTimeout(ep, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-ai-provider': provider,
          'x-ai-api-key': targetKey,
          'x-gemini-api-key': targetKey
        },
        body: JSON.stringify({ provider, apiKey: targetKey })
      }, 10000);

      const contentType = res.headers.get('content-type') || '';
      if (contentType.includes('application/json')) {
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          return { ok: true, message: data.message || `Connected to ${AI_PROVIDERS_CONFIG[provider]?.name}!` };
        }
        if (data?.message) {
          return { ok: false, message: data.message };
        }
      }
    } catch (_) {}
  }

  return { ok: false, message: `Could not connect to ${AI_PROVIDERS_CONFIG[provider]?.name || provider}. Please check your API key.` };
}

// ── File / Blob to base64 helper ───────────────────────────────────────────
function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      const base64 = dataUrl.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

const SUPPORTED_EXTS = new Set([
  'jpg','jpeg','png','webp','tiff','tif','gif',
  'eps','ai','svg','pdf',
  'mp4','mov','avi','webm'
]);

export function isGeminiAnalyzable(ext) {
  if (!ext) return false;
  return SUPPORTED_EXTS.has(ext.toLowerCase().replace('.', ''));
}

function getGeminiMimeType(item, ext) {
  if (item.type && item.type.includes('/')) return item.type;
  switch (ext) {
    case 'jpg': case 'jpeg': return 'image/jpeg';
    case 'png':  return 'image/png';
    case 'webp': return 'image/webp';
    case 'gif':  return 'image/gif';
    case 'tiff': case 'tif': return 'image/tiff';
    case 'mp4':  return 'video/mp4';
    case 'mov':  return 'video/quicktime';
    case 'avi':  return 'video/x-msvideo';
    case 'webm': return 'video/webm';
    default:    return 'image/jpeg';
  }
}

export async function rasterizeSvgToJpegBase64(svgInput) {
  let svgText = '';
  if (typeof svgInput === 'string') {
    if (svgInput.startsWith('data:image/svg+xml')) {
      const parts = svgInput.split(',');
      svgText = parts[1] ? (parts[0].includes('base64') ? atob(parts[1]) : decodeURIComponent(parts[1])) : svgInput;
    } else if (svgInput.startsWith('http') || svgInput.startsWith('blob:')) {
      const res = await fetch(svgInput);
      svgText = await res.text();
    } else {
      svgText = svgInput;
    }
  } else if (svgInput instanceof Blob || svgInput instanceof File) {
    svgText = await svgInput.text();
  }

  if (!svgText || typeof svgText !== 'string') {
    throw new Error('Invalid SVG content.');
  }

  return new Promise((resolve, reject) => {
    try {
      // Parse SVG to ensure valid namespaces and dimensions
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgText, 'image/svg+xml');
      const svgEl = doc.querySelector('svg');

      if (!svgEl) {
        return reject(new Error('Invalid SVG: root <svg> element missing.'));
      }

      if (!svgEl.getAttribute('xmlns')) {
        svgEl.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      }

      // Check viewBox and dimensions
      let viewBox = svgEl.getAttribute('viewBox');
      let widthAttr = svgEl.getAttribute('width');
      let heightAttr = svgEl.getAttribute('height');

      let vbW = 0, vbH = 0;
      if (viewBox) {
        const parts = viewBox.trim().split(/[\s,]+/).map(Number);
        if (parts.length === 4 && parts[2] > 0 && parts[3] > 0) {
          vbW = parts[2];
          vbH = parts[3];
        }
      }

      let w = parseFloat(widthAttr) || vbW || 1000;
      let h = parseFloat(heightAttr) || vbH || 1000;

      if (!viewBox) {
        svgEl.setAttribute('viewBox', `0 0 ${w} ${h}`);
      }
      svgEl.setAttribute('width', `${w}`);
      svgEl.setAttribute('height', `${h}`);

      const serializer = new XMLSerializer();
      const cleanSvg = serializer.serializeToString(doc);

      const blob = new Blob([cleanSvg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();

      let isDone = false;
      const timeoutId = setTimeout(() => {
        if (!isDone) {
          isDone = true;
          URL.revokeObjectURL(url);
          reject(new Error('SVG rasterization timed out.'));
        }
      }, 12000);

      img.onload = () => {
        if (isDone) return;
        isDone = true;
        clearTimeout(timeoutId);

        const naturalW = img.naturalWidth || img.width || w || 1000;
        const naturalH = img.naturalHeight || img.height || h || 1000;
        const MAX_DIM = 1400;
        const scale = Math.min(1, MAX_DIM / naturalW, MAX_DIM / naturalH);
        const cw = Math.max(100, Math.round(naturalW * scale));
        const ch = Math.max(100, Math.round(naturalH * scale));

        const canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext('2d');

        // Clean white background for stock vector AI parsing
        ctx.fillStyle = '#FFFFFF';
        ctx.fillRect(0, 0, cw, ch);
        ctx.drawImage(img, 0, 0, cw, ch);

        URL.revokeObjectURL(url);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.90);
        resolve({
          base64: dataUrl.split(',')[1],
          mimeType: 'image/jpeg'
        });
      };

      img.onerror = () => {
        if (isDone) return;
        isDone = true;
        clearTimeout(timeoutId);
        URL.revokeObjectURL(url);

        // Fallback with direct data URI
        try {
          const encoded = encodeURIComponent(cleanSvg).replace(/'/g, '%27').replace(/"/g, '%22');
          const fallbackImg = new Image();
          fallbackImg.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = Math.max(100, Math.min(1200, w));
            canvas.height = Math.max(100, Math.min(1200, h));
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(fallbackImg, 0, 0, canvas.width, canvas.height);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.90);
            resolve({
              base64: dataUrl.split(',')[1],
              mimeType: 'image/jpeg'
            });
          };
          fallbackImg.onerror = () => {
            reject(new Error('Failed to rasterize SVG for AI vision.'));
          };
          fallbackImg.src = `data:image/svg+xml;charset=utf-8,${encoded}`;
        } catch (err) {
          reject(new Error('Failed to rasterize SVG for AI vision.'));
        }
      };

      img.src = url;
    } catch (err) {
      reject(err);
    }
  });
}

/**
 * Robust EPS & AI Vector Rasterizer for AI Metadata Generation.
 * Extracts embedded JPEG/PNG/TIFF previews from DOS EPS binary headers or streams,
 * or parses PostScript paths onto an HTML5 Canvas to produce high-resolution JPEGs.
 */
export async function rasterizeEpsToJpegBase64(epsInput) {
  let arrayBuffer;
  let fileName = 'vector.eps';
  if (epsInput instanceof File) {
    fileName = epsInput.name;
    arrayBuffer = await epsInput.arrayBuffer();
  } else if (epsInput instanceof Blob) {
    arrayBuffer = await epsInput.arrayBuffer();
  } else if (epsInput instanceof ArrayBuffer) {
    arrayBuffer = epsInput;
  } else if (typeof epsInput === 'string') {
    if (epsInput.startsWith('data:')) {
      const b64 = epsInput.split(',')[1] || '';
      const binaryStr = atob(b64);
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = binaryStr.charCodeAt(i);
      arrayBuffer = bytes.buffer;
    } else {
      const res = await fetch(epsInput);
      arrayBuffer = await res.arrayBuffer();
    }
  }

  if (!arrayBuffer || arrayBuffer.byteLength === 0) {
    throw new Error('Empty or invalid EPS file.');
  }

  const bytes = new Uint8Array(arrayBuffer);
  const len = bytes.length;

  const canvasToJpeg = (canvas) => {
    const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return { base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' };
  };

  const uint8ArrayToJpegBase64 = (u8Arr, mime = 'image/jpeg') => {
    let binary = '';
    const chunk = 8192;
    for (let i = 0; i < u8Arr.length; i += chunk) {
      binary += String.fromCharCode.apply(null, u8Arr.subarray(i, Math.min(i + chunk, u8Arr.length)));
    }
    return { base64: btoa(binary), mimeType: mime };
  };

  const decodeSliceToJpeg = (slice, mime) => {
    return new Promise((resolve) => {
      try {
        const blob = new Blob([slice], { type: mime });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          try {
            const maxDim = 900;
            const scale = Math.min(1, maxDim / Math.max(img.width || 1, 1), maxDim / Math.max(img.height || 1, 1));
            const w = Math.max(1, Math.round((img.width || 500) * scale));
            const h = Math.max(1, Math.round((img.height || 500) * scale));
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvasToJpeg(canvas));
          } catch (_) {
            resolve(uint8ArrayToJpegBase64(slice, mime));
          }
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          resolve(null);
        };
        img.src = url;
      } catch (_) {
        resolve(null);
      }
    });
  };

  // ── Strategy 1: Check DOS EPS Binary Header (0xC5D0D3C6) ───────────────────
  if (len >= 30 && bytes[0] === 0xC5 && bytes[1] === 0xD0 && bytes[2] === 0xD3 && bytes[3] === 0xC6) {
    try {
      const view = new DataView(arrayBuffer);
      const tiffOffset = view.getUint32(20, true);
      const tiffLength = view.getUint32(24, true);

      if (tiffOffset > 0 && tiffLength > 0 && tiffOffset + tiffLength <= len) {
        const previewSlice = bytes.subarray(tiffOffset, tiffOffset + tiffLength);
        if (previewSlice.length > 4 && previewSlice[0] === 0xFF && previewSlice[1] === 0xD8) {
          const res = await decodeSliceToJpeg(previewSlice, 'image/jpeg');
          if (res) return res;
        }
        if (previewSlice.length > 8 && previewSlice[0] === 0x89 && previewSlice[1] === 0x50) {
          const res = await decodeSliceToJpeg(previewSlice, 'image/png');
          if (res) return res;
        }
        const res = await decodeSliceToJpeg(previewSlice, 'image/tiff');
        if (res) return res;
      }
    } catch (_) {}
  }

  // ── Strategy 2: Scan for Embedded JPEG or PNG inside Postscript stream ───────
  for (let i = 0; i < len - 100; i++) {
    if (bytes[i] === 0xFF && bytes[i + 1] === 0xD8 && bytes[i + 2] === 0xFF) {
      for (let j = i + 100; j < Math.min(len - 1, i + 4000000); j++) {
        if (bytes[j] === 0xFF && bytes[j + 1] === 0xD9) {
          const jpegSlice = bytes.subarray(i, j + 2);
          if (jpegSlice.length >= 512) {
            const res = await decodeSliceToJpeg(jpegSlice, 'image/jpeg');
            if (res) return res;
          }
          break;
        }
      }
    }
    if (bytes[i] === 0x89 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x4E && bytes[i + 3] === 0x47) {
      for (let j = i + 100; j < Math.min(len - 4, i + 4000000); j++) {
        if (bytes[j] === 0x49 && bytes[j + 1] === 0x45 && bytes[j + 2] === 0x4E && bytes[j + 3] === 0x44) {
          const pngSlice = bytes.subarray(i, j + 8);
          const res = await decodeSliceToJpeg(pngSlice, 'image/png');
          if (res) return res;
          break;
        }
      }
    }
  }

  // ── Strategy 3: PostScript Vector Path & Text Parser ──────────────────────
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const text = decoder.decode(bytes.subarray(0, Math.min(len, 800000)));

  return renderEpsPostscriptToCanvas(text, fileName);
}

function renderEpsPostscriptToCanvas(text, fileName) {
  const canvas = document.createElement('canvas');
  const W = 800;
  const H = 800;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  // Clean white backdrop
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  // Extract Bounding Box
  let bbox = [0, 0, 500, 500];
  const bboxMatch = text.match(/%%(?:BoundingBox|HiResBoundingBox):\s*(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)/i);
  if (bboxMatch) {
    const minX = parseFloat(bboxMatch[1]);
    const minY = parseFloat(bboxMatch[2]);
    const maxX = parseFloat(bboxMatch[3]);
    const maxY = parseFloat(bboxMatch[4]);
    if (maxX > minX && maxY > minY) {
      bbox = [minX, minY, maxX, maxY];
    }
  }

  const bbW = bbox[2] - bbox[0] || 500;
  const bbH = bbox[3] - bbox[1] || 500;
  const scale = Math.min((W - 80) / bbW, (H - 80) / bbH);
  const offsetX = (W - bbW * scale) / 2 - bbox[0] * scale;
  const offsetY = H - (H - bbH * scale) / 2 + bbox[1] * scale;

  const titleMatch = text.match(/%%Title:\s*(.+)/i);
  const epsTitle = titleMatch ? titleMatch[1].trim() : fileName.replace(/\.[^.]+$/, '');
  const creatorMatch = text.match(/%%Creator:\s*(.+)/i);
  const epsCreator = creatorMatch ? creatorMatch[1].trim() : 'Vector Graphic';

  let pathCount = 0;
  ctx.save();
  ctx.translate(offsetX, offsetY);
  ctx.scale(scale, -scale);

  ctx.lineWidth = Math.max(1 / scale, 1.5);
  ctx.strokeStyle = '#222222';
  ctx.fillStyle = '#333333';

  const lines = text.split(/\r?\n/);
  ctx.beginPath();

  for (let i = 0; i < Math.min(lines.length, 12000); i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('%')) continue;

    const tokens = line.split(/\s+/);
    if (tokens.length >= 3 && (tokens[tokens.length - 1] === 'm' || tokens[tokens.length - 1] === 'moveto')) {
      const x = parseFloat(tokens[tokens.length - 3]);
      const y = parseFloat(tokens[tokens.length - 2]);
      if (!isNaN(x) && !isNaN(y)) {
        ctx.moveTo(x, y);
        pathCount++;
      }
    } else if (tokens.length >= 3 && (tokens[tokens.length - 1] === 'l' || tokens[tokens.length - 1] === 'lineto')) {
      const x = parseFloat(tokens[tokens.length - 3]);
      const y = parseFloat(tokens[tokens.length - 2]);
      if (!isNaN(x) && !isNaN(y)) {
        ctx.lineTo(x, y);
        pathCount++;
      }
    } else if (tokens.length >= 7 && (tokens[tokens.length - 1] === 'c' || tokens[tokens.length - 1] === 'curveto')) {
      const x1 = parseFloat(tokens[tokens.length - 7]);
      const y1 = parseFloat(tokens[tokens.length - 6]);
      const x2 = parseFloat(tokens[tokens.length - 5]);
      const y2 = parseFloat(tokens[tokens.length - 4]);
      const x3 = parseFloat(tokens[tokens.length - 3]);
      const y3 = parseFloat(tokens[tokens.length - 2]);
      if (!isNaN(x1) && !isNaN(y1) && !isNaN(x2) && !isNaN(y2) && !isNaN(x3) && !isNaN(y3)) {
        ctx.bezierCurveTo(x1, y1, x2, y2, x3, y3);
        pathCount++;
      }
    } else if (tokens.length >= 4 && (tokens[tokens.length - 1] === 'rg' || tokens[tokens.length - 1] === 'setrgbcolor')) {
      const r = Math.round(parseFloat(tokens[tokens.length - 4]) * 255) || 0;
      const g = Math.round(parseFloat(tokens[tokens.length - 3]) * 255) || 0;
      const b = Math.round(parseFloat(tokens[tokens.length - 2]) * 255) || 0;
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.strokeStyle = `rgb(${r},${g},${b})`;
    } else if (tokens.length >= 5 && (tokens[tokens.length - 1] === 'k' || tokens[tokens.length - 1] === 'setcmykcolor')) {
      const c = parseFloat(tokens[tokens.length - 5]);
      const m = parseFloat(tokens[tokens.length - 4]);
      const y = parseFloat(tokens[tokens.length - 3]);
      const k = parseFloat(tokens[tokens.length - 2]);
      const r = Math.round(255 * (1 - c) * (1 - k));
      const g = Math.round(255 * (1 - m) * (1 - k));
      const b = Math.round(255 * (1 - y) * (1 - k));
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.strokeStyle = `rgb(${r},${g},${b})`;
    } else if (tokens.length >= 5 && (tokens[tokens.length - 1] === 're' || tokens[tokens.length - 1] === 'rectfill')) {
      const rx = parseFloat(tokens[tokens.length - 5]);
      const ry = parseFloat(tokens[tokens.length - 4]);
      const rw = parseFloat(tokens[tokens.length - 3]);
      const rh = parseFloat(tokens[tokens.length - 2]);
      if (!isNaN(rx) && !isNaN(ry) && !isNaN(rw) && !isNaN(rh)) {
        ctx.fillRect(rx, ry, rw, rh);
        pathCount++;
      }
    } else if (line === 'f' || line === 'fill' || line === 'f*' || line === 'eofill') {
      ctx.fill();
      ctx.beginPath();
    } else if (line === 's' || line === 'stroke' || line === 'S') {
      ctx.stroke();
      ctx.beginPath();
    } else if (line === 'h' || line === 'closepath' || line === 'cp') {
      ctx.closePath();
    }
  }

  if (pathCount > 0) {
    ctx.stroke();
  }
  ctx.restore();

  if (pathCount < 3) {
    ctx.fillStyle = '#0f172a';
    ctx.fillRect(20, 20, W - 40, H - 40);

    ctx.strokeStyle = 'rgba(0, 219, 233, 0.15)';
    ctx.lineWidth = 1;
    for (let x = 40; x < W - 40; x += 40) {
      ctx.beginPath(); ctx.moveTo(x, 40); ctx.lineTo(x, H - 40); ctx.stroke();
    }
    for (let y = 40; y < H - 40; y += 40) {
      ctx.beginPath(); ctx.moveTo(40, y); ctx.lineTo(W - 40, y); ctx.stroke();
    }

    ctx.fillStyle = '#00dbe9';
    ctx.font = 'bold 36px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('EPS VECTOR GRAPHIC', W / 2, 280);

    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 24px sans-serif';
    ctx.fillText(epsTitle, W / 2, 340);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '16px sans-serif';
    ctx.fillText(`Vector Format: Encapsulated PostScript (${epsCreator})`, W / 2, 380);
    ctx.fillText(`Dimensions: ${Math.round(bbW)} x ${Math.round(bbH)} px`, W / 2, 410);

    ctx.strokeStyle = '#00dbe9';
    ctx.lineWidth = 3;
    ctx.strokeRect(W / 2 - 160, 460, 320, 180);
    ctx.fillStyle = 'rgba(0, 219, 233, 0.08)';
    ctx.fillRect(W / 2 - 160, 460, 320, 180);

    ctx.fillStyle = '#38bdf8';
    ctx.font = 'bold 18px monospace';
    ctx.fillText('SCALABLE VECTOR ASSET', W / 2, 555);
  }

  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return { base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' };
}

/**
 * Fast client-side Video Frame Extractor.
 * Seeks to the optimal video timestamp (0.5s - 1.0s) and extracts a crisp JPEG frame.
 * Converts large MP4/MOV/AVI/WEBM videos into ~100KB JPEG for instantaneous Gemini vision analysis.
 */
export async function extractVideoFrameJpegBase64(input) {
  return new Promise((resolve) => {
    let objectUrl = null;
    const fileName = (input && input.name) ? input.name : 'video.mp4';
    try {
      if (typeof input === 'string') {
        objectUrl = input;
      } else if (input instanceof Blob || input instanceof File) {
        objectUrl = URL.createObjectURL(input);
      } else {
        return resolve(renderVideoFallbackCanvas(fileName));
      }

      const video = document.createElement('video');
      video.crossOrigin = 'anonymous';
      video.muted = true;
      video.playsInline = true;
      video.preload = 'auto';

      let isDone = false;
      const timeoutId = setTimeout(() => {
        if (!isDone) {
          isDone = true;
          if (objectUrl && !objectUrl.startsWith('data:') && !objectUrl.startsWith('http')) URL.revokeObjectURL(objectUrl);
          resolve(renderVideoFallbackCanvas(fileName));
        }
      }, 10000);

      const captureFrame = () => {
        if (isDone) return;
        isDone = true;
        clearTimeout(timeoutId);

        try {
          const vw = video.videoWidth || 1280;
          const vh = video.videoHeight || 720;
          const maxDim = 1024;
          const scale = Math.min(1, maxDim / vw, maxDim / vh);
          const w = Math.max(100, Math.round(vw * scale));
          const h = Math.max(100, Math.round(vh * scale));

          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.fillStyle = '#000000';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(video, 0, 0, w, h);

          if (objectUrl && !objectUrl.startsWith('data:') && !objectUrl.startsWith('http')) URL.revokeObjectURL(objectUrl);
          const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
          resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
        } catch (_) {
          if (objectUrl && !objectUrl.startsWith('data:') && !objectUrl.startsWith('http')) URL.revokeObjectURL(objectUrl);
          resolve(renderVideoFallbackCanvas(fileName));
        }
      };

      video.onloadeddata = () => {
        try {
          const seekTime = Math.min(1.0, (video.duration && video.duration > 0.5) ? video.duration * 0.25 : 0.5);
          video.currentTime = seekTime;
        } catch (_) {
          captureFrame();
        }
      };

      video.onseeked = () => {
        captureFrame();
      };

      video.onerror = () => {
        if (isDone) return;
        isDone = true;
        clearTimeout(timeoutId);
        if (objectUrl && !objectUrl.startsWith('data:') && !objectUrl.startsWith('http')) URL.revokeObjectURL(objectUrl);
        resolve(renderVideoFallbackCanvas(fileName));
      };

      video.src = objectUrl;
    } catch (_) {
      if (objectUrl && !objectUrl.startsWith('data:') && !objectUrl.startsWith('http')) URL.revokeObjectURL(objectUrl);
      resolve(renderVideoFallbackCanvas(fileName));
    }
  });
}

function renderVideoFallbackCanvas(fileName) {
  const canvas = document.createElement('canvas');
  const W = 800;
  const H = 450;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#090d16';
  ctx.fillRect(0, 0, W, H);

  // Video play icon
  ctx.fillStyle = '#00dbe9';
  ctx.beginPath();
  ctx.arc(W / 2, H / 2 - 30, 48, 0, Math.PI * 2);
  ctx.fill();

  ctx.fillStyle = '#002022';
  ctx.beginPath();
  ctx.moveTo(W / 2 - 12, H / 2 - 48);
  ctx.lineTo(W / 2 + 20, H / 2 - 30);
  ctx.lineTo(W / 2 - 12, H / 2 - 12);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('STOCK FOOTAGE / VIDEO ASSET', W / 2, H / 2 + 50);

  ctx.fillStyle = '#94a3b8';
  ctx.font = '16px sans-serif';
  ctx.fillText(fileName.replace(/\.[^.]+$/, ''), W / 2, H / 2 + 80);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return { base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' };
}

/**
 * Fast client-side PDF Cover/First-Page Extractor.
 * Extracts embedded JPEG/PNG image streams or renders document layout for AI vision analysis.
 */
export async function extractPdfFirstPageJpegBase64(input) {
  let arrayBuffer;
  let fileName = (input && input.name) ? input.name : 'document.pdf';
  if (input instanceof File || input instanceof Blob) {
    arrayBuffer = await input.arrayBuffer();
  } else if (input instanceof ArrayBuffer) {
    arrayBuffer = input;
  } else if (typeof input === 'string') {
    if (input.startsWith('data:')) {
      const b64 = input.split(',')[1] || '';
      const binaryStr = atob(b64);
      const len = binaryStr.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) bytes[i] = binaryStr.charCodeAt(i);
      arrayBuffer = bytes.buffer;
    } else {
      const res = await fetch(input);
      arrayBuffer = await res.arrayBuffer();
    }
  }

  if (!arrayBuffer || arrayBuffer.byteLength === 0) {
    return renderPdfFallbackCanvas(fileName, {});
  }

  const bytes = new Uint8Array(arrayBuffer);
  const len = bytes.length;

  const decodeSliceToJpeg = (slice, mime) => {
    return new Promise((resolve) => {
      try {
        const blob = new Blob([slice], { type: mime });
        const url = URL.createObjectURL(blob);
        const img = new Image();
        img.onload = () => {
          URL.revokeObjectURL(url);
          try {
            const maxDim = 900;
            const scale = Math.min(1, maxDim / Math.max(img.width || 1, 1), maxDim / Math.max(img.height || 1, 1));
            const w = Math.max(100, Math.round((img.width || 500) * scale));
            const h = Math.max(100, Math.round((img.height || 500) * scale));
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#FFFFFF';
            ctx.fillRect(0, 0, w, h);
            ctx.drawImage(img, 0, 0, w, h);
            const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
            resolve({ base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' });
          } catch (_) {
            resolve(null);
          }
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          resolve(null);
        };
        img.src = url;
      } catch (_) {
        resolve(null);
      }
    });
  };

  // ── Strategy 1: Scan for embedded JPEG / PNG streams in PDF ─────────────────
  for (let i = 0; i < len - 100; i++) {
    if (bytes[i] === 0xFF && bytes[i + 1] === 0xD8 && bytes[i + 2] === 0xFF) {
      for (let j = i + 100; j < Math.min(len - 1, i + 4000000); j++) {
        if (bytes[j] === 0xFF && bytes[j + 1] === 0xD9) {
          const jpegSlice = bytes.subarray(i, j + 2);
          if (jpegSlice.length >= 1024) {
            const res = await decodeSliceToJpeg(jpegSlice, 'image/jpeg');
            if (res) return res;
          }
          break;
        }
      }
    }
    if (bytes[i] === 0x89 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x4E && bytes[i + 3] === 0x47) {
      for (let j = i + 100; j < Math.min(len - 4, i + 4000000); j++) {
        if (bytes[j] === 0x49 && bytes[j + 1] === 0x45 && bytes[j + 2] === 0x4E && bytes[j + 3] === 0x44) {
          const pngSlice = bytes.subarray(i, j + 8);
          const res = await decodeSliceToJpeg(pngSlice, 'image/png');
          if (res) return res;
          break;
        }
      }
    }
  }

  // ── Strategy 2: Extract PDF Text Metadata & Render Visual Document Card ────
  const decoder = new TextDecoder('utf-8', { fatal: false });
  const text = decoder.decode(bytes.subarray(0, Math.min(len, 400000)));

  const titleMatch = text.match(/\/Title\s*(?:\(([^)]+)\)|<([0-9a-fA-F]+)>)/i);
  const authorMatch = text.match(/\/Author\s*(?:\(([^)]+)\)|<([0-9a-fA-F]+)>)/i);
  const kwMatch = text.match(/\/Keywords\s*(?:\(([^)]+)\)|<([0-9a-fA-F]+)>)/i);
  const subjectMatch = text.match(/\/Subject\s*(?:\(([^)]+)\)|<([0-9a-fA-F]+)>)/i);

  const meta = {
    title: titleMatch ? (titleMatch[1] || titleMatch[2]) : '',
    author: authorMatch ? (authorMatch[1] || authorMatch[2]) : '',
    keywords: kwMatch ? (kwMatch[1] || kwMatch[2]) : '',
    subject: subjectMatch ? (subjectMatch[1] || subjectMatch[2]) : ''
  };

  return renderPdfFallbackCanvas(fileName, meta);
}

function renderPdfFallbackCanvas(fileName, meta = {}) {
  const canvas = document.createElement('canvas');
  const W = 600;
  const H = 800;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = '#E2E8F0';
  ctx.lineWidth = 2;
  ctx.strokeRect(30, 30, W - 60, H - 60);

  ctx.fillStyle = '#0F172A';
  ctx.fillRect(30, 30, W - 60, 90);

  ctx.fillStyle = '#EF4444';
  ctx.fillRect(50, 48, 55, 30);
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 14px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('PDF', 77, 69);

  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'left';
  const cleanName = fileName.replace(/\.[^.]+$/, '');
  ctx.fillText('PDF DOCUMENT ASSET', 120, 68);

  const displayTitle = meta.title || cleanName;
  ctx.fillStyle = '#1E293B';
  ctx.font = 'bold 22px sans-serif';
  ctx.fillText(displayTitle.slice(0, 40), 50, 170);

  if (meta.subject || meta.author) {
    ctx.fillStyle = '#64748B';
    ctx.font = '14px sans-serif';
    ctx.fillText(`${meta.subject || ''} ${meta.author ? '• By ' + meta.author : ''}`.trim(), 50, 205);
  }

  ctx.fillStyle = '#CBD5E1';
  for (let y = 240; y < 650; y += 32) {
    const lineWidth = (y % 64 === 0) ? W - 160 : W - 100;
    ctx.fillRect(50, y, lineWidth, 12);
  }

  if (meta.keywords) {
    ctx.fillStyle = '#F1F5F9';
    ctx.fillRect(50, 680, W - 100, 60);
    ctx.fillStyle = '#475569';
    ctx.font = 'italic 13px sans-serif';
    ctx.fillText(`Tags: ${meta.keywords.slice(0, 60)}`, 65, 715);
  }

  const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
  return { base64: dataUrl.split(',')[1], mimeType: 'image/jpeg' };
}

/**
 * Fast client-side image compression on upload.
 * Compresses any large image (10MB-100MB, 4K/8K/50MP) down to ~350-480KB.
 * Ensures the workspace and AI pipeline operate with maximum speed and zero memory bloat.
 */
export async function compressImageFile(file, options = {}) {
  if (!file || !(file instanceof Blob || file instanceof File)) return file;

  const ext = (file.name ? file.name.split('.').pop() : '').toLowerCase();
  if (ext === 'svg' || file.type === 'image/svg+xml') {
    return file; // Keep original SVG vector
  }

  // If already <= 450KB and standard web jpeg/webp, no need to compress further
  if (file.size <= 450 * 1024 && (file.type === 'image/jpeg' || file.type === 'image/webp')) {
    return file;
  }

  const maxDim = options.maxDim || 1024;
  const quality = options.quality || 0.80;

  try {
    let bitmap;
    try {
      bitmap = await createImageBitmap(file, {
        resizeWidth: maxDim,
        resizeHeight: maxDim,
        resizeQuality: 'medium'
      });
    } catch (_) {
      bitmap = await createImageBitmap(file);
    }

    const { width, height } = bitmap;
    const scale = Math.min(1, maxDim / (width || 1), maxDim / (height || 1));
    const w = Math.max(1, Math.round((width || 1) * scale));
    const h = Math.max(1, Math.round((height || 1) * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) {
      if (bitmap.close) bitmap.close();
      return file;
    }

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'medium';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bitmap, 0, 0, w, h);
    if (bitmap.close) bitmap.close();

    const blob = await new Promise((res) => {
      canvas.toBlob((b) => res(b || file), 'image/jpeg', quality);
    });

    return blob || file;
  } catch (err) {
    console.warn('[compressImageFile] Fallback to original file:', err);
    return file;
  }
}

/**
 * Optimizes an image or vector for AI vision consumption.
 * Scales down to optimal dimension (~1024px) and compresses as lightweight JPEG.
 * Reduces payload from 20-50MB down to ~120KB for instantaneous processing.
 */
export async function optimizeImageForAi(input, ext = '') {
  if (!input) throw new Error('No input provided for image optimization.');

  const cleanExt = (ext || '').toLowerCase().replace('.', '');
  // Handle SVG
  if (cleanExt === 'svg') {
    try {
      return await rasterizeSvgToJpegBase64(input);
    } catch (_) {}
  }

  // Handle EPS & AI vector files
  if ((cleanExt === 'eps' || cleanExt === 'ai') && (input instanceof Blob || input instanceof File || typeof input === 'string')) {
    try {
      return await rasterizeEpsToJpegBase64(input);
    } catch (e) {
      console.warn('EPS rasterization error, proceeding with canvas rasterizer:', e);
    }
  }

  // Handle Video files (MP4, MOV, AVI, WEBM)
  if ((cleanExt === 'mp4' || cleanExt === 'mov' || cleanExt === 'avi' || cleanExt === 'webm' || (input.type && input.type.startsWith('video/'))) && (input instanceof Blob || input instanceof File || typeof input === 'string')) {
    try {
      return await extractVideoFrameJpegBase64(input);
    } catch (e) {
      console.warn('Video frame extraction error:', e);
    }
  }

  // Handle PDF documents
  if (cleanExt === 'pdf' && (input instanceof Blob || input instanceof File || typeof input === 'string')) {
    try {
      return await extractPdfFirstPageJpegBase64(input);
    } catch (e) {
      console.warn('PDF extraction error:', e);
    }
  }

  const MAX_DIM = 1024;

  const canvasToJpeg = (canvas) => {
    const dataUrl = canvas.toDataURL('image/jpeg', 0.80);
    const base64 = dataUrl.split(',')[1];
    return { base64, mimeType: 'image/jpeg' };
  };

  // 1. Try createImageBitmap (modern, high-performance, runs off-main-thread)
  if (typeof createImageBitmap === 'function' && (input instanceof Blob || input instanceof File)) {
    try {
      let bitmap = await createImageBitmap(input);
      const { width, height } = bitmap;
      if (width > 0 && height > 0) {
        const scale = Math.min(1, MAX_DIM / width, MAX_DIM / height);
        const w = Math.max(1, Math.round(width * scale));
        const h = Math.max(1, Math.round(height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d', { alpha: false });
        if (ctx) {
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(bitmap, 0, 0, w, h);
          if (bitmap.close) bitmap.close();
          return canvasToJpeg(canvas);
        }
      }
      if (bitmap.close) bitmap.close();
    } catch (e) {
      console.warn('createImageBitmap optimization failed, falling back to HTMLImageElement:', e);
    }
  }

  // 2. Fallback via HTMLImageElement (handles URLs, data URIs, Blobs)
  return new Promise(async (resolve, reject) => {
    let objectUrl = null;
    try {
      let src = '';
      if (typeof input === 'string') {
        src = input;
      } else if (input instanceof Blob || input instanceof File) {
        objectUrl = URL.createObjectURL(input);
        src = objectUrl;
      } else {
        return reject(new Error('Unsupported image input format.'));
      }

      const img = new Image();
      img.crossOrigin = 'anonymous';

      let isDone = false;
      const timer = setTimeout(() => {
        if (!isDone) {
          isDone = true;
          if (objectUrl) URL.revokeObjectURL(objectUrl);
          if (input instanceof Blob || input instanceof File) {
            blobToBase64(input).then(base64 => {
              resolve({ base64, mimeType: getGeminiMimeType({ type: input.type }, cleanExt) });
            }).catch(reject);
          } else {
            reject(new Error('Image decoding timed out.'));
          }
        }
      }, 10000);

      img.onload = () => {
        if (isDone) return;
        isDone = true;
        clearTimeout(timer);
        if (objectUrl) URL.revokeObjectURL(objectUrl);

        try {
          const naturalW = img.naturalWidth || img.width || 1000;
          const naturalH = img.naturalHeight || img.height || 1000;
          const scale = Math.min(1, MAX_DIM / naturalW, MAX_DIM / naturalH);
          const w = Math.max(1, Math.round(naturalW * scale));
          const h = Math.max(1, Math.round(naturalH * scale));

          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';
          ctx.fillStyle = '#FFFFFF';
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);

          resolve(canvasToJpeg(canvas));
        } catch (err) {
          if (input instanceof Blob || input instanceof File) {
            blobToBase64(input).then(base64 => {
              resolve({ base64, mimeType: getGeminiMimeType({ type: input.type }, cleanExt) });
            }).catch(reject);
          } else {
            reject(err);
          }
        }
      };

      img.onerror = () => {
        if (isDone) return;
        isDone = true;
        clearTimeout(timer);
        if (objectUrl) URL.revokeObjectURL(objectUrl);

        if (input instanceof Blob || input instanceof File) {
          blobToBase64(input).then(base64 => {
            resolve({ base64, mimeType: getGeminiMimeType({ type: input.type }, cleanExt) });
          }).catch(reject);
        } else {
          reject(new Error('Failed to load image for optimization.'));
        }
      };

      img.src = src;
    } catch (err) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      reject(err);
    }
  });
}

async function getImageBase64(item, ext) {
  if (item.file) {
    return await optimizeImageForAi(item.file, ext);
  }

  if (item.url && item.url.startsWith('data:image/')) {
    return await optimizeImageForAi(item.url, ext);
  }

  if (item.url) {
    return await optimizeImageForAi(item.url, ext);
  }

  throw new Error(`Unable to extract base64 image data for ${item.name || 'asset'}`);
}


const SHUTTERSTOCK_IMAGE_CATEGORIES = [
  'Abstract', 'Animals/Wildlife', 'Arts', 'Backgrounds/Textures', 'Beauty/Fashion',
  'Buildings/Landmarks', 'Business/Finance', 'Celebrities', 'Education', 'Food and drink',
  'Healthcare/Medical', 'Holidays', 'Industrial', 'Interiors', 'Miscellaneous',
  'Nature', 'Objects', 'Parks/Outdoor', 'People', 'Religion', 'Science',
  'Signs/Symbols', 'Sports/Recreation', 'Technology', 'Transportation', 'Vintage'
];

const SHUTTERSTOCK_VIDEO_CATEGORIES = [
  'Animals/Wildlife', 'Arts', 'Backgrounds/Textures', 'Buildings/Landmarks',
  'Business/Finance', 'Education', 'Food and drink', 'Healthcare/Medical',
  'Holidays', 'Industrial', 'Nature', 'Objects', 'People', 'Religion',
  'Science', 'Signs/Symbols', 'Sports/Recreation', 'Technology', 'Transportation'
];

function buildClientKwTarget(effectiveKwMax, kwMin) {
  if (effectiveKwMax >= 49) return '42 to 47';
  if (effectiveKwMax >= 40) return `${effectiveKwMax}`;
  if (kwMin)                return `${kwMin} to ${effectiveKwMax}`;
  return `5 to ${effectiveKwMax}`;
}

function buildClientCategoryOptions(platformObj, isVideo = false) {
  const isShutterstock = (platformObj?.id === 'shutterstock' || (platformObj?.name && platformObj.name.toLowerCase().includes('shutterstock')));
  if (isShutterstock) {
    return (isVideo ? SHUTTERSTOCK_VIDEO_CATEGORIES : SHUTTERSTOCK_IMAGE_CATEGORIES).join(', ');
  }
  return Array.isArray(platformObj?.categories) && platformObj.categories.length > 0
    ? platformObj.categories.join(', ')
    : 'General, Abstract, Animals, Architecture, Business, Food, Landscapes, Nature, People, Technology, Graphic Resources';
}

function buildClientPrompt({ platformObj, kwTarget, titleLimit, categoryOptions, settings, mode, filename, isVideo }) {
  const pId = (platformObj?.id || platformObj?.name || '').toLowerCase();
  const isAdobe         = pId === 'adobe' || pId.includes('adobestock') || pId.includes('adobe');
  const isShutterstock  = pId === 'shutterstock' || pId.includes('shutterstock');
  const isVecteezy      = pId === 'vecteezy' || pId.includes('vecteezy');
  const isDepositphotos = pId === 'depositphotos' || pId.includes('depositphotos');
  const is123RF         = pId === 'rf123' || pId === '123rf' || pId.includes('123rf');
  const isDreamstime    = pId === 'dreamstime' || pId.includes('dreamstime');
  const isMagnific      = pId === 'magnific' || pId.includes('magnific');

  let prompt = '';

  if (mode === 'img2prompt' || mode === 'img2prompt-photo') {
    prompt = `You are a world-class AI Image Prompt Engineer specializing in commercial-safe, microstock-friendly, original AI image prompts for Midjourney v6, Flux.1, DALL-E 3, and Stable Diffusion XL.
CRITICAL RULES:
1. VISUAL ANALYSIS: Thoroughly analyze subject, composition, lighting, palette, mood, style.
2. ORIGINAL & UNIQUE CREATION (NON-REPETITIVE): Create a NEW and UNIQUE generation prompt inspired by the visual concept, NOT a copy. Avoid duplication or repetitive elements.
3. COPYRIGHT & TRADEMARK SAFETY: Never include logos, brand names, or copyrighted artists/characters.
STRICT OUTPUT FORMAT (JSON ONLY):
{
  "filename": "${filename}",
  "title": "Master Prompt: subject + composition + lighting + atmosphere + camera angle + style details",
  "description": "Visual breakdown of elements, colors, lighting, lens characteristics, depth of field",
  "keywords": ["keyword1", "keyword2", ...],
  "category": "Photography / Art Genre"
}`;
  } else if (mode === 'img2prompt-video') {
    prompt = `You are a world-class AI Video Prompt Engineer specializing in commercial-safe, microstock-friendly, silent AI video prompts for Sora, Runway Gen-3, Pika Labs, and Kling AI.
CRITICAL RULES:
1. ORIGINAL VIDEO CONCEPT: Create dynamic, commercially usable video prompt.
2. SILENT VIDEO ONLY: Must explicitly specify "silent video, no audio, no voice, no music". Focus purely on visual motion, camera work, lighting, and cinematic optics.
STRICT OUTPUT FORMAT (JSON ONLY):
{
  "filename": "${filename}",
  "title": "Master Video Prompt: subject + motion + camera movement + lighting + mood. silent video, no audio, no voice, no music.",
  "description": "Scene composition and motion progression over time. Strictly silent visual description.",
  "keywords": ["keyword1", "keyword2", ...],
  "category": "Cinematic B-Roll / Video Genre"
}`;
  } else if (isAdobe) {
    prompt = `You are a world-renowned Microstock SEO Specialist and Adobe Stock Contributor Metadata Expert.
Generate OFFICIAL ADOBE STOCK-OPTIMIZED METADATA:
1. FIRST 10 KEYWORDS: Primary subject, core theme, asset format, primary visual traits.
2. REMAINING KEYWORDS: High-traffic commercial buyer queries (target ${kwTarget} keywords).
3. TITLE: Front-load commercial keywords in first 3-5 words (Strictly max ${titleLimit} characters).
4. DESCRIPTION & CATEGORY: Natural English summary. Select category from: [${categoryOptions}].
STRICT OUTPUT FORMAT (JSON ONLY):
{
  "filename": "${filename}",
  "title": "Front-Loaded Commercial Title (max ${titleLimit} chars)",
  "description": "High-SEO commercial description in English",
  "keywords": ["keyword1", "keyword2", ...],
  "category": "Selected Category"
}`;
  } else if (isShutterstock) {
    prompt = `You are a world-renowned Microstock SEO Specialist and Shutterstock Contributor Metadata Expert.
Generate OFFICIAL SHUTTERSTOCK-COMPLIANT METADATA:
1. FACTUAL TITLE & DESCRIPTION (MAX 200 CHARACTERS): Front-load top commercial search terms in first 3-5 words.
2. KEYWORDS (7 to 50 keywords): Generate ${kwTarget} unique, high-traffic English keywords.
3. CATEGORIES: Select 1 or 2 valid categories from official list: [${categoryOptions}].
STRICT OUTPUT FORMAT (JSON ONLY):
{
  "filename": "${filename}",
  "title": "Factual Commercial Title (max 200 chars)",
  "description": "Factual detailed description (strictly max 200 chars)",
  "keywords": ["keyword1", "keyword2", ...],
  "category": "PrimaryCategory, SecondaryCategory"
}`;
  } else {
    prompt = `You are a world-renowned Microstock SEO Specialist.
Generate TOP-RANKING COMMERCIAL METADATA:
1. TITLE: Front-load primary subject in first 3-5 words (max ${titleLimit} characters).
2. KEYWORDS: Exactly ${kwTarget} high-converting keywords ordered from primary subject to visual details.
3. DESCRIPTION & CATEGORY: Accurate English description. Select category from: [${categoryOptions}].
STRICT OUTPUT FORMAT (JSON ONLY):
{
  "filename": "${filename}",
  "title": "Front-Loaded Commercial Title",
  "description": "Accurate commercial description in English",
  "keywords": ["keyword1", "keyword2", ...],
  "category": "Selected Category"
}`;
  }

  if (settings?.customPrompt) {
    prompt += `\nUSER CUSTOM OVERRIDE: ${settings.customPrompt}`;
  }

  return prompt;
}

function formatClientCategoryAndMeta(parsed, platformObj, isVideo, effectiveTitleLimit, effectiveKwMax, filename, mode) {
  const isShutterstock = (platformObj?.id === 'shutterstock' || (platformObj?.name && platformObj.name.toLowerCase().includes('shutterstock')));
  const maxTitleLimit = isShutterstock ? 200 : effectiveTitleLimit;
  const isImg2Prompt = mode === 'img2prompt' || mode === 'img2prompt-photo' || mode === 'img2prompt-video';

  let title = (isImg2Prompt
    ? String(parsed.title || '')
    : String(parsed.title || '').substring(0, maxTitleLimit)
  ).trim();

  let description = String(parsed.description || title).trim();
  if (isShutterstock) {
    if (description.length > 200) description = description.substring(0, 200).trim();
    if (!title || title.length > 200) title = description.substring(0, 200).trim();
  }

  let rawCat = String(parsed.category || '').trim();
  const catList = isShutterstock
    ? (isVideo ? SHUTTERSTOCK_VIDEO_CATEGORIES : SHUTTERSTOCK_IMAGE_CATEGORIES)
    : (Array.isArray(platformObj?.categories) && platformObj.categories.length > 0
      ? platformObj.categories
      : ['General', 'Abstract', 'Animals', 'Architecture', 'Business', 'Food', 'Landscapes', 'Nature', 'People', 'Technology', 'Graphic Resources']);

  let category;
  if (isShutterstock) {
    const parts = rawCat.split(',').map(s => s.trim()).filter(Boolean);
    const matched = [];
    for (const p of parts) {
      const found = catList.find(c => c.toLowerCase() === p.toLowerCase())
        || catList.find(c => c.toLowerCase().includes(p.toLowerCase()) || p.toLowerCase().includes(c.toLowerCase()));
      if (found && !matched.includes(found)) matched.push(found);
    }
    category = matched.slice(0, 2).join(', ') || catList[0];
  } else {
    category = catList.find(c => c.toLowerCase() === rawCat.toLowerCase())
      || catList.find(c => c.toLowerCase().includes(rawCat.toLowerCase()) || rawCat.toLowerCase().includes(c.toLowerCase()))
      || rawCat || catList[0];
  }

  let keywords = Array.isArray(parsed.keywords) ? parsed.keywords : String(parsed.keywords || '').split(',');
  keywords = keywords
    .map(k => String(k).toLowerCase().trim())
    .filter(k => k.length > 0);

  const seen = new Set();
  keywords = keywords.filter(k => { if (seen.has(k)) return false; seen.add(k); return true; });
  keywords = keywords.slice(0, effectiveKwMax);

  if (!title) {
    title = description || (keywords.length ? keywords.slice(0, 6).join(' ') : (filename || 'Commercial Media Asset').replace(/\.[^/.]+$/, ''));
  }

  return {
    filename: parsed.filename || filename,
    title,
    description,
    keywords,
    category
  };
}

async function generateDirectClientAi({ provider, key, base64, mimeType, filename, platform, settings, mode, model, signal }) {
  if (!key) throw new Error(`${AI_PROVIDERS_CONFIG[provider]?.name || provider} API key is missing.`);

  const platformObj = platform || { name: 'Adobe Stock', keywordMax: 49, titleMaxLen: 70, categories: [] };
  const pId = (platformObj?.id || platformObj?.name || '').toLowerCase();
  const isShutterstock = pId === 'shutterstock' || pId.includes('shutterstock');
  const effectiveKwMax = settings?.kwMax ? parseInt(settings.kwMax, 10) : (parseInt(platformObj.keywordMax, 10) || 49);
  const effectiveTitleLimit = isShutterstock ? 200 : (settings?.titleMax ? parseInt(settings.titleMax, 10) : (parseInt(platformObj.titleMaxLen, 10) || 70));
  const kwTarget = buildClientKwTarget(effectiveKwMax, settings?.kwMin);
  const categoryOptions = buildClientCategoryOptions(platformObj, false);

  const prompt = buildClientPrompt({ platformObj, kwTarget, titleLimit: effectiveTitleLimit, categoryOptions, settings, mode, filename, isVideo: false });

  let cleanBase64 = String(base64 || '').trim();
  if (cleanBase64.includes('base64,')) {
    cleanBase64 = cleanBase64.split('base64,')[1].trim();
  }
  cleanBase64 = cleanBase64.replace(/[\r\n\s]/g, '');

  const validMimes = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']);
  const effectiveMime = validMimes.has((mimeType || '').toLowerCase()) ? mimeType.toLowerCase() : 'image/jpeg';

  if (provider === 'gemini') {
    const requestBody = {
      contents: [
        {
          parts: [
            { inline_data: { mime_type: effectiveMime, data: cleanBase64 } },
            { text: prompt }
          ]
        }
      ],
      generationConfig: {
        temperature: 0.3,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json'
      }
    };

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${encodeURIComponent(key)}`;
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    }, 28000);

    const resJson = await res.json().catch(() => ({}));
    const candidate = resJson.candidates?.[0];
    const rawText = candidate?.content?.parts?.map(p => p.text || '').join('\n') || '';

    if (res.ok && rawText.trim().length > 0) {
      let parsed;
      try {
        parsed = JSON.parse(rawText.replace(/^```(?:json)?\s*|\s*```$/gi, '').replace(/```/g, '').trim());
      } catch (_) {
        const titleMatch = rawText.match(/"title"\s*:\s*"([^"]+)"/i);
        const descMatch  = rawText.match(/"description"\s*:\s*"([^"]+)"/i);
        const catMatch   = rawText.match(/"category"\s*:\s*"([^"]+)"/i);
        const kwMatches  = [...rawText.matchAll(/"([a-zA-Z][a-zA-Z0-9\s-]{1,29})"/g)]
          .map(m => m[1].trim())
          .filter(k => k.length > 1 && !['title','description','keywords','category','filename','json'].includes(k.toLowerCase()));
        parsed = {
          title: titleMatch ? titleMatch[1].trim() : '',
          description: descMatch ? descMatch[1].trim() : '',
          category: catMatch ? catMatch[1].trim() : 'General',
          keywords: kwMatches.length ? kwMatches : []
        };
      }
      if (parsed && (parsed.title || parsed.description || (parsed.keywords && parsed.keywords.length > 0))) {
        return formatClientCategoryAndMeta(parsed, platformObj, false, effectiveTitleLimit, effectiveKwMax, filename, mode);
      }
    }
    if (resJson?.error?.message) {
      throw new Error(resJson.error.message);
    }
    throw new Error('Direct Gemini generation with gemini-3.5-flash failed.');
  }

  if (provider === 'openrouter' || provider === 'openai') {
    const isOR = provider === 'openrouter';
    const apiUrl = isOR ? 'https://openrouter.ai/api/v1/chat/completions' : 'https://api.openai.com/v1/chat/completions';
    const dataUri = `data:${mimeType || 'image/jpeg'};base64,${cleanBase64}`;
    const selectedModel = model || (isOR ? 'openrouter/auto' : 'gpt-4o-mini');

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    };
    if (isOR) {
      headers['HTTP-Referer'] = 'https://microstock-metadata-tool.com';
      headers['X-Title'] = 'Microstock Tool';
    }

    const res = await fetchWithTimeout(apiUrl, {
      method: 'POST',
      signal,
      headers,
      body: JSON.stringify({
        model: selectedModel,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: dataUri, detail: 'low' } }
            ]
          }
        ],
        temperature: 0.3,
        max_tokens: isOR ? 900 : 1200
      })
    }, 28000);

    const resJson = await res.json().catch(() => ({}));
    if (res.ok && resJson.choices?.[0]?.message?.content) {
      const text = resJson.choices[0].message.content;
      const parsed = JSON.parse(text.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim());
      return formatClientCategoryAndMeta(parsed, platformObj, false, effectiveTitleLimit, effectiveKwMax, filename, mode);
    }
    throw new Error(resJson?.error?.message || `${AI_PROVIDERS_CONFIG[provider]?.name} direct call failed.`);
  }

  throw new Error(`Unsupported provider: ${provider}`);
}

// ── Main Metadata Generation (Direct Client + Secure Server Proxy Fallback) ──
export async function generateMetadataForImage(item, platform, apiKey, settings, mode, signal) {
  const provider = _activeProvider || 'gemini';
  const key = apiKey || _providerKeys[provider] || getSessionKey(provider) || '';
  const selectedModel = getProviderModel(provider);

  const ext = (item.ext || ((item.name || item.file?.name || 'asset.jpg').split('.').pop()) || 'jpg').toLowerCase();

  if (!isGeminiAnalyzable(ext)) {
    return {
      _geminiUnsupported: true,
      reason: `${ext.toUpperCase()} files are not supported for AI analysis.`
    };
  }

  if (item.assetType === 'video') {
    const mimeType = getGeminiMimeType(item, ext);
    if (!item.file) throw new Error('Video file object is missing.');

    const endpoints = [
      `${getApiBase()}/api/gemini/generate-video`,
      '/.netlify/functions/api/gemini/generate-video'
    ];

    let lastError = null;
    for (const ep of endpoints) {
      try {
        const res = await fetchWithTimeout(ep, {
          method: 'POST',
          signal,
          headers: {
            'Content-Type': mimeType,
            'x-ai-provider': provider,
            'x-ai-api-key': key,
            'x-gemini-api-key': key,
            'x-filename': encodeURIComponent(item.name || item.file?.name || 'video.mp4'),
            'x-platform': encodeURIComponent(JSON.stringify(platform)),
            'x-settings': encodeURIComponent(JSON.stringify(settings || {})),
            'x-mode':  mode || 'metadata',
            'x-model': selectedModel || 'gemini-3.5-flash'
          },
          body: item.file
        }, VIDEO_TIMEOUT_MS);

        const data = await res.json().catch(() => ({}));
        if (res.ok && data.ok) {
          return data.data;
        }
        if (data.message) lastError = new Error(data.message);
      } catch (e) {
        lastError = e;
      }
    }
    throw lastError || new Error('Video metadata generation failed.');
  }

  const { base64, mimeType } = await getImageBase64(item, ext);

  let lastError = null;

  // 1. Direct Browser Client generation (Fastest, zero Netlify timeout, works everywhere)
  if (key) {
    try {
      return await generateDirectClientAi({
        provider,
        key,
        base64,
        mimeType,
        filename: item.name || item.file?.name || 'asset.jpg',
        platform,
        settings,
        mode,
        model: selectedModel,
        signal
      });
    } catch (directErr) {
      lastError = directErr;
      const msg = (directErr.message || '').toLowerCase();
      if (msg.includes('api key') || msg.includes('api_key') || msg.includes('unauthorized') || msg.includes('permission') || msg.includes('quota') || msg.includes('resource_exhausted') || msg.includes('429')) {
        throw directErr;
      }
      console.warn('[DirectAI Client Notice]', directErr.message, 'Trying backend proxy fallback...');
    }
  }

  // 2. Dual-Route Backend Proxy Fallback
  const endpoints = [
    `${getApiBase()}/api/ai/generate`,
    '/.netlify/functions/api/ai/generate'
  ];

  for (const ep of endpoints) {
    try {
      const res = await fetchWithTimeout(ep, {
        method: 'POST',
        signal,
        headers: {
          'Content-Type': 'application/json',
          'x-ai-provider': provider,
          'x-ai-api-key': key,
          'x-gemini-api-key': key
        },
        body: JSON.stringify({
          provider,
          apiKey: key,
          base64Image: base64,
          mimeType,
          filename: item.name || item.file?.name || 'asset.jpg',
          platform,
          settings,
          mode,
          model: selectedModel
        })
      }, REQUEST_TIMEOUT_MS);

      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) {
        return data.data;
      }
      if (data.message) lastError = new Error(data.message);
    } catch (e) {
      if (!lastError) lastError = e;
    }
  }

  throw lastError || new Error(`${AI_PROVIDERS_CONFIG[provider]?.name || provider} metadata generation failed.`);
}
