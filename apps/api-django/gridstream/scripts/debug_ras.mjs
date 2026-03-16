import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 1200, height: 900 },
  userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
});
const page = await context.newPage();

const resp = await page.goto('https://ras.football/ras-information/?PlayerID=1466', { waitUntil: 'networkidle', timeout: 30000 });
console.log('Status:', resp.status());
console.log('URL:', page.url());

await page.waitForTimeout(3000);

const title = await page.title();
console.log('Title:', title);

const allCanvas = await page.$$('canvas');
console.log('Canvas elements:', allCanvas.length);

const ids = await page.evaluate(() => {
  return [...document.querySelectorAll('[id]')].map(el => el.id).slice(0, 30);
});
console.log('IDs on page:', ids);

await browser.close();
