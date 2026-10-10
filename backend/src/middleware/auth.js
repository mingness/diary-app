/**
 * JWT authentication & role-based access control.
 */
import jwt from 'jsonwebtoken';
import { deriveUserMasterKey } from '../crypto/encryption.js';
import { getUserByName } from '../services/userService.js';

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // Fail fast — a missing/weak secret allows token forgery (auth bypass).
  // Only allow local development without a secret.
  if (process.env.VERCEL || process.env.NODE_ENV === 'production') {
    throw new Error('JWT_SECRET environment variable is required in production');
  }
  console.warn('[auth] JWT_SECRET not set — using insecure dev secret (LOCAL ONLY)');
}

const JWT_SECRET_VALUE = JWT_SECRET || 'dev-secret-change-in-production';

export function signToken(user) {
  return jwt.sign(
    { userName: user.user_name, role: user.role, id: user.id },
    JWT_SECRET_VALUE,
    { expiresIn: '8h' }
  );
}

export async function authMiddleware(req, res, next) {
  const token = req.cookies?.token || req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const payload = jwt.verify(token, JWT_SECRET_VALUE);
    const user = await getUserByName(payload.userName);
    if (!user) return res.status(401).json({ error: 'User not found' });
    req.user = user;
    req.userRole = user.role;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

/** Attach session password-derived key (password sent at login, stored in session token payload hash) */
export function sessionKeyMiddleware(req, res, next) {
  const sessionKey = req.headers['x-session-key'];
  if (sessionKey && req.user) {
    req.userMasterKey = deriveUserMasterKey(sessionKey, req.user.password_salt);
    req.sessionPassword = sessionKey;
  }
  next();
}

export function requireRole(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.userRole)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}
