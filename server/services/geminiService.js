/**
 * Server-Side Gemini AI Service & Security Proxy
 * Handles all direct communication with Google Generative Language API.
 * Keeps API keys completely hidden from client logs, stack traces, and network inspectors.
 */

import { config } from '../config/config.js';

const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png',
  'image/webp', 'image/tiff', 'image/gif',
  'video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'
]);

/**
 * Redacts any occurrence of the raw API key from error strings or logs.
 */
function sanitizeErrorMessage(errorMsg, apiKey) {
  if (!errorMsg) return 'Gemini processing encountered an error.';
  let safeMsg = String(errorMsg);

  // Redact exact key string if present
  if (apiKey && typeof apiKey === 'string' && apiKey.length > 5) {
    safeMsg = safeMsg.replaceAll(apiKey.trim(), '***GEMINI_KEY_REDACTED***');
  }

  // Redact URL key query params (?key=AIza...)
  safeMsg = safeMsg.replace(/key=[a-zA-Z0-9_-]+/g, 'key=***REDACTED***');
  return safeMsg;
}

/**
 * Classifies Gemini API HTTP status codes and response bodies into clean, actionable error messages.
 */
function classifyGeminiError(status, body) {
  const errStatus = body?.error?.status || '';
  const apiMsg    = body?.error?.message || '';
  const msgLower  = apiMsg.toLowerCase();

  // 1. Quota / Rate Limit (HTTP 429)
  if (
    status === 429 ||
    errStatus === 'RESOURCE_EXHAUSTED' ||
    msgLower.includes('quota') ||
    msgLower.includes('resource_exhausted') ||
    msgLower.includes('rate limit')
  ) {
    return 'Gemini API quota or rate limit exceeded. Please wait a moment before trying again.';
  }

  // 2. Authentication / Invalid Key (HTTP 400 / 401)
  if (
    status === 401 ||
    (status === 400 && (msgLower.includes('api_key') || msgLower.includes('key') || msgLower.includes('invalid')))
  ) {
    return 'Invalid Gemini API key. Please check your API key settings.';
  }

  // 3. Forbidden / Billing (HTTP 403)
  if (status === 403) {
    return 'Gemini API key unauthorized (403). Check API key restrictions and billing setup.';
  }

  if (apiMsg) return `Gemini API Error (${status}): ${apiMsg}`;
  if (status >= 500) return 'Gemini service is temporarily unavailable. Please try again.';

  return `Gemini API request failed with status ${status}.`;
}

/**
 * Test a Gemini API Key via server-to-server ping.
 */
export async function testGeminiKey(providedKey) {
  const apiKey = (providedKey || process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey || apiKey.length < 8) {
    return { ok: false, status: 400, message: 'Please enter a valid Gemini API key.' };
  }

  const url = `${config.geminiBaseUrl}/${config.geminiModel}:generateContent?key=${encodeURIComponent(apiKey)}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Ping' }] }],
        generationConfig: { maxOutputTokens: 1, temperature: 0 }
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const errMsg = classifyGeminiError(res.status, data);
      return { ok: false, status: res.status, message: sanitizeErrorMessage(errMsg, apiKey) };
    }

    return { ok: true, status: 200, message: 'Gemini Connected' };
  } catch (err) {
    console.error('[GeminiService testKey Error]', sanitizeErrorMessage(err.message, apiKey));
    return { ok: false, status: 500, message: 'Network error reaching Gemini API servers.' };
  }
}

/**
 * Server-side metadata generation proxy for image / vector assets.
 */
export async function generateGeminiMetadata({ apiKey: providedKey, base64Image, mimeType = 'image/jpeg', filename = 'asset.jpg', platform, mode }) {
  const apiKey = (providedKey || process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) throw new Error('Gemini API key is required. Please provide an API key.');

  // Payload validations
  if (!base64Image || typeof base64Image !== 'string' || base64Image.length < 50) {
    throw new Error('Invalid or missing base64 image data payload.');
  }

  const normalizedMime = (mimeType || 'image/jpeg').toLowerCase();
  const effectiveMime  = ALLOWED_MIME_TYPES.has(normalizedMime) ? normalizedMime : 'image/jpeg';

  const platformObj = platform || { name: 'Adobe Stock', keywordMax: 49, titleMaxLen: 70, categories: [] };
  const kwMax = parseInt(platformObj.keywordMax, 10) || 49;
  const titleLimit = parseInt(platformObj.titleMaxLen, 10) || 70;

  const categoryOptions = Array.isArray(platformObj.categories) && platformObj.categories.length > 0
    ? platformObj.categories.join(', ')
    : 'General, Abstract, Animals, Architecture, Business, Food, Landscapes, Nature, People, Technology, Graphic Resources';

  const kwTarget = kwMax >= 49 ? '42 to 47' : `5 to ${kwMax}`;

  const isImg2Prompt = mode === 'img2prompt';
  const prompt = isImg2Prompt
    ? `You are an expert AI art prompt engineer for text-to-image AI generators like Midjourney v6, Flux.1, DALL-E 3, and Stable Diffusion XL.
Analyze this visual asset accurately and generate a hyper-detailed, highly descriptive AI image prompt.
STRICT INSTRUCTIONS:
- Title: A vivid, comprehensive master prompt describing the core subject, environment, lighting, composition, mood, and art style.
- Description: A detailed breakdown of visual elements, color palette, lighting atmosphere, and texture details.
- Keywords: 20-30 visual modifier keywords, art style tags, lighting terms, and composition terms.
- Category: The artistic genre/medium (e.g. Photography, 3D Render, Digital Painting, Vector Art, Concept Art, Portraiture).

FILENAME: ${filename}`
    : `You are an expert commercial microstock metadata cataloger for ${platformObj.name}.
Analyze this visual asset accurately and generate commercial metadata.
STRICT INSTRUCTIONS:
- Describe ONLY what is ACTUALLY visible in the image.
- Do NOT invent non-existent objects, people, or brands.
- KEYWORD REQUIREMENT: Generate exactly ${kwTarget} unique, highly relevant keywords.
- Order keywords by relevance: the FIRST 10 keywords MUST be the most essential visual concepts.
- Title: Clear, descriptive, natural language title (maximum ${titleLimit} characters).
- Description: Natural, informative 1-2 sentence visual summary.
- Category: Select the single best matching category for this visual asset from this list: [${categoryOptions}].

FILENAME: ${filename}
PLATFORM: ${platformObj.name}
KEYWORD MAX: ${kwMax}`;

  const isVideo = effectiveMime.startsWith('video/');
  let mediaPart = { inline_data: { mime_type: effectiveMime, data: base64Image } };

  if (isVideo) {
    // 1. Upload video to Gemini File API
    const uploadUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(apiKey)}`;
    const buffer = Buffer.from(base64Image, 'base64');
    
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'X-Goog-Upload-Protocol': 'raw',
        'X-Goog-Upload-Command': 'upload, finalize',
        'X-Goog-Upload-Header-Content-Length': buffer.length.toString(),
        'X-Goog-Upload-Header-Content-Type': effectiveMime,
        'Content-Type': effectiveMime
      },
      body: buffer
    });

    const uploadData = await uploadRes.json();
    if (!uploadRes.ok || !uploadData.file || !uploadData.file.name) {
      throw new Error(`Video upload to Gemini failed: ${uploadData?.error?.message || 'Unknown error'}`);
    }

    const uploadedFileName = uploadData.file.name;
    const fileUri = uploadData.file.uri;

    // 2. Poll until ACTIVE
    let fileState = uploadData.file.state;
    let attempts = 0;
    while (fileState === 'PROCESSING' && attempts < 30) {
      await new Promise(r => setTimeout(r, 2000));
      const statusRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/${uploadedFileName}?key=${encodeURIComponent(apiKey)}`);
      if (!statusRes.ok) break;
      const statusData = await statusRes.json();
      fileState = statusData.state;
      if (fileState === 'FAILED') throw new Error('Video processing failed on Gemini servers.');
      attempts++;
    }
    
    if (fileState !== 'ACTIVE') {
      throw new Error('Video processing timed out.');
    }

    mediaPart = { file_data: { mime_type: effectiveMime, file_uri: fileUri } };
  }

  const url = `${config.geminiBaseUrl}/${config.geminiModel}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const requestBody = {
    contents: [{
      parts: [
        { text: prompt },
        mediaPart
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

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody)
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      const classified = classifyGeminiError(res.status, data);
      throw new Error(sanitizeErrorMessage(classified, apiKey));
    }

    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    if (!rawText) throw new Error('Gemini API returned an empty content candidate.');

    // Parse structured JSON output
    let parsed;
    try {
      parsed = JSON.parse(rawText.replace(/^```(?:json)?\s*|\s*```$/gi, '').trim());
    } catch (_) {
      throw new Error('Failed to parse Gemini metadata response JSON.');
    }

    const title = String(parsed.title || '').substring(0, titleLimit).trim();
    const description = String(parsed.description || title).trim();

    let rawCat = String(parsed.category || '').trim();
    const catList = Array.isArray(platformObj.categories) && platformObj.categories.length > 0
      ? platformObj.categories
      : ['General', 'Abstract', 'Animals', 'Architecture', 'Business', 'Food', 'Landscapes', 'Nature', 'People', 'Technology', 'Graphic Resources'];

    let category = catList.find(c => c.toLowerCase() === rawCat.toLowerCase())
      || catList.find(c => c.toLowerCase().includes(rawCat.toLowerCase()) || rawCat.toLowerCase().includes(c.toLowerCase()))
      || rawCat
      || catList[0];

    let keywords = Array.isArray(parsed.keywords) ? parsed.keywords : String(parsed.keywords || '').split(',');
    keywords = keywords
      .map(k => String(k).toLowerCase().trim())
      .filter(k => k.length > 0);

    // Deduplicate while preserving relevance order
    const seen = new Set();
    keywords = keywords.filter(k => { if (seen.has(k)) return false; seen.add(k); return true; });
    keywords = keywords.slice(0, kwMax);

    if (!title) throw new Error('Generated metadata title was empty.');

    return {
      filename: parsed.filename || filename,
      title,
      description,
      keywords,
      category
    };

  } catch (err) {
    console.error('[GeminiService generateMetadata Error]', sanitizeErrorMessage(err.message, apiKey));
    throw new Error(sanitizeErrorMessage(err.message, apiKey));
  }
}

/**
 * Generate metadata using raw binary video data (bypassing Base64)
 */
export async function generateGeminiMetadataBinary({ apiKey, buffer, mimeType, filename, platform }) {
  if (!apiKey || typeof apiKey !== 'string') {
    throw new Error('Valid Gemini API key is required.');
  }
  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error('Valid video buffer is required.');
  }

  const normalizedMime = (mimeType || 'video/mp4').toLowerCase();
  const effectiveMime  = ALLOWED_MIME_TYPES.has(normalizedMime) ? normalizedMime : 'video/mp4';

  const platformObj = platform || { name: 'Adobe Stock', keywordMax: 49, titleMaxLen: 70, categories: [] };
  const kwMax = parseInt(platformObj.keywordMax, 10) || 49;
  const titleLimit = parseInt(platformObj.titleMaxLen, 10) || 70;

  const categoryOptions = Array.isArray(platformObj.categories) && platformObj.categories.length > 0
    ? platformObj.categories.join(', ')
    : 'General, Abstract, Animals, Architecture, Business, Food, Landscapes, Nature, People, Technology, Graphic Resources';

  const kwTarget = kwMax >= 49 ? '42 to 47' : `5 to ${kwMax}`;

  const prompt = `You are an expert commercial microstock metadata cataloger for ${platformObj.name}.
Analyze this visual asset accurately and generate commercial metadata.
STRICT INSTRUCTIONS:
- Describe ONLY what is ACTUALLY visible in the image.
- Do NOT invent non-existent objects, people, or brands.
- KEYWORD REQUIREMENT: Generate exactly ${kwTarget} unique, highly relevant keywords.
- Order keywords by relevance: the FIRST 10 keywords MUST be the most essential visual concepts.
- Title: Clear, descriptive, natural language title (maximum ${titleLimit} characters).
- Description: Natural, informative 1-2 sentence visual summary.
- Category: Select the single best matching category for this visual asset from this list: [${categoryOptions}].

FILENAME: ${filename}
PLATFORM: ${platformObj.name}
KEYWORD MAX: ${kwMax}`;

  // 1. Upload video to Gemini File API
  const uploadUrl = `https://generativelanguage.googleapis.com/upload/v1beta/files?key=${encodeURIComponent(apiKey)}`;
  
  const uploadRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'X-Goog-Upload-Protocol': 'raw',
      'X-Goog-Upload-Command': 'upload, finalize',
      'X-Goog-Upload-Header-Content-Length': buffer.length.toString(),
      'X-Goog-Upload-Header-Content-Type': effectiveMime,
      'Content-Type': effectiveMime
    },
    body: buffer
  });

  const uploadData = await uploadRes.json();
  if (!uploadRes.ok || !uploadData.file || !uploadData.file.name) {
    throw new Error(`Video upload to Gemini failed: ${uploadData?.error?.message || 'Unknown error'}`);
  }

  const uploadedFileName = uploadData.file.name;
  const fileUri = uploadData.file.uri;

  // 2. Poll until ACTIVE
  let fileState = uploadData.file.state;
  let attempts = 0;
  while (fileState === 'PROCESSING' && attempts < 30) {
    await new Promise(r => setTimeout(r, 2000));
    const statusRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/${uploadedFileName}?key=${encodeURIComponent(apiKey)}`);
    if (!statusRes.ok) break;
    const statusData = await statusRes.json();
    fileState = statusData.state;
    if (fileState === 'FAILED') throw new Error('Video processing failed on Gemini servers.');
    attempts++;
  }
  
  if (fileState !== 'ACTIVE') {
    throw new Error('Video processing timed out.');
  }

  const mediaPart = { file_data: { mime_type: effectiveMime, file_uri: fileUri } };
  const url = `${config.geminiBaseUrl}/${config.geminiModel}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const requestBody = {
    contents: [{ parts: [ { text: prompt }, mediaPart ] }],
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

  const genRes = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody)
  });

  const genData = await genRes.json();
  if (!genRes.ok) throw new Error(genData.error?.message || 'Gemini API generation request failed');

  const candidate = genData.candidates?.[0];
  if (!candidate || !candidate.content || !candidate.content.parts || !candidate.content.parts[0].text) {
    throw new Error('Gemini API returned an unexpected response structure.');
  }

  const rawText = candidate.content.parts[0].text;
  let text = rawText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    text = text.substring(firstBrace, lastBrace + 1).trim();
  }
  
  const parsed = JSON.parse(text);
  
  return {
    filename: parsed.filename || filename,
    title: parsed.title,
    description: parsed.description,
    keywords: parsed.keywords.slice(0, kwMax),
    category: parsed.category
  };
}
