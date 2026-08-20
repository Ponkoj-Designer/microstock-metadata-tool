import express       from 'express';
import cors          from 'cors';
import path          from 'path';
import { fileURLToPath } from 'url';
import { apiRouter }  from './routes/api.js';

export const app = express();

// ── CORS ──────────────────────────────────────────────────────────────────────
app.use(cors({
  origin:      true,
  credentials: true
}));

// ── Body parsers ──────────────────────────────────────────────────────────────
app.use(express.raw({ type: ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'], limit: '150mb' }));
app.use(express.json({ limit: '100mb' }));

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const rootDir    = path.resolve(__dirname, '..');

// ── Serve static frontend files ───────────────────────────────────────────────
app.use(express.static(rootDir));

// ── API Routes ────────────────────────────────────────────────────────────────
app.use('/api', apiRouter);
app.use('/.netlify/functions/api', apiRouter);

