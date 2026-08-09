/**
 * Gemini BYOK Client — Bring Your Own API Key
 * The customer's API key is held in memory only for this session.
 * It is NEVER stored in localStorage, cookies, or logs.
 * All calls go directly to the Gemini REST API using the customer's key.
 */

const GEMINI_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const GEMINI_MODEL = 'gemini-3.6-flash';
const REQUEST_TIMEOUT_MS = 45000;

// ── In-memory key store (cleared on page refresh) ──────────────────────────
let _sessionKey = null;

export function setApiKey(key) {
  _sessionKey = key ? key.trim() : null;
}

export function hasApiKey() {
  return !!_sessionKey && _sessionKey.trim().length > 0;
}

export function clearApiKey() {
  _sessionKey = null;
}

/** Returns a redacted version safe for display / logging */
export function getRedactedKey(key) {
  const target = key || _sessionKey;
  if (!target || target.length < 6) return '***';
  return target.substring(0, 4) + '…' + target.substring(target.length - 4);
}

// ── Fetch with timeout ──────────────────────────────────────────────────────
async function fetchWithTimeout(url, options, timeoutMs = REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ── Error classifier ────────────────────────────────────────────────────────
function classifyGeminiError(status, body) {
  const errStatus = body?.error?.status || '';
  const apiMsg = body?.error?.message || '';
  const apiMsgLower = apiMsg.toLowerCase();

  // 1. HTTP 429 / RESOURCE_EXHAUSTED / Quota Exceeded Detection
  if (
    status === 429 ||
    errStatus === 'RESOURCE_EXHAUSTED' ||
    apiMsgLower.includes('quota') ||
    apiMsgLower.includes('resource_exhausted') ||
    apiMsgLower.includes('rate limit') ||
    apiMsgLower.includes('free_tier')
  ) {
    let delayInfo = '';
    if (Array.isArray(body?.error?.details)) {
      const retryDetail = body.error.details.find(d =>
        (d['@type'] && d['@type'].includes('RetryInfo')) || d.retryDelay
      );
      if (retryDetail && retryDetail.retryDelay) {
        delayInfo = ` (Retry after: ${retryDetail.retryDelay})`;
      }
    }
    return `Gemini API quota exceeded. Please wait for the quota to reset or use a Gemini API project with available quota.${delayInfo}`;
  }

  // 2. Authentication / Invalid Key Detection
  if (
    (status === 400 && (apiMsgLower.includes('key') || apiMsgLower.includes('invalid') || apiMsgLower.includes('api_key'))) ||
    status === 401
  ) {
    return 'Invalid Gemini API key. Please check your API key in Google AI Studio.';
  }

  // 3. Permission / Project Restrictions
  if (status === 403) {
    return `Gemini API Key Unauthorized (${status}). Check API key permissions or billing setup in Google AI Studio.`;
  }

  // 4. Return exact API error message if provided
  if (apiMsg) {
    return `Gemini API Error (${status}): ${apiMsg}`;
  }

  // 5. Server & Network Fallbacks
  if (status === 500 || status === 503) {
    return 'Gemini service is temporarily unavailable. Please try again.';
  }

  if (status === 0 || !status) {
    return 'Network error connecting to Gemini API. Check your internet connection.';
  }

  return `Gemini API request failed (${status}).`;
}

// ── Test connection (minimal token usage) ──────────────────────────────────
export async function testConnection(apiKey) {
  const keyToTest = apiKey ? apiKey.trim() : _sessionKey;
  if (!keyToTest || keyToTest.length === 0) {
    return { ok: false, message: 'Please enter your Gemini API key in the input box.' };
  }

  const url = `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(keyToTest)}`;
  try {
    const res = await fetchWithTimeout(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'p' }] }],
        generationConfig: { maxOutputTokens: 1, temperature: 0 }
      })
    }, 15000);

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, message: classifyGeminiError(res.status, data) };
    }
    return { ok: true, message: 'Gemini Connected' };
  } catch (err) {
    if (err.name === 'AbortError') return { ok: false, message: 'Connection timed out connecting to Gemini API (15s).' };
    return { ok: false, message: `Network error: ${err.message || 'Unable to reach Gemini API servers.'}` };
  }
}

// ── Build structured metadata prompt ───────────────────────────────────────
function buildMetadataPrompt(filename, platform) {
  let kwTarget;
  if (platform.keywordMax >= 49) {
    kwTarget = '42 to 47';
  } else if (platform.keywordMax >= 40) {
    kwTarget = `${platform.keywordMax}`;
  } else {
    kwTarget = `5 to ${platform.keywordMax}`;
  }
  const titleLimit = platform.titleMaxLen;
  const categoriesList = platform.categories.length > 0
    ? `Choose one category from: ${platform.categories.join(', ')}`
    : 'Choose a general category suitable for microstock agencies';

  return `You are an expert commercial microstock metadata cataloger for ${platform.name}.

Analyze this visual asset accurately and generate commercial metadata.

STRICT INSTRUCTIONS:
- Describe ONLY what is ACTUALLY visible in the image.
- Do NOT invent non-existent objects, people, locations, or brands.
- KEYWORD REQUIREMENT: Generate exactly ${kwTarget} unique, highly relevant keywords.
- Order keywords by relevance: the FIRST 10 keywords MUST be the most essential visual concepts.
- Title: Clear, descriptive, natural language title (maximum ${titleLimit} characters).
- Description: Natural, informative 1-2 sentence visual summary.
- Category: ${categoriesList}.

FILENAME: ${filename}
PLATFORM: ${platform.name}
KEYWORD MAX: ${platform.keywordMax} (Do not exceed)

Respond with a JSON object:
{
  "filename": "${filename}",
  "title": "Descriptive title here",
  "description": "Visual description here",
  "keywords": ["keyword1", "keyword2", "keyword3"],
  "category": "Category"
}`;
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

/**
 * Temporary PNG preview extractor & canvas renderer for EPS/AI/PDF vector files.
 * Extracts embedded JPEG/PNG bytes from EPS binary or renders a canvas PNG preview.
 */
async function rasterizeVectorToPng(item) {
  if (item.file) {
    try {
      const buffer = await item.file.arrayBuffer();
      const bytes = new Uint8Array(buffer);

      // 1. Scan for embedded JPEG (\xFF \xD8 \xFF) in EPS binary
      for (let i = 0; i < bytes.length - 3; i++) {
        if (bytes[i] === 0xFF && bytes[i + 1] === 0xD8 && bytes[i + 2] === 0xFF) {
          for (let j = i + 3; j < bytes.length - 1; j++) {
            if (bytes[j] === 0xFF && bytes[j + 1] === 0xD9) {
              const jpegSlice = bytes.subarray(i, j + 2);
              const blob = new Blob([jpegSlice], { type: 'image/jpeg' });
              return { base64: await blobToBase64(blob), mimeType: 'image/jpeg' };
            }
          }
        }
      }

      // 2. Scan for embedded PNG (\x89 PNG) in EPS binary
      for (let i = 0; i < bytes.length - 4; i++) {
        if (bytes[i] === 0x89 && bytes[i + 1] === 0x50 && bytes[i + 2] === 0x4E && bytes[i + 3] === 0x47) {
          for (let j = i + 4; j < bytes.length - 8; j++) {
            if (bytes[j] === 0x49 && bytes[j + 1] === 0x45 && bytes[j + 2] === 0x4E && bytes[j + 3] === 0x44) {
              const pngSlice = bytes.subarray(i, j + 8);
              const blob = new Blob([pngSlice], { type: 'image/png' });
              return { base64: await blobToBase64(blob), mimeType: 'image/png' };
            }
          }
        }
      }
    } catch (e) {
      // fallback to canvas rasterizer below
    }
  }

  // 3. Render temporary canvas PNG preview representing the EPS vector
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    const ctx = canvas.getContext('2d');

    const grad = ctx.createLinearGradient(0, 0, 800, 600);
    grad.addColorStop(0, '#0F172A');
    grad.addColorStop(1, '#1E1B4B');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 800, 600);

    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    for (let x = 0; x < 800; x += 40) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, 600); ctx.stroke(); }
    for (let y = 0; y < 600; y += 40) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(800, y); ctx.stroke(); }

    ctx.fillStyle = '#8B5CF6';
    ctx.font = '800 28px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('VECTOR ASSET (EPS)', 400, 260);

    ctx.fillStyle = '#94A3B8';
    ctx.font = '600 20px Inter, sans-serif';
    ctx.fillText(item.name, 400, 310);

    ctx.fillStyle = 'rgba(139, 92, 246, 0.4)';
    ctx.fillRect(250, 340, 300, 2);

    const dataUrl = canvas.toDataURL('image/png');
    return { base64: dataUrl.split(',')[1], mimeType: 'image/png' };
  } catch (err) {
    throw new Error(`EPS conversion failed: ${err.message}`);
  }
}

async function getImageBase64(item, ext) {
  const isVector = ['eps', 'ai', 'pdf', 'svg'].includes(ext);
  if (isVector) {
    return await rasterizeVectorToPng(item);
  }

  if (item.file) {
    return { base64: await blobToBase64(item.file), mimeType: getGeminiMimeType(item, ext) };
  }
  if (item.url && item.url.startsWith('http')) {
    const res = await fetch(item.url);
    if (!res.ok) throw new Error(`Failed to fetch image preview from ${item.url}`);
    const blob = await res.blob();
    return { base64: await blobToBase64(blob), mimeType: 'image/jpeg' };
  }
  throw new Error('Image file data unavailable for AI analysis.');
}

function getGeminiMimeType(item, ext) {
  const mimeMap = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg',
    png: 'image/png', webp: 'image/webp',
    tiff: 'image/tiff', tif: 'image/tiff',
    gif: 'image/gif', svg: 'image/png'
  };
  if (item.file && item.file.type) return item.file.type;
  return mimeMap[ext] || item.type || 'image/jpeg';
}

const GEMINI_SUPPORTED_EXTS = new Set(['jpg', 'jpeg', 'png', 'webp', 'tiff', 'tif', 'gif', 'eps', 'ai', 'svg', 'pdf']);

export function isGeminiAnalyzable(ext) {
  return GEMINI_SUPPORTED_EXTS.has(ext.toLowerCase());
}

// ── Robust Response Parser & Validator ─────────────────────────────────────
function parseMetadataResponse(rawText, filename, platform) {
  if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
    throw new Error('Gemini API returned an empty text payload.');
  }

  // 1. Strip markdown code block fences (```json ... ``` or ``` ...)
  let text = rawText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

  // 2. Locate the outermost JSON object bounds { ... }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    text = text.substring(firstBrace, lastBrace + 1).trim();
  }

  let parsed = null;

  // Attempt 1: Direct JSON parse
  try {
    parsed = JSON.parse(text);
  } catch (e1) {
    // Attempt 2: Strip trailing commas inside arrays or objects
    try {
      const sanitized = text.replace(/,\s*([}\]])/g, '$1');
      parsed = JSON.parse(sanitized);
    } catch (e2) {
      // Attempt 3: Replace unescaped newlines/tabs inside string values
      try {
        const noNewlines = text.replace(/[\r\n]+/g, ' ');
        parsed = JSON.parse(noNewlines);
      } catch (e3) {
        throw new Error('Could not parse metadata JSON from Gemini API response.');
      }
    }
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Gemini response is not a valid JSON object.');
  }

  // Extract & validate fields
  const title = String(parsed.title || parsed.name || '').substring(0, platform.titleMaxLen).trim();
  const description = String(parsed.description || title || '').trim();
  const category = String(parsed.category || 'General').trim();

  // Keywords cleanup & normalization
  let keywords = [];
  if (Array.isArray(parsed.keywords)) {
    keywords = parsed.keywords;
  } else if (typeof parsed.keywords === 'string') {
    keywords = parsed.keywords.split(',');
  }

  keywords = keywords
    .map(k => String(k).toLowerCase().trim())
    .filter(k => k.length > 0);

  // Deduplicate preserving relevance order
  const seen = new Set();
  keywords = keywords.filter(k => { if (seen.has(k)) return false; seen.add(k); return true; });

  // Enforce platform keyword cap
  keywords = keywords.slice(0, platform.keywordMax);

  // Strict field validation
  if (!title) {
    throw new Error('Generated metadata is missing a valid title.');
  }

  return {
    filename: parsed.filename || filename,
    title,
    description: description || title,
    keywords,
    category: category || 'General'
  };
}

// ── Main Metadata Generation ───────────────────────────────────────────────
export async function generateMetadataForImage(item, platform, apiKey) {
  const key = apiKey || _sessionKey;
  if (!key) throw new Error('No Gemini API key provided. Please enter your API key in AI Settings.');

  const ext = (item.ext || item.name.split('.').pop()).toLowerCase();

  if (!isGeminiAnalyzable(ext)) {
    return {
      _geminiUnsupported: true,
      reason: `${ext.toUpperCase()} files are not supported for AI analysis.`
    };
  }

  // Obtain base64 payload & mimeType (handles EPS vector rasterization automatically)
  const { base64, mimeType } = await getImageBase64(item, ext);
  const prompt = buildMetadataPrompt(item.name, platform);
  const url = `${GEMINI_BASE}/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`;

  // Use Gemini Structured JSON Output Schema
  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType, data: base64 } }
      ]
    }],
    generationConfig: {
      temperature: 0.35,
      maxOutputTokens: 2048,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          filename:    { type: 'STRING' },
          title:       { type: 'STRING' },
          description: { type: 'STRING' },
          keywords:    { type: 'ARRAY', items: { type: 'STRING' } },
          category:    { type: 'STRING' }
        },
        required: ['title', 'description', 'keywords', 'category']
      }
    }
  };

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }, REQUEST_TIMEOUT_MS);

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    const errMsg = classifyGeminiError(res.status, data);
    throw new Error(errMsg);
  }

  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  if (!rawText) {
    throw new Error('Gemini API returned an empty candidate content response.');
  }

  return parseMetadataResponse(rawText, item.name, platform);
}
