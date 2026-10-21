/**
 * QA persona #6 TINY-SCREEN — Playwright, engine off.
 *   node qa/launch/tiny-screen-run.mjs
 */
import { chromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.QA_URL || 'http://127.0.0.1:4321';
const OUT = join(process.cwd(), 'qa/launch/screenshots');
mkdirSync(OUT, { recursive: true });

const started = Date.now();
const findings = [];
const settings = [];

const VIEWPORTS = [
  {
    id: 'portrait-320x568',
    shot: 'tiny_01_portrait-320x568.png',
    context: { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    pageZoom: null,
  },
  {
    id: 'landscape-568x320',
    shot: 'tiny_02_landscape-568x320.png',
    context: { viewport: { width: 568, height: 320 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    pageZoom: null,
  },
  {
    id: '375x812-zoom150',
    shot: 'tiny_03_375x812-zoom150.png',
    context: { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    pageZoom: '1.5',
  },
];

function measureLayout(page) {
  return page.evaluate(() => {
    const rect = (el) => {
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return {
        w: Math.round(r.width),
        h: Math.round(r.height),
        x: Math.round(r.x),
        y: Math.round(r.y),
        right: Math.round(r.right),
        bottom: Math.round(r.bottom),
      };
    };
    const dock = document.querySelector('.dock');
    const tabs = dock
      ? [...dock.querySelectorAll('button')].map((b) => ({
          label: b.textContent?.trim(),
          ...rect(b),
        }))
      : [];
    const doc = document.documentElement;
    const overlaps = (a, b) => {
      if (!a || !b) return false;
      return !(a.right <= b.x || b.right <= a.x || a.bottom <= b.y || b.bottom <= a.y);
    };
    const input = document.getElementById('askBox');
    const mic = document.getElementById('micBtn');
    const send = document.getElementById('askBtn');
    const composer = document.querySelector('.composer');
    const ir = rect(input);
    const mr = rect(mic);
    const sr = rect(send);
    const cr = rect(composer);
    return {
      viewport: {
        innerW: window.innerWidth,
        innerH: window.innerHeight,
        scrollW: doc.scrollWidth,
        clientW: doc.clientWidth,
        hasHorizontalScroll: doc.scrollWidth > doc.clientWidth + 1,
        zoom: getComputedStyle(document.body).zoom || '1',
      },
      dock: rect(dock),
      tabs,
      input: ir,
      mic: mr,
      send: sr,
      composer: cr,
      micSendOverlap: overlaps(mr, sr),
      inputVisibleAboveComposer: ir ? ir.bottom <= window.innerHeight && ir.y >= 0 : false,
      tabMin: tabs.length ? Math.min(...tabs.map((t) => Math.min(t.w, t.h))) : null,
    };
  });
}

async function shot(page, name) {
  const path = join(OUT, name);
  await page.screenshot({ path, fullPage: false });
  return path;
}

async function waitFunkeReply(page, timeout = 90_000) {
  await page
    .waitForFunction(
      () => {
        const msgs = [...document.querySelectorAll('.msg.funke')];
        if (!msgs.length) return false;
        const last = msgs[msgs.length - 1];
        const t = (last.textContent || '').trim();
        return t.length > 15 && !/thinking|…|\.\.\./i.test(t.slice(-20));
      },
      { timeout },
    )
    .catch(() => undefined);
}

async function ask(page, text) {
  await page.locator('#askBox').fill(text);
  await page.locator('#askBtn').click();
  await waitFunkeReply(page);
}

async function keyboardCoversInput(page) {
  await page.locator('#askBox').click();
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => {
    const box = document.getElementById('askBox');
    const r = box.getBoundingClientRect();
    return { y: r.y, bottom: r.bottom, vh: window.innerHeight };
  });
  // Simulate focus + virtual keyboard shrink (common mobile heuristic)
  await page.evaluate(() => {
    window.dispatchEvent(new Event('resize'));
    if (window.visualViewport) {
      Object.defineProperty(window.visualViewport, 'height', {
        configurable: true,
        get: () => Math.round(window.innerHeight * 0.55),
      });
      window.visualViewport.dispatchEvent(new Event('resize'));
    }
  });
  await page.waitForTimeout(200);
  const after = await page.evaluate(() => {
    const box = document.getElementById('askBox');
    const r = box.getBoundingClientRect();
    const vv = window.visualViewport?.height ?? window.innerHeight;
    return {
      y: r.y,
      bottom: r.bottom,
      vh: window.innerHeight,
      visualH: vv,
      inputAboveFold: r.bottom <= vv,
    };
  });
  return { before, after, likelyHidden: !after.inputAboveFold && after.bottom > after.visualH * 0.9 };
}

const success = { plate: false, reminder: false, draftApprove: false };
let flowPage = null;

for (const vp of VIEWPORTS) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(vp.context);
  const page = await context.newPage();
  if (vp.pageZoom) {
    await page.addInitScript((z) => {
      document.documentElement.style.setProperty('zoom', z);
    }, vp.pageZoom);
  }
  await page.goto(BASE, { waitUntil: 'networkidle' });
  const layout = await measureLayout(page);
  settings.push({
    viewport: vp.id,
    playwright: vp.context,
    cssZoom: vp.pageZoom,
    measured: layout.viewport,
  });

  if (layout.viewport.hasHorizontalScroll) {
    findings.push({
      severity: 'high',
      viewport: vp.id,
      issue: 'horizontal scroll on load',
      scrollW: layout.viewport.scrollW,
      clientW: layout.viewport.clientW,
    });
  }
  if (layout.dock && layout.dock.w > layout.viewport.innerW) {
    findings.push({
      severity: 'medium',
      viewport: vp.id,
      issue: 'tab dock wider than viewport',
      dockW: layout.dock.w,
      innerW: layout.viewport.innerW,
    });
  }
  if (layout.tabMin != null && layout.tabMin < 44) {
    findings.push({
      severity: 'low',
      viewport: vp.id,
      issue: 'tab target slightly under 44px',
      minPx: layout.tabMin,
    });
  }
  if (layout.micSendOverlap) {
    findings.push({ severity: 'high', viewport: vp.id, issue: 'Mic and Send overlap' });
  }

  await shot(page, vp.shot);

  if (vp.id === 'portrait-320x568') {
    flowPage = page;
    const kb = await keyboardCoversInput(page);
    settings.push({ keyboardSim: kb });
    if (kb.likelyHidden) {
      findings.push({
        severity: 'medium',
        viewport: vp.id,
        issue: 'chat input may sit under keyboard (no visualViewport handler observed)',
        detail: kb,
      });
    }
    // scroll to composer screenshot
    await page.locator('.composer-wrap').scrollIntoViewIfNeeded().catch(() => undefined);
    await shot(page, 'tiny_04_portrait-composer.png');
  } else {
    await browser.close();
  }
}

// First-success flow at 320x568 (reuse open browser)
if (flowPage) {
  const page = flowPage;
  await page.goto(BASE, { waitUntil: 'networkidle' });

  await ask(page, "What's on my plate?");
  await page.waitForTimeout(800);
  const plateText = await page.locator('.msg.funke').last().innerText().catch(() => '');
  success.plate = /plate|calendar|reminder|meeting|follow|nothing|today|Here's/i.test(plateText);
  if (!success.plate) {
    findings.push({ step: 'plate', issue: 'answer unclear or empty', text: plateText.slice(0, 240) });
  }
  await shot(page, 'tiny_05_plate-reply.png');

  await ask(page, 'Remind me tomorrow at 9am to prep for Talent Sourcing');
  await page.waitForTimeout(1000);
  const remText = await page.locator('.msg.funke').last().innerText().catch(() => '');
  success.reminder = /remind|9|tomorrow|Talent|Got it|I'll|set/i.test(remText);
  if (!success.reminder) {
    findings.push({ step: 'reminder', issue: 'reminder not confirmed in reply', text: remText.slice(0, 240) });
  }
  await shot(page, 'tiny_06_reminder-reply.png');

  await ask(page, 'Draft a LinkedIn post about shipping honest reconcile numbers this week');
  await page.waitForTimeout(2500);
  await shot(page, 'tiny_07_draft-approval-card.png');
  const approve = page.getByRole('button', { name: /^Approve$/i }).first();
  if (await approve.isVisible().catch(() => false)) {
    const cardLayout = await page.evaluate(() => {
      const draft = document.querySelector('.draft');
      const r = draft?.getBoundingClientRect();
      return r
        ? { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.x), scrollW: document.documentElement.scrollWidth }
        : null;
    });
    if (cardLayout && cardLayout.w > 320) {
      findings.push({ step: 'draft', issue: 'approval card wider than viewport', cardLayout });
    }
    await approve.click();
    await page.waitForTimeout(2000);
    success.draftApprove = true;
    await shot(page, 'tiny_08_after-approve.png');
  } else {
    findings.push({
      step: 'draft',
      issue: 'no Approve button visible after draft request',
      lastFunke: (await page.locator('.msg.funke').last().innerText().catch(() => '')).slice(0, 300),
    });
  }

  await page.context().browser().close();
}

const minutes = (Date.now() - started) / 60000;
const reached_first_success = success.plate && success.reminder && success.draftApprove;

const report = {
  persona: 'TINY-SCREEN (#6)',
  engine: 'off',
  baseUrl: BASE,
  settings,
  minutes: Number(minutes.toFixed(2)),
  reached_first_success,
  success,
  findings,
  screenshots: [
    'tiny_01_portrait-320x568.png',
    'tiny_02_landscape-568x320.png',
    'tiny_03_375x812-zoom150.png',
    'tiny_04_portrait-composer.png',
    'tiny_05_plate-reply.png',
    'tiny_06_reminder-reply.png',
    'tiny_07_draft-approval-card.png',
    'tiny_08_after-approve.png',
  ],
};

writeFileSync(join(OUT, 'tiny-screen-report.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(reached_first_success ? 0 : 1);
