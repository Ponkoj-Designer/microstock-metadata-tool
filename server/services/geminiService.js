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

// ── Shared prompt-building helpers (used by both image and video endpoints) ──

function buildKwTarget(effectiveKwMax, kwMin) {
  if (effectiveKwMax >= 49) return '42 to 47';
  if (effectiveKwMax >= 40) return `${effectiveKwMax}`;
  if (kwMin)                return `${kwMin} to ${effectiveKwMax}`;
  return `5 to ${effectiveKwMax}`;
}

function buildCategoryOptions(platformObj) {
  return Array.isArray(platformObj.categories) && platformObj.categories.length > 0
    ? platformObj.categories.join(', ')
    : 'General, Abstract, Animals, Architecture, Business, Food, Landscapes, Nature, People, Technology, Graphic Resources';
}

function buildGenerationPrompt({ platformObj, kwTarget, titleLimit, categoryOptions, settings, mode, filename }) {
  let prompt = '';

  if (mode === 'img2prompt') {
    prompt = `You are a world-class AI art prompt engineer and visual taxonomist.
Analyze this visual asset accurately and generate a hyper-detailed, high-converting master AI prompt for Midjourney v6, Flux.1, DALL-E 3, and Stable Diffusion XL.
STRICT INSTRUCTIONS:
- Title: A vivid, comprehensive master prompt describing the primary subject, environment, lighting, composition, mood, and exact art style.
- Description: A detailed breakdown of visual elements, color palette, lighting atmosphere, and texture details.
- Keywords: 25-35 high-value visual modifier keywords, art style tags, lighting terms, and composition tags.
- Category: The artistic genre/medium (e.g. Photography, 3D Render, Digital Painting, Vector Art, Concept Art).`;
  } else {
    prompt = `You are a world-renowned Microstock SEO Specialist & Commercial Metadata Ranking Expert for top stock agencies (${platformObj.name}, Adobe Stock, Shutterstock, Freepik, Vecteezy, Getty/iStock, 123RF).
Your mission is to generate **ULTRA HIGH-SEO OPTIMIZED, TOP-RANKING METADATA** designed to rank on Page 1 / top search results for high-intent stock buyers.

=== MICROSTOCK SEO RANKING ALGORITHM RULES ===

1. TOP-RANKING COMMERCIAL TITLE (Strict limit: ${titleLimit} characters):
   - FRONT-LOAD the most powerful, highest search-volume commercial search terms in the FIRST 3 TO 5 WORDS.
   - Formula: [Core Subject / Focus] + [Format/Style: Vector / Illustration / Photo / 3D] + [Action / Theme / Mood] + [Composition / Background].
   - Focus on what real commercial buyers search for (e.g. "Cyberpunk Neon City Skyline Vector Background with Glowing Cyan Lights" instead of vague "City at night").
   - NEVER start with filler words like "A photo of", "An image of", "Illustration of", or artistic metaphors.
   - Keep within ${titleLimit} characters while maximizing keyword density.

2. TOP 5-10 KEYWORDS (CRITICAL ALGORITHM WEIGHT - 80% SEARCH RANKING):
   - Algorithms on Adobe Stock, Shutterstock, and Freepik weigh the FIRST 5-10 KEYWORDS most heavily.
   - Keywords 1-5 MUST be the absolute primary subject, core theme, and asset format (e.g. "vector", "background", "technology", "abstract", "banner").
   - Keywords 6-10 MUST be primary visual traits, primary colors, and main contextual environment.

3. REMAINING KEYWORDS (Generate exactly ${kwTarget} unique, high-traffic keywords):
   - Include high search-volume buyer intent queries:
     * Specific objects, shapes, textures, materials, and concepts visible.
     * Commercial usage & industry terms: "banner", "template", "wallpaper", "graphic design", "marketing", "web design", "presentation", "ui design".
     * If vector/illustration/SVG/EPS: Include essential vector search terms ("illustration", "vector", "scalable", "eps", "svg", "isolated", "clipart", "graphic element", "editable").
     * Relevant synonyms, mood, emotions, and seasonal/trend terms.
   - ALL keywords must be lowercase, separated, relevant, and 100% deduplicated.
   - No spamming or irrelevant keywords that cause stock reviewer rejections.

4. COMMERCIAL DESCRIPTION:
   - 1-2 natural, informative sentences with rich secondary search phrases for Google Image SEO indexing.

5. PLATFORM CATEGORY:
   - Choose the single best matching high-traffic category from: [${categoryOptions}].`;
  }

  if (settings?.customPrompt) {
    prompt += `\n\n- USER CUSTOM OVERRIDE INSTRUCTIONS: ${settings.customPrompt}`;
  }

  prompt += `\n\nFILENAME: ${filename}\nPLATFORM: ${platformObj.name}`;
  return prompt;
}

/**
 * Server-side metadata generation proxy for image / vector assets.
 */
export async function generateGeminiMetadata({ apiKey: providedKey, base64Image, mimeType = 'image/jpeg', filename = 'asset.jpg', platform, settings, mode }) {
  const apiKey = (providedKey || process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) throw new Error('Gemini API key is required. Please provide an API key.');

  // Payload validations
  if (!base64Image || typeof base64Image !== 'string' || base64Image.length < 50) {
    throw new Error('Invalid or missing base64 image data payload.');
  }

  const normalizedMime = (mimeType || 'image/jpeg').toLowerCase();
  const effectiveMime  = ALLOWED_MIME_TYPES.has(normalizedMime) ? normalizedMime : 'image/jpeg';

  const platformObj = platform || { name: 'Adobe Stock', keywordMax: 49, titleMaxLen: 70, categories: [] };

  // Determine effective kwMax and titleLimit (settings override platform defaults)
  const platformKwMax = parseInt(platformObj.keywordMax, 10) || 49;
  const effectiveKwMax = settings?.kwMax ? parseInt(settings.kwMax, 10) : platformKwMax;
  const effectiveTitleLimit = settings?.titleMax ? parseInt(settings.titleMax, 10) : (parseInt(platformObj.titleMaxLen, 10) || 70);

  const kwTarget = buildKwTarget(effectiveKwMax, settings?.kwMin);
  const categoryOptions = buildCategoryOptions(platformObj);
  const prompt = buildGenerationPrompt({ platformObj, kwTarget, titleLimit: effectiveTitleLimit, categoryOptions, settings, mode, filename });

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

    const title = (mode === 'img2prompt'
      ? String(parsed.title || '')
      : String(parsed.title || '').substring(0, effectiveTitleLimit)
    ).trim();
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
    keywords = keywords.slice(0, effectiveKwMax);

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
export async function generateGeminiMetadataBinary({ apiKey: providedKey, buffer, mimeType = 'video/mp4', filename = 'video.mp4', platform, settings, mode }) {
  const apiKey = (providedKey || process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) throw new Error('Gemini API key is required.');

  if (!buffer || !Buffer.isBuffer(buffer)) {
    throw new Error('Invalid or missing binary buffer payload.');
  }

  const normalizedMime = (mimeType || 'video/mp4').toLowerCase();
  const effectiveMime  = ALLOWED_MIME_TYPES.has(normalizedMime) ? normalizedMime : 'video/mp4';

  const platformObj = platform || { name: 'Adobe Stock', keywordMax: 49, titleMaxLen: 70, categories: [] };

  // Determine effective kwMax and titleLimit
  const platformKwMax = parseInt(platformObj.keywordMax, 10) || 49;
  const effectiveKwMax = settings?.kwMax ? parseInt(settings.kwMax, 10) : platformKwMax;
  const effectiveTitleLimit = settings?.titleMax ? parseInt(settings.titleMax, 10) : (parseInt(platformObj.titleMaxLen, 10) || 70);

  const kwTarget = buildKwTarget(effectiveKwMax, settings?.kwMin);
  const categoryOptions = buildCategoryOptions(platformObj);
  const prompt = buildGenerationPrompt({ platformObj, kwTarget, titleLimit: effectiveTitleLimit, categoryOptions, settings, mode, filename });

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
    keywords: Array.isArray(parsed.keywords) ? parsed.keywords.slice(0, effectiveKwMax) : [],
    category: parsed.category
  };
}
