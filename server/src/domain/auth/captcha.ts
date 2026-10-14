/**
 * Human-verification images (spec §4.1): a distorted addition or subtraction question, drawn by the server.
 *
 * The question never reaches the client as text: characters are drawn as SVG strokes, and every control point
 * is jittered on every render, so the same digit never has the same path data twice (otherwise a bot could
 * look paths up in a table). Spec styling: gradient background, ~200 coloured noise dots, per-character
 * rotation/skew/colour, 5 Bézier interference curves and 15 faint decoy characters.
 *
 * This stops casual bots, not a determined attacker with an image model; rate limits are the real defence.
 */
import { createHmac, randomInt, timingSafeEqual } from 'node:crypto';

/** Injectable for deterministic tests. Returns an integer in [min, max). */
export type RandomInt = (min: number, max: number) => number;
const defaultRandom: RandomInt = (min, max) => randomInt(min, max);

export interface CaptchaQuestion {
  readonly a: number;
  readonly op: '+' | '-';
  readonly b: number;
  readonly answer: number;
}

/** Same ranges as the original app: sums of 1–20, differences that are never negative. */
export function generateQuestion(random: RandomInt = defaultRandom): CaptchaQuestion {
  if (random(0, 2) === 0) {
    const a = random(1, 21);
    const b = random(1, 21);
    return { a, op: '+', b, answer: a + b };
  }
  const a = random(10, 31);
  const b = random(1, a + 1);
  return { a, op: '-', b, answer: a - b };
}

/** HMAC so the stored value can't be reversed by trying the ~60 possible answers without the server secret. */
export function hashAnswer(secret: Buffer, captchaId: string, answer: number): Buffer {
  return createHmac('sha256', secret).update(`captcha:${captchaId}:${answer}`).digest();
}

export function answerMatches(
  secret: Buffer,
  captchaId: string,
  given: string,
  storedHash: Buffer,
): boolean {
  const trimmed = given.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return false;
  const candidate = hashAnswer(secret, captchaId, Number(trimmed));
  return candidate.length === storedHash.length && timingSafeEqual(candidate, storedHash);
}

// ---------------------------------------------------------------------------------------------------------
// Rendering

/** Stroke glyphs on a 20×30 grid. */
const GLYPHS: Readonly<Record<string, string>> = {
  '0': 'M10 3 C3 3 3 27 10 27 C17 27 17 3 10 3 Z',
  '1': 'M6 7 L11 3 L11 27 M6 27 L16 27',
  '2': 'M4 9 C4 2 16 2 16 9 C16 15 4 20 4 27 L16 27',
  '3': 'M4 5 C8 1 16 2 16 8 C16 13 10 14 8 14 C12 14 17 16 17 21 C17 28 7 29 3 25',
  '4': 'M13 27 L13 3 L3 19 L17 19',
  '5': 'M16 3 L5 3 L4 13 C8 10 17 11 17 19 C17 27 7 29 3 25',
  '6': 'M15 4 C8 1 3 8 3 18 C3 27 16 28 16 19 C16 12 6 11 3 17',
  '7': 'M3 3 L17 3 L8 27',
  '8': 'M10 14 C3 14 3 3 10 3 C17 3 17 14 10 14 C2 14 2 27 10 27 C18 27 18 14 10 14 Z',
  '9': 'M17 11 C17 3 4 3 4 10 C4 17 15 17 17 11 C17 20 14 27 6 26',
  '+': 'M10 9 L10 23 M3 16 L17 16',
  '-': 'M3 16 L17 16',
  '=': 'M3 12 L17 12 M3 20 L17 20',
  '?': 'M4 8 C4 1 16 1 16 8 C16 13 10 14 10 19 M10 25 L10 26',
};

const WIDTH = 240;
const HEIGHT = 70;
const INK = ['#1f3a5f', '#2f5d8c', '#5b3f8c', '#7a4e24', '#2f6b3a', '#8a2f4a'];

function jitterPath(path: string, random: RandomInt, amount: number): string {
  return path.replace(/-?\d+(\.\d+)?/g, (n) => {
    const offset = random(-amount * 10, amount * 10 + 1) / 10;
    return (Number(n) + offset).toFixed(1);
  });
}

const pick = <T>(items: readonly T[], random: RandomInt): T => items[random(0, items.length)] as T;

/** Renders the question as a standalone SVG document. */
export function renderCaptchaSvg(q: CaptchaQuestion, random: RandomInt = defaultRandom): string {
  const parts: string[] = [];

  const hue1 = random(180, 260);
  const hue2 = random(20, 80);
  parts.push(
    `<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">` +
      `<stop offset="0" stop-color="hsl(${hue1},35%,93%)"/>` +
      `<stop offset="1" stop-color="hsl(${hue2},35%,90%)"/></linearGradient></defs>`,
    `<rect width="${WIDTH}" height="${HEIGHT}" fill="url(#bg)"/>`,
  );

  // 15 faint decoys behind everything.
  for (let i = 0; i < 15; i++) {
    const glyph = GLYPHS[String(random(0, 10))] ?? '';
    const x = random(0, WIDTH - 12);
    const y = random(0, HEIGHT - 18);
    parts.push(
      `<path d="${jitterPath(glyph, random, 1)}" transform="translate(${x} ${y}) scale(0.55) rotate(${random(-40, 41)} 10 15)" ` +
        `fill="none" stroke="${pick(INK, random)}" stroke-opacity="0.18" stroke-width="2"/>`,
    );
  }

  // ~200 noise dots.
  for (let i = 0; i < 200; i++) {
    parts.push(
      `<circle cx="${random(0, WIDTH)}" cy="${random(0, HEIGHT)}" r="${random(4, 16) / 10}" ` +
        `fill="hsl(${random(0, 360)},50%,55%)" fill-opacity="0.5"/>`,
    );
  }

  // The question itself, laid out as tokens: digits of one number sit close together, with clear gaps
  // between numbers and symbols, so "28 − 26" never reads as "2 8 − 2 6". Symbols stay nearly level so a
  // minus can't be mistaken for a slash or an equals sign.
  const tokens = [String(q.a), q.op, String(q.b), '=', '?'];
  const DIGIT_ADVANCE = 21;
  const TOKEN_GAP = 13;
  const widths = tokens.map((tok) => tok.length * DIGIT_ADVANCE);
  const total = widths.reduce((sum, w) => sum + w, 0) + TOKEN_GAP * (tokens.length - 1);
  let x = (WIDTH - total) / 2;
  for (const tok of tokens) {
    const isNumber = /^\d+$/.test(tok);
    for (const ch of tok) {
      const glyph = GLYPHS[ch] ?? '';
      const y = 18 + random(-5, 6);
      const rotation = isNumber ? random(-18, 19) : random(-6, 7);
      const skew = isNumber ? random(-12, 13) : 0;
      const scale = random(100, 116) / 100;
      parts.push(
        `<path d="${jitterPath(glyph, random, isNumber ? 1.5 : 0.8)}" ` +
          `transform="translate(${(x + random(-1, 2)).toFixed(1)} ${y}) rotate(${rotation} 10 15) skewX(${skew}) scale(${scale})" ` +
          `fill="none" stroke="${pick(INK, random)}" stroke-width="${random(26, 33) / 10}" stroke-linecap="round" stroke-linejoin="round"/>`,
      );
      x += DIGIT_ADVANCE;
    }
    x += TOKEN_GAP;
  }

  // 5 interference curves on top.
  for (let i = 0; i < 5; i++) {
    const p = () => `${random(0, WIDTH)} ${random(0, HEIGHT)}`;
    parts.push(
      `<path d="M0 ${random(0, HEIGHT)} C${p()} ${p()} ${WIDTH} ${random(0, HEIGHT)}" fill="none" ` +
        `stroke="hsl(${random(0, 360)},55%,55%)" stroke-opacity="0.55" stroke-width="${random(10, 22) / 10}"/>`,
    );
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${WIDTH} ${HEIGHT}" width="${WIDTH}" height="${HEIGHT}" ` +
    `role="img" aria-label="captcha">${parts.join('')}</svg>`
  );
}
