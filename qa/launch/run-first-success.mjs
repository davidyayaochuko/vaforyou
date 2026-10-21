/**
 * Automated first-success path against isolated QA Funke.
 *   node qa/launch/run-first-success.mjs
 * Requires http://127.0.0.1:4321 running. Engine must stay stopped.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.QA_URL || 'http://127.0.0.1:4321';
const OUT = join(process.cwd(), 'qa/launch/screenshots');
mkdirSync(OUT, { recursive: true });

const started = Date.now();
const findings = [];
let success = { plate: false, reminder: false, draftApprove: false };

async function shot(page, name) {
  const path = join(OUT, name);
  await page.screenshot({ path, fullPage: true });
  return path;
}

async function ask(page, text) {
  await page.fill('#askBox', text);
  await page.click('#askBtn');
  await page.waitForTimeout(800);
  // wait for funke reply
  await page.waitForFunction(
    () => {
      const msgs = [...document.querySelectorAll('.msg.funke')];
      if (!msgs.length) return false;
      const last = msgs[msgs.length - 1];
      return (last.textContent || '').length > 10;
    },
    { timeout: 90_000 },
  ).catch(() => undefined);
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await shot(page, 'harness_01_land.png');

  // a) plate
  await ask(page, "What's on my plate?");
  await page.waitForTimeout(1500);
  const plateText = await page.locator('.msg.funke').last().innerText();
  success.plate = /plate|meeting|reminder|none|calendar|Here's/i.test(plateText);
  if (!success.plate) findings.push({ issue: 'plate answer unclear', text: plateText.slice(0, 200) });
  await shot(page, 'harness_02_plate.png');

  // b) reminder
  await ask(page, 'Remind me tomorrow at 9am to call Ada');
  await page.waitForTimeout(2000);
  const remText = await page.locator('.msg.funke').last().innerText();
  success.reminder = /remind|Ada|9|tomorrow|Got it|I'll/i.test(remText);
  await shot(page, 'harness_03_reminder.png');

  // c) draft + approve
  await ask(page, 'Draft a LinkedIn post about shipping honest reconcile numbers this week');
  await page.waitForTimeout(3000);
  await shot(page, 'harness_04_draft.png');
  // Prefer the chat approval card (not suggestion buttons).
  const approve = page.locator('.draft button.primary, [id^="approval-"] button.primary').filter({ hasText: /^Approve$/ });
  await page.waitForTimeout(2000);
  if (await approve.count()) {
    await approve.first().click();
    await page.waitForTimeout(2500);
    success.draftApprove = /Approved|Queued|done/i.test(await page.locator('.msg.funke').last().innerText());
    await shot(page, 'harness_05_approved.png');
  } else {
    const ok = page.locator('#tab-appr');
    if (await ok.count()) {
      await ok.click();
      await page.waitForTimeout(800);
    }
    const approve2 = page.locator('#apprPanel button.primary, .draft button.primary').filter({ hasText: /^Approve$/ });
    if (await approve2.count()) {
      await approve2.first().click();
      await page.waitForTimeout(2500);
      success.draftApprove = true;
      await shot(page, 'harness_05_approved.png');
    } else {
      findings.push({ issue: 'no approval card after draft', text: (await page.locator('.msg.funke').last().innerText()).slice(0, 400) });
      await shot(page, 'harness_05_no-approve.png');
    }
  }

  const minutes = (Date.now() - started) / 60000;
  const reached = success.plate && success.reminder && success.draftApprove;
  console.log(JSON.stringify({ reached_first_success: reached, success, minutes: Number(minutes.toFixed(2)), findings }, null, 2));
  await browser.close();
  process.exit(reached ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
