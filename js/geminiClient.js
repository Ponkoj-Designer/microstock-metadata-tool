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
      { id: 'gemini-2.5-flash', name: 'Gemini 2.5 Flash (Recommended)' },
      { id: 'gemini-3.6-flash', name: 'Gemini 3.6 Flash' },
      { id: 'gemini-1.5-pro',   name: 'Gemini 1.5 Pro' }
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
      { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash (via OpenRouter)' },
      { id: 'openai/gpt-4o-mini',       name: 'GPT-4o Mini (via OpenRouter)' },
      { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet' }
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
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini (Fast & Efficient)' },
      { id: 'gpt-4o',      name: 'GPT-4o (High Precision Vision)' }
    ]
  }
};

// ── In-memory key & provider store (cleared on page refresh) ─────────────
let _activeProvider = 'gemini';
let _providerKeys = {
  gemini: null,
  openrouter: null,
  openai: null
};
let _selectedModels = {
  gemini: 'gemini-2.5-flash',
  openrouter: 'google/gemini-2.5-flash',
  openai: 'gpt-4o-mini'
};

export function setAiProvider(provider) {
  if (AI_PROVIDERS_CONFIG[provider]) {
    _activeProvider = provider;
  }
}

export function getActiveProvider() {
  return _activeProvider;
}

export function setProviderModel(modelId, provider = _activeProvider) {
  _selectedModels[provider] = modelId;
}

export function getProviderModel(provider = _activeProvider) {
  return _selectedModels[provider] || AI_PROVIDERS_CONFIG[provider]?.models[0]?.id;
}

export function setApiKey(key, provider = _activeProvider) {
  _providerKeys[provider] = key ? key.trim() : null;
}

export function hasApiKey(provider = _activeProvider) {
  const key = _providerKeys[provider];
  return !!key && key.trim().length > 0;
}

export function clearApiKey(provider = _activeProvider) {
  _providerKeys[provider] = null;
}

export function getSessionKey(provider = _activeProvider) {
  return _providerKeys[provider];
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

// ── Connection Test ─────────────────────────────────────────────────────────
export async function testConnection(key, provider = _activeProvider) {
  const targetKey = key || _providerKeys[provider];
  if (!targetKey && provider !== 'gemini') {
    return { ok: false, message: `${AI_PROVIDERS_CONFIG[provider]?.name || provider} API key is missing.` };
  }

  try {
    const res = await fetchWithTimeout('/api/ai/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-ai-provider': provider,
        'x-ai-api-key': targetKey || '',
        'x-gemini-api-key': targetKey || ''
      },
      body: JSON.stringify({ provider, apiKey: targetKey || '' })
    }, 15000);

    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      return { ok: true, message: data.message || `Connected to ${AI_PROVIDERS_CONFIG[provider]?.name}!` };
    }
    return { ok: false, message: data.message || `${AI_PROVIDERS_CONFIG[provider]?.name} connection test failed.` };
  } catch (err) {
    return { ok: false, message: `Network error reaching ${AI_PROVIDERS_CONFIG[provider]?.name} servers.` };
  }
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

async function extractPdfFirstPageJpegBase64(pdfFile) {
  const blobB64 = await blobToBase64(pdfFile);
  return { base64: blobB64, mimeType: 'application/pdf' };
}

async function getImageBase64(item, ext) {
  if (ext === 'svg') {
    if (item.file) {
      try {
        return await rasterizeSvgToJpegBase64(item.file);
      } catch (err) {
        console.warn('SVG file rasterization warning:', err);
      }
    }
    if (item.url) {
      try {
        return await rasterizeSvgToJpegBase64(item.url);
      } catch (err) {
        console.warn('SVG url rasterization warning:', err);
      }
    }
  }

  if (ext === 'pdf' && item.file) {
    try {
      return await extractPdfFirstPageJpegBase64(item.file);
    } catch (_) {}
  }

  if (item.file) {
    const base64 = await blobToBase64(item.file);
    const mimeType = getGeminiMimeType(item, ext);
    return { base64, mimeType };
  }

  if (item.url && item.url.startsWith('data:')) {
    const parts = item.url.split(',');
    const mimeMatch = parts[0].match(/:(.*?);/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    return { base64: parts[1], mimeType };
  }

  if (item.url) {
    const res = await fetch(item.url);
    const blob = await res.blob();
    const base64 = await blobToBase64(blob);
    const mimeType = getGeminiMimeType(item, ext);
    return { base64, mimeType };
  }

  throw new Error(`Unable to extract base64 image data for ${item.name || 'asset'}`);
}

// ── Main Metadata Generation (Secure Server Proxy) ─────────────────────────
export async function generateMetadataForImage(item, platform, apiKey, settings, mode, signal) {
  const provider = _activeProvider || 'gemini';
  const key = apiKey || _providerKeys[provider] || getSessionKey(provider) || '';
  const selectedModel = getProviderModel(provider);

  const ext = (item.ext || item.name.split('.').pop()).toLowerCase();

  if (!isGeminiAnalyzable(ext)) {
    return {
      _geminiUnsupported: true,
      reason: `${ext.toUpperCase()} files are not supported for AI analysis.`
    };
  }

  if (item.assetType === 'video') {
    const mimeType = getGeminiMimeType(item, ext);
    if (!item.file) throw new Error('Video file object is missing.');

    const res = await fetchWithTimeout('/api/gemini/generate-video', {
      method: 'POST',
      signal,
      headers: {
        'Content-Type': mimeType,
        'x-ai-provider': provider,
        'x-ai-api-key': key,
        'x-gemini-api-key': key,
        'x-filename': encodeURIComponent(item.name),
        'x-platform': encodeURIComponent(JSON.stringify(platform)),
        'x-settings': encodeURIComponent(JSON.stringify(settings || {})),
        'x-mode': mode || 'metadata'
      },
      body: item.file
    }, VIDEO_TIMEOUT_MS);

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok) {
      throw new Error(data.message || 'Video metadata generation failed.');
    }
    return data.data;
  }

  const { base64, mimeType } = await getImageBase64(item, ext);

  const res = await fetchWithTimeout('/api/ai/generate', {
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
      filename: item.name,
      platform,
      settings,
      mode,
      model: selectedModel
    })
  }, REQUEST_TIMEOUT_MS);

  const data = await res.json().catch(() => ({}));

  if (!res.ok || !data.ok) {
    const errMsg = data.message || `${AI_PROVIDERS_CONFIG[provider]?.name || provider} metadata generation failed.`;
    throw new Error(errMsg);
  }

  return data.data;
}
