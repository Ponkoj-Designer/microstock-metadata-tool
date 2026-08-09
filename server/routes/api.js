import { Router } from 'express';
import { testGeminiKey, generateGeminiMetadata } from '../services/geminiService.js';

export const apiRouter = Router();

// GET /api/health
apiRouter.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString(), version: '2.0.0' });
});

// POST /api/gemini/test
apiRouter.post('/gemini/test', async (req, res) => {
  const { apiKey } = req.body || {};
  if (!apiKey) {
    return res.status(400).json({ ok: false, message: 'API key is required' });
  }
  const result = await testGeminiKey(apiKey);
  res.status(result.status || 200).json(result);
});

// POST /api/gemini/generate
apiRouter.post('/gemini/generate', async (req, res) => {
  const { apiKey, base64Image, mimeType, filename, platform } = req.body || {};
  if (!apiKey || !base64Image) {
    return res.status(400).json({ ok: false, message: 'apiKey and base64Image are required' });
  }
  try {
    const data = await generateGeminiMetadata({ apiKey, base64Image, mimeType, filename, platform });
    res.json({ ok: true, data });
  } catch (err) {
    res.status(500).json({ ok: false, message: err.message || 'Gemini generation failed' });
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
