import 'dotenv/config';

export const config = {
  // Server
  port:         process.env.PORT     || 3000,
  nodeEnv:      process.env.NODE_ENV || 'development',

  geminiBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/models',
  geminiModel:   'gemini-3.5-flash-lite',

  // CORS — set to your Netlify URL in production
  allowedOrigin: process.env.ALLOWED_ORIGIN || 'http://localhost:3000',
};
