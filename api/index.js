import app, { ready } from '../backend/src/index.js';

// Vercel Node.js functions accept an async (req, res) handler.
// Express's app IS such a function — no serverless-http wrapper needed
// (the wrapper caused responses to never flush: 300s runtime timeouts).
export default async function handler(req, res) {
  // Ensure DB schema is initialized before the first request is served
  await ready;
  return app(req, res);
}
