/**
 * Multi-Provider AI Service — Unified proxy for Google Gemini, OpenAI, and OpenRouter APIs.
 * Supports image analysis, commercial metadata generation, and AI prompt engineering.
 */

import { generateGeminiMetadata, generateGeminiMetadataBinary, testGeminiKey, formatCategoryAndMeta } from './geminiService.js';

export const AI_PROVIDERS = {
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    getKeyUrl: 'https://aistudio.google.com/app/apikey',
    placeholder: 'AIzaSy...',
    defaultModel: 'gemini-3.5-flash-lite'
  },
  openai: {
    id: 'openai',
    name: 'OpenAI',
    getKeyUrl: 'https://platform.openai.com/api-keys',
    placeholder: 'sk-proj-...',
    defaultModel: 'gpt-4o-mini'
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    getKeyUrl: 'https://openrouter.ai/keys',
    placeholder: 'sk-or-v1-...',
    defaultModel: 'openrouter/auto'
  }
};

/**
 * Test connection for any supported provider API key.
 * Strictly tests the provided key against official provider endpoints.
 */
export async function testAiKey(provider = 'gemini', apiKey = '') {
  let cleanKey = String(apiKey || '').trim();

  if (!cleanKey) {
    return { ok: false, status: 400, message: `Please enter a valid ${AI_PROVIDERS[provider]?.name || provider} API key.` };
  }

  if (provider === 'gemini') {
    return await testGeminiKey(cleanKey);
  }

  try {
    let url = '';
    let headers = {};

    if (provider === 'openai') {
      url = 'https://api.openai.com/v1/models';
      headers = { Authorization: `Bearer ${cleanKey}` };
    } else if (provider === 'openrouter') {
      url = 'https://openrouter.ai/api/v1/auth/key';
      headers = { Authorization: `Bearer ${cleanKey}` };
    } else {
      return { ok: false, status: 400, message: `Unsupported provider: ${provider}` };
    }

    const res = await fetch(url, { method: 'GET', headers });
    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      return { ok: true, status: 200, message: `Successfully connected to ${AI_PROVIDERS[provider]?.name || provider} API!` };
    }

    const errorMsg = data?.error?.message || data?.message || `${AI_PROVIDERS[provider]?.name || provider} API key test failed.`;
    return { ok: false, status: res.status, message: errorMsg };
  } catch (err) {
    return { ok: false, status: 500, message: `Failed to reach ${AI_PROVIDERS[provider]?.name || provider} servers: ${err.message}` };
  }
}

/**
 * BUG FIX #6: Mirrors geminiService.js buildKwTarget() so kwMin is respected for all providers.
 */
function buildKwTarget(effectiveKwMax, kwMin) {
  if (effectiveKwMax >= 49) return '42 to 47';
  if (effectiveKwMax >= 40) return `${effectiveKwMax}`;
  if (kwMin)                return `${kwMin} to ${effectiveKwMax}`;
  return `5 to ${effectiveKwMax}`;
}

/**
 * Universal Metadata Generator supporting Gemini, OpenAI, and OpenRouter.
 */
export async function generateAiMetadata({ provider = 'gemini', apiKey, base64Image, mimeType = 'image/jpeg', filename = 'asset.jpg', platform, settings, mode, model }) {
  let cleanKey = String(apiKey || '').trim();

  if (provider === 'gemini') {
    const finalKey = cleanKey || process.env.GEMINI_API_KEY;
    if (!finalKey) throw new Error('Google Gemini API key is required. Add your key in AI Settings.');
    return await generateGeminiMetadata({ apiKey: finalKey, base64Image, mimeType, filename, platform, settings, mode, model });
  }

  if (!cleanKey) {
    if (provider === 'openai') cleanKey = process.env.OPENAI_API_KEY || '';
    else if (provider === 'openrouter') cleanKey = process.env.OPENROUTER_API_KEY || '';
  }

  if (!cleanKey) {
    throw new Error(`${AI_PROVIDERS[provider]?.name || provider} API key is required. Please add your key in AI Settings.`);
  }

  if (!base64Image || typeof base64Image !== 'string' || base64Image.length < 50) {
    throw new Error('Invalid or missing image payload.');
  }

  // BUG FIX #5: OpenAI and OpenRouter do NOT support video data URIs.
  // Only Gemini can handle video files (via File API upload).
  const isVideo = (mimeType || '').toLowerCase().startsWith('video/');
  if (isVideo) {
    throw new Error(
      `Video metadata generation is only supported with Google Gemini. ` +
      `Please switch your AI Engine to Gemini to process video files.`
    );
  }

  const platformObj_effective = platform || { name: 'Adobe Stock', keywordMax: 49, titleMaxLen: 70, categories: [] };
  const pId = (platformObj_effective?.id || platformObj_effective?.name || '').toLowerCase();
  const isAdobe         = pId === 'adobe' || pId.includes('adobestock') || pId.includes('adobe');
  const isShutterstock  = pId === 'shutterstock' || pId.includes('shutterstock');
  const isVecteezy      = pId === 'vecteezy' || pId.includes('vecteezy');
  const isDepositphotos = pId === 'depositphotos' || pId.includes('depositphotos');
  const is123RF         = pId === 'rf123' || pId === '123rf' || pId.includes('123rf');
  const isDreamstime    = pId === 'dreamstime' || pId.includes('dreamstime');
  const isMagnific      = pId === 'magnific' || pId.includes('magnific');

  const platformKwMax       = parseInt(platformObj_effective.keywordMax, 10) || 49;
  const effectiveKwMax      = settings?.kwMax ? parseInt(settings.kwMax, 10) : platformKwMax;
  const effectiveTitleLimit = isShutterstock ? 200 : (settings?.titleMax ? parseInt(settings.titleMax, 10) : (parseInt(platformObj_effective.titleMaxLen, 10) || 70));

  // BUG FIX #6: use shared buildKwTarget that respects kwMin
  const kwTarget = buildKwTarget(effectiveKwMax, settings?.kwMin);

  const categoryOptions = isShutterstock
    ? 'Abstract, Animals/Wildlife, Arts, Backgrounds/Textures, Beauty/Fashion, Buildings/Landmarks, Business/Finance, Celebrities, Education, Food and drink, Healthcare/Medical, Holidays, Industrial, Interiors, Miscellaneous, Nature, Objects, Parks/Outdoor, People, Religion, Science, Signs/Symbols, Sports/Recreation, Technology, Transportation, Vintage'
    : (Array.isArray(platformObj_effective.categories) && platformObj_effective.categories.length > 0
      ? platformObj_effective.categories.join(', ')
      : 'General, Abstract, Animals, Architecture, Business, Food, Landscapes, Nature, People, Technology, Graphic Resources');

  let prompt = '';
  if (mode === 'img2prompt' || mode === 'img2prompt-photo') {
    prompt = `You are a world-class AI Image Prompt Engineer specializing in commercial-safe, microstock-friendly, highly detailed AI image prompts for Midjourney v6, Flux.1, DALL-E 3, and Stable Diffusion XL.

CRITICAL PHOTO PROMPT INSTRUCTIONS (DEEP IMAGE ANALYSIS):
1. DEEP VISUAL ANALYSIS: Deeply analyze the uploaded image before generating the prompt. Describe the asset in maximum useful detail: main subject, secondary objects, composition, layout, perspective, camera angle, lighting, shadows, color palette, textures, materials, background, environment, depth of field, visual style, and important fine details.
2. ACCURATE REPRESENTATION: The prompt must accurately represent the uploaded image without inventing unrepresented important elements.
3. UNIQUE & ORIGINAL CREATION: Generate a unique, original master prompt specifically describing this exact image. Do NOT copy, imitate, or closely reproduce known stock-image prompts or generic templates. Avoid generic/template wording so different images produce genuinely unique prompts.
4. STRICT IP & TRADEMARK SAFETY: Never include brand names, logos, trademarks, copyrighted characters, celebrities, famous artwork, or protected IP. Use generic descriptors for people and objects.

Respond STRICTLY with a valid JSON object matching this schema:
{
  "title": "Master Photo Prompt: Detailed visual breakdown describing subject + objects + composition + camera framing + lighting & shadows + color palette + environment & depth + visual style (no brand names, logos, or real people)",
  "description": "Comprehensive visual description of scene elements, lighting atmosphere, lens optics, depth of field, surface textures, and color mood based strictly on the uploaded image",
  "keywords": ["25-35 specific visual modifier keywords", "photography style", "lighting setup", "composition tags", "camera/lens parameters", "surface textures"],
  "category": "Photography genre (e.g. Portrait Photography, Landscape Photography, Street Photography, Commercial Photography)"
}`;
  } else if (mode === 'img2prompt-video') {
    prompt = `You are a world-class AI Video Prompt Engineer specializing in commercial-safe, microstock-friendly, production-ready silent AI video prompts for Sora, Runway Gen-3, Pika Labs, Kling AI, and Stable Video Diffusion.

CRITICAL VIDEO PROMPT INSTRUCTIONS (PRODUCTION-READY MOTION CONCEPT):
1. DEEP IMAGE ANALYSIS & INDIVIDUAL MOTION CONCEPT: Deeply analyze the uploaded image individually to create a highly detailed, unique video prompt specifically describing that image and its natural possible motion over time. Do NOT generate a generic, reusable template prompt.
2. PRODUCTION-READY VIDEO ELEMENTS: Include subject & environment details, composition & camera framing, camera movement (pan, tilt, dolly, tracking, zoom, orbit, crane), natural subject/object movement progression over time, lighting & atmosphere, depth & perspective, realistic motion dynamics & timing, fine visual textures, and professional stock-footage quality with a clear beginning-to-end motion concept.
3. ABSOLUTELY NO AUDIO / SILENT VIDEO ONLY (MANDATORY): The video must contain NO SOUND: do NOT mention music, dialogue, voice, speech, narration, sound effects, ambient audio, or any audio references. Every video prompt MUST explicitly specify: "silent video, no audio, no voice, no music, no sound effects".
4. STRICT IP & TRADEMARK SAFETY: Never include brand names, logos, trademarks, copyrighted characters, celebrities, recognizable copyrighted designs, or protected IP.

Respond STRICTLY with a valid JSON object matching this schema:
{
  "title": "Master Video Prompt: Detailed subject + natural motion progression + camera movement + lighting & atmosphere + environment + timing. silent video, no audio, no voice, no music, no sound effects.",
  "description": "Production-ready video concept: scene composition, camera trajectory, subject movement timing, visual progression from start to finish, color grading, atmospheric depth. Strictly silent description without audio.",
  "keywords": ["25-35 video visual modifier keywords", "motion style", "camera technique", "visual effects", "color grading", "mood/atmosphere", "cinematic style"],
  "category": "Video genre (e.g. Cinematic B-Roll, Aerial Footage, Timelapse, Slow Motion, Animation, Motion Graphics, Documentary Style)"
}`;
  } else if (isAdobe) {
    prompt = `You are a world-renowned Microstock SEO Specialist and Adobe Stock Contributor Metadata Expert.
Generate **OFFICIAL ADOBE STOCK-OPTIMIZED, TOP-RANKING METADATA** engineered for maximum commercial visibility and buyer conversion based strictly on actual image content.

=== ADOBE STOCK SEO ALGORITHM RULES ===
1. VISUAL ACCURACY FIRST: Analyze main subject, secondary elements, concept, style (photo/vector/3D/illustration), composition, colors, and commercial search intent. Base all metadata strictly on what is genuinely present or supported by the visual asset. No hallucinated objects, brand names, or trademarks.
2. CRITICAL FIRST 10 KEYWORDS: Adobe Stock weighs the FIRST 10 KEYWORDS most heavily (80% search weight). Keywords 1-5 MUST be primary subject, core theme, and asset format ("vector", "photo", "background", "illustration", "3d"). Keywords 6-10 must be primary visual traits and colors.
3. REMAINING KEYWORDS: Exactly ${kwTarget} unique keywords. Order by importance: core subject -> visual traits -> contextual setting -> buyer-intent queries ("banner", "copy space", "template", "graphic element") -> long-tail terms. No keyword-stuffing, spam, or duplicate synonyms.
4. FRONT-LOADED COMMERCIAL TITLE: Max ${effectiveTitleLimit} characters. Front-load top commercial keywords in the first 3-5 words naturally. Never start with filler phrases ("A photo of").
5. COMMERCIAL DESCRIPTION & CATEGORY: 1-2 natural commercial sentences for Google Image SEO and single best category from: [${categoryOptions}].

Respond STRICTLY with a valid JSON object matching this schema:
{
  "filename": "${filename}",
  "title": "Front-Loaded Commercial Title",
  "description": "Natural commercial description in English",
  "keywords": ["keyword1", "keyword2", ...],
  "category": "Selected Category Name"
}`;
  } else if (isShutterstock) {
    prompt = `You are a world-renowned Microstock SEO Specialist & Shutterstock Contributor Metadata Expert.
Generate **OFFICIAL SHUTTERSTOCK-COMPLIANT, HIGH-CONVERTING COMMERCIAL METADATA** adhering strictly to Shutterstock Contributor specifications and actual image content:

SHUTTERSTOCK OFFICIAL RULES:
1. FILENAME: "${filename}".
2. DESCRIPTION (STRICT LIMIT: MAXIMUM 200 CHARACTERS IN ENGLISH): Unique, detailed factual description in English (max 200 chars). Front-load top commercial keywords in the first 3-5 words.
3. TITLE: Same commercial title matching description (max 200 chars). Never start with filler phrases ("A photo of").
4. KEYWORDS: Exactly ${kwTarget} unique high-traffic English keywords (7 to 50). Top 5-10 carry heavy search weight. Combine broad, mid-tier, and long-tail terms. Prioritize precise, specific search terms only when genuinely accurate. Put strongest terms first.
5. CATEGORY (Strictly ONE valid category by default; add a SECOND category ONLY when genuinely relevant): Select ONE valid category by default from: [${categoryOptions}]. If 2 apply, separate with a comma.

Respond STRICTLY with a valid JSON object matching this schema:
{
  "filename": "${filename}",
  "title": "Factual Commercial Title (max 200 chars)",
  "description": "Detailed unique description in English (strictly max 200 characters)",
  "keywords": ["keyword1", "keyword2", ...],
  "category": "PrimaryCategory, SecondaryCategory"
}`;
  } else if (isVecteezy) {
    prompt = `You are a world-renowned Graphic Design & Vector SEO Specialist for Vecteezy.
Generate **HIGH-DISCOVERABILITY VECTEEZY METADATA** optimized for vector, illustration, and graphic design search intent based strictly on visual content.

VECTEEZY RULES:
1. CRITICAL FIRST 5 KEYWORDS: Vecteezy prioritizes the FIRST 5 KEYWORDS heavily. Keywords 1-5 MUST be primary subject, asset format ("vector", "icon", "illustration", "background", "template"), and core theme.
2. RELEVANT KEYWORDS: Generate target ${kwTarget} strong keywords. Include essential vector terms ("vector", "scalable", "eps", "svg", "isolated", "graphic element", "editable", "template"). Order by search power. No keyword stuffing.
3. TITLE: Front-load primary subject and asset format (max ${effectiveTitleLimit} chars).
4. CATEGORY: Select category from: [${categoryOptions}].

Respond STRICTLY with a valid JSON object matching this schema:
{
  "filename": "${filename}",
  "title": "Front-Loaded Vector Title",
  "description": "Clear graphic summary and usage description in English",
  "keywords": ["keyword1", "keyword2", ...],
  "category": "Selected Category Name"
}`;
  } else if (isDepositphotos) {
    prompt = `You are a professional Microstock Metadata Specialist for Depositphotos.
Generate **ACCURATE, HIGH-RANKING DEPOSITPHOTOS METADATA** with natural descriptive titles and strong searchable keywords based strictly on actual image content.

DEPOSITPHOTOS RULES:
1. NATURAL DESCRIPTIVE TITLE: Max ${effectiveTitleLimit} chars front-loading key search terms in first 3-5 words.
2. STRONG SEARCHABLE KEYWORDS: Exactly ${kwTarget} keywords ordered by importance from core subject to visual attributes and buyer intent. Put strongest terms first.
3. DESCRIPTION & CATEGORY: Natural descriptive sentences. Category from: [${categoryOptions}].

Respond STRICTLY with a valid JSON object matching this schema:
{
  "filename": "${filename}",
  "title": "Natural Descriptive Commercial Title",
  "description": "Informative and natural English description",
  "keywords": ["keyword1", "keyword2", ...],
  "category": "Selected Category Name"
}`;
  } else if (is123RF) {
    prompt = `You are a professional Microstock SEO Specialist for 123RF.
Generate **COMMERCIALLY OPTIMIZED 123RF METADATA** with clear commercial search intent and high-volume relevant keywords based strictly on actual image content.

123RF RULES:
1. COMMERCIAL TITLE: Max ${effectiveTitleLimit} chars with core subject in first 3-5 words.
2. KEYWORDS: Exactly ${kwTarget} high-volume keywords front-loaded by search volume and commercial intent.
3. DESCRIPTION & CATEGORY: Category from: [${categoryOptions}].

Respond STRICTLY with a valid JSON object matching this schema:
{
  "filename": "${filename}",
  "title": "Commercial Search Title",
  "description": "Accurate commercial description in English",
  "keywords": ["keyword1", "keyword2", ...],
  "category": "Selected Category Name"
}`;
  } else if (isDreamstime) {
    prompt = `You are a professional Microstock Metadata Specialist for Dreamstime.
Generate **DISCOVERABILITY-OPTIMIZED DREAMSTIME METADATA** with relevant, descriptive, commercially useful keywords based strictly on visual content.

DREAMSTIME RULES:
1. DESCRIPTIVE TITLE: Clear descriptive image title (max ${effectiveTitleLimit} chars).
2. COMMERCIALLY USEFUL KEYWORDS: Exactly ${kwTarget} keywords ordered logically from primary subject to visual details, commercial use cases, and synonyms. Put strongest terms first.
3. DESCRIPTION & CATEGORY: Category from: [${categoryOptions}].

Respond STRICTLY with a valid JSON object matching this schema:
{
  "filename": "${filename}",
  "title": "Descriptive Image Title",
  "description": "Detailed visual description in English",
  "keywords": ["keyword1", "keyword2", ...],
  "category": "Selected Category Name"
}`;
  } else if (isMagnific) {
    prompt = `You are an AI Art & Visual Content Metadata Specialist for Magnific.
Generate **CONCISE, DESCRIPTIVE, SEO-FRIENDLY METADATA** focused strictly on actual visual content and aesthetic characteristics.

MAGNIFIC RULES:
1. CONCISE TITLE: Descriptive title capturing visual aesthetics and subject (max ${effectiveTitleLimit} chars).
2. VISUAL KEYWORDS: Exactly ${kwTarget} visual descriptors, style tags, lighting, atmosphere, textures, and aesthetic modifiers. Put strongest terms first.
3. DESCRIPTION & CATEGORY: Category from: [${categoryOptions}].

Respond STRICTLY with a valid JSON object matching this schema:
{
  "filename": "${filename}",
  "title": "Concise Descriptive Visual Title",
  "description": "Detailed aesthetic breakdown in English",
  "keywords": ["keyword1", "keyword2", ...],
  "category": "Selected Category Name"
}`;
  } else {
    // General / Universal Microstock
    prompt = `You are a world-renowned Microstock SEO Specialist & Commercial Metadata Ranking Expert across all major stock marketplaces.
Generate **BALANCED, TOP-RANKING UNIVERSAL MICROSTOCK METADATA** engineered for maximum discoverability based strictly on actual image content.

UNIVERSAL MICROSTOCK SEO RULES:
1. VISUAL ACCURACY FIRST: Base all metadata strictly on what is genuinely visible or supported by the media asset. No hallucinated objects, brand names, or trademarks.
2. TITLE: Front-load highest search volume commercial keywords in FIRST 3-5 WORDS. Formula: [Core Subject] + [Format/Style] + [Action/Theme] + [Composition/Background]. Max ${effectiveTitleLimit} chars. Never start with filler phrases ("A photo of").
3. FIRST 5-10 KEYWORDS: Keywords 1-5 MUST be primary subject, core theme & format ("vector", "photo", "background", "illustration", "3d render"). Keywords 6-10 must be main visual attributes, colors, and setting.
4. REMAINING KEYWORDS: Exactly ${kwTarget} unique buyer queries combining broad, mid-tier, and long-tail terms ("banner", "copy space", "graphic element", "template") ONLY when accurate. Put strongest terms first. No keyword-stuffing, spam, or duplicate synonyms.
5. DESCRIPTION & CATEGORY: 1-2 natural commercial sentences and category from: [${categoryOptions}].

Respond STRICTLY with a valid JSON object matching this schema:
{
  "filename": "${filename}",
  "title": "Front-Loaded Commercial Title",
  "description": "Natural commercial visual summary in English",
  "keywords": ["keyword1", "keyword2", ...],
  "category": "Selected Category Name"
}`;
  }

  if (settings?.customPrompt) {
    prompt += `\nUSER CUSTOM OVERRIDE INSTRUCTIONS: ${settings.customPrompt}`;
  }

  let apiUrl = '';
  let headers = { 'Content-Type': 'application/json' };
  let selectedModel = model || AI_PROVIDERS[provider]?.defaultModel;

  if (provider === 'openai') {
    apiUrl = 'https://api.openai.com/v1/chat/completions';
    headers['Authorization'] = `Bearer ${cleanKey}`;
  } else if (provider === 'openrouter') {
    apiUrl = 'https://openrouter.ai/api/v1/chat/completions';
    headers['Authorization'] = `Bearer ${cleanKey}`;
    headers['HTTP-Referer'] = 'https://microstock-metadata-tool.com';
    headers['X-Title'] = 'Microstock Metadata Tool';
  } else {
    throw new Error(`Unsupported AI Provider: ${provider}`);
  }

  const dataUri = `data:${mimeType || 'image/jpeg'};base64,${base64Image}`;

  // OpenRouter free tier can only afford ~1034 tokens — keep under that limit.
  // OpenAI has no such restriction, so allow more tokens for richer output.
  const maxTokens = provider === 'openrouter' ? 900 : 1200;

  const requestBody = {
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
    max_tokens: maxTokens
  };

  const res = await fetch(apiUrl, {
    method: 'POST',
    headers,
    body: JSON.stringify(requestBody)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data?.error?.message || data?.message || `${AI_PROVIDERS[provider]?.name || provider} API request failed.`;
    throw new Error(msg);
  }

  const contentText = data?.choices?.[0]?.message?.content || '';
  if (!contentText) throw new Error(`${AI_PROVIDERS[provider]?.name || provider} returned empty response content.`);

  let parsed;
  try {
    parsed = JSON.parse(contentText.replace(/^```(?:json)?\s*|\s*```$/gi, '').trim());
  } catch (_) {
    const firstBrace = contentText.indexOf('{');
    const lastBrace  = contentText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      parsed = JSON.parse(contentText.substring(firstBrace, lastBrace + 1));
    } else {
      throw new Error(`Failed to parse ${AI_PROVIDERS[provider]?.name} JSON output.`);
    }
  }

  return formatCategoryAndMeta(parsed, platformObj_effective, false, effectiveTitleLimit, effectiveKwMax, filename, mode);
}
