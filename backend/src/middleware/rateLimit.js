/**
 * Rate limiting — protects credential endpoints from brute-force attacks.
 * In-memory store (per serverless instance); Vercel scales instances but
 * each instance still throttles its share of traffic.
 */
import rateLimit from 'express-rate-limit';

/** Login / auto-login: 10 attempts per 15 min per IP */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts, try again later', errorZh: '尝试次数过多，请稍后再试' },
});

/** Register / password reset: 5 per hour per IP */
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, try again later', errorZh: '请求过于频繁，请稍后再试' },
});
