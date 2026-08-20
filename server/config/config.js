import 'dotenv/config';

export const config = {
  // Server
  port:         process.env.PORT     || 3000,
  nodeEnv:      process.env.NODE_ENV || 'development',

  geminiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
  geminiModel:   'gemini-3.5-flash',

  // Supabase — set via environment variables, NEVER hardcode keys here
  supabaseUrl:  process.env.SUPABASE_URL                || '',
  supabaseKey:  process.env.SUPABASE_SERVICE_ROLE_KEY   || '',

  // JWT — use a strong random secret in production (openssl rand -hex 32)
  jwtSecret:    process.env.JWT_SECRET     || 'dev-only-insecure-please-set-JWT_SECRET-env-var',
  jwtExpiresIn: process.env.JWT_EXPIRES_IN || '7d',

  // CORS — set to your Netlify URL in production
  allowedOrigin: process.env.ALLOWED_ORIGIN || 'http://localhost:3000',
};
