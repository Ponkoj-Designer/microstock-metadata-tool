import { Router } from 'express';
import { testAiKey, generateAiMetadata } from '../services/aiService.js';
import { generateGeminiMetadataBinary } from '../services/geminiService.js';

export const apiRouter = Router();

// GET /api/health
apiRouter.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    mode: 'free',
    timestamp: new Date().toISOString(),
    version: '2.0.0'
  });
});

// POST /api/ai/test or /api/gemini/test — Multi-provider API key verification
const handleTestKey = async (req, res) => {
  const provider = req.body?.provider || req.headers['x-ai-provider'] || 'gemini';
  const apiKey = req.body?.apiKey || req.headers['x-ai-api-key'] || req.headers['x-gemini-api-key'] || req.headers['x-api-key'] || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(400).json({ ok: false, message: 'API key is required.' });
  }
  const result = await testAiKey(provider, apiKey);
  return res.status(result.status || 200).json(result);
};
apiRouter.post('/ai/test', handleTestKey);
apiRouter.post('/gemini/test', handleTestKey);

// POST /api/gemini/generate-video — Binary stream endpoint for video payloads
apiRouter.post('/gemini/generate-video', async (req, res) => {
  const apiKey = req.headers['x-gemini-api-key'] || req.headers['x-ai-api-key'] || req.headers['x-api-key'] || process.env.GEMINI_API_KEY;
  const mimeType = req.headers['content-type'];
  const filename = req.headers['x-filename'] ? decodeURIComponent(req.headers['x-filename']) : 'video.mp4';
  const platformStr = req.headers['x-platform'] ? decodeURIComponent(req.headers['x-platform']) : '{}';
  const settingsStr = req.headers['x-settings'] ? decodeURIComponent(req.headers['x-settings']) : 'null';
  const mode  = req.headers['x-mode']  || 'metadata';
  // BUG FIX #4: read model header so user-selected model is passed through
  const model = req.headers['x-model'] || null;

  let platform = {};
  try { platform = JSON.parse(platformStr); } catch(e){}

  let settings = null;
  try { settings = JSON.parse(settingsStr); } catch(e){}

  if (!apiKey) {
    return res.status(400).json({ ok: false, message: 'API key is required.' });
  }
  if (!Buffer.isBuffer(req.body)) {
    return res.status(400).json({ ok: false, message: 'Invalid video binary payload.' });
  }

  try {
    const data = await generateGeminiMetadataBinary({ apiKey, buffer: req.body, mimeType, filename, platform, settings, mode, model });
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message || 'Video generation failed.' });
  }
});

// POST /api/ai/generate or /api/gemini/generate — Multi-provider metadata proxy endpoint
const handleGenerateMetadata = async (req, res) => {
  const { base64Image, mimeType, filename, platform, settings, mode, provider: bodyProvider, model } = req.body || {};
  const provider = bodyProvider || req.headers['x-ai-provider'] || 'gemini';
  const apiKey = req.body?.apiKey || req.headers['x-ai-api-key'] || req.headers['x-gemini-api-key'] || req.headers['x-api-key'] || process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return res.status(400).json({ ok: false, message: 'API key is required. Add your key in AI Engine Settings.' });
  }
  if (!base64Image) {
    return res.status(400).json({ ok: false, message: 'Image base64 data payload is required.' });
  }

  try {
    const data = await generateAiMetadata({ provider, apiKey, base64Image, mimeType, filename, platform, settings, mode, model });
    return res.json({ ok: true, data });
  } catch (err) {
    return res.status(500).json({ ok: false, message: err.message || 'AI generation failed.' });
  }
};
apiRouter.post('/ai/generate', handleGenerateMetadata);
apiRouter.post('/gemini/generate', handleGenerateMetadata);

// POST /api/csv/export
apiRouter.post('/csv/export', (req, res) => {
  const { items, platform } = req.body || {};
  if (!Array.isArray(items) || !platform) {
    return res.status(400).json({ ok: false, message: 'items and platform are required' });
  }
  res.json({ ok: true, count: items.length, platform: platform.name });
});
