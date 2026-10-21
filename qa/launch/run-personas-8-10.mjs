/**
 * Personas #8 FLAKY-CONNECTION and #10 LOW-VISION launch QA.
 * Usage: node qa/launch/run-personas-8-10.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { join } from 'path';

const BASE = 'http://127.0.0.1:4321';
const SHOT_DIR = join(process.cwd(), 'qa/launch/screenshots');
mkdirSync(SHOT_DIR, { recursive: true });

const findings = { flaky: [], lowvis: [] };
let shotFlaky = 0;
let shotLowvis = 0;

async function shot(page, prefix, slug) {
  const n = prefix === 'flaky' ? ++shotFlaky : ++shotLowvis;
  const name = `${prefix}_${String(n).padStart(2, '0')}_${slug}.png`;
  await page.screenshot({ path: join(SHOT_DIR, name), fullPage: true });
  return name;
}

function countTexts(page, selector) {
  return page.locator(selector).allTextContents();
}

async function msgCounts(page) {
  return page.evaluate(() => {
    const users = [...document.querySelectorAll('.msg.user')].map((el) =>
      (el.textContent || '').replace(/^You/i, '').trim(),
    );
    const funke = [...document.querySelectorAll('.msg.funke')].map((el) =>
      (el.textContent || '').replace(/^Funke/i, '').trim(),
    );
    const dup = (arr) => {
      const c = {};
      for (const t of arr) c[t] = (c[t] || 0) + 1;
      return Object.entries(c).filter(([, n]) => n > 1).map(([t, n]) => ({ text: t.slice(0, 80), count: n }));
    };
    return { userCount: users.length, funkeCount: funke.length, dupUser: dup(users), dupFunke: dup(funke), lastFunke: funke.slice(-3) };
  });
}

async function waitAskIdle(page, timeout = 120_000) {
  const btn = page.locator('#askBtn');
  await btn.waitFor({ state: 'visible', timeout: 10_000 });
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const disabled = await btn.isDisabled();
    if (!disabled) return;
    await page.waitForTimeout(400);
  }
  throw new Error('ask idle timeout');
}

async function sendAsk(page, text) {
  await page.locator('#askBox').fill(text);
  await page.locator('#askBtn').click();
}

async function runFlaky(browser) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const t0 = Date.now();

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#askBox', { timeout: 15_000 });
  await shot(page, 'flaky', '01-loaded');

  // --- Mid-ask offline: plate question ---
  await page.locator('#askBox').fill("What's on my plate?");
  await page.locator('#askBtn').click();
  await page.waitForTimeout(300);
  await context.setOffline(true);
  findings.flaky.push({
    id: 'flaky-mid-ask-offline',
    note: 'Went offline ~300ms after sending plate question.',
  });
  await shot(page, 'flaky', '02-mid-ask-offline');

  try {
    await waitAskIdle(page, 25_000);
  } catch {
    findings.flaky.push({ id: 'flaky-ask-stuck', note: 'Send button stayed disabled or timed out while offline.' });
  }

  let counts = await msgCounts(page);
  const errTexts = counts.lastFunke.filter((t) => /fail|fetch|network|offline|error/i.test(t));
  findings.flaky.push({
    id: 'flaky-plate-error',
    plainLanguage: errTexts.length > 0 && !/^Failed to fetch$/i.test(errTexts[errTexts.length - 1]?.trim()),
    lastError: errTexts[errTexts.length - 1] || counts.lastFunke[counts.lastFunke.length - 1],
    duplicateUserMsgs: counts.dupUser,
  });
  await shot(page, 'flaky', '03-plate-offline-error');

  await context.setOffline(false);
  findings.flaky.push({ id: 'flaky-reconnect-1', note: 'Back online after plate ask failure.' });
  await page.waitForTimeout(800);
  await sendAsk(page, "What's on my plate?");
  await waitAskIdle(page, 120_000);
  counts = await msgCounts(page);
  findings.flaky.push({
    id: 'flaky-plate-retry',
    duplicateUserMsgs: counts.dupUser,
    userPlateSends: counts.userCount,
  });
  await shot(page, 'flaky', '04-plate-after-reconnect');

  // --- Reminder with brief offline blip mid-flight ---
  await sendAsk(page, 'Remind me tomorrow at 9am to prep for Talent Sourcing');
  await page.waitForTimeout(500);
  await context.setOffline(true);
  await page.waitForTimeout(1500);
  await context.setOffline(false);
  try {
    await waitAskIdle(page, 120_000);
  } catch {
    findings.flaky.push({ id: 'flaky-reminder-timeout', note: 'Reminder ask did not finish after blip.' });
  }
  counts = await msgCounts(page);
  findings.flaky.push({ id: 'flaky-reminder', duplicateUserMsgs: counts.dupUser, dupFunke: counts.dupFunke });
  await shot(page, 'flaky', '05-reminder-flap');

  // --- LinkedIn draft + approval offline ---
  await sendAsk(page, 'Draft a LinkedIn post about Spendprofile reconcile honesty');
  await page.waitForTimeout(800);
  await context.setOffline(true);
  findings.flaky.push({ id: 'flaky-mid-draft-offline', note: 'Offline during LinkedIn draft generation.' });
  await shot(page, 'flaky', '06-draft-offline');

  try {
    await waitAskIdle(page, 180_000);
  } catch {
    findings.flaky.push({ id: 'flaky-draft-timeout-offline', note: 'Draft ask hung or timed out offline.' });
  }
  await context.setOffline(false);
  await page.waitForTimeout(500);

  const approvalVisible = await page.locator('.draft .primary:has-text("Approve")').first().isVisible().catch(() => false);
  if (!approvalVisible) {
    await sendAsk(page, 'Draft a LinkedIn post about Spendprofile reconcile honesty');
    await waitAskIdle(page, 180_000);
  }

  const approveBtn = page.locator('.draft .primary:has-text("Approve")').first();
  await approveBtn.waitFor({ state: 'visible', timeout: 30_000 }).catch(() => null);
  await shot(page, 'flaky', '07-approval-ready');

  if (await approveBtn.isVisible()) {
    await context.setOffline(true);
    await approveBtn.click();
    await page.waitForTimeout(2000);
    const halfDone = await page.evaluate(() => {
      const btn = document.querySelector('.draft .primary');
      return {
        btnText: btn?.textContent,
        btnDisabled: btn?.disabled,
        approvedLabels: [...document.querySelectorAll('.draft .primary')].map((b) => ({
          text: b.textContent,
          disabled: b.disabled,
        })),
      };
    });
    findings.flaky.push({
      id: 'flaky-mid-approval-offline',
      halfDone,
      note: 'Clicked Approve while offline; checked button state vs server.',
    });
    await shot(page, 'flaky', '08-approval-offline');

    await context.setOffline(false);
    await page.waitForTimeout(1000);
    const retryApprove = page.locator('.draft .primary:has-text("Approve")').first();
    if (await retryApprove.isVisible() && !(await retryApprove.isDisabled())) {
      await retryApprove.click();
      await page.waitForTimeout(3000);
    }
    counts = await msgCounts(page);
    findings.flaky.push({
      id: 'flaky-approval-reconnect',
      duplicateUserMsgs: counts.dupUser,
      lastFunke: counts.lastFunke,
    });
    await shot(page, 'flaky', '09-approval-after-reconnect');
  } else {
    findings.flaky.push({ id: 'flaky-no-approval', note: 'Never got an approval card after draft flow.' });
  }

  findings.flaky.push({ id: 'flaky-duration-ms', value: Date.now() - t0 });
  await context.close();
}

async function contrastReport(page) {
  return page.evaluate(() => {
    const picks = [
      { sel: '.hint', label: 'composer hint' },
      { sel: '.voice-status', label: 'voice status' },
      { sel: '.badge', label: 'live status pill' },
      { sel: '.eyebrow', label: 'eyebrow' },
      { sel: '.hero p', label: 'hero subtext' },
      { sel: '.card-line span', label: 'card subtext' },
      { sel: '.suggestion span', label: 'suggestion helper' },
      { sel: '.stage-label', label: 'stage label' },
      { sel: '.msg .who', label: 'message who label' },
    ];
    const parseRgb = (c) => {
      const m = c.match(/rgba?\(([^)]+)\)/);
      if (!m) return null;
      const p = m[1].split(',').map((x) => parseFloat(x.trim()));
      return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 };
    };
    const lum = ({ r, g, b }) => {
      const f = (v) => {
        v /= 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (fg, bg) => {
      const L1 = lum(fg);
      const L2 = lum(bg);
      const hi = Math.max(L1, L2);
      const lo = Math.min(L1, L2);
      return (hi + 0.05) / (lo + 0.05);
    };
    const out = [];
    for (const { sel, label } of picks) {
      const el = document.querySelector(sel);
      if (!el) continue;
      const cs = getComputedStyle(el);
      const fg = parseRgb(cs.color);
      let bgEl = el;
      let bg = parseRgb(getComputedStyle(bgEl).backgroundColor);
      while (bg && bg.a < 0.5 && bgEl.parentElement) {
        bgEl = bgEl.parentElement;
        bg = parseRgb(getComputedStyle(bgEl).backgroundColor);
      }
      if (!fg || !bg) continue;
      out.push({
        label,
        color: cs.color,
        background: getComputedStyle(bgEl).backgroundColor,
        contrastRatio: Math.round(ratio(fg, bg) * 100) / 100,
        fontSize: cs.fontSize,
      });
    }
    const hasDarkStyles = [...document.styleSheets].some((ss) => {
      try {
        return [...ss.cssRules].some((r) => r.cssText && /prefers-color-scheme:\s*dark/i.test(r.cssText));
      } catch {
        return false;
      }
    });
    return { samples: out, hasDarkModeCss: hasDarkStyles, colorScheme: document.documentElement.style.colorScheme || 'default' };
  });
}

async function runLowVis(browser) {
  const settings = {
    zoom: '200% (CSS zoom on html)',
    viewport: { width: 1280, height: 900 },
    prefersContrast: 'more',
    forcedColors: 'active',
    colorSchemeChecked: ['light', 'dark'],
  };

  const context = await browser.newContext({
    viewport: settings.viewport,
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  await page.emulateMedia({ prefersContrast: 'more', forcedColors: 'active', colorScheme: 'light' });
  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    document.documentElement.style.zoom = '2';
  });
  await page.waitForSelector('#askBox');
  await shot(page, 'lowvis', '01-zoom200-forced-colors');

  let report = await contrastReport(page);
  const lowContrast = report.samples.filter((s) => s.contrastRatio < 4.5);
  findings.lowvis.push({
    id: 'lowvis-settings',
    settings,
    forcedColorsActive: true,
    prefersContrastMore: true,
  });
  findings.lowvis.push({
    id: 'lowvis-contrast-light',
    lowContrastElements: lowContrast,
    allSamples: report.samples,
    darkModeCssInStylesheets: report.hasDarkModeCss,
  });

  await page.emulateMedia({ colorScheme: 'dark' });
  const darkVisual = await page.evaluate(() => ({
    bodyBg: getComputedStyle(document.body).backgroundColor,
    bodyColor: getComputedStyle(document.body).color,
    stillLightBg: getComputedStyle(document.body).backgroundColor.includes('246') || getComputedStyle(document.body).backgroundColor.includes('245'),
  }));
  findings.lowvis.push({
    id: 'lowvis-dark-mode-absence',
    note: 'Emulated prefers-color-scheme: dark; UI stays on light tokens.',
    ...darkVisual,
  });
  await shot(page, 'lowvis', '02-emulated-dark-still-light');

  await page.emulateMedia({ colorScheme: 'light', forcedColors: 'active', prefersContrast: 'more' });
  await page.locator('button.suggestion').first().click().catch(() => {});
  await waitAskIdle(page, 120_000).catch(() => {});
  await shot(page, 'lowvis', '03-chat-at-200-zoom');

  report = await contrastReport(page);
  findings.lowvis.push({
    id: 'lowvis-contrast-after-chat',
    lowContrastElements: report.samples.filter((s) => s.contrastRatio < 4.5),
  });

  await page.click('#tab-appr').catch(() => {});
  await page.waitForTimeout(800);
  await shot(page, 'lowvis', '04-approvals-panel-zoom');
  report = await contrastReport(page);
  const pill = report.samples.find((s) => s.label === 'live status pill');
  if (pill && pill.contrastRatio < 4.5) {
    findings.lowvis.push({ id: 'lowvis-status-pill', flagged: true, ...pill });
  } else {
    findings.lowvis.push({ id: 'lowvis-status-pill', flagged: pill ? pill.contrastRatio < 7 : 'missing', ...pill });
  }

  await context.close();
}

const browser = await chromium.launch({ headless: true });
try {
  await runFlaky(browser);
  await runLowVis(browser);
} finally {
  await browser.close();
}

console.log(JSON.stringify({ findings, screenshotDir: SHOT_DIR, flakyShots: shotFlaky, lowvisShots: shotLowvis }, null, 2));
