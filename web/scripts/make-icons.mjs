/**
 * Renders the app icons (web/public/icons/*.png) with the test browser, so no image tool is needed:
 *   node web/scripts/make-icons.mjs
 * A placeholder design in the app's palette: a cream 修 on brown. Replace the PNGs with real artwork any time
 * (keep the sizes; the maskable one keeps its mark inside the middle 80%, which Android may crop to a circle).
 */
import { chromium } from '@playwright/test';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../public/icons/', import.meta.url));
const icons = [
  { name: 'icon-192.png', size: 192, glyph: 0.62, radius: 0.18 },
  { name: 'icon-512.png', size: 512, glyph: 0.62, radius: 0.18 },
  // Full-bleed background, smaller mark: the safe zone is the middle 80%.
  { name: 'icon-maskable-512.png', size: 512, glyph: 0.46, radius: 0 },
  { name: 'apple-touch-icon.png', size: 180, glyph: 0.62, radius: 0 },
];

const browser = await chromium.launch();
const page = await browser.newPage();
for (const icon of icons) {
  await page.setViewportSize({ width: icon.size, height: icon.size });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">
    <div style="width:${icon.size}px;height:${icon.size}px;background:#7A4E24;border-radius:${icon.radius * icon.size}px;
      display:flex;align-items:center;justify-content:center;color:#F6F2EC;
      font:${Math.round(icon.glyph * icon.size)}px 'Noto Serif CJK TC','Songti TC',serif;line-height:1">修</div>
    </body></html>`);
  await page.screenshot({ path: `${out}${icon.name}`, omitBackground: true });
}
await browser.close();
process.stdout.write(`Wrote ${icons.length} icons to ${out}\n`);
