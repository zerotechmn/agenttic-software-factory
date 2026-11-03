import { chromium } from '../../../office/node_modules/playwright/index.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('./', import.meta.url));
mkdirSync(root + 'slides', { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  await page.goto('file://' + root + 'deck.html');
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: 'nav,aside{display:none!important}' });
  for (let index = 0; index < 10; index++) {
    await page.evaluate(n => { i = n; show(); }, index);
    const problems = await page.evaluate(() => {
      const slide = document.querySelector('.slide.active');
      const missing = [...slide.querySelectorAll('img')].filter(e => !e.complete || !e.naturalWidth);
      const overflow = [...slide.querySelectorAll('*')].filter(e => !e.closest('.hero-screen')).filter(e => {
        const rect = e.getBoundingClientRect();
        return rect.right > 1600 || rect.bottom > 900;
      });
      return { missing: missing.length, overflow: overflow.length };
    });
    if (problems.missing || problems.overflow) throw new Error(`Slide ${index + 1}: ${JSON.stringify(problems)}`);
    await page.screenshot({ path: root + `slides/slide-${String(index + 1).padStart(2, '0')}.png` });
  }
  const video = await page.locator('video').boundingBox();
  if (!video) throw new Error('Slide 10 video missing');
  writeFileSync(root + 'video-layout.json', JSON.stringify(video, null, 2));
  await page.evaluate(() => {
    document.body.classList.remove('present');
    document.querySelectorAll('.slide').forEach(s => s.style.transform = 'none');
  });
  await page.pdf({ path: root + 'agentic-software-factory.pdf', width: '1600px', height: '900px', printBackground: true, preferCSSPageSize: true });
  console.log('10 slides checked: no missing images or viewport overflow; PDF exported.');
} finally {
  await browser.close();
}
