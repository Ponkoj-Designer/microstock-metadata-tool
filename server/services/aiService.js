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
    return await generateGeminiMetadata({ apiKey: finalKey, base64Image, mimeType, filename, platform, settings, mode });
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
    prompt = `You are an expert AI art prompt engineer for text-to-image AI generators like Midjourney v6, Flux.1, DALL-E 3, and Stable Diffusion XL.
Analyze this visual asset accurately and generate a hyper-detailed, highly descriptive AI image prompt.
Respond STRICTLY with a valid JSON object matching this schema:
{
  "title": "A vivid, comprehensive master prompt describing subject, environment, lighting, composition, mood, art style",
  "description": "Detailed breakdown of visual elements, color palette, atmosphere, texture",
  "keywords": ["20-30 visual modifier keywords", "art style tags", "lighting terms"],
  "category": "Artistic genre/medium (e.g. Photography, 3D Render, Digital Painting, Vector Art)"
}`;
  } else {
    prompt = `You are an expert commercial microstock metadata cataloger for ${platformObj.name}.
Analyze this visual asset accurately and generate commercial metadata.
STRICT INSTRUCTIONS:
- Describe ONLY what is ACTUALLY visible in the image.
- KEYWORD REQUIREMENT: Generate exactly ${kwTarget} unique, highly relevant keywords.
- Order keywords by relevance: the FIRST 10 keywords MUST be the most essential visual concepts.
- Title: Clear, descriptive title (maximum ${effectiveTitleLimit} characters).
- Description: Natural 1-2 sentence visual summary.
- Category: Select single best matching category from: [${categoryOptions}].
Respond STRICTLY with a valid JSON object matching this schema:
{
  "title": "Descriptive commercial title",
  "description": "Visual summary",
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
