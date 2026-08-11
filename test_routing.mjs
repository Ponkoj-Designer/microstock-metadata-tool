import { app } from './server/app.js';
import http from 'http';

const server = http.createServer(app);

server.listen(0, async () => {
  const port = server.address().port;
  console.log(`Server started on port ${port}`);

  try {
    const res = await fetch(`http://localhost:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@test.com', password: 'password' })
    });
    console.log('Status 1 (/api/...):', res.status);
    const text = await res.text();
    console.log('Body 1:', text);
  } catch (err) {
    console.error('Fetch error:', err);
  }

  try {
    const res2 = await fetch(`http://localhost:${port}/.netlify/functions/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@test.com', password: 'password' })
    });
    console.log('Status 2 (/.netlify/...):', res2.status);
    const text2 = await res2.text();
    console.log('Body 2:', text2);
  } catch (err) {
    console.error('Fetch error 2:', err);
  }
  
  try {
    const res3 = await fetch(`http://localhost:${port}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'test@test.com', password: 'password' })
    });
    console.log('Status 3 (/auth/...):', res3.status);
    const text3 = await res3.text();
    console.log('Body 3:', text3);
  } catch (err) {
    console.error('Fetch error 3:', err);
  }

  server.close();
});
