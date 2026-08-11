import 'dotenv/config'; // Load .env for local development (no-op in Netlify where vars are injected)
import { config } from './config/config.js';
import { app } from './app.js';

app.listen(config.port, () => {
  console.log(`Microstock SaaS Backend running on http://localhost:${config.port}`);
});
