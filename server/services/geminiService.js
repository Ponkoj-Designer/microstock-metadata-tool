import { config } from '../config/config.js';

export async function testGeminiKey(apiKey) {
  if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length < 10) {
    return { ok: false, status: 400, message: 'Invalid or missing API key format.' };
  }

  const url = `${config.geminiBaseUrl}/${config.geminiModel}:generateContent?key=${apiKey.trim()}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: 'Ping' }] }],
        generationConfig: { maxOutputTokens: 5 }
      })
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, status: res.status, message: data?.error?.message || 'Gemini API key verification failed.' };
    }
    return { ok: true, status: 200, message: 'Gemini Connected' };
  } catch (err) {
    return { ok: false, status: 500, message: 'Server proxy network error.' };
  }
}

export async function generateGeminiMetadata({ apiKey, base64Image, mimeType, filename, platform }) {
  if (!apiKey) throw new Error('API key is required.');
  const url = `${config.geminiBaseUrl}/${config.geminiModel}:generateContent?key=${apiKey.trim()}`;

  const kwTarget = platform.keywordMax >= 49 ? '42 to 47' : `5 to ${platform.keywordMax}`;
  const prompt = `You are a microstock metadata specialist for ${platform.name}.
Analyze this image and return strict JSON with format:
{
  "filename": "${filename}",
  "title": "Descriptive commercial title",
  "description": "Clear 1-2 sentence visual description",
  "keywords": ["kw1", "kw2", ...],
  "category": "Category name"
}
Target ${kwTarget} unique relevant keywords. Max ${platform.keywordMax} keywords.`;

  const body = {
    contents: [{
      parts: [
        { text: prompt },
        { inline_data: { mime_type: mimeType || 'image/jpeg', data: base64Image } }
      ]
    }],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: 'application/json'
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error?.message || `Gemini error ${res.status}`);
  }

  const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const parsed = JSON.parse(rawText.replace(/^```json\s*|\s*```$/g, ''));
  return parsed;
}
