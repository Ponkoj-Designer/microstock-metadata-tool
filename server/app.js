import express from 'express';
import cors from 'cors';
import { apiRouter } from './routes/api.js';

export const app = express();

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.static('.'));

app.use('/api', apiRouter);
