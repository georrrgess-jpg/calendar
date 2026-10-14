#!/usr/bin/env node
/*
 * Browser checks for assignments.html, driven by Playwright (used only by the
 * developer; the app itself needs nothing). Opens the file from file://, with
 * network access disabled, and walks through the acceptance checklist.
 *
 *   node tests/browser.js            # run all checks
 *   node tests/browser.js --shots    # also save screenshots to tests/.shots/
 *
 * Needs Playwright with Chromium installed (globally is fine; the script also
 * looks in `npm root -g`).
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

function loadPlaywright() {
  try { return require('playwright'); } catch (e) { /* try global */ }
  try {
    const g = require('child_process').execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    return require(path.join(g, 'playwright'));
  } catch (e) {
    console.error('Playwright is not installed. Install it globally (npm i -g playwright) or skip browser checks.');
    process.exit(2);
  }
}
const { chromium } = loadPlaywright();

const root = path.resolve(__dirname, '..');
const fileUrl = 'file://' + path.join(root, 'assignments.html');
const fixtures = n => path.join(__dirname, 'fixtures', n);
const SHOTS = process.argv.includes('--shots');
const shotsDir = path.join(__dirname, '.shots');
if (SHOTS) fs.mkdirSync(shotsDir, { recursive: true });

let passed = 0, failed = 0; const failures = [];
async function check(name, fn) {
  try { await fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; failures.push(name); console.log('  FAIL ' + name + '\n       ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n       ')); }
}

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ timezoneId: 'America/New_York', viewport: { width: 1440, height: 900 }, colorScheme: 'dark', acceptDownloads: true });
  const page = await context.newPage();
  const consoleErrors = [], pageErrors = [], requests = [];
  page.on('console', m => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', e => pageErrors.push(String(e)));
  page.on('request', r => requests.push(r.url()));
  await context.route(/^https?:\/\//, r => { requests.push('BLOCKED ' + r.request().url()); r.abort(); });

  await page.goto(fileUrl);
  await page.waitForSelector('#view-root');

  console.log('offline & load');
  await check('renders from file:// with zero network requests', async () => {
    await page.waitForTimeout(300);
    const external = requests.filter(u => !u.startsWith('file://'));
    assert.deepStrictEqual(external, [], 'unexpected requests: ' + external.join(', '));
    assert.deepStrictEqual(pageErrors, []);
    assert.deepStrictEqual(consoleErrors, []);
    assert.strictEqual(await page.title(), 'Assignments');
    assert.ok(await page.isVisible('#nav'));
  });
  await check('empty state offers import and demo data', async () => {
    assert.ok(await page.isVisible('[data-action="open-import"]'));
    assert.ok(await page.isVisible('[data-action="load-demo"]'));
  });
  await check('demo data loads and the hero card shows a countdown', async () => {
    await page.click('[data-action="load-demo"]');
    await page.waitForSelector('.hero .hero-title');
    const title = await page.textContent('.hero .hero-title');
    assert.ok(title.trim().length > 0);
    assert.ok(await page.isVisible('.hero [data-action="start"]'));
    assert.ok(await page.isVisible('.lane[data-lane="today"]'));
    assert.ok(await page.isVisible('.lane[data-lane="overdue"]'), 'overdue lane visible');
    assert.ok((await page.textContent('#streak-widget')).includes('day'));
  });

  console.log('quick add');
  await check('quick-add parses the spec example and adds the item', async () => {
    await page.fill('#quickadd', 'Chem lab report fri 11:59pm #chem !high 45m');
    await page.waitForSelector('#quickadd-preview:not([hidden])');
    const preview = await page.textContent('#quickadd-preview');
    assert.ok(preview.includes('Chem lab report'), preview);
    assert.ok(preview.includes('Chemistry'), 'class resolved from #chem: ' + preview);
    assert.ok(preview.includes('high'), preview);
    assert.ok(preview.includes('45m'), preview);
    await page.press('#quickadd', 'Enter');
    await page.waitForSelector('.toast');
    assert.strictEqual(await page.inputValue('#quickadd'), '', 'input cleared after adding');
    await page.keyboard.press('Escape');
    const st = await page.evaluate(() => { const a = App.state.assignments.find(x => x.title === 'Chem lab report'); return a && { p: a.priority, auto: a.priorityAuto, est: a.estimatedMin, due: a.due, cls: App.className(a.classId) }; });
    assert.ok(st, 'assignment stored');
    assert.strictEqual(st.p, 'high'); assert.strictEqual(st.auto, false); assert.strictEqual(st.est, 45); assert.strictEqual(st.cls, 'Chemistry');
    const d = new Date(st.due);
    assert.strictEqual(d.getUTCHours() === 3 || d.getUTCHours() === 4, true, 'due 11:59 PM New York = 03:59/04:59 UTC');
  });

  console.log('views, filters, persistence');
  await check('keyboard 1-5 switches views and the last view is restored on reload', async () => {
    await page.keyboard.press('4');
    assert.ok(await page.isVisible('.view[data-view="board"].active'));
    await page.reload(); await page.waitForSelector('#view-root');
    assert.ok(await page.isVisible('.view[data-view="board"].active'), 'board restored after reload');
    assert.strictEqual(await page.getAttribute('#nav [data-view="board"]', 'aria-current'), 'page');
    await page.keyboard.press('1');
    assert.ok(await page.isVisible('.view[data-view="today"].active'));
  });
  await check('class filter chip persists across views and reload; overdue items stay visible', async () => {
    await page.click('#filter-classes .chip:has-text("Precalculus")');
    await page.waitForTimeout(200);
    assert.strictEqual(await page.getAttribute('#filter-classes .chip:has-text("Precalculus")', 'aria-pressed'), 'true');
    const titles = await page.$$eval('.lane:not([data-lane="overdue"]) .item .item-title', els => els.map(e => e.textContent));
    assert.ok(titles.every(t => /Problem set|Midterm/.test(t)), 'only Precalculus items: ' + titles.join(' | '));
    const overdue = await page.$$eval('.lane[data-lane="overdue"] .item .item-title', els => els.map(e => e.textContent));
    assert.ok(overdue.some(t => t.includes('Cell respiration')), 'overdue AP Bio item still shown despite class filter');
    await page.keyboard.press('2'); await page.keyboard.press('1');
    assert.strictEqual(await page.getAttribute('#filter-classes .chip:has-text("Precalculus")', 'aria-pressed'), 'true');
    await page.reload(); await page.waitForSelector('#view-root');
    assert.strictEqual(await page.getAttribute('#filter-classes .chip:has-text("Precalculus")', 'aria-pressed'), 'true');
    await page.click('#filter-classes .chip:has-text("Precalculus")');
  });

  console.log('ICS import');
  await check('dropping both fixtures imports AP Biology only, skips cancelled, keeps holidays out, converts times', async () => {
    await page.click('#btn-import');
    await page.waitForSelector('#dropzone');
    await page.setInputFiles('#file-ics', [fixtures('ap-bio.ics'), fixtures('holidays.ics')]);
    await page.waitForSelector('#import-summary:not([hidden])');
    const summary = await page.textContent('#import-summary');
    assert.ok(summary.includes('AP Biology - Period 3 (7)'), summary);
    assert.ok(summary.includes('Ignored as not-a-class: Holidays in United States'), summary);
    assert.ok(summary.includes('1 cancelled event skipped'), summary);
    const s = await page.evaluate(() => ({
      classes: App.state.classes.map(c => c.name),
      bio: App.state.assignments.filter(a => a.source === 'ics').map(a => ({ t: a.title, due: a.due, allDay: a.allDay, url: a.url })),
      known: App.state.settings.knownCalendars, hidden: App.state.settings.hiddenCalendars
    }));
    assert.ok(s.classes.includes('AP Biology - Period 3'));
    assert.ok(!s.classes.some(c => /Holidays/.test(c)), 'no holidays class');
    assert.strictEqual(s.bio.length, 7);
    assert.ok(!s.bio.some(a => /cancelled/i.test(a.t)));
    const lab = s.bio.find(a => a.t === 'Lab report: enzyme activity');
    assert.strictEqual(lab.due, '2026-10-21T03:59:00.000Z');
    const form = s.bio.find(a => a.t === 'Lab safety form');
    assert.strictEqual(form.due, '2026-10-23T19:00:00.000Z');
    const ws = s.bio.find(a => a.t === 'Cellular respiration worksheet');
    assert.strictEqual(ws.allDay, true);
    assert.ok(ws.url.startsWith('https://classroom.google.com/'));
    assert.ok(s.known.includes('Holidays in United States') && s.hidden.includes('Holidays in United States'));
    await page.keyboard.press('Escape');
    await page.fill('#filter-search', 'enzyme');
    await page.waitForTimeout(300);
    const due = await page.textContent('.item:has-text("enzyme activity") .due');
    assert.ok(due.includes('11:59 PM'), 'local due time shown: ' + due);
    await page.fill('#filter-search', '');
  });
  await check('re-import keeps done flag and priority override', async () => {
    await page.evaluate(() => {
      const a = App.state.assignments.find(x => x.title === 'Lab report: enzyme activity');
      App.setPriority(a.id, 'low');
      App.completeAssignment(a.id);
      const b = App.state.assignments.find(x => x.title === 'Lab safety form');
      App.updateAssignment(b.id, { notes: 'bring pen', estimatedMin: 15 });
    });
    await page.waitForTimeout(600);
    await page.click('#btn-import');
    await page.setInputFiles('#file-ics', [fixtures('ap-bio.ics')]);
    await page.waitForSelector('#import-summary:not([hidden])');
    const summary = await page.textContent('#import-summary');
    assert.ok(summary.includes('0 new'), summary);
    const s = await page.evaluate(() => {
      const a = App.state.assignments.find(x => x.title === 'Lab report: enzyme activity');
      const b = App.state.assignments.find(x => x.title === 'Lab safety form');
      return { done: a.done, p: a.priority, auto: a.priorityAuto, notes: b.notes, est: b.estimatedMin, count: App.state.assignments.filter(x => x.source === 'ics').length };
    });
    assert.strictEqual(s.done, true); assert.strictEqual(s.p, 'low'); assert.strictEqual(s.auto, false);
    assert.strictEqual(s.notes, 'bring pen'); assert.strictEqual(s.est, 15); assert.strictEqual(s.count, 7);
    await page.keyboard.press('Escape');
    assert.ok((await page.textContent('#footer-import')).includes('Last import:'));
  });

  console.log('countdowns, completion, streak');
  await check('an item due in 10 minutes is hot and pulsing; completing it fires confetti and bumps the streak', async () => {
    const before = await page.evaluate(() => App.state.stats.streakDays);
    const id = await page.evaluate(() => {
      const d = new Date(Date.now() + 10 * 60000);
      return App.addAssignment({ title: 'Ten minute test', due: d.toISOString(), allDay: false }).id;
    });
    await page.waitForSelector(`.item[data-id="${id}"] .countdown.is-hot`);
    const text = await page.textContent(`.item[data-id="${id}"] .countdown`);
    assert.ok(/^(9|10)m$/.test(text.trim()), text);
    const anim = await page.$eval(`.item[data-id="${id}"] .countdown`, el => getComputedStyle(el).animationName);
    assert.strictEqual(anim, 'hot-pulse');
    const firstToday = await page.textContent('.lane[data-lane="today"] .item .item-title');
    assert.strictEqual(firstToday.trim(), 'Ten minute test', 'most urgent item leads the today lane');
    const hero = await page.textContent('.hero .hero-title');
    const heroOverdue = await page.evaluate(() => App.isOverdue(App.byId(document.querySelector('.hero').dataset.id)));
    assert.ok(hero.trim() === 'Ten minute test' || heroOverdue, 'hero is overdue work or the 10-minute item: ' + hero);
    await page.waitForFunction(() => !document.getElementById('confetti-canvas').classList.contains('is-on'), null, { timeout: 5000 });
    await page.click(`.item[data-id="${id}"] .item-check`);
    const fired = await page.waitForFunction(() => document.getElementById('confetti-canvas').classList.contains('is-on'), null, { timeout: 2000 }).then(() => true).catch(() => false);
    assert.ok(fired, 'confetti canvas turned on');
    await page.waitForFunction(id => !document.querySelector(`.item[data-id="${id}"]`), id);
    const after = await page.evaluate(() => App.state.stats.streakDays);
    assert.ok(after >= 1, 'streak is at least 1 (was ' + before + ', now ' + after + ')');
    const key = await page.evaluate(() => Object.keys(App.state.stats.completedByDay).sort().pop());
    assert.strictEqual(key, await page.evaluate(() => Core.dayKey(new Date())));
  });
  await check('ticker updates countdown text in place', async () => {
    const id = await page.evaluate(() => App.addAssignment({ title: 'Ticker test', due: new Date(Date.now() + 3 * 3600000 + 5 * 60000).toISOString(), allDay: false }).id);
    const t1 = await page.textContent(`.item[data-id="${id}"] .countdown`);
    await page.evaluate(() => { App.setNow(new Date(Date.now() + 60 * 60000)); });
    const t2 = await page.textContent(`.item[data-id="${id}"] .countdown`);
    assert.notStrictEqual(t1.trim(), t2.trim());
    assert.ok(t2.includes('2h'), t2);
    await page.evaluate(() => App.setNow(null));
  });

  console.log('settings, theme, focus, backup');
  await check('theme toggles and persists; settings rename/colour persist', async () => {
    await page.click('#btn-theme');
    assert.strictEqual(await page.getAttribute('html', 'data-theme'), 'light');
    await page.reload(); await page.waitForSelector('#view-root');
    assert.strictEqual(await page.getAttribute('html', 'data-theme'), 'light');
    await page.click('#btn-theme');
    assert.strictEqual(await page.getAttribute('html', 'data-theme'), 'dark');
    await page.keyboard.press(',');
    await page.waitForSelector('.class-row');
    const row = page.locator('.class-row:has([data-field="name"][value="AP Biology - Period 3"])').first();
    await row.locator('[data-field="name"]').fill('AP Bio');
    await row.locator('[data-field="name"]').press('Tab');
    await row.locator('[data-field="color"][data-color="5"]').click();
    await page.fill('#st-budget', '90'); await page.press('#st-budget', 'Tab');
    await page.keyboard.press('Escape');
    await page.reload(); await page.waitForSelector('#view-root');
    const s = await page.evaluate(() => ({ c: App.state.classes.find(c => c.sourceName === 'AP Biology - Period 3'), b: App.state.settings.dailyBudgetMin }));
    assert.strictEqual(s.c.name, 'AP Bio'); assert.strictEqual(s.c.color, 5); assert.strictEqual(s.b, 90);
    assert.ok(await page.isVisible('#filter-classes .chip:has-text("AP Bio")'));
  });
  await check('focus mode hides everything but the hero and today lane', async () => {
    await page.keyboard.press('f');
    await page.waitForFunction(() => document.body.classList.contains('focus-mode'));
    assert.ok(await page.isHidden('#filterbar'));
    assert.ok(await page.isHidden('.lane[data-lane="tomorrow"]'));
    assert.ok(await page.isVisible('.hero'));
    assert.ok(await page.isVisible('.lane[data-lane="today"]'));
    await page.keyboard.press('f');
    assert.ok(await page.isVisible('#filterbar'));
  });
  await check('JSON export then import on cleared storage restores everything', async () => {
    const before = await page.evaluate(() => JSON.stringify({ a: App.state.assignments.length, c: App.state.classes.length, s: App.state.stats.completedByDay }));
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-backup')]);
    assert.match(download.suggestedFilename(), /^assignments-backup-\d{4}-\d{2}-\d{2}\.json$/);
    const tmp = path.join(os.tmpdir(), download.suggestedFilename());
    await download.saveAs(tmp);
    await page.waitForTimeout(400);
    await page.evaluate(() => localStorage.clear());
    await page.reload(); await page.waitForSelector('#view-root');
    assert.ok(await page.isVisible('[data-action="load-demo"]'), 'empty after clearing storage');
    await page.click('#btn-import');
    await page.click('[role="tab"][data-tab="json"]');
    await page.click('[data-action="import-json-merge"]');
    await page.setInputFiles('#file-json', tmp);
    await page.waitForSelector('.toast.is-ok');
    const after = await page.evaluate(() => JSON.stringify({ a: App.state.assignments.length, c: App.state.classes.length, s: App.state.stats.completedByDay }));
    assert.strictEqual(after, before);
    await page.reload(); await page.waitForSelector('#view-root');
    assert.strictEqual(await page.evaluate(() => JSON.stringify({ a: App.state.assignments.length, c: App.state.classes.length, s: App.state.stats.completedByDay })), before);
  });

  console.log('responsive, motion, keyboard');
  await check('reduced motion disables the pulse animation', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const id = await page.evaluate(() => App.addAssignment({ title: 'Motion test', due: new Date(Date.now() + 5 * 60000).toISOString(), allDay: false }).id);
    const dur = await page.$eval(`.item[data-id="${id}"] .countdown`, el => getComputedStyle(el).animationName + '/' + getComputedStyle(el).animationDuration);
    assert.ok(/none|0\.0{0,3}1?ms|0s/.test(dur), dur);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(id => App.deleteAssignment(id), id);
  });
  await check('usable at 360px: no horizontal overflow, nav reachable', async () => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.waitForTimeout(200);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 0, 'horizontal overflow: ' + over + 'px');
    assert.ok(await page.isVisible('#nav [data-view="month"]'));
    if (SHOTS) await page.screenshot({ path: path.join(shotsDir, 'today-360.png'), fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    if (SHOTS) await page.screenshot({ path: path.join(shotsDir, 'today-1440.png'), fullPage: true });
  });
  await check('Esc closes the modal; N focuses quick-add; / focuses search', async () => {
    await page.keyboard.press('n');
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'quickadd');
    await page.keyboard.press('Escape');
    await page.keyboard.press('/');
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'filter-search');
    await page.keyboard.press('Escape');
    await page.keyboard.press('?');
    await page.waitForSelector('#modal-root .modal');
    await page.keyboard.press('Escape');
    assert.ok(!(await page.$('#modal-root .modal')));
  });
  await check('no console or page errors during the whole run', async () => {
    assert.deepStrictEqual(pageErrors, []);
    assert.deepStrictEqual(consoleErrors, []);
    const external = requests.filter(u => !u.startsWith('file://'));
    assert.deepStrictEqual(external, []);
  });

  /* Module checks: every tests/checks/*.js exports async ({ page, check, assert, fixtures, SHOTS, shotsDir, path }) => {} */
  const checksDir = path.join(__dirname, 'checks');
  if (fs.existsSync(checksDir)) {
    for (const f of fs.readdirSync(checksDir).filter(f => f.endsWith('.js')).sort()) {
      console.log(f.replace(/\.js$/, ''));
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.evaluate(() => App.setNow(null));
      await require(path.join(checksDir, f))({ page, check, assert, fixtures, SHOTS, shotsDir, path, fileUrl });
    }
    await check('no console or page errors in module checks', async () => {
      assert.deepStrictEqual(pageErrors, []);
      assert.deepStrictEqual(consoleErrors, []);
      assert.deepStrictEqual(requests.filter(u => !u.startsWith('file://')), []);
    });
  }

  await browser.close();
  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  if (failed) { console.log('Failed: ' + failures.join(', ')); process.exit(1); }
})().catch(e => { console.error(e); process.exit(1); });
