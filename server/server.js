import express from 'express';
import cors from 'cors';
import { config } from './config/config.js';
import { apiRouter } from './routes/api.js';

const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('.'));

app.use('/api', apiRouter);

app.listen(config.port, () => {
  console.log(`Microstock SaaS Backend running on http://localhost:${config.port}`);
});
