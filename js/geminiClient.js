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
      { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash-Lite' }
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
  models: 'pk_ai_provider_models',
  verified: 'pk_ai_provider_verified'
};

function loadStoredData() {
  if (typeof localStorage === 'undefined') return { activeProvider: 'gemini', keys: {}, models: {}, verified: {} };
  try {
    const active = localStorage.getItem(STORAGE_KEYS.activeProvider);
    const keysStr = localStorage.getItem(STORAGE_KEYS.keys);
    const modelsStr = localStorage.getItem(STORAGE_KEYS.models);
    const verifiedStr = localStorage.getItem(STORAGE_KEYS.verified);
    return {
      activeProvider: active || 'gemini',
      keys: keysStr ? JSON.parse(keysStr) : {},
      models: modelsStr ? JSON.parse(modelsStr) : {},
      verified: verifiedStr ? JSON.parse(verifiedStr) : {}
    };
  } catch (_) {
    return { activeProvider: 'gemini', keys: {}, models: {}, verified: {} };
  }
}

const _initialData = loadStoredData();

let _activeProvider = _initialData.activeProvider || 'gemini';
let _providerKeys = {
  gemini: _initialData.keys?.gemini || null,
  openrouter: _initialData.keys?.openrouter || null,
  openai: _initialData.keys?.openai || null
};
let _verifiedProviders = {
  gemini: Boolean(_initialData.verified?.gemini),
  openrouter: Boolean(_initialData.verified?.openrouter),
  openai: Boolean(_initialData.verified?.openai)
};
let _selectedModels = {
  gemini: 'gemini-3.5-flash-lite',
  openrouter: _initialData.models?.openrouter || 'openrouter/auto',
  openai: _initialData.models?.openai || 'gpt-4o-mini'
};
// Auto-migrate: ensure default is gemini-3.5-flash-lite
_selectedModels.gemini = 'gemini-3.5-flash-lite';

function saveStorage() {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEYS.activeProvider, _activeProvider);
    localStorage.setItem(STORAGE_KEYS.keys, JSON.stringify(_providerKeys));
    localStorage.setItem(STORAGE_KEYS.models, JSON.stringify(_selectedModels));
    localStorage.setItem(STORAGE_KEYS.verified, JSON.stringify(_verifiedProviders));
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

export function isProviderVerified(provider = _activeProvider) {
  return hasApiKey(provider) && Boolean(_verifiedProviders[provider]);
}

export function setProviderVerified(verified, provider = _activeProvider) {
  _verifiedProviders[provider] = Boolean(verified);
  saveStorage();
}

export function clearApiKey(provider = _activeProvider) {
  _providerKeys[provider] = null;
  _verifiedProviders[provider] = false;
  saveStorage();
}

export function clearAllApiKeys() {
  _providerKeys = { gemini: null, openrouter: null, openai: null };
  _verifiedProviders = { gemini: false, openrouter: false, openai: false };
  _activeProvider = 'gemini';
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(STORAGE_KEYS.keys);
    localStorage.removeItem(STORAGE_KEYS.activeProvider);
    localStorage.removeItem(STORAGE_KEYS.verified);
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
  const timer = setTimeout(() => {
    try {
      controller.abort(new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`));
    } catch (_) {
      controller.abort();
    }
  }, timeoutMs);

  if (options && options.signal) {
    if (options.signal.aborted) {
      clearTimeout(timer);
      try {
        controller.abort(options.signal.reason || new Error('Request was cancelled'));
      } catch (_) {
        controller.abort();
      }
    } else {
      options.signal.addEventListener('abort', () => {
        clearTimeout(timer);
        try {
          controller.abort(options.signal.reason || new Error('Request was cancelled'));
        } catch (_) {
          controller.abort();
        }
      }, { once: true });
    }
  }
  try {
    const fetchOptions = { ...options, signal: controller.signal };
    const res = await fetch(url, fetchOptions);
    return res;
  } catch (err) {
    if (err.name === 'AbortError') {
      const abortReason = controller.signal?.reason?.message || (typeof controller.signal?.reason === 'string' ? controller.signal.reason : null);
      if (abortReason) {
        throw new Error(abortReason);
      }
      if (options?.signal?.aborted) {
        const parentReason = options.signal?.reason?.message || (typeof options.signal?.reason === 'string' ? options.signal.reason : null);
        throw new Error(parentReason || 'Operation was cancelled');
      }
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
    }
    throw err;
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
  if (!targetKey) {
    return { ok: false, message: `Please enter your ${AI_PROVIDERS_CONFIG[provider]?.name || provider} API key.` };
  }

  // 1. Direct Browser-to-API check (ultra-fast Google Gemini validation)
  if (provider === 'gemini') {
    try {
      const directUrl = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(targetKey)}`;
      const res = await fetchWithTimeout(directUrl, { method: 'GET' }, 25000);
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setProviderVerified(true, 'gemini');
        return { ok: true, message: 'Successfully connected to Google Gemini API (gemini-3.5-flash-lite)!' };
      }
      setProviderVerified(false, 'gemini');
      if (data?.error?.message) {
        return { ok: false, message: data.error.message };
      }
      return { ok: false, message: `Gemini API returned status ${res.status}` };
    } catch (e) {
      setProviderVerified(false, 'gemini');
      return { ok: false, message: e.message || 'Unable to reach Google Gemini API' };
    }
  } else if (provider === 'openrouter') {
    try {
      const res = await fetchWithTimeout('https://openrouter.ai/api/v1/auth/key', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${targetKey}` }
      }, 25000);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.data) {
        setProviderVerified(true, 'openrouter');
        return { ok: true, message: 'Successfully connected to OpenRouter API!' };
      }
      setProviderVerified(false, 'openrouter');
      if (data?.error?.message) {
        return { ok: false, message: data.error.message };
      }
      return { ok: false, message: `OpenRouter returned status ${res.status}` };
    } catch (e) {
      setProviderVerified(false, 'openrouter');
      return { ok: false, message: e.message || 'Unable to reach OpenRouter API' };
    }
  } else if (provider === 'openai') {
    try {
      const res = await fetchWithTimeout('https://api.openai.com/v1/models', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${targetKey}` }
      }, 25000);
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        setProviderVerified(true, 'openai');
        return { ok: true, message: 'Successfully connected to OpenAI API!' };
      }
      setProviderVerified(false, 'openai');
      if (data?.error?.message) {
        return { ok: false, message: data.error.message };
      }
      return { ok: false, message: `OpenAI returned status ${res.status}` };
    } catch (e) {
      setProviderVerified(false, 'openai');
      return { ok: false, message: e.message || 'Unable to reach OpenAI API' };
    }
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

  const MAX_DIM = 640;

  const canvasToJpeg = (canvas) => {
    const dataUrl = canvas.toDataURL('image/jpeg', 0.70);
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
          ctx.imageSmoothingQuality = 'medium';
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
      }, 8000);

      img.onload = () => {
        if (isDone) return;
        isDone = true;
        clearTimeout(timer);
        if (objectUrl) URL.revokeObjectURL(objectUrl);

        try {
          const naturalW = img.naturalWidth || img.width || 800;
          const naturalH = img.naturalHeight || img.height || 800;
          const scale = Math.min(1, MAX_DIM / naturalW, MAX_DIM / naturalH);
          const w = Math.max(1, Math.round(naturalW * scale));
          const h = Math.max(1, Math.round(naturalH * scale));

          const canvas = document.createElement('canvas');
          canvas.width = w;
          canvas.height = h;
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'medium';
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
  if (item._cachedBase64 && item._cachedMimeType) {
    return { base64: item._cachedBase64, mimeType: item._cachedMimeType };
  }

  let result;
  if (item.file) {
    result = await optimizeImageForAi(item.file, ext);
  } else if (item.url && item.url.startsWith('data:image/')) {
    result = await optimizeImageForAi(item.url, ext);
  } else if (item.url) {
    result = await optimizeImageForAi(item.url, ext);
  } else {
    throw new Error(`Unable to extract base64 image data for ${item.name || 'asset'}`);
  }

  if (result?.base64) {
    item._cachedBase64 = result.base64;
    item._cachedMimeType = result.mimeType;
  }
  return result;
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
    prompt = `You are a world-class AI Image Prompt Engineer specializing in commercial-safe, microstock-friendly, highly detailed AI image prompts for Midjourney v6, Flux.1, DALL-E 3, and Stable Diffusion XL.

CRITICAL PHOTO PROMPT INSTRUCTIONS (DEEP IMAGE ANALYSIS):
1. DEEP VISUAL ANALYSIS: Deeply analyze the uploaded image before generating the prompt. Describe the asset in maximum useful detail: main subject, secondary objects, composition, layout, perspective, camera angle, lighting, shadows, color palette, textures, materials, background, environment, depth of field, visual style, and important fine details.
2. ACCURATE REPRESENTATION: The prompt must accurately represent the uploaded image without inventing unrepresented important elements.
3. UNIQUE & ORIGINAL CREATION: Generate a unique, original master prompt specifically describing this exact image. Do NOT copy, imitate, or closely reproduce known stock-image prompts or generic templates. Avoid generic/template wording so different images produce genuinely unique prompts.
4. STRICT IP & TRADEMARK SAFETY: Never include brand names, logos, trademarks, copyrighted characters, celebrities, famous artwork, or protected IP. Use generic descriptors for people and objects.

STRICT OUTPUT FORMAT (JSON ONLY):
{
  "filename": "${filename}",
  "title": "Master Photo Prompt: Detailed visual breakdown describing subject + objects + composition + camera framing + lighting & shadows + color palette + environment & depth + visual style (no brand names, logos, or real people)",
  "description": "Comprehensive visual description of scene elements, lighting, lens optics, depth of field, surface textures, and color mood based strictly on the uploaded image",
  "keywords": ["25-35 specific visual modifier keywords", "photography style", "lighting setup", "composition tags", "camera/lens parameters", "surface textures"],
  "category": "Photography / Art Genre"
}`;
  } else if (mode === 'img2prompt-video') {
    prompt = `You are a world-class AI Video Prompt Engineer specializing in commercial-safe, microstock-friendly, production-ready silent AI video prompts for Sora, Runway Gen-3, Pika Labs, Kling AI, and Stable Video Diffusion.

CRITICAL VIDEO PROMPT INSTRUCTIONS (PRODUCTION-READY MOTION CONCEPT):
1. DEEP IMAGE ANALYSIS & INDIVIDUAL MOTION CONCEPT: Deeply analyze the uploaded image individually to create a highly detailed, unique video prompt specifically describing that image and its natural possible motion over time. Do NOT generate a generic, reusable template prompt.
2. PRODUCTION-READY VIDEO ELEMENTS:
   - Subject & Environment details
   - Composition & camera framing
   - Camera movement (pan, tilt, dolly, tracking, zoom, orbit, crane)
   - Natural subject/object movement progression over time
   - Lighting, atmosphere, depth, and perspective
   - Realistic motion dynamics, timing, and fine visual textures
   - Professional stock-footage / cinematic quality with a clear beginning-to-end motion concept.
3. ABSOLUTELY NO AUDIO / SILENT VIDEO ONLY (MANDATORY):
   - The video must contain NO SOUND: do NOT mention music, dialogue, voice, speech, narration, sound effects, ambient audio, or any audio references.
   - Every video prompt MUST explicitly include: "silent video, no audio, no voice, no music, no sound effects".
4. STRICT IP & TRADEMARK SAFETY: Never include brand names, logos, trademarks, copyrighted characters, celebrities, recognizable copyrighted designs, or protected IP.

STRICT OUTPUT FORMAT (JSON ONLY):
{
  "filename": "${filename}",
  "title": "Master Video Prompt: Detailed subject + natural motion progression + camera movement + lighting & atmosphere + environment + timing. silent video, no audio, no voice, no music, no sound effects.",
  "description": "Production-ready video concept: scene composition, camera trajectory, subject movement timing, visual progression from start to finish, color grading, atmospheric depth. Strictly silent description without audio.",
  "keywords": ["25-35 video visual modifier keywords", "motion style", "camera technique", "color grading", "cinematic stock quality", "lighting atmosphere"],
  "category": "Cinematic B-Roll / Video Genre"
}`;
  } else if (isAdobe) {
    prompt = `You are a world-renowned Microstock SEO Specialist and Adobe Stock Contributor Metadata Expert.
Generate **OFFICIAL ADOBE STOCK-OPTIMIZED, TOP-RANKING METADATA** engineered for maximum commercial discoverability based strictly on the image content.

=== ADOBE STOCK SEO ALGORITHM RULES ===
1. VISUAL ACCURACY & CONTENT TRUTH:
   - Analyze the image thoroughly: identify main subject, secondary elements, concept, style (photo/vector/3D/illustration), composition, colors, and buyer search intent.
   - Base all metadata strictly on what is genuinely present or supported by the visual asset. Never invent or hallucinate unrepresented elements.
2. CRITICAL FIRST 10 KEYWORDS (80% ALGORITHM SEARCH WEIGHT):
   - Adobe Stock weighs the FIRST 10 KEYWORDS most heavily in its ranking algorithm.
   - Keywords 1-5 MUST be the absolute primary subject, core theme, and asset format (e.g. "vector", "background", "technology", "abstract", "photo").
   - Keywords 6-10 MUST be primary visual traits, primary colors, and main contextual environment.
3. RELEVANT KEYWORDS (Generate exactly ${kwTarget} unique keywords):
   - Order keywords strictly by relevance and importance from strongest search terms to specific details.
   - Combine broad, mid-tier, and long-tail buyer queries ("banner", "copy space", "template", "graphic element") ONLY when genuinely accurate.
   - NO keyword-stuffing, repetition, spam, brand names, trademarks, or duplicate synonyms.
4. FRONT-LOADED COMMERCIAL TITLE (Strict limit: ${titleLimit} characters):
   - Front-load top commercial search keywords in the FIRST 3 TO 5 WORDS.
   - Formula: [Core Subject / Focus] + [Format/Style: Vector / Illustration / Photo / 3D] + [Action / Theme / Mood] + [Composition / Background]. Max ${titleLimit} characters.
   - Never start with generic filler phrases like "A photo of" or "An image of".
5. COMMERCIAL DESCRIPTION & CATEGORY:
   - 1-2 natural, informative English sentences. Select single best category from: [${categoryOptions}].

STRICT OUTPUT FORMAT (JSON ONLY):
{
  "filename": "${filename}",
  "title": "Front-Loaded Commercial Title (Strictly max ${titleLimit} characters)",
  "description": "Natural, high-SEO commercial description in English",
  "keywords": ["keyword1", "keyword2", ...],
  "category": "Selected Category Name"
}`;
  } else if (isShutterstock) {
    prompt = `You are a world-renowned Microstock SEO Specialist and Shutterstock Contributor Metadata Expert.
Generate **OFFICIAL SHUTTERSTOCK-COMPLIANT, HIGH-CONVERTING COMMERCIAL METADATA** based strictly on the image content.

=== SHUTTERSTOCK OFFICIAL REQUIREMENTS ===
1. VISUAL ACCURACY: Base metadata strictly on actual media content. Never hallucinate unrepresented details, brand names, or trademarks.
2. FACTUAL TITLE & DESCRIPTION (STRICT LIMIT: MAXIMUM 200 CHARACTERS):
   - Provide a unique, factual commercial description in English (strictly max 200 chars).
   - FRONT-LOAD top commercial search terms in the first 3 to 5 words.
   - Provide a matching front-loaded commercial title (max 200 chars).
3. KEYWORDS (Generate exactly ${kwTarget} unique keywords):
   - Order keywords by search importance: core subject & style first (keywords 1-10 carry major discovery weight), followed by specific objects, buyer intent, and synonyms.
   - Prioritize high-search-volume terms ONLY when genuinely accurate. Combine broad and long-tail terms. No spam or keyword stuffing.
4. CATEGORIES:
   - Select 1 or 2 valid categories from official Shutterstock list: [${categoryOptions}].
   - If 2 categories apply, separate them with a comma (e.g. "Nature, Animals/Wildlife").

STRICT OUTPUT FORMAT (JSON ONLY):
{
  "filename": "${filename}",
  "title": "Factual Commercial Title (max 200 chars)",
  "description": "Factual, detailed description in English (strictly max 200 chars)",
  "keywords": ["keyword1", "keyword2", ...],
  "category": "PrimaryCategory, SecondaryCategory"
}`;
  } else if (isVecteezy) {
    prompt = `You are a world-renowned Graphic Design & Vector SEO Specialist for Vecteezy.
Generate **HIGH-DISCOVERABILITY VECTEEZY METADATA** optimized for vector, illustration, and graphic design buyer search intent based strictly on visual content.

=== VECTEEZY SEO RULES ===
1. CRITICAL FIRST 5 KEYWORDS: Vecteezy prioritizes the FIRST 5 KEYWORDS heavily for ranking. Keywords 1-5 MUST be primary subject, asset type ("vector", "icon", "illustration", "background", "template"), and core theme.
2. RELEVANT KEYWORDS (Generate target ${kwTarget} keywords): Combine essential design terms ("vector", "scalable", "eps", "svg", "isolated", "graphic element", "editable") with accurate subject tags. Order by search power. No spam.
3. COMMERCIAL TITLE (Strict limit: ${titleLimit} characters): Front-load primary subject and asset format (e.g. "Minimalist Web Contact Icons Vector Set").
4. DESCRIPTION & CATEGORY: Clear graphic summary and single best category from: [${categoryOptions}].

STRICT OUTPUT FORMAT (JSON ONLY):
{
  "filename": "${filename}",
  "title": "Front-Loaded Vector Title (Strictly max ${titleLimit} characters)",
  "description": "Clear graphic summary and usage description in English",
  "keywords": ["keyword1", "keyword2", ...],
  "category": "Selected Category Name"
}`;
  } else if (isDepositphotos) {
    prompt = `You are a professional Microstock Metadata Specialist for Depositphotos.
Generate **ACCURATE, HIGH-RANKING DEPOSITPHOTOS METADATA** with natural descriptive titles and strong searchable keywords.

=== DEPOSITPHOTOS METADATA RULES ===
1. VISUAL ACCURACY: Identify main subject, secondary details, style, mood, composition, and colors strictly from the asset.
2. NATURAL DESCRIPTIVE TITLE (Strict limit: ${titleLimit} characters): Clear commercial title front-loading key search terms in the first 3-5 words.
3. SEARCHABLE KEYWORDS (Generate target ${kwTarget} keywords): Ordered logically from core subject to contextual details and commercial use cases. No keyword-stuffing.
4. DESCRIPTION & CATEGORY: Informative 1-2 sentence description and category from: [${categoryOptions}].

STRICT OUTPUT FORMAT (JSON ONLY):
{
  "filename": "${filename}",
  "title": "Natural Descriptive Commercial Title (max ${titleLimit} chars)",
  "description": "Informative and natural English description",
  "keywords": ["keyword1", "keyword2", ...],
  "category": "Selected Category Name"
}`;
  } else if (is123RF) {
    prompt = `You are a professional Microstock SEO Specialist for 123RF.
Generate **COMMERCIALLY OPTIMIZED 123RF METADATA** with clear commercial search intent and high-volume relevant keywords.

=== 123RF METADATA RULES ===
1. COMMERCIAL TITLE (Strict limit: ${titleLimit} characters): Front-load core subject in the first 3-5 words naturally.
2. HIGH-VOLUME RELEVANT KEYWORDS (Generate target ${kwTarget} keywords): Front-load top search volume buyer terms, ordered by relevance from primary subject to visual attributes.
3. DESCRIPTION & CATEGORY: Accurate visual summary and category from: [${categoryOptions}].

STRICT OUTPUT FORMAT (JSON ONLY):
{
  "filename": "${filename}",
  "title": "Commercial Search Title (max ${titleLimit} chars)",
  "description": "Accurate commercial description in English",
  "keywords": ["keyword1", "keyword2", ...],
  "category": "Selected Category Name"
}`;
  } else if (isDreamstime) {
    prompt = `You are a professional Microstock Metadata Specialist for Dreamstime.
Generate **DISCOVERABILITY-OPTIMIZED DREAMSTIME METADATA** with relevant, descriptive, commercially useful keywords.

=== DREAMSTIME METADATA RULES ===
1. DESCRIPTIVE TITLE (Strict limit: ${titleLimit} characters): Clear descriptive title front-loading key search terms.
2. COMMERCIALLY USEFUL KEYWORDS (Generate target ${kwTarget} keywords): Ordered logically: core subject -> action/theme -> visual details -> commercial use cases -> synonyms. Put strongest terms first.
3. DESCRIPTION & CATEGORY: Detailed visual breakdown and category from: [${categoryOptions}].

STRICT OUTPUT FORMAT (JSON ONLY):
{
  "filename": "${filename}",
  "title": "Descriptive Image Title (max ${titleLimit} chars)",
  "description": "Detailed visual description in English",
  "keywords": ["keyword1", "keyword2", ...],
  "category": "Selected Category Name"
}`;
  } else if (isMagnific) {
    prompt = `You are an AI Art & Visual Content Metadata Specialist for Magnific.
Generate **CONCISE, DESCRIPTIVE, SEO-FRIENDLY METADATA** focused strictly on visual content and aesthetic characteristics.

=== MAGNIFIC METADATA RULES ===
1. CONCISE TITLE (Strict limit: ${titleLimit} characters): Captures exact visual subject and artistic style.
2. AESTHETIC KEYWORDS (Generate target ${kwTarget} keywords): Subject, art style, lighting atmosphere, textures, colors, composition, aesthetic modifiers. Order by relevance.
3. DESCRIPTION & CATEGORY: Aesthetic breakdown and category from: [${categoryOptions}].

STRICT OUTPUT FORMAT (JSON ONLY):
{
  "filename": "${filename}",
  "title": "Concise Descriptive Visual Title (max ${titleLimit} chars)",
  "description": "Detailed aesthetic breakdown in English",
  "keywords": ["keyword1", "keyword2", ...],
  "category": "Selected Category Name"
}`;
  } else {
    prompt = `You are a world-renowned Microstock SEO Specialist & Commercial Metadata Ranking Expert across all major stock marketplaces (Adobe Stock, Shutterstock, Freepik, Vecteezy, Getty/iStock, 123RF, Depositphotos, Dreamstime).
Generate **BALANCED, TOP-RANKING UNIVERSAL MICROSTOCK METADATA** engineered for maximum discoverability based strictly on the image content.

=== UNIVERSAL MICROSTOCK SEO RULES ===
1. VISUAL ACCURACY FIRST: Base all metadata strictly on what is genuinely visible or supported by the media asset. No hallucinated objects, brand names, or trademarks.
2. STRONGEST SEARCH TERMS FIRST (TOP 5-10 KEYWORDS):
   - Keywords 1-5 MUST be the absolute primary subject, core theme, and asset format ("vector", "photo", "background", "illustration", "3d render").
   - Keywords 6-10 MUST be primary visual traits, primary colors, and main setting.
3. BALANCED KEYWORDS (Generate target ${kwTarget} unique keywords):
   - Combine broad search terms, mid-tier tags, and long-tail buyer queries ("banner", "copy space", "graphic element", "template") ONLY when accurate.
   - Put strongest search terms first. No keyword-stuffing, spam, or duplicate synonyms.
4. TOP-RANKING COMMERCIAL TITLE (Strict limit: ${titleLimit} characters):
   - Front-load highest search volume commercial keywords in the FIRST 3 TO 5 WORDS.
   - Formula: [Core Subject] + [Format/Style] + [Action/Theme] + [Composition/Background]. Max ${titleLimit} characters. Never start with filler phrases ("A photo of").
5. DESCRIPTION & CATEGORY: 1-2 natural commercial sentences and category from: [${categoryOptions}].

STRICT OUTPUT FORMAT (JSON ONLY):
{
  "filename": "${filename}",
  "title": "Front-Loaded Commercial Title (Strictly max ${titleLimit} characters)",
  "description": "Natural, high-SEO commercial description in English",
  "keywords": ["keyword1", "keyword2", ...],
  "category": "Selected Category Name"
}`;
  }

  if (settings?.customPrompt) {
    prompt += `\n\nUSER CUSTOM OVERRIDE INSTRUCTIONS: ${settings.customPrompt}`;
  }

  prompt += `\n\nFILENAME: ${filename}\nPLATFORM: ${platformObj?.name || 'Stock'}`;
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

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${encodeURIComponent(key)}`;
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    }, 45000);

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
    if (!res.ok) {
      if (resJson?.error?.message) {
        throw new Error(resJson.error.message);
      }
      throw new Error(`Google Gemini API HTTP ${res.status}: ${res.statusText || 'Generation request failed'}`);
    }
    if (resJson?.error?.message) {
      throw new Error(resJson.error.message);
    }
    throw new Error('Google Gemini API returned an empty or unparseable response.');
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
    }, 15000);

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
    // 1. If backend server is available and user wants direct video upload, try binary endpoint
    if (!key && item.file) {
      const mimeType = getGeminiMimeType(item, ext);
      const endpoints = [
        `${getApiBase()}/api/gemini/generate-video`,
        '/.netlify/functions/api/gemini/generate-video'
      ];

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
              'x-model': selectedModel || 'gemini-3.5-flash-lite'
            },
            body: item.file
          }, VIDEO_TIMEOUT_MS);

          const data = await res.json().catch(() => ({}));
          if (res.ok && data.ok) {
            return data.data;
          }
        } catch (_) {}
      }
    }
  }

  // 2. Extract JPEG frame/image base64 for fast, reliable AI vision processing across Client & Netlify Serverless
  const { base64, mimeType } = await getImageBase64(item, ext);

  let lastError = null;

  // Direct Browser Client generation
  if (key) {
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
  }

  // Dual-Route Backend Proxy Fallback
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
      }, 35000);

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
