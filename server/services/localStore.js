/**
 * Local JSON Store for fallback / dev / offline persistence.
 * Automatically synchronizes users, sessions, subscriptions, and transactions
 * to disk in `server/data/` when Supabase is not configured.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DATA_DIR = path.resolve(__dirname, '../data');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  } catch (_) {}
}

function getFilePath(collection) {
  return path.join(DATA_DIR, `${collection}.json`);
}

export function readCollection(collection) {
  const filePath = getFilePath(collection);
  try {
    if (!fs.existsSync(filePath)) {
      return [];
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw) || [];
  } catch (err) {
    console.warn(`[LocalStore] Failed to read ${collection}:`, err.message);
    return [];
  }
}

export function writeCollection(collection, data) {
  const filePath = getFilePath(collection);
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
  } catch (err) {
    console.warn(`[LocalStore] Failed to write ${collection}:`, err.message);
  }
}

// Seed initial admin user if empty
try {
  const users = readCollection('users');
  const adminEmail = 'ponkojdas6586@gmail.com';
  const existingAdmin = users.find(u => u.email?.toLowerCase() === adminEmail);
  if (!existingAdmin) {
    users.push({
      id: 'admin-ponkoj-das-master',
      email: adminEmail,
      full_name: 'Ponkoj Das',
      password_hash: '$2a$10$IdEgXNqOG.8T0OqDA5v5Tey33ypyqpU3awNZFI8niOW4bO5duPcQO',
      role: 'admin',
      plan: 'pro',
      credits: 15000,
      is_active: true,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    // Also add sample user
    users.push({
      id: 'demo-creator-user-01',
      email: 'creator.stock@example.com',
      full_name: 'Creative Stock Studio',
      password_hash: '$2b$12$e6xU4pQW/mEwXkMhyu5/C.4r3Jm7sVqB4G1f7H2l9K5y8Z3p1Q0wS',
      role: 'user',
      plan: 'free',
      credits: 250,
      is_active: true,
      created_at: new Date(Date.now() - 86400000).toISOString(),
      updated_at: new Date(Date.now() - 86400000).toISOString()
    });
    writeCollection('users', users);
  }
} catch (_) {}
