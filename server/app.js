import express       from 'express';
import cors          from 'cors';
import cookieParser  from 'cookie-parser';
import { config }    from './config/config.js';
import { authMiddleware } from './middleware/auth.js';
import { authRouter } from './routes/auth.js';
import { userRouter } from './routes/user.js';
import { adminRouter } from './routes/admin.js';
import { paymentRouter } from './routes/payment.js';
import { apiRouter }  from './routes/api.js';

export const app = express();

// ── CORS — reflect origin, allow credentials (needed for httpOnly cookies) ────
app.use(cors({
  origin:      true,     // Reflect the request Origin (safe: cookies are httpOnly + SameSite=Strict)
  credentials: true      // Required for Set-Cookie headers to be accepted by browsers
}));

// ── Body parsers ──────────────────────────────────────────────────────────────
app.use(express.raw({ type: ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'], limit: '150mb' }));
app.use(express.json({ limit: '100mb' }));

// ── Cookie parser — MUST come before authMiddleware ───────────────────────────
app.use(cookieParser());

// ── Serve static frontend files ───────────────────────────────────────────────
app.use(express.static('.'));

// ── Auth middleware — populates req.user on every request ─────────────────────
// Non-blocking: sets req.user = null if no valid session exists.
app.use(authMiddleware);

// ── Routes ────────────────────────────────────────────────────────────────────
const mountApi = (routerApp, prefix) => {
  routerApp.use(`${prefix}/auth`,    authRouter);   // signup, login, logout, me
  routerApp.use(`${prefix}/user`,    userRouter);   // user profile & subscription plan
  routerApp.use(`${prefix}/payment`, paymentRouter); // pricing plans, payment checkout & confirmation
  routerApp.use(`${prefix}/admin`,   adminRouter);  // protected admin endpoints (user management, plans, credits)
  routerApp.use(`${prefix}`,         apiRouter);    // existing API routes (health, gemini, csv)
};

// Mount at all possible Netlify/serverless base paths
mountApi(app, '/api');
mountApi(app, '/.netlify/functions/api');
mountApi(app, ''); // Catch-all for when serverless-http completely strips the base path
