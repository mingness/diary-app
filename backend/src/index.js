import 'dotenv/config';
import 'express-async-errors';
import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import db from './db/index.js';
import { initSchema } from './db/schema.js';
import authRoutes from './routes/auth.js';
import documentRoutes from './routes/documents.js';
import userRoutes from './routes/users.js';
import countRoutes from './routes/count.js';
import { schedule as scheduleCountJob } from './services/countScheduler.js';
import translateRoutes from './routes/translate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// Uploaded images for rich editor
const uploadsDir = path.join(__dirname, '../uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

import multer from 'multer';
const upload = multer({ dest: uploadsDir });
app.post('/api/upload', (req, res, next) => {
  upload.single('image')(req, res, (err) => {
    if (err) return res.status(400).json({ error: 'Upload failed' });
    if (!req.file) return res.status(400).json({ error: 'No file' });
    res.json({ url: `/uploads/${req.file.filename}` });
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/users', userRoutes);
app.use('/api/count', countRoutes);
app.use('/api/translate', translateRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', title: '日记' }));

// APK download route
const apkDir = path.join(__dirname, '../downloads');
app.get('/api/download-apk', (req, res) => {
  fs.readdir(apkDir, (err, files) => {
    if (err) return res.status(404).json({ error: 'APK not found' });
    const apkFile = files.find(f => f.endsWith('.apk'));
    if (!apkFile) return res.status(404).json({ error: 'APK not found' });
    res.download(path.join(apkDir, apkFile), apkFile);
  });
});

// App version check for the Android auto-update flow.
// version = APK build timestamp (yyyyMMddHHmmss, Beijing time)
app.get('/api/app-version', (req, res) => {
  fs.readdir(apkDir, (err, files) => {
    if (err) return res.status(404).json({ error: 'APK not found' });
    const apkFile = files.find(f => f.endsWith('.apk'));
    if (!apkFile) return res.status(404).json({ error: 'APK not found' });
    // APK filename convention: diary-app-<yyyyMMddHHmmss>.apk (fallback: mtime)
    const m = apkFile.match(/(\d{14})/);
    const version = m ? m[1] : fs.statSync(path.join(apkDir, apkFile)).mtime.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
    res.json({ version, apk: apkFile });
  });
});

// Serve frontend static files (for browser access)
const frontendDist = path.join(__dirname, '../../frontend/dist');
console.log(`Looking for frontend dist at: ${frontendDist}`);
console.log(`Frontend dist exists: ${fs.existsSync(frontendDist)}`);

if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));
  // Catch-all for React Router (avoid capturing /api/*)
  app.get('*', (req, res) => {
    if (req.path.startsWith('/api/')) {
      return res.status(404).json({ error: 'Not found' });
    }
    res.sendFile(path.join(frontendDist, 'index.html'));
  });
} else {
  console.log('Frontend dist not found!');
}

// Initialize PostgreSQL schema, then start server
initSchema(db)
  .then(() => {
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`日记 backend running on http://localhost:${PORT}`);
      console.log(`可从局域网访问: http://0.0.0.0:${PORT}`);
      // Start the daily 0:00 auto-submit scheduler for the 报数 feature
      scheduleCountJob();
    });
  })
  .catch((err) => {
    console.error('Failed to initialize database schema:', err);
    process.exit(1);
  });
