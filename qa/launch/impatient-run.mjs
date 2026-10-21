/**
 * QA persona #1 IMPATIENT — first button, quit at first error.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.QA_URL || 'http://127.0.0.1:4321';
const OUT = join(process.cwd(), 'qa/launch/screenshots');
mkdirSync(OUT, { recursive: true });

const started = Date.now();
const result = { steps: [], quit: null };

async function shot(page, name) {
  const path = join(OUT, name);
  await page.screenshot({ path, fullPage: true });
  return path;
}

function badReply(text) {
  return (
    /something went wrong/i.test(text) ||
    /didn't catch that clearly/i.test(text) ||
    /try again in one short sentence/i.test(text)
  );
}

async function waitFunke(page, timeout = 90_000) {
  await page.waitForFunction(
    () => {
      const msgs = [...document.querySelectorAll('.msg.funke')];
      if (!msgs.length) return false;
      const last = msgs[msgs.length - 1];
      const t = (last.textContent || '').trim();
      return t.length > 15 && !/checking|Hi, I'm Funke/i.test(t);
    },
    { timeout },
  ).catch(() => undefined);
}

async function lastFunke(page) {
  const n = await page.locator('.msg.funke').count();
  if (!n) return '';
  return page.locator('.msg.funke').nth(n - 1).innerText();
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });

  await page.goto(`file://${join(process.cwd(), 'README.md')}`, { waitUntil: 'domcontentloaded' });
  await shot(page, 'impatient_01_readme-branding.png');

  await page.goto(`file://${join(process.cwd(), 'qa/launch/screenshots/_setup-preview.html')}`, {
    waitUntil: 'domcontentloaded',
  });
  await shot(page, 'impatient_02_setup-linkedin-step.png');

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await shot(page, 'impatient_03_funke-landing.png');

  // Impatient: click first suggestion chip (not type).
  await page.locator('.suggestion').first().click();
  await page.locator('#askBtn').click();
  await waitFunke(page);
  const plate = await lastFunke(page);
  await shot(page, 'impatient_04_plate-response.png');
  result.steps.push({ step: 'plate', reply: plate.slice(0, 400) });
  if (badReply(plate)) {
    result.quit = { step: 'plate', reply: plate.slice(0, 200), screenshot: 'impatient_04_plate-response.png' };
    console.log(JSON.stringify({ ...result, minutes: (Date.now() - started) / 60000 }, null, 2));
    await browser.close();
    process.exit(0);
  }

  await page.locator('.suggestion').nth(1).click();
  await page.locator('#askBtn').click();
  await waitFunke(page);
  const rem = await lastFunke(page);
  await shot(page, 'impatient_05_reminder-response.png');
  result.steps.push({ step: 'reminder', reply: rem.slice(0, 400) });
  if (badReply(rem)) {
    result.quit = { step: 'reminder', reply: rem.slice(0, 200), screenshot: 'impatient_05_reminder-response.png' };
    console.log(JSON.stringify({ ...result, minutes: (Date.now() - started) / 60000 }, null, 2));
    await browser.close();
    process.exit(0);
  }

  await page.locator('.suggestion').nth(3).click();
  await page.locator('#askBtn').click();
  await waitFunke(page, 120_000);
  const draft = await lastFunke(page);
  await shot(page, 'impatient_06_draft-response.png');
  result.steps.push({ step: 'draft', reply: draft.slice(0, 400) });
  if (badReply(draft)) {
    result.quit = { step: 'draft', reply: draft.slice(0, 200), screenshot: 'impatient_06_draft-response.png' };
    console.log(JSON.stringify({ ...result, minutes: (Date.now() - started) / 60000 }, null, 2));
    await browser.close();
    process.exit(0);
  }

  const approve = page.locator('.approval-card button', { hasText: /^Approve$/ }).first();
  if (!(await approve.count())) {
    result.quit = { step: 'approve', reply: 'no approval card', screenshot: 'impatient_06_draft-response.png' };
  } else {
    await approve.click();
    await page.waitForTimeout(3000);
    await shot(page, 'impatient_07_after-approve.png');
    result.steps.push({ step: 'approve', reply: (await lastFunke(page)).slice(0, 200) });
  }

  console.log(JSON.stringify({ ...result, minutes: (Date.now() - started) / 60000 }, null, 2));
  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
