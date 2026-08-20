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

  // 2. Authentication / Invalid Key (HTTP 400 / 401 / 403)
  if (
    status === 401 ||
    (status === 400 && (msgLower.includes('api_key_invalid') || msgLower.includes('api key not valid') || msgLower.includes('invalid api key')))
  ) {
    return 'Invalid Gemini API key. Please check your API key settings.';
  }

  // 3. Forbidden / Billing (HTTP 403)
  if (status === 403 && (msgLower.includes('unregistered callers') || msgLower.includes('permission_denied') || msgLower.includes('api consumer identity'))) {
    return 'Invalid Gemini API key. Please check your API key settings.';
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

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, { method: 'GET' });
    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      return { ok: true, status: 200, message: 'Successfully connected to Google Gemini API!' };
    }

    const errMsg = data?.error?.message || 'Invalid Gemini API key. Please check your API key.';
    return { ok: false, status: res.status, message: errMsg };
  } catch (err) {
    return { ok: false, status: 500, message: `Network error reaching Google Gemini servers: ${err.message}` };
  }
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

function buildKwTarget(effectiveKwMax, kwMin) {
  if (effectiveKwMax >= 49) return '42 to 47';
  if (effectiveKwMax >= 40) return `${effectiveKwMax}`;
  if (kwMin)                return `${kwMin} to ${effectiveKwMax}`;
  return `5 to ${effectiveKwMax}`;
}

function buildCategoryOptions(platformObj, isVideo = false) {
  const isShutterstock = (platformObj?.id === 'shutterstock' || (platformObj?.name && platformObj.name.toLowerCase().includes('shutterstock')));
  if (isShutterstock) {
    // BUG FIX #9: correctly use video vs image category list based on isVideo flag
    return (isVideo ? SHUTTERSTOCK_VIDEO_CATEGORIES : SHUTTERSTOCK_IMAGE_CATEGORIES).join(', ');
  }
  return Array.isArray(platformObj?.categories) && platformObj.categories.length > 0
    ? platformObj.categories.join(', ')
    : 'General, Abstract, Animals, Architecture, Business, Food, Landscapes, Nature, People, Technology, Graphic Resources';
}

function buildGenerationPrompt({ platformObj, kwTarget, titleLimit, categoryOptions, settings, mode, filename, isVideo = false }) {
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

STRICT OUTPUT FORMAT:
- Title: A vivid, original master photo prompt describing: subject + objects + composition + camera framing + lighting & shadows + color palette + environment & depth + visual style (no brand names, logos, or real people).
- Description: Comprehensive visual description of scene elements, lighting atmosphere, lens optics, depth of field, surface textures, and color mood based strictly on the uploaded image.
- Keywords: 25-35 specific visual modifier keywords covering: photography style, lighting setup, composition tags, camera/lens parameters, surface textures.
- Category: The photography/art genre (e.g. Portrait Photography, Landscape Photography, Street Photography, Commercial Photography, Macro Photography, 3D Render).`;

  } else if (mode === 'img2prompt-video') {
    prompt = `You are a world-class AI Video Prompt Engineer specializing in commercial-safe, microstock-friendly, production-ready silent AI video prompts for Sora, Runway Gen-3, Pika Labs, Kling AI, and Stable Video Diffusion.

CRITICAL VIDEO PROMPT INSTRUCTIONS (PRODUCTION-READY MOTION CONCEPT):
1. DEEP IMAGE ANALYSIS & INDIVIDUAL MOTION CONCEPT: Deeply analyze the uploaded image individually to create a highly detailed, unique video prompt specifically describing that image and its natural possible motion over time. Do NOT generate a generic, reusable template prompt.
2. PRODUCTION-READY VIDEO ELEMENTS: Include subject & environment details, composition & camera framing, camera movement (pan, tilt, dolly, tracking, zoom, orbit, crane), natural subject/object movement progression over time, lighting & atmosphere, depth & perspective, realistic motion dynamics & timing, fine visual textures, and professional stock-footage quality with a clear beginning-to-end motion concept.
3. ABSOLUTELY NO AUDIO / SILENT VIDEO ONLY (MANDATORY): The video must contain NO SOUND: do NOT mention music, dialogue, voice, speech, narration, sound effects, ambient audio, or any audio references. Every video prompt MUST explicitly specify: "silent video, no audio, no voice, no music, no sound effects".
4. STRICT IP & TRADEMARK SAFETY: Never include brand names, logos, trademarks, copyrighted characters, celebrities, recognizable copyrighted designs, or protected IP.

STRICT OUTPUT FORMAT:
- Title: An original, copyright-safe, silent master VIDEO prompt describing: subject + natural motion progression + camera movement + lighting & atmosphere + environment + timing. Must explicitly specify: "silent video, no audio, no voice, no music, no sound effects."
- Description: Production-ready video concept: scene composition, camera trajectory, subject movement timing, visual progression from start to finish, color grading, atmospheric depth. Strictly silent description without audio.
- Keywords: 25-35 visual video modifier keywords covering: motion style, camera technique, visual effects, color grading terms, mood/atmosphere, cinematic style descriptors.
- Category: The video genre (e.g. Cinematic B-Roll, Aerial Footage, Timelapse, Slow Motion, Animation, Motion Graphics, Documentary Style, Commercial Video).`;

  } else if (isAdobe) {
    prompt = `You are a world-renowned Microstock SEO Specialist and Adobe Stock Contributor Metadata Expert.
Your mission is to generate **OFFICIAL ADOBE STOCK-OPTIMIZED, TOP-RANKING METADATA** engineered for maximum commercial visibility and buyer conversion based strictly on actual image content.

=== ADOBE STOCK SEO ALGORITHM RULES ===
1. VISUAL ACCURACY & CONTENT TRUTH FIRST:
   - Analyze the image thoroughly: identify main subject, secondary elements, concept, style (photo/vector/3D/illustration), composition, colors, and commercial search intent.
   - Base all metadata strictly on what is genuinely present or supported by the visual asset. Never invent or hallucinate unrepresented elements, brands, trademarks, or people.
2. CRITICAL FIRST 10 KEYWORDS (80% SEARCH ALGORITHM WEIGHT):
   - Adobe Stock weighs the FIRST 10 KEYWORDS most heavily in its search ranking algorithm.
   - Keywords 1-5 MUST be the absolute primary subject, core theme, and asset format (e.g. "vector", "background", "technology", "abstract", "photo").
   - Keywords 6-10 MUST be primary visual traits, primary colors, and main contextual environment.
3. REMAINING KEYWORDS (Generate exactly ${kwTarget} unique keywords):
   - Order keywords strictly by importance and searchability: core subject -> visual traits -> contextual setting -> buyer-intent queries ("banner", "copy space", "template", "graphic element") -> relevant long-tail phrases.
   - Combine broad, mid-tier, and long-tail terms ONLY when genuinely accurate.
   - ALL keywords in lowercase, deduplicated, 100% relevant. NO keyword-stuffing, repetition, spam, brand names, or duplicate synonyms.
4. FRONT-LOADED COMMERCIAL TITLE (Strict limit: ${titleLimit} characters):
   - Front-load the most powerful, highest search-volume commercial keywords in the FIRST 3 TO 5 WORDS.
   - Formula: [Core Subject / Focus] + [Format/Style: Vector / Illustration / Photo / 3D] + [Action / Theme / Mood] + [Composition / Background].
   - Max ${titleLimit} characters. Never start with generic filler phrases like "A photo of" or "An image of".
5. COMMERCIAL DESCRIPTION:
   - 1-2 natural, informative English sentences with rich secondary search phrases.
6. PLATFORM CATEGORY:
   - Select the single best matching category from: [${categoryOptions}].

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
Generate **OFFICIAL SHUTTERSTOCK-COMPLIANT, HIGH-CONVERTING COMMERCIAL METADATA** adhering strictly to Shutterstock Contributor specifications and actual image content:

=== SHUTTERSTOCK OFFICIAL REQUIREMENTS ===
1. VISUAL ACCURACY: Base metadata strictly on actual media content. Never hallucinate unrepresented details, brand names, or trademarks.
2. FACTUAL, DESCRIPTIVE TITLE & DESCRIPTION (STRICT LIMIT: MAXIMUM 200 CHARACTERS):
   - A unique, detailed, factual description of the media in English up to 200 characters.
   - FRONT-LOAD top commercial search terms in the first 3 to 5 words.
   - Provide the same high-converting commercial title matching the description (max 200 chars). Never start with "A photo of".
3. KEYWORDS (Generate exactly ${kwTarget} unique keywords):
   - Order keywords strictly by relevance and importance: core subject & format first (keywords 1-10 carry major discovery weight), followed by specific objects, buyer intent ("copy space", "background", "graphic element"), and synonyms.
   - Prioritize high-search-volume terms ONLY when genuinely accurate. Combine broad and long-tail terms. No spam or keyword stuffing.
4. CATEGORIES (Strictly ONE valid category by default; add a SECOND category ONLY when genuinely relevant):
   - Generate exactly ONE valid category in English from this official Shutterstock list by default:
     [${categoryOptions}]
   - Add a SECOND category ONLY when genuinely relevant and distinct.
   - If two categories apply, store them in the single 'category' field separated by a comma (e.g. "Nature, Animals/Wildlife").

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
Your mission is to generate **HIGH-DISCOVERABILITY VECTEEZY METADATA** optimized for vector, illustration, and graphic design buyer search intent based strictly on visual content.

=== VECTEEZY SEO ALGORITHM RULES ===
1. CRITICAL FIRST 5 KEYWORDS:
   - Vecteezy's search engine prioritizes the FIRST 5 KEYWORDS heavily for ranking.
   - Keywords 1-5 MUST be the absolute primary subject, asset type ("vector", "icon", "illustration", "background", "pattern", "template"), and primary theme.
2. RELEVANT KEYWORDS (Generate target ${kwTarget} strong keywords):
   - Combine essential design terms ("vector", "illustration", "scalable", "eps", "svg", "isolated", "graphic element", "editable", "template") with precise subject tags.
   - Prioritize high-search-potential keywords ONLY when genuinely relevant. Order by search power. No keyword stuffing.
3. COMMERCIAL TITLE (Strict limit: ${titleLimit} characters):
   - Front-load the primary subject and asset format (e.g. "Minimalist Web Contact Icons Vector Set"). Max ${titleLimit} characters.
4. DESCRIPTION & CATEGORY:
   - Clear summary of graphic elements and usage. Select category from: [${categoryOptions}].

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
Generate **ACCURATE, HIGH-RANKING DEPOSITPHOTOS METADATA** with natural descriptive titles and strong searchable keywords based strictly on actual image content.

=== DEPOSITPHOTOS METADATA RULES ===
1. VISUAL ACCURACY: Identify main subject, secondary details, style, mood, composition, colors, and buyer search intent strictly from the visual asset.
2. NATURAL DESCRIPTIVE TITLE (Strict limit: ${titleLimit} characters):
   - Clear, natural, and descriptive commercial title front-loading key search terms in the first 3-5 words. Max ${titleLimit} characters.
3. STRONG SEARCHABLE KEYWORDS (Generate target ${kwTarget} keywords):
   - Ordered logically from core subject to contextual attributes and buyer intent.
   - Prioritize high-search-potential keywords ONLY when genuinely relevant. Put strongest terms first. No spam or keyword stuffing.
4. ACCURATE DESCRIPTION & CATEGORY:
   - 1-2 natural descriptive sentences. Select category from: [${categoryOptions}].

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
Generate **COMMERCIALLY OPTIMIZED 123RF METADATA** with clear commercial search intent and high-volume relevant keywords based strictly on actual image content.

=== 123RF METADATA RULES ===
1. VISUAL ACCURACY: Identify main subject, setting, style, mood, composition, colors, and commercial buyer intent.
2. CLEAR COMMERCIAL TITLE (Strict limit: ${titleLimit} characters):
   - Front-load core subject in the first 3-5 words naturally. Max ${titleLimit} characters.
3. HIGH-VOLUME RELEVANT KEYWORDS (Generate target ${kwTarget} keywords):
   - Order from most important core subject/medium to secondary details, concepts, and synonyms.
   - Put strongest and most searchable terms first. Never keyword-stuff.
4. ACCURATE DESCRIPTION & CATEGORY:
   - Accurate, commercial visual summary for search indexing. Select category from: [${categoryOptions}].

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
Generate **DISCOVERABILITY-OPTIMIZED DREAMSTIME METADATA** with relevant, descriptive, commercially useful keywords based strictly on visual content.

=== DREAMSTIME METADATA RULES ===
1. VISUAL ACCURACY: Identify primary subject, concept, visual technique, background, colors, and commercial application.
2. DESCRIPTIVE TITLE (Strict limit: ${titleLimit} characters):
   - Clear, descriptive title front-loading key search terms. Max ${titleLimit} characters.
3. COMMERCIALLY USEFUL KEYWORDS (Generate target ${kwTarget} keywords):
   - Order keywords logically: core subject -> action/theme -> visual details -> commercial use cases -> synonyms.
   - Put strongest and most searchable terms first. Genuinely relevant terms only. No keyword stuffing.
4. DESCRIPTION & CATEGORY:
   - Detailed visual description. Select primary category from: [${categoryOptions}].

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
Generate **CONCISE, DESCRIPTIVE, SEO-FRIENDLY METADATA** focused strictly on the actual visual content and aesthetic characteristics.

=== MAGNIFIC METADATA RULES ===
1. VISUAL CONTENT ANALYSIS: Analyze actual visual content: main subject, art style, rendering quality, lighting atmosphere, composition, color palette, and textures.
2. CONCISE DESCRIPTIVE TITLE (Strict limit: ${titleLimit} characters): Concise, descriptive title capturing exact visual subject and artistic style. Max ${titleLimit} characters.
3. AESTHETIC & VISUAL KEYWORDS (Generate target ${kwTarget} keywords): Cover core subject, style/medium, lighting/atmosphere, textures, colors, composition, and aesthetic descriptors. Put strongest visual search terms first.
4. VISUAL DESCRIPTION & CATEGORY: Detailed breakdown of visual elements. Select category from: [${categoryOptions}].

STRICT OUTPUT FORMAT (JSON ONLY):
{
  "filename": "${filename}",
  "title": "Concise Descriptive Visual Title (max ${titleLimit} chars)",
  "description": "Detailed aesthetic breakdown in English",
  "keywords": ["keyword1", "keyword2", ...],
  "category": "Selected Category Name"
}`;

  } else {
    // General / Universal Microstock
    prompt = `You are a world-renowned Microstock SEO Specialist & Commercial Metadata Ranking Expert across all major stock marketplaces (Adobe Stock, Shutterstock, Freepik, Vecteezy, Getty/iStock, 123RF, Depositphotos, Dreamstime).
Generate **BALANCED, TOP-RANKING UNIVERSAL MICROSTOCK METADATA** engineered for maximum discoverability based strictly on the image content.

=== UNIVERSAL MICROSTOCK SEO RULES ===
1. VISUAL ACCURACY FIRST: Base all metadata strictly on what is genuinely visible or supported by the media asset. No hallucinated objects, brand names, or trademarks.
2. STRONGEST SEARCH TERMS FIRST (TOP 5-10 KEYWORDS):
   - Keywords 1-5 MUST be the absolute primary subject, core theme, and asset format ("vector", "photo", "background", "illustration", "3d render").
   - Keywords 6-10 MUST be primary visual traits, primary colors, and main contextual setting.
3. BALANCED KEYWORDS (Generate target ${kwTarget} unique keywords):
   - Combine broad search terms, mid-tier tags, and long-tail buyer queries ("banner", "copy space", "graphic element", "template") ONLY when accurate.
   - Put strongest search terms first. No keyword-stuffing, spam, or duplicate synonyms.
4. TOP-RANKING COMMERCIAL TITLE (Strict limit: ${titleLimit} characters):
   - Front-load highest search volume commercial keywords in the FIRST 3 TO 5 WORDS.
   - Formula: [Core Subject] + [Format/Style] + [Action/Theme] + [Composition/Background]. Max ${titleLimit} characters. Never start with filler phrases ("A photo of").
5. COMMERCIAL DESCRIPTION: 1-2 natural commercial sentences and category from: [${categoryOptions}].

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
    prompt += `\n\n- USER CUSTOM OVERRIDE INSTRUCTIONS: ${settings.customPrompt}`;
  }

  prompt += `\n\nFILENAME: ${filename}\nPLATFORM: ${platformObj?.name || 'Stock'}`;
  return prompt;
}

export function formatCategoryAndMeta(parsed, platformObj, isVideo, effectiveTitleLimit, effectiveKwMax, filename, mode) {
  const isShutterstock = (platformObj?.id === 'shutterstock' || (platformObj?.name && platformObj.name.toLowerCase().includes('shutterstock')));
  const maxTitleLimit = isShutterstock ? 200 : effectiveTitleLimit;

  const isImg2Prompt = mode === 'img2prompt' || mode === 'img2prompt-photo' || mode === 'img2prompt-video';
  let title = (isImg2Prompt
    ? String(parsed.title || '')
    : String(parsed.title || '').substring(0, maxTitleLimit)
  ).trim();

  let description = String(parsed.description || title).trim();
  if (isShutterstock) {
    if (description.length > 200) {
      description = description.substring(0, 200).trim();
    }
    if (!title || title.length > 200) {
      title = description.substring(0, 200).trim();
    }
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
      || rawCat
      || catList[0];
  }

  let keywords = Array.isArray(parsed.keywords) ? parsed.keywords : String(parsed.keywords || '').split(',');
  keywords = keywords
    .map(k => String(k).toLowerCase().trim())
    .filter(k => k.length > 0);

  // Deduplicate while preserving relevance order
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

/**
 * Upload a video buffer to Gemini File API and poll until ACTIVE.
 * Returns { fileUri, uploadedFileName }
 */
async function uploadVideoToGemini(buffer, effectiveMime, apiKey) {
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

  // Poll until ACTIVE (max 60 seconds / 30 attempts × 2s)
  let fileState = uploadData.file.state;
  let attempts = 0;
  while (fileState === 'PROCESSING' && attempts < 30) {
    await new Promise(r => setTimeout(r, 2000));
    const statusRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/${uploadedFileName}?key=${encodeURIComponent(apiKey)}`
    );
    if (!statusRes.ok) break;
    const statusData = await statusRes.json();
    fileState = statusData.state;
    if (fileState === 'FAILED') throw new Error('Video processing failed on Gemini servers.');
    attempts++;
  }

  if (fileState !== 'ACTIVE') {
    throw new Error('Video processing timed out. Please try again.');
  }

  return { fileUri, uploadedFileName };
}

/**
 * Extract and parse JSON text from a Gemini candidate response.
 */
function extractJsonFromCandidate(candidate) {
  if (!candidate || !candidate.content || !candidate.content.parts || !candidate.content.parts[0]?.text) {
    const finishReason = candidate?.finishReason || 'UNKNOWN';
    throw new Error(`Gemini response missing text. finishReason=${finishReason}`);
  }

  const rawText = candidate.content.parts[0].text;
  console.log('[GeminiService] Raw response preview:', rawText.substring(0, 120));

  // Clean markdown code fences
  let text = rawText.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();

  // Extract first { ... } block
  const firstBrace = text.indexOf('{');
  const lastBrace  = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    text = text.substring(firstBrace, lastBrace + 1).trim();
  }

  // Fix common JSON issues: trailing commas before ] or }
  text = text
    .replace(/,\s*([}\]])/g, '$1')   // trailing commas
    .replace(/[\u0000-\u001F]/g, ' '); // control chars

  try {
    return JSON.parse(text);
  } catch (jsonErr) {
    console.warn('[GeminiService] JSON.parse failed, using regex fallback. Error:', jsonErr.message);
    const titleMatch = rawText.match(/"title"\s*:\s*"([^"]+)"/i);
    const descMatch  = rawText.match(/"description"\s*:\s*"([^"]+)"/i);
    const catMatch   = rawText.match(/"category"\s*:\s*"([^"]+)"/i);
    const kwMatches  = [...rawText.matchAll(/"([a-zA-Z][a-zA-Z0-9\s-]{1,29})"/g)]
      .map(m => m[1].trim())
      .filter(k => k.length > 1 && !['title','description','keywords','category','filename','json'].includes(k.toLowerCase()));

    const title       = titleMatch ? titleMatch[1].trim() : '';
    const description = descMatch  ? descMatch[1].trim()  : title;
    const category    = catMatch   ? catMatch[1].trim()   : 'General';

    if (title || description) {
      console.log('[GeminiService] Regex fallback OK:', { title: title.substring(0,40), kw: kwMatches.length });
      return { title: title || description, description, keywords: kwMatches, category };
    }
    throw new Error('Failed to parse Gemini response. Raw: ' + rawText.substring(0, 80));
  }
}

/**
 * Run Gemini generateContent using config.geminiModel (gemini-3.5-flash-lite).
 */
async function runGeminiModel(requestBody, apiKey) {
  const modelName = config.geminiModel || 'gemini-3.5-flash-lite';
  const url = `${config.geminiBaseUrl}/${modelName}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const abortController = new AbortController();
  const timeoutId = setTimeout(() => abortController.abort(), 8500);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestBody),
      signal: abortController.signal
    });

    clearTimeout(timeoutId);
    const resJson = await res.json().catch(() => ({}));

    if (!res.ok) {
      const classified   = classifyGeminiError(res.status, resJson);
      const safeErrorMsg = sanitizeErrorMessage(classified, apiKey);
      throw new Error(safeErrorMsg);
    }

    console.log(`[GeminiService] ✅ Success with model: ${modelName}`);
    return resJson;
  } catch (err) {
    clearTimeout(timeoutId);
    const msg = sanitizeErrorMessage(err.message || 'Gemini request failed', apiKey);
    throw new Error(msg);
  }
}



/**
 * Server-side metadata generation proxy for image / vector / video assets.
 * BUG FIX #3: Cleaned up try/catch scope — all logic is inside the single try block.
 * BUG FIX #9: isVideo now correctly passed to buildCategoryOptions.
 */
export async function generateGeminiMetadata({ apiKey: providedKey, base64Image, mimeType = 'image/jpeg', filename = 'asset.jpg', platform, settings, mode, model }) {
  const apiKey = (providedKey || process.env.GEMINI_API_KEY || '').trim();
  if (!apiKey) throw new Error('Gemini API key is required. Please provide an API key.');

  try {
    // Payload validation
    if (!base64Image || typeof base64Image !== 'string' || base64Image.length < 50) {
      throw new Error('Invalid or missing base64 image data payload.');
    }

    const normalizedMime = (mimeType || 'image/jpeg').toLowerCase();
    const effectiveMime  = ALLOWED_MIME_TYPES.has(normalizedMime) ? normalizedMime : 'image/jpeg';
    const isVideo        = effectiveMime.startsWith('video/');

    const platformObj = platform || { name: 'Adobe Stock', keywordMax: 49, titleMaxLen: 70, categories: [] };

    // Determine effective kwMax and titleLimit (settings override platform defaults)
    const platformKwMax       = parseInt(platformObj.keywordMax, 10) || 49;
    const effectiveKwMax      = settings?.kwMax ? parseInt(settings.kwMax, 10) : platformKwMax;
    const effectiveTitleLimit = settings?.titleMax ? parseInt(settings.titleMax, 10) : (parseInt(platformObj.titleMaxLen, 10) || 70);

    const kwTarget       = buildKwTarget(effectiveKwMax, settings?.kwMin);
    // BUG FIX #9: pass isVideo so Shutterstock gets video categories for video files
    const categoryOptions = buildCategoryOptions(platformObj, isVideo);
    const prompt         = buildGenerationPrompt({ platformObj, kwTarget, titleLimit: effectiveTitleLimit, categoryOptions, settings, mode, filename, isVideo });

    let cleanBase64 = String(base64Image || '').trim();
    if (cleanBase64.includes('base64,')) {
      cleanBase64 = cleanBase64.split('base64,')[1].trim();
    }
    cleanBase64 = cleanBase64.replace(/[\r\n\s]/g, '');

    let mediaPart;

    if (isVideo) {
      // Upload video to Gemini File API, poll until ACTIVE
      const buffer = Buffer.from(cleanBase64, 'base64');
      const { fileUri } = await uploadVideoToGemini(buffer, effectiveMime, apiKey);
      mediaPart = { file_data: { mime_type: effectiveMime, file_uri: fileUri } };
    } else {
      mediaPart = { inline_data: { mime_type: effectiveMime, data: cleanBase64 } };
    }

    const requestBody = {
      contents: [
        {
          parts: [
            mediaPart,
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

    console.log('[GeminiService] Using model: gemini-3.5-flash-lite');
    const data      = await runGeminiModel(requestBody, apiKey);
    const candidate = data.candidates?.[0];
    const parsed    = extractJsonFromCandidate(candidate);

    return formatCategoryAndMeta(parsed, platformObj, isVideo, effectiveTitleLimit, effectiveKwMax, filename, mode);

  } catch (err) {
    const safeMsg = sanitizeErrorMessage(err.message, apiKey);
    console.error('[GeminiService generateMetadata Error]', safeMsg);
    throw new Error(safeMsg);
  }
}

/**
 * Generate metadata using raw binary video data (bypassing Base64).
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
  const platformKwMax       = parseInt(platformObj.keywordMax, 10) || 49;
  const effectiveKwMax      = settings?.kwMax ? parseInt(settings.kwMax, 10) : platformKwMax;
  const effectiveTitleLimit = settings?.titleMax ? parseInt(settings.titleMax, 10) : (parseInt(platformObj.titleMaxLen, 10) || 70);

  const kwTarget        = buildKwTarget(effectiveKwMax, settings?.kwMin);
  // Always video=true for binary endpoint
  const categoryOptions = buildCategoryOptions(platformObj, true);
  const prompt          = buildGenerationPrompt({ platformObj, kwTarget, titleLimit: effectiveTitleLimit, categoryOptions, settings, mode, filename, isVideo: true });

  try {
    // Upload video to Gemini File API using shared helper
    const { fileUri } = await uploadVideoToGemini(buffer, effectiveMime, apiKey);
    const mediaPart   = { file_data: { mime_type: effectiveMime, file_uri: fileUri } };

    const requestBody = {
      contents: [{ parts: [ { text: prompt }, mediaPart ] }],
      generationConfig: {
        temperature: 0.35,
        maxOutputTokens: 2048,
        responseMimeType: 'application/json'
      }
    };

    console.log('[GeminiService] Using model: gemini-3.5-flash-lite');
    const data      = await runGeminiModel(requestBody, apiKey);
    const candidate = data.candidates?.[0];
    const parsed    = extractJsonFromCandidate(candidate);

    return formatCategoryAndMeta(parsed, platformObj, true, effectiveTitleLimit, effectiveKwMax, filename, mode);

  } catch (err) {
    const safeMsg = sanitizeErrorMessage(err.message, apiKey);
    console.error('[GeminiService generateMetadataBinary Error]', safeMsg);
    throw new Error(safeMsg);
  }
}
