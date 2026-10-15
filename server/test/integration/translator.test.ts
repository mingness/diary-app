/**
 * The real OpenAI-compatible translator against a local stand-in for the provider: what it sends, and how it
 * fails. No third-party network (engineering standards §12.5).
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createOpenAiTranslator,
  systemPrompt,
  TranslationError,
} from '../../src/services/translator.js';

type Handler = (req: IncomingMessage, body: string, res: ServerResponse) => void;
let handler: Handler = () => {};
let server: Server;
let baseUrl: string;

beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => handler(req, body, res));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1/`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
});

const translator = (timeoutMs = 2_000) =>
  createOpenAiTranslator({ url: baseUrl, apiKey: 'sk-test', model: 'test-model' }, timeoutMs);
const reply =
  (status: number, json: unknown): Handler =>
  (_req, _body, res) => {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(json));
  };
const failure = (promise: Promise<unknown>) =>
  promise.then(
    () => null,
    (err: unknown) => (err instanceof TranslationError ? err.reason : err),
  );

describe('OpenAI-compatible translator', () => {
  it('posts the text with the key, model and direction, and returns the trimmed answer', async () => {
    let seen: { url?: string | undefined; auth?: string | undefined; body?: unknown } = {};
    handler = (req, body, res) => {
      seen = { url: req.url, auth: req.headers.authorization, body: JSON.parse(body) };
      reply(200, { choices: [{ message: { content: '  今天很好。\n' } }] })(req, body, res);
    };
    expect(await translator().translate('Today was good.', 'en_to_zh')).toBe('今天很好。');
    expect(seen).toEqual({
      url: '/v1/chat/completions',
      auth: 'Bearer sk-test',
      body: expect.objectContaining({
        model: 'test-model',
        messages: [
          { role: 'system', content: systemPrompt('en_to_zh') },
          { role: 'user', content: 'Today was good.' },
        ],
      }),
    });
    expect(systemPrompt('en_to_zh')).toContain('Traditional Chinese');
    expect(systemPrompt('zh_to_en')).toMatch(/from Chinese to English/);
  });

  it.each([
    ['an error status', reply(500, { error: { message: 'echoing your text' } })],
    ['no answer text', reply(200, { choices: [] })],
    ['an empty answer', reply(200, { choices: [{ message: { content: '  ' } }] })],
    [
      'a body that is not JSON',
      ((_req, _body, res) => {
        res.writeHead(200);
        res.end('<html>');
      }) as Handler,
    ],
  ])('fails cleanly on %s', async (_name, h) => {
    handler = h;
    expect(await failure(translator().translate('x', 'zh_to_en'))).toBe('failed');
  });

  it('gives up after the timeout', async () => {
    handler = () => {
      // Never answers.
    };
    expect(await failure(translator(100).translate('x', 'zh_to_en'))).toBe('timeout');
  });
});
