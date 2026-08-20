import { handler } from './netlify/functions/api.js';

async function testNetlify() {
  console.log("Testing Netlify Functions Handler with Admin Login...");
  
  // 1. Test Login on Netlify
  const loginEvent = {
    httpMethod: 'POST',
    path: '/api/auth/login',
    headers: {
      'content-type': 'application/json',
      'host': 'microstock-tool.netlify.app',
      'x-forwarded-proto': 'https'
    },
    body: JSON.stringify({ email: 'ponkojdas6586@gmail.com', password: 'Admin12345!' }),
    isBase64Encoded: false
  };

  const loginRes = await handler(loginEvent, {});
  console.log('Netlify Login Status:', loginRes.statusCode);
  console.log('Netlify Login Headers:', loginRes.headers);
  console.log('Netlify Login MultiValueHeaders:', loginRes.multiValueHeaders);
  console.log('Netlify Login Body:', loginRes.body);

  const parsedBody = JSON.parse(loginRes.body || '{}');
  const token = parsedBody.token;

  // Extract cookie
  let cookieHeader = '';
  if (loginRes.headers && (loginRes.headers['set-cookie'] || loginRes.headers['Set-Cookie'])) {
    cookieHeader = loginRes.headers['set-cookie'] || loginRes.headers['Set-Cookie'];
  } else if (loginRes.multiValueHeaders && loginRes.multiValueHeaders['Set-Cookie']) {
    cookieHeader = loginRes.multiValueHeaders['Set-Cookie'].join('; ');
  }
  console.log('Extracted Cookie Header:', cookieHeader);

  // 2. Test GET /api/auth/me with Cookie
  console.log("\nTesting /api/auth/me with Cookie...");
  const meEvent = {
    httpMethod: 'GET',
    path: '/api/auth/me',
    headers: {
      'content-type': 'application/json',
      'cookie': cookieHeader,
      'host': 'microstock-tool.netlify.app',
      'x-forwarded-proto': 'https'
    },
    isBase64Encoded: false
  };
  const meRes = await handler(meEvent, {});
  console.log('Netlify /me Status (Cookie):', meRes.statusCode);
  console.log('Netlify /me Body (Cookie):', meRes.body);

  // 4. Test Sign Up on Netlify
  console.log("\nTesting /api/auth/signup on Netlify...");
  const signupEmail = `netlify_user_${Date.now()}@example.com`;
  const signupEvent = {
    httpMethod: 'POST',
    path: '/api/auth/signup',
    headers: {
      'content-type': 'application/json',
      'host': 'microstock-tool.netlify.app',
      'x-forwarded-proto': 'https'
    },
    body: JSON.stringify({
      fullName: 'Netlify Creator',
      email: signupEmail,
      password: 'NetlifyPass123!'
    }),
    isBase64Encoded: false
  };
  const signupRes = await handler(signupEvent, {});
  console.log('Netlify Signup Status:', signupRes.statusCode);
  console.log('Netlify Signup Body:', signupRes.body);

  // 5. Test Logout on Netlify
  console.log("\nTesting /api/auth/logout on Netlify...");
  const logoutEvent = {
    httpMethod: 'POST',
    path: '/api/auth/logout',
    headers: {
      'content-type': 'application/json',
      'cookie': cookieHeader,
      'host': 'microstock-tool.netlify.app',
      'x-forwarded-proto': 'https'
    },
    isBase64Encoded: false
  };
  const logoutRes = await handler(logoutEvent, {});
  console.log('Netlify Logout Status:', logoutRes.statusCode);
  console.log('Netlify Logout Body:', logoutRes.body);
  console.log('\n✅ ALL NETLIFY SERVERLESS TESTS PASSED!');
}

testNetlify();
