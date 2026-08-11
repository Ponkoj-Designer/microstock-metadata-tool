/**
 * Supabase client singleton — SERVER-SIDE ONLY.
 * This file must NEVER be imported by frontend JS.
 * The service role key bypasses Row-Level Security and has full DB access.
 */

import { createClient } from '@supabase/supabase-js';
import { config } from '../config/config.js';

let _client = null;

export function getDbClient() {
  if (_client) return _client;

  if (!config.supabaseUrl || !config.supabaseKey) {
    throw new Error(
      'Database not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables.'
    );
  }

  _client = createClient(config.supabaseUrl, config.supabaseKey, {
    auth: {
      persistSession: false,   // Never persist auth state server-side
      autoRefreshToken: false
    }
  });

  return _client;
}

/**
 * Returns true if the database is configured (env vars are present).
 * Used by middleware to fail gracefully when DB is not set up.
 */
export function isDbConfigured() {
  return !!(config.supabaseUrl && config.supabaseKey);
}
