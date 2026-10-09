/**
 * Translation route — POST /api/translate
 *
 * Body: { text: string, direction: 'to-zh' | 'to-en' }
 * Uses an OpenAI-compatible chat API (configured in config/translate.js)
 * to translate diary content / comments between English and Traditional Chinese.
 */
import { Router } from 'express';
import { authMiddleware } from '../middleware/auth.js';
import { translateConfig } from '../config/translate.js';

const router = Router();

router.use(authMiddleware);

router.post('/', async (req, res) => {
  const { text, direction } = req.body || {};
  if (!text || typeof text !== 'string' || !text.trim()) {
    return res.status(400).json({ error: 'Missing text', errorZh: '缺少翻译内容' });
  }
  if (direction !== 'to-zh' && direction !== 'to-en') {
    return res.status(400).json({ error: 'Invalid direction', errorZh: '无效的翻译方向' });
  }

  const target = direction === 'to-zh'
    ? '繁體中文（Traditional Chinese）'
    : 'English';

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    const response = await fetch(`${translateConfig.apiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${translateConfig.apiKey}`,
      },
      body: JSON.stringify({
        model: translateConfig.model,
        messages: [
          {
            role: 'system',
            content: `You are a translator. Translate the user's text into ${target}. Output ONLY the translation, no explanations, no quotes.`,
          },
          { role: 'user', content: text },
        ],
        temperature: 0.2,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      console.error(`[translate] upstream ${response.status}:`, detail.slice(0, 300));
      return res.status(502).json({ error: `Translation service error (${response.status})`, errorZh: `翻译服务出错 (${response.status})` });
    }

    const data = await response.json();
    const translation = data?.choices?.[0]?.message?.content?.trim();
    if (!translation) {
      return res.status(502).json({ error: 'Empty translation', errorZh: '翻译结果为空' });
    }
    res.json({ translation });
  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({ error: 'Translation timed out', errorZh: '翻译超时' });
    }
    console.error('[translate] failed:', err?.message || err);
    res.status(500).json({ error: 'Translation failed', errorZh: '翻译失败' });
  }
});

export default router;
