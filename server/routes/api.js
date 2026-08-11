import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { testGeminiKey, generateGeminiMetadata, generateGeminiMetadataBinary } from '../services/geminiService.js';

export const apiRouter = Router();

// GET /api/health
apiRouter.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '2.0.0' });
});

// POST /api/gemini/test — Server-side Gemini API key ping verification (Requires Auth)
apiRouter.post('/gemini/test', requireAuth, async (req, res) => {
  const apiKey = req.body?.apiKey || req.headers['x-gemini-api-key'] || req.headers['x-api-key'] || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(400).json({ ok: false, message: 'Gemini API key is required.' });
  }
  const result = await testGeminiKey(apiKey);
  return res.status(result.status || 200).json(result);
});

// POST /api/gemini/generate-video — Binary stream endpoint for huge video payloads
apiRouter.post('/gemini/generate-video', requireAuth, async (req, res) => {
  const apiKey = req.headers['x-gemini-api-key'] || req.headers['x-api-key'] || process.env.GEMINI_API_KEY;
  const mimeType = req.headers['content-type'];
  const filename = req.headers['x-filename'] ? decodeURIComponent(req.headers['x-filename']) : 'video.mp4';
  const platformStr = req.headers['x-platform'] ? decodeURIComponent(req.headers['x-platform']) : '{}';
  const settingsStr = req.headers['x-settings'] ? decodeURIComponent(req.headers['x-settings']) : 'null';
  const mode = req.headers['x-mode'] || 'metadata';
  
  let platform = {};
  try { platform = JSON.parse(platformStr); } catch(e){}
  
  let settings = null;
  try { settings = JSON.parse(settingsStr); } catch(e){}

  if (!apiKey) {
    return res.status(400).json({ ok: false, message: 'Gemini API key is required.' });
  }
  if (!Buffer.isBuffer(req.body)) {
    return res.status(400).json({ ok: false, message: 'Invalid video binary payload.' });
  }

  try {
    const data = await generateGeminiMetadataBinary({ apiKey, buffer: req.body, mimeType, filename, platform, settings, mode });
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message || 'Gemini video generation failed.' });
  }
});

// POST /api/gemini/generate — Server-side Gemini metadata proxy endpoint (Requires Auth)
apiRouter.post('/gemini/generate', requireAuth, async (req, res) => {
  const { base64Image, mimeType, filename, platform, settings, mode } = req.body || {};
  const apiKey = req.body?.apiKey || req.headers['x-gemini-api-key'] || req.headers['x-api-key'] || process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(400).json({ ok: false, message: 'Gemini API key is required. Add your key in AI Settings.' });
  }
  if (!base64Image) {
    return res.status(400).json({ ok: false, message: 'Image base64 data payload is required.' });
  }

  try {
    const data = await generateGeminiMetadata({ apiKey, base64Image, mimeType, filename, platform, settings, mode });
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message || 'Gemini generation failed.' });
  }
});

// POST /api/csv/export
apiRouter.post('/csv/export', (req, res) => {
  const { items, platform } = req.body || {};
  if (!Array.isArray(items) || !platform) {
    return res.status(400).json({ ok: false, message: 'items and platform are required' });
  }
  res.json({ ok: true, count: items.length, platform: platform.name });
});
