import { testAiKey, generateAiMetadata } from '../server/services/aiService.js';

async function runTest() {
  console.log('Testing AI Service Provider test pings...');

  // Test invalid key for each provider to ensure status code & message returned cleanly
  const providers = ['gemini', 'openai', 'groq', 'openrouter'];
  for (const p of providers) {
    const res = await testAiKey(p, 'invalid-test-key-12345');
    console.log(`[${p}] Ping response ok:`, res.ok, '| status:', res.status, '| message:', res.message);
  }

  console.log('\nAI Service logic structure check complete.');
}

runTest().catch(console.error);
