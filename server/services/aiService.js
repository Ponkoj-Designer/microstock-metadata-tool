/**
 * Multi-Provider AI Service — Unified proxy for Google Gemini, OpenAI, and OpenRouter APIs.
 * Supports image analysis, commercial metadata generation, and AI prompt engineering.
 */

import { generateGeminiMetadata, generateGeminiMetadataBinary, testGeminiKey } from './geminiService.js';

export const AI_PROVIDERS = {
  gemini: {
    id: 'gemini',
    name: 'Google Gemini',
    getKeyUrl: 'https://aistudio.google.com/app/apikey',
    placeholder: 'AIzaSy...',
    defaultModel: 'gemini-2.5-flash'
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
    defaultModel: 'google/gemini-2.5-flash'
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
 * Universal Metadata Generator supporting Gemini, OpenAI, and OpenRouter
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

  const platformObj = platform || { name: 'Adobe Stock', keywordMax: 49, titleMaxLen: 70, categories: [] };
  const platformKwMax = parseInt(platformObj.keywordMax, 10) || 49;
  const effectiveKwMax = settings?.kwMax ? parseInt(settings.kwMax, 10) : platformKwMax;
  const effectiveTitleLimit = settings?.titleMax ? parseInt(settings.titleMax, 10) : (parseInt(platformObj.titleMaxLen, 10) || 70);

  const kwTarget = (effectiveKwMax >= 49) ? '42 to 47' : (effectiveKwMax >= 40 ? `${effectiveKwMax}` : `5 to ${effectiveKwMax}`);
  const categoryOptions = Array.isArray(platformObj.categories) && platformObj.categories.length > 0
    ? platformObj.categories.join(', ')
    : 'General, Abstract, Animals, Architecture, Business, Food, Landscapes, Nature, People, Technology, Graphic Resources';

  let prompt = '';
  if (mode === 'img2prompt') {
    prompt = `You are a world-class AI art prompt engineer and visual taxonomist.
Analyze this visual asset accurately and generate a hyper-detailed, high-converting master AI prompt for Midjourney v6, Flux.1, DALL-E 3, and Stable Diffusion XL.
Respond STRICTLY with a valid JSON object matching this schema:
{
  "title": "A vivid, comprehensive master prompt describing subject, environment, lighting, composition, mood, art style",
  "description": "Detailed breakdown of visual elements, color palette, atmosphere, texture",
  "keywords": ["25-35 visual modifier keywords", "art style tags", "lighting terms"],
  "category": "Artistic genre/medium (e.g. Photography, 3D Render, Digital Painting, Vector Art)"
}`;
  } else {
    prompt = `You are a world-renowned Microstock SEO Specialist & Commercial Metadata Ranking Expert for ${platformObj.name}, Adobe Stock, Shutterstock, Freepik, and Vecteezy.
Generate **ULTRA HIGH-SEO OPTIMIZED, TOP-RANKING METADATA** engineered to rank on Page 1 for high-volume buyer searches.

STRICT MICROSTOCK SEO RULES:
1. TITLE: Front-load the highest search volume commercial keywords in the FIRST 3-5 WORDS. Format: [Subject] + [Medium/Vector/Photo] + [Action/Theme] + [Composition]. Max ${effectiveTitleLimit} chars. Never use generic filler words.
2. FIRST 5-10 KEYWORDS: Crucial algorithm ranking weight. Keywords 1-5 MUST be primary subject, core theme & format ("vector", "background", "technology", etc). Keywords 6-10 must be main visual attributes and colors.
3. REMAINING KEYWORDS: Exactly ${kwTarget} unique high-traffic buyer queries including objects, commercial uses ("banner", "template", "graphic design"), vector terms ("illustration", "svg", "eps", "scalable", "isolated") if vector, and synonyms. All lowercase, strictly unique.
4. DESCRIPTION: 1-2 informative commercial sentences for Google Image SEO.
5. CATEGORY: Select single best matching category from: [${categoryOptions}].

Respond STRICTLY with a valid JSON object matching this schema:
{
  "title": "High-Converting Front-Loaded Commercial Title",
  "description": "Natural commercial visual summary",
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
    max_tokens: 1500
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
    const lastBrace = contentText.lastIndexOf('}');
    if (firstBrace !== -1 && lastBrace > firstBrace) {
      parsed = JSON.parse(contentText.substring(firstBrace, lastBrace + 1));
    } else {
      throw new Error(`Failed to parse ${AI_PROVIDERS[provider]?.name} JSON output.`);
    }
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
  keywords = keywords.map(k => String(k).toLowerCase().trim()).filter(k => k.length > 0);
  const seen = new Set();
  keywords = keywords.filter(k => { if (seen.has(k)) return false; seen.add(k); return true; });
  keywords = keywords.slice(0, effectiveKwMax);

  if (!title) throw new Error('Generated title was empty.');

  return {
    filename: parsed.filename || filename,
    title,
    description,
    keywords,
    category
  };
}
