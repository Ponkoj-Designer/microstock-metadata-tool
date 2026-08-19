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
    prompt = `You are a world-class AI Image Prompt Engineer specializing in commercial-safe, microstock-friendly, original AI image prompts for Midjourney v6, Flux.1, DALL-E 3, and Stable Diffusion XL.

CRITICAL VISUAL ANALYSIS & GENERATION RULES (MUST FOLLOW):
1. VISUAL ANALYSIS:
   - Thoroughly analyze the reference image for: subject, composition, lighting, color palette, mood, style, camera angle, and visual concept.
2. ORIGINAL & UNIQUE CREATION (NON-REPETITIVE):
   - Create a NEW and UNIQUE generation prompt inspired by the visual concept, NOT a copy or reproduction.
   - Every generated image must contain unique and non-repetitive visual elements.
   - Never generate duplicate, cloned, repeated, mirrored, or unnecessarily identical objects, icons, patterns, decorations, or design elements.
   - Each main object must have its own unique shape, position, angle, detail, and visual characteristics.
   - Avoid repetitive layouts and predictable duplication.
   - If multiple similar objects are necessary, make each one visibly different in size, orientation, shape, position, or details.
   - Do not repeat the same design element more than necessary.
   - The final prompt should encourage one-of-a-kind, non-duplicated elements while preserving the original concept.
   - Always prioritize: ORIGINAL + UNIQUE + COMMERCIAL-SAFE + MICROSTOCK-FRIENDLY.
3. COPYRIGHT & TRADEMARK SAFETY:
   - NEVER include or reproduce logos, brand names, trademarks, copyrighted characters, famous artwork, protected designs, or recognizable branded products.
   - Do NOT identify or imitate a specific artist, photographer, designer, or living creator's exact style.
   - NEVER add brand names, trademark names, copyrighted character names, or unnecessary references to existing works.
4. GENERIC DESCRIPTORS FOR PEOPLE & OBJECTS:
   - If a recognizable person appears, describe generic visual characteristics (e.g. "young adult woman with curly hair", "elderly man with gray beard") instead of identifying or reproducing that person.
   - Replace protected elements with original, generic alternatives while preserving the overall concept and commercial usefulness.
5. MICROSTOCK SUITABILITY & CLEAN COMPOSITION:
   - Prioritize originality, visual variety, clean composition, and commercial microstock usability.
   - Make the final prompt suitable for commercial/microstock use and designed to minimize copyright, trademark, similarity, and infringement risks.

Respond STRICTLY with a valid JSON object matching this schema:
{
  "title": "Original, unique, non-duplicated master prompt: subject + composition + lighting + color atmosphere + mood + camera style (no names/brands)",
  "description": "Detailed breakdown: visual elements, color palette, depth of field, lens characteristics, atmosphere. No brand names or real people.",
  "keywords": ["25-35 visual modifier keywords", "photography style", "lighting terms", "composition tags", "camera/lens terms"],
  "category": "Photography genre (e.g. Portrait Photography, Landscape Photography, Street Photography, Commercial Photography)"
}`;
  } else if (mode === 'img2prompt-video') {
    prompt = `You are a world-class AI Video Prompt Engineer specializing in commercial-safe, microstock-friendly, silent AI video prompts for Sora, Runway Gen-3, Pika Labs, Kling AI, and Stable Video Diffusion.

CRITICAL VISUAL & MOTION RULES (MUST FOLLOW):
1. ORIGINAL & UNIQUE VIDEO CONCEPT:
   - Create an ORIGINAL, commercially safe video concept based on the reference's subject, composition, motion dynamics, lighting, and visual idea.
   - Make the scene visually unique, dynamic, and commercially usable for microstock.
   - Always prioritize: ORIGINAL + UNIQUE + COMMERCIAL-SAFE + MICROSTOCK-FRIENDLY.
2. STRICT COPYRIGHT & TRADEMARK SAFETY:
   - NEVER reproduce copyrighted characters, logos, trademarks, branded products, famous people, or protected designs.
   - Replace protected or recognizable elements with generic, copyright-free descriptions.
3. ABSOLUTELY NO AUDIO / SILENT VIDEO ONLY (MANDATORY):
   - NEVER include voice, dialogue, narration, speech, lyrics, music, sound effects, ambient audio, or any other audio references.
   - Every video prompt MUST explicitly specify: "silent video, no audio, no voice, no dialogue, no music, no sound effects."
   - Focus only on visuals, camera movement (pan, dolly, tracking, zoom, orbit), subject movement, environment, lighting, optics, and cinematic details.

Respond STRICTLY with a valid JSON object matching this schema:
{
  "title": "Original, copyright-safe, silent master VIDEO prompt: subject + visual motion/action + camera movement + lighting + environment + mood + cinematic grade. Must specify: silent video, no audio, no voice, no dialogue, no music, no sound effects.",
  "description": "Scene visual composition, motion dynamics, visual progression over time, color palette, atmospheric visual effects, camera lens style, final frame state. Strictly silent/visual-only without any audio.",
  "keywords": ["25-35 video visual modifier keywords", "motion style", "camera technique", "visual effects", "color grading", "mood/atmosphere", "cinematic style"],
  "category": "Video genre (e.g. Cinematic B-Roll, Aerial Footage, Timelapse, Slow Motion, Animation, Motion Graphics, Documentary Style)"
}`;
  } else if (isAdobe) {
    prompt = `You are a world-renowned Microstock SEO Specialist and Adobe Stock Contributor Metadata Expert.
Generate **OFFICIAL ADOBE STOCK-OPTIMIZED, TOP-RANKING METADATA** engineered for maximum commercial visibility and buyer conversion.

=== ADOBE STOCK SEO ALGORITHM RULES ===
1. VISUAL ANALYSIS FIRST: Analyze main subject, secondary elements, concept, style (photo/vector/3D/illustration), composition, colors, and commercial search intent.
2. CRITICAL FIRST 10 KEYWORDS: Adobe Stock weighs the FIRST 10 KEYWORDS most heavily. Keywords 1-5 MUST be primary subject, core theme, and asset format. Keywords 6-10 must be primary visual traits and colors.
3. REMAINING KEYWORDS: Exactly ${kwTarget} unique keywords. Prioritize high-search-potential buyer queries ONLY when genuinely relevant. Never keyword-stuff or invent details. Put strongest terms first.
4. FRONT-LOADED COMMERCIAL TITLE: Max ${effectiveTitleLimit} characters. Front-load top commercial keywords in the first 3-5 words.
5. COMMERCIAL DESCRIPTION: 1-2 natural, informative sentences for Google Image SEO.
6. PLATFORM CATEGORY: Select single best category from: [${categoryOptions}].

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
Generate **OFFICIAL SHUTTERSTOCK-COMPLIANT, HIGH-CONVERTING COMMERCIAL METADATA** adhering strictly to Shutterstock Contributor specifications:

SHUTTERSTOCK OFFICIAL RULES:
1. FILENAME: "${filename}".
2. DESCRIPTION (STRICT LIMIT: MAXIMUM 200 CHARACTERS IN ENGLISH): A unique, detailed factual description in English. Front-load top commercial keywords in the first 3-5 words. Must be <= 200 chars.
3. TITLE: Same commercial title matching description (max 200 chars).
4. KEYWORDS: Exactly ${kwTarget} unique high-traffic English keywords (7 to 50). Top 5-10 carry 80% search algorithm weight. Prioritize precise, specific search terms and avoid spam/trademarks. Put strongest terms first.
5. CATEGORY (Strictly ONE valid category by default; add a SECOND category ONLY when genuinely relevant): Select ONE valid category by default from this official list: [${categoryOptions}]. If a second category is genuinely relevant, separate them with a comma in the single 'category' field.

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
Generate **HIGH-DISCOVERABILITY VECTEEZY METADATA** optimized for vector, illustration, and graphic design search intent.

VECTEEZY RULES:
1. CRITICAL FIRST 5 KEYWORDS: Vecteezy prioritizes the FIRST 5 KEYWORDS heavily. Keywords 1-5 MUST be primary subject, asset type ("vector", "icon", "illustration", "template"), and primary theme.
2. RELEVANT KEYWORDS: Generate around 20–30 strong keywords (target ${kwTarget}). Include vector terms if applicable. Put strongest search terms first.
3. TITLE: Front-load primary subject and asset type (max ${effectiveTitleLimit} chars).
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
Generate **ACCURATE, HIGH-RANKING DEPOSITPHOTOS METADATA** with natural descriptive titles and strong searchable keywords.

DEPOSITPHOTOS RULES:
1. NATURAL DESCRIPTIVE TITLE: Max ${effectiveTitleLimit} chars front-loading key search terms.
2. STRONG SEARCHABLE KEYWORDS: Exactly ${kwTarget} keywords ordered by importance from primary subject to contextual attributes. Put strongest terms first.
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
Generate **COMMERCIALLY OPTIMIZED 123RF METADATA** with clear commercial search intent and high-volume relevant keywords.

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
Generate **DISCOVERABILITY-OPTIMIZED DREAMSTIME METADATA** with relevant, descriptive, commercially useful keywords.

DREAMSTIME RULES:
1. DESCRIPTIVE TITLE: Clear descriptive image name/title (max ${effectiveTitleLimit} chars).
2. COMMERCIALLY USEFUL KEYWORDS: Exactly ${kwTarget} keywords ordered logically from primary subject to visual details and synonyms. Put strongest terms first.
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
Generate **CONCISE, DESCRIPTIVE, SEO-FRIENDLY METADATA** focused on the actual visual content and aesthetic characteristics.

MAGNIFIC RULES:
1. CONCISE TITLE: Descriptive title capturing the visual aesthetics and subject (max ${effectiveTitleLimit} chars).
2. VISUAL KEYWORDS: Exactly ${kwTarget} visual descriptors, style tags, lighting, atmosphere, and aesthetic modifiers. Put strongest terms first.
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
Generate **BALANCED, TOP-RANKING UNIVERSAL MICROSTOCK METADATA** engineered for maximum discoverability across all major stock agencies.

UNIVERSAL MICROSTOCK SEO RULES:
1. TITLE: Front-load highest search volume commercial keywords in FIRST 3-5 WORDS. Max ${effectiveTitleLimit} chars.
2. FIRST 5-10 KEYWORDS: Keywords 1-5 MUST be primary subject, core theme & format. Keywords 6-10 must be main visual attributes and colors.
3. REMAINING KEYWORDS: Exactly ${kwTarget} unique buyer queries including objects, commercial uses, vector terms if applicable, and synonyms. Put strongest search terms first.
4. DESCRIPTION & CATEGORY: Category from: [${categoryOptions}].

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
