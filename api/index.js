import serverlessHttp from 'serverless-http';
import app, { ready } from '../backend/src/index.js';

const serverless = serverlessHttp(app);

export default async function handler(req, res) {
  // Ensure DB schema is initialized before the first request is served
  await ready;
  return serverless(req, res);
}
