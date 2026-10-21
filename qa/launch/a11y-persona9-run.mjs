/**
 * QA persona #9: keyboard + axe (one-shot runner)
 */
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const BASE = 'http://127.0.0.1:4321/';
const SHOT_DIR = path.join(process.cwd(), 'qa/launch/screenshots');
const OUT_JSON = path.join(process.cwd(), 'qa/launch/a11y-persona9-axe-summary.json');

function focusDesc(el) {
  if (!el || el === document.body) return { tag: 'BODY', name: '(body)' };
  const name =
    el.getAttribute('aria-label') ||
    el.getAttribute('title') ||
    el.placeholder ||
    (el.textContent || '').trim().slice(0, 50) ||
    el.id ||
    el.tagName;
  const cs = getComputedStyle(el);
  const outlineVisible =
    (cs.outlineWidth && cs.outlineWidth !== '0px' && cs.outlineStyle !== 'none') ||
    (cs.boxShadow && cs.boxShadow !== 'none' && !cs.boxShadow.includes('0px 0px'));
  return {
    tag: el.tagName,
    role: el.getAttribute('role'),
    name: String(name).replace(/\s+/g, ' ').trim(),
    ariaLabel: el.getAttribute('aria-label'),
    title: el.getAttribute('title'),
    outlineVisible,
    outline: cs.outline,
    boxShadow: cs.boxShadow?.slice(0, 80),
  };
}

async function injectAxe(page) {
  await page.addScriptTag({
    url: 'https://cdnjs.cloudflare.com/ajax/libs/axe-core/4.10.2/axe.min.js',
  });
  await page.waitForFunction(() => typeof window.axe !== 'undefined', null, { timeout: 15000 });
}

async function runAxe(page, viewName) {
  return page.evaluate(async (view) => {
    const res = await window.axe.run(document, {
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21aa', 'best-practice'] },
    });
    const byImpact = { critical: 0, serious: 0, moderate: 0, minor: 0 };
    for (const v of res.violations) {
      byImpact[v.impact] = (byImpact[v.impact] || 0) + 1;
    }
    return {
      view,
      url: location.href,
      violationCount: res.violations.length,
      byImpact,
      violations: res.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        help: v.help,
        nodes: v.nodes.length,
      })),
      incomplete: res.incomplete.length,
      passes: res.passes.length,
    };
  }, viewName);
}

async function tabWalk(page, maxTabs = 22) {
  await page.evaluate(() => document.body.focus());
  const trail = [];
  for (let i = 0; i < maxTabs; i++) {
    await page.keyboard.press('Tab');
    const info = await page.evaluate(focusDesc);
    trail.push({ step: i + 1, ...info });
  }
  return trail;
}

async function clickTabByTitle(page, title) {
  await page.locator(`button[title="${title}"]`).first().focus();
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await context.newPage();

const results = {
  persona: 9,
  keyboard: { trail: [], findings: [], focusTrap: null },
  ariaLabels: {},
  axe: {},
  reached_first_success: { attempted: true, chat_plate: false, reminder: false, linkedin_approval: false, notes: [] },
  screenshots: [],
};

try {
  await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30000 });

  results.ariaLabels = await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll('button'));
    function findTab(t) {
      return buttons.find((b) => (b.textContent || '').trim() === t);
    }
    function fmt(b, label) {
      if (!b) return { key: label, missing: true };
      return {
        key: label,
        text: (b.textContent || '').trim(),
        ariaLabel: b.getAttribute('aria-label'),
        title: b.getAttribute('title'),
        accessibleName: b.getAttribute('aria-label') || b.getAttribute('title') || (b.textContent || '').trim(),
      };
    }
    const mic = buttons.find((b) => /hold to talk|mic/i.test((b.getAttribute('aria-label') || '') + (b.textContent || '')));
    return {
      tabs: ['Fk', 'Cal', 'Soc', 'Pg', 'Ok', 'G'].map((t) => fmt(findTab(t), t)),
      mic: fmt(mic, 'Mic'),
      say: fmt(buttons.find((b) => (b.textContent || '').trim() === 'Say'), 'Say'),
      send: fmt(
        buttons.find((b) => (b.textContent || '').trim() === '↑' || /send/i.test(b.getAttribute('title') || '')),
        'Send',
      ),
    };
  });

  // Keyboard tab walk on chat
  results.keyboard.trail = await tabWalk(page, 20);
  const shot1 = path.join(SHOT_DIR, 'a11y_02_keyboard-tab-cycle.png');
  await page.screenshot({ path: shot1, fullPage: false });
  results.screenshots.push('a11y_02_keyboard-tab-cycle.png');

  // Focus visibility analysis
  const noOutline = results.keyboard.trail.filter((s) => s.tag !== 'BODY' && !s.outlineVisible);
  if (noOutline.length > 5) {
    results.keyboard.findings.push({
      severity: 'major',
      issue: 'Many tab stops show no visible focus ring (outline/box-shadow)',
      examples: noOutline.slice(0, 5).map((s) => s.name),
    });
  }

  // Tab abbreviations without aria-label
  const tabsMissingAria = results.ariaLabels.tabs.filter((t) => !t.ariaLabel && t.title);
  if (tabsMissingAria.length) {
    results.keyboard.findings.push({
      severity: 'moderate',
      issue: 'Nav tabs rely on title/tooltip only; no aria-label (screen reader may read "Fk" not "Chat")',
      tabs: tabsMissingAria.map((t) => ({ text: t.text, title: t.title })),
    });
  }
  if (!results.ariaLabels.send.ariaLabel && results.ariaLabels.send.title) {
    results.keyboard.findings.push({
      severity: 'moderate',
      issue: 'Send button is icon-only (↑) with title="Send" but no aria-label',
    });
  }
  if (!results.ariaLabels.say.ariaLabel && results.ariaLabels.say.title) {
    results.keyboard.findings.push({
      severity: 'minor',
      issue: 'Say button has title="Read replies aloud" but no aria-label',
    });
  }

  // Enter on suggestion chip via keyboard
  await page.evaluate(() => document.body.focus());
  for (let i = 0; i < 8; i++) await page.keyboard.press('Tab');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(2500);
  const shot3 = path.join(SHOT_DIR, 'a11y_03_plate-via-keyboard.png');
  await page.screenshot({ path: shot3 });
  results.screenshots.push('a11y_03_plate-via-keyboard.png');

  const chatText = await page.locator('main, [class*="chat"], body').first().innerText();
  if (/plate|calendar|reminder|follow/i.test(chatText)) {
    results.reached_first_success.chat_plate = true;
  } else {
    results.reached_first_success.notes.push('After Enter on chip, no obvious plate answer in DOM text');
  }

  // Type in chat via keyboard
  const input = page.getByRole('textbox', { name: /Ask Funke/i });
  await input.focus();
  await input.fill('');
  await input.type('Set a reminder tomorrow 9am: QA keyboard test', { delay: 15 });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(3500);
  const shot4 = path.join(SHOT_DIR, 'a11y_04_reminder-keyboard.png');
  await page.screenshot({ path: shot4 });
  results.screenshots.push('a11y_04_reminder-keyboard.png');
  const afterReminder = await page.locator('body').innerText();
  if (/reminder|9am|tomorrow|set|calendar/i.test(afterReminder)) {
    results.reached_first_success.reminder = true;
  }

  // LinkedIn draft + approval via keyboard
  await input.focus();
  await input.fill('Draft a LinkedIn post about keyboard accessibility testing');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(8000);
  const shot5 = path.join(SHOT_DIR, 'a11y_05-linkedin-draft.png');
  await page.screenshot({ path: shot5, fullPage: true });
  results.screenshots.push('a11y_05-linkedin-draft.png');

  const bodyAfterDraft = await page.locator('body').innerText();
  if (/approv|draft|linkedin|publish/i.test(bodyAfterDraft)) {
    results.reached_first_success.linkedin_approval = true;
  }

  // Ok tab for approval UI
  await clickTabByTitle(page, 'Approvals');
  await page.waitForTimeout(500);
  const shot6 = path.join(SHOT_DIR, 'a11y_06-ok-approvals-tab.png');
  await page.screenshot({ path: shot6, fullPage: true });
  results.screenshots.push('a11y_06-ok-approvals-tab.png');

  // Escape from any modal
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // axe on each view
  await injectAxe(page);
  const views = [
    { name: 'Ok', title: 'Approvals' },
    { name: 'chat', title: 'Chat' },
    { name: 'Cal', title: 'Calendar' },
    { name: 'Soc', title: 'Accounts' },
    { name: 'Pg', title: 'Page pipeline' },
  ];

  for (const v of views) {
    await clickTabByTitle(page, v.title);
    await page.waitForTimeout(600);
    const slug = v.name.toLowerCase();
    const shotPath = path.join(SHOT_DIR, `a11y_07_axe-${slug}.png`);
    await page.screenshot({ path: shotPath, fullPage: true });
    results.screenshots.push(`a11y_07_axe-${slug}.png`);
    results.axe[v.name] = await runAxe(page, v.name);
  }

  // Check for focus trap: tab walk on Ok view
  const okTrail = await tabWalk(page, 15);
  const unique = new Set(okTrail.map((t) => t.name));
  if (okTrail.length >= 10 && unique.size <= 3) {
    results.keyboard.focusTrap = { view: 'Ok', uniqueFocusTargets: [...unique] };
    results.keyboard.findings.unshift({
      severity: 'blocker',
      issue: 'Possible focus trap on Approvals view: Tab cycle hits very few targets',
      uniqueFocusTargets: [...unique],
    });
  }

  // Try keyboard to approval buttons if present
  const approveBtn = page.getByRole('button', { name: /approve/i });
  if (await approveBtn.count()) {
    await approveBtn.first().focus();
    const approveFocus = await page.evaluate(focusDesc);
    results.keyboard.approvalButtonFocus = approveFocus;
    await page.keyboard.press('Enter');
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(SHOT_DIR, 'a11y_08_approve-enter.png') });
    results.screenshots.push('a11y_08_approve-enter.png');
  } else {
    results.keyboard.findings.push({
      severity: 'info',
      issue: 'No Approve button found on Ok view during this run (may need pending approval)',
    });
  }
} catch (err) {
  results.error = String(err.message || err);
  await page.screenshot({ path: path.join(SHOT_DIR, 'a11y_99_error.png') }).catch(() => {});
} finally {
  fs.writeFileSync(OUT_JSON, JSON.stringify(results, null, 2));
  await browser.close();
}

console.log(JSON.stringify({ ok: !results.error, out: OUT_JSON, axe: results.axe, first_success: results.reached_first_success }, null, 2));
