import { handler } from './netlify/functions/api.mjs';

async function test() {
  const event = {
    httpMethod: 'POST',
    path: '/api/auth/login', // simulate what Netlify passes
    headers: {
      'content-type': 'application/json'
    },
    body: JSON.stringify({ email: 'test@test.com', password: 'password' }),
    isBase64Encoded: false
  };

  const context = {};

  try {
    const response = await handler(event, context);
    console.log('Response status:', response.statusCode);
    console.log('Response body:', response.body);
  } catch (err) {
    console.error('Handler crashed:', err);
  }
}

test();
