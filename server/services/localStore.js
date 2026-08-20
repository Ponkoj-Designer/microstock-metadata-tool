/**
 * Local JSON Store for fallback / dev / offline persistence.
 * Automatically synchronizes users, sessions, subscriptions, and transactions
 * to disk in `server/data/` when Supabase is not configured.
 */

import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BUNDLED_DATA_DIR = path.resolve(__dirname, '../data');

const isServerless = !!(
  process.env.NETLIFY ||
  process.env.AWS_LAMBDA_FUNCTION_NAME ||
  process.env.LAMBDA_TASK_ROOT ||
  process.env.VERCEL
);

const DATA_DIR = isServerless 
  ? path.join(os.tmpdir(), 'microstock-data')
  : BUNDLED_DATA_DIR;

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (_) {}
}

function getFilePath(collection) {
  return path.join(DATA_DIR, `${collection}.json`);
}

function getBundledFilePath(collection) {
  return path.join(BUNDLED_DATA_DIR, `${collection}.json`);
}

const DEFAULT_SEED_DATA = {
  users: [
    {
      id: 'admin-ponkoj-das-master',
      email: 'ponkojdas6586@gmail.com',
      full_name: 'Ponkoj Das',
      password_hash: '$2a$10$IdEgXNqOG.8T0OqDA5v5Tey33ypyqpU3awNZFI8niOW4bO5duPcQO',
      role: 'admin',
      plan: 'pro',
      credits: 15987,
      is_active: true,
      created_at: '2026-08-20T06:58:35.125Z',
      updated_at: '2026-08-20T07:04:03.682Z'
    },
    {
      id: 'demo-creator-user-01',
      email: 'creator.stock@example.com',
      full_name: 'Creative Stock Studio',
      password_hash: '$2b$12$e6xU4pQW/mEwXkMhyu5/C.4r3Jm7sVqB4G1f7H2l9K5y8Z3p1Q0wS',
      role: 'user',
      plan: 'free',
      credits: 250,
      is_active: true,
      created_at: '2026-08-19T06:58:35.143Z',
      updated_at: '2026-08-19T06:58:35.143Z'
    }
  ],
  sessions: [],
  subscriptions: [],
  credit_transactions: [],
  payments: []
};

// Global in-memory cache for fast, reliable serverless access
const _memoryStore = {
  users: [...DEFAULT_SEED_DATA.users],
  sessions: [],
  subscriptions: [],
  credit_transactions: [],
  payments: []
};

export function readCollection(collection) {
  const filePath = getFilePath(collection);
  try {
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        _memoryStore[collection] = parsed;
        return parsed;
      }
    }
    // In serverless, fallback to bundled static file if tmp not yet populated
    const bundledPath = getBundledFilePath(collection);
    if (fs.existsSync(bundledPath)) {
      const raw = fs.readFileSync(bundledPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        _memoryStore[collection] = parsed;
        writeCollection(collection, parsed);
        return parsed;
      }
    }
  } catch (err) {
    console.warn(`[LocalStore] Failed to read ${collection}:`, err.message);
  }
  return _memoryStore[collection] || DEFAULT_SEED_DATA[collection] || [];
}

export function writeCollection(collection, data) {
  _memoryStore[collection] = Array.isArray(data) ? [...data] : data;
  const filePath = getFilePath(collection);
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    // In strict read-only serverless, in-memory store continues without failure
    console.warn(`[LocalStore] Disk write skipped for ${collection}:`, err.message);
  }
}

// Seed on startup
try {
  const currentUsers = readCollection('users');
  const adminEmail = 'ponkojdas6586@gmail.com';
  const existingAdmin = currentUsers.find(u => u.email?.toLowerCase() === adminEmail);
  if (!existingAdmin) {
    currentUsers.unshift(DEFAULT_SEED_DATA.users[0]);
    writeCollection('users', currentUsers);
  }
} catch (_) {}
