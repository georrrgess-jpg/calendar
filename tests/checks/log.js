/*
 * Daily log checks. Loaded by tests/browser.js after its own checks; the page
 * holds demo data plus imported fixtures. The log opens on a month calendar;
 * selecting a day opens its editor. Everything the checks log is removed again
 * at the end (the original log, unit, week start, view and theme are restored).
 */
'use strict';
module.exports = async ({ page, check, assert, SHOTS, shotsDir, path }) => {
  const original = await page.evaluate(() => ({
    days: JSON.stringify(App.state.log.days), unit: App.state.settings.weightUnit, theme: App.state.settings.theme,
    wso: App.state.settings.weekStartsOn,
    view: App.state.ui.view, cursor: App.state.ui.logCursor || null, cursorSet: App.state.ui.logCursorSet || null, open: !!App.state.ui.logOpen
  }));
  const today = await page.evaluate(() => Core.dayKey(App.now()));
  const shift = (k, n) => page.evaluate(([k, n]) => Core.dayKey(Core.addDays(Core.fromDayKey(k), n)), [k, n]);
  const yesterday = await shift(today, -1);
  const tomorrow = await shift(today, 1);
  const day = k => page.evaluate(k => JSON.parse(JSON.stringify(App.logDay(k))), k);
  const cursor = () => page.evaluate(() => App.state.ui.logCursor);
  const edDay = () => page.evaluate(() => { const e = document.getElementById('log-ed'); return e ? e.dataset.day : null; });
  const gridMonth = () => page.getAttribute('#log-grid', 'data-month');
  const active = () => page.evaluate(() => { const a = document.activeElement; return a ? (a.dataset.day || a.id || a.dataset.fk || a.tagName) : null; });
  const cell = k => `#log-grid .log-cell[data-day="${k}"]:not(.is-out)`;
  const shot = async name => { if (SHOTS) await page.screenshot({ path: path.join(shotsDir, name), fullPage: true }); };
  const setTheme = t => page.evaluate(t => { App.state.settings.theme = t; App.applyTheme(); }, t);
  const blur = () => page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
  const clearToasts = () => page.evaluate(() => { document.getElementById('toasts').innerHTML = ''; });
  await page.evaluate(() => { App.closeModal(); App.closePanel(); });

  await check('log: key 7 opens the month calendar; L opens today\'s editor', async () => {
    await page.evaluate(() => { App.state.ui.logCursor = null; App.state.ui.logOpen = false; App.setView('today'); });
    await blur();
    await page.keyboard.press('7');
    await page.waitForSelector('.view[data-view="log"].active .log-cal');
    assert.strictEqual(await page.getAttribute('#nav [data-view="log"]', 'aria-current'), 'page');
    const monthName = await page.evaluate(() => Core.MONTHS_LONG[App.now().getMonth()]);
    assert.ok((await page.textContent('#log-title')).includes(monthName));
    assert.strictEqual(await gridMonth(), today.slice(0, 7));
    assert.strictEqual(await page.$('#log-ed'), null, 'no editor until a day is picked');
    assert.strictEqual(await page.getAttribute(cell(today), 'aria-current'), 'date');
    assert.ok(await page.isVisible('.log-legend'));
    await page.keyboard.press('1');
    await blur();
    await page.keyboard.press('l');
    await page.waitForSelector('.view[data-view="log"].active #log-ed');
    assert.strictEqual(await cursor(), today);
    assert.strictEqual(await edDay(), today);
    assert.ok((await page.textContent('#log-ed .log-ed-eyebrow')).includes('Today'));
    assert.strictEqual(await page.inputValue('#log-date'), today);
  });

  await check('log: the month grid has whole weeks and starts on weekStartsOn (0 and 1)', async () => {
    for (const wso of [0, 1]) {
      await page.evaluate(w => { App.state.settings.weekStartsOn = w; App.render(); }, wso);
      const r = await page.evaluate(() => {
        const g = document.getElementById('log-grid');
        const m = g.dataset.month, first = Core.fromDayKey(m + '-01');
        const start = Core.startOfWeek(first, App.state.settings.weekStartsOn);
        const dim = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
        const want = Math.ceil((Core.daysBetween(start, first) + dim) / 7) * 7;
        const cells = Array.from(g.querySelectorAll('.log-cell'));
        return {
          n: cells.length, want, firstKey: cells[0].dataset.day, startKey: Core.dayKey(start),
          firstDow: Core.fromDayKey(cells[0].dataset.day).getDay(), head: document.querySelector('.log-wd .log-wd-l').textContent,
          inMonth: cells.filter(c => !c.classList.contains('is-out')).length, dim
        };
      });
      assert.strictEqual(r.n, r.want, 'cells for weekStartsOn ' + wso);
      assert.strictEqual(r.firstKey, r.startKey);
      assert.strictEqual(r.firstDow, wso);
      assert.strictEqual(r.head, wso === 1 ? 'Mon' : 'Sun');
      assert.strictEqual(r.inMonth, r.dim, 'adjacent-month days are marked is-out');
    }
    await page.evaluate(w => { App.state.settings.weekStartsOn = w; App.render(); }, original.wso);
  });

  await check('log: clicking a day opens its editor with the right date; prev/next day arrows keep it open', async () => {
    await page.evaluate(() => { App.state.ui.logOpen = false; App.render(); });
    assert.ok(await page.isVisible('.log-ph'), 'side column invites picking a day');
    await page.click(cell(yesterday));
    await page.waitForSelector('#log-ed');
    assert.strictEqual(await edDay(), yesterday);
    assert.strictEqual(await cursor(), yesterday);
    const full = await page.evaluate(k => { const d = Core.fromDayKey(k); return Core.WEEKDAYS_LONG[d.getDay()] + ', ' + Core.MONTHS_LONG[d.getMonth()] + ' ' + d.getDate() + ', ' + d.getFullYear(); }, yesterday);
    assert.strictEqual((await page.textContent('#log-ed-title')).trim(), full);
    assert.strictEqual(await page.getAttribute(cell(yesterday), 'aria-pressed'), 'true');
    await page.click('#log-ed [data-action="log-next"]');
    assert.strictEqual(await edDay(), today);
    await page.click('#log-ed [data-action="log-next"]');
    assert.strictEqual(await edDay(), tomorrow, 'future days can be opened for planning');
    assert.strictEqual(await active(), 'next', 'focus stays on the arrow');
    await page.click('#log-ed [data-action="log-prev"]');
    assert.strictEqual(await edDay(), today);
  });

  await check('log: mood buttons form a radio group; tap selects, tap again clears; the cell updates at once', async () => {
    await page.click('.log-mood-btn[data-mood="good"]');
    assert.strictEqual(await page.getAttribute('.log-mood-btn[data-mood="good"]', 'aria-checked'), 'true');
    assert.strictEqual(await page.getAttribute('.log-mood-btn[data-mood="bad"]', 'aria-checked'), 'false');
    assert.strictEqual((await day(today)).mood, 'good');
    assert.strictEqual(await page.evaluate(() => document.activeElement.dataset.mood), 'good', 'focus kept on the mood');
    assert.ok(await page.$eval(cell(today), el => el.classList.contains('has-mood')));
    assert.strictEqual((await page.textContent(`${cell(today)} .log-cell-mood`)).trim(), '😊');
    assert.ok((await page.getAttribute(cell(today), 'aria-label')).includes('Good day'));
    await page.click('.log-mood-btn[data-mood="good"]');
    assert.strictEqual(await page.getAttribute('.log-mood-btn[data-mood="good"]', 'aria-checked'), 'false');
    assert.strictEqual(await day(today), null, 'clearing the only field removes the entry');
    assert.strictEqual(await page.$(`${cell(today)} .log-cell-mood`), null, 'cell mood cleared');
    await page.click('.log-mood-btn[data-mood="medium"]');
    await page.keyboard.press('ArrowLeft');
    assert.strictEqual((await day(today)).mood, 'good', 'ArrowLeft inside the group moves the selection');
    assert.strictEqual(await cursor(), today);
    assert.strictEqual(await page.getAttribute('.log-moods', 'role'), 'radiogroup');
    assert.strictEqual((await page.textContent(`${cell(today)} .log-cell-mood`)).trim(), '😊');
  });

  await check('log: weight saves with its unit, the toggle converts, the change and trend show, and the cell shows it', async () => {
    await page.evaluate(() => { App.state.settings.weightUnit = 'lb'; App.render(); });
    await page.evaluate(k => App.updateLogDay(k, { weight: 151.2, weightUnit: 'lb' }), yesterday);
    await page.fill('#log-weight', '150.4');
    await page.press('#log-weight', 'Tab');
    await page.waitForTimeout(50);
    let d = await day(today);
    assert.strictEqual(d.weight, 150.4);
    assert.strictEqual(d.weightUnit, 'lb');
    const delta = await page.textContent('#log-wstats .log-delta');
    assert.ok(/▼\s*Down 0\.8 lb since/.test(delta.replace(/\s+/g, ' ')), delta);
    assert.ok(await page.isVisible('#log-wstats .log-spark'), 'sparkline with two weigh-ins');
    assert.strictEqual((await page.textContent(`${cell(today)} .log-cell-w`)).replace(/\s+/g, ' ').trim(), '150.4 lb');
    await page.click('.log-unit[data-unit="kg"]');
    assert.strictEqual(await page.evaluate(() => App.state.settings.weightUnit), 'kg');
    assert.strictEqual(await page.getAttribute('.log-unit[data-unit="kg"]', 'aria-pressed'), 'true');
    assert.strictEqual(await page.inputValue('#log-weight'), '68.2');
    assert.ok((await page.textContent('#log-wstats .log-delta')).includes('kg'));
    assert.strictEqual((await page.textContent(`${cell(today)} .log-cell-w`)).replace(/\s+/g, ' ').trim(), '68.2 kg', 'cell converts with the unit');
    assert.strictEqual((await page.textContent(`${cell(yesterday)} .log-cell-w`)).replace(/\s+/g, ' ').trim(), '68.6 kg');
    d = await day(today);
    assert.strictEqual(d.weight, 150.4, 'stored value untouched by the toggle');
    /* Hover and focus both show the readout. */
    await page.locator('.log-spark').scrollIntoViewIfNeeded();
    /* The editor re-renders after the unit switch; hover the settled chart, re-hovering if a render replaced it. */
    let tipShown = false;
    for (let attempt = 0; attempt < 4 && !tipShown; attempt++) {
      await page.waitForTimeout(150);
      const box = await page.locator('.log-spark').boundingBox();
      await page.mouse.move(0, 0);
      await page.mouse.move(box.x + 4, box.y + box.height / 2, { steps: 3 });
      tipShown = await page.waitForSelector('.log-spark-tip:not([hidden])', { timeout: 800 }).then(() => true).catch(() => false);
    }
    assert.ok(tipShown && await page.isVisible('.log-spark-tip'));
    assert.ok((await page.textContent('.log-spark-tip')).includes('68.6 kg'), await page.textContent('.log-spark-tip'));
    await page.mouse.move(0, 0);
    await page.focus('.log-spark');
    assert.ok((await page.textContent('.log-spark-tip')).includes('68.2 kg'));
    await page.keyboard.press('ArrowLeft');
    assert.ok((await page.textContent('.log-spark-tip')).includes('68.6 kg'));
    assert.strictEqual(await cursor(), today, 'arrows on the trend do not change day');
    await page.click('.log-unit[data-unit="lb"]');
    assert.strictEqual(await page.inputValue('#log-weight'), '150.4');
  });

  await check('log: get a verse, then draw a different one; it persists per day and marks the cell', async () => {
    await page.click('[data-action="log-verse"][data-fk="verse-get"]');
    const v1 = (await day(today)).verse;
    assert.ok(v1 && v1.ref && v1.text);
    assert.strictEqual((await page.textContent('.log-quote-text')).trim(), v1.text);
    assert.strictEqual((await page.textContent('.log-quote-ref')).trim(), v1.ref);
    assert.ok(await page.evaluate(r => Core.VERSES.some(v => v.ref === r), v1.ref));
    for (let i = 0; i < 3; i++) {
      const before = (await day(today)).verse.ref;
      await page.click('[data-fk="verse-new"]');
      assert.notStrictEqual((await day(today)).verse.ref, before, 'new verse differs');
    }
    assert.strictEqual(await page.evaluate(() => document.activeElement.dataset.fk), 'verse-new');
    assert.ok(await page.isVisible(`${cell(today)} .log-mark-verse`));
    if (SHOTS) await page.waitForTimeout(600);
  });

  await check('log: the note autosaves after the debounce, keeps focus and caret, and survives a reload', async () => {
    await page.click('#log-note');
    await page.keyboard.type('Scored a goal!');
    assert.strictEqual(((await day(today)).note || ''), '', 'not saved before the debounce');
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'log-note');
    await page.waitForTimeout(650);
    assert.strictEqual((await day(today)).note, 'Scored a goal!');
    assert.ok((await page.textContent('#log-note-status')).includes('Saved'));
    await page.keyboard.type(' Pizza after.');
    await page.waitForTimeout(650);
    const r = await page.evaluate(() => ({ id: document.activeElement.id, pos: document.activeElement.selectionStart, len: document.activeElement.value.length }));
    assert.deepStrictEqual(r, { id: 'log-note', pos: 27, len: 27 }, 'focus and caret intact while typing');
    assert.strictEqual((await day(today)).note, 'Scored a goal! Pizza after.');
    assert.ok(await page.isVisible(`${cell(today)} .log-mark-note`), 'grid shows the note marker while typing');
    await page.reload(); await page.waitForSelector('#view-root');
    await page.waitForSelector('.view[data-view="log"].active #log-note');
    assert.strictEqual(await page.inputValue('#log-note'), 'Scored a goal! Pizza after.');
    assert.strictEqual(await cursor(), today);
  });

  await check('log: one tap on a preset adds the event with a toast that can undo it', async () => {
    await clearToasts();
    const before = ((await day(today)).events || []).length;
    await page.click('.log-preset[data-type="birthday"]');
    let d = await day(today);
    assert.strictEqual(d.events.length, before + 1);
    assert.deepStrictEqual([d.events[before].type, d.events[before].label, d.events[before].time], ['birthday', 'Birthday', '']);
    assert.ok(await page.isVisible('.log-ev.is-new .log-ev-ico'), 'new event row pops in');
    assert.ok((await page.textContent(`${cell(today)} .log-cell-ev`)).includes('🎂'), 'cell shows the symbol');
    assert.ok((await page.textContent('#toasts')).includes('Added 🎂 Birthday'));
    await page.click('#toasts .toast:last-child button:has-text("Undo")');
    d = await day(today);
    assert.strictEqual(d.events.length, before, 'undo removes it');
    assert.ok(!(await page.textContent(`${cell(today)} .log-cell-ev`)).includes('🎂'));
  });

  await check('log: quick input "Basketball game 7pm" becomes a sports event at 19:00', async () => {
    await page.click('#log-quick-input');
    await page.keyboard.type('Basketball game 7pm');
    assert.strictEqual((await page.textContent('#log-quick-ico')).trim(), '🏆', 'guessed symbol shown live');
    assert.ok((await page.textContent('#log-quick-preview')).includes('Sports game'));
    await page.keyboard.press('Enter');
    const d = await day(today);
    const e = d.events[d.events.length - 1];
    assert.deepStrictEqual([e.type, e.label, e.time], ['sports', 'Basketball game', '19:00']);
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'log-quick-input', 'focus stays to add another');
    assert.strictEqual(await page.inputValue('#log-quick-input'), '');
    assert.strictEqual(await page.inputValue(`#log-ev-t-${e.id}`), '19:00');
    await page.keyboard.type('Pickup with friends');
    await page.selectOption('#log-quick-type', 'sports');
    await page.click('.log-quick-add');
    const d2 = await day(today);
    assert.strictEqual(d2.events[d2.events.length - 1].type, 'sports');
    await page.click(`.log-ev[data-ev="${d2.events[d2.events.length - 1].id}"] .log-ev-remove`);
    assert.strictEqual((await day(today)).events.length, d.events.length);
  });

  await check('log: event label and time are editable in place', async () => {
    const d = await day(today);
    const e = d.events.find(x => x.type === 'sports');
    await page.fill(`#log-ev-l-${e.id}`, 'Basketball vs North');
    await page.press(`#log-ev-l-${e.id}`, 'Enter');
    await page.fill(`#log-ev-t-${e.id}`, '18:30');
    await page.press(`#log-ev-t-${e.id}`, 'Tab');
    const e2 = (await day(today)).events.find(x => x.id === e.id);
    assert.deepStrictEqual([e2.label, e2.time], ['Basketball vs North', '18:30']);
    assert.ok((await page.getAttribute(cell(today), 'aria-label')).includes('Basketball vs North'));
  });

  await check('log: a 3-day vacation lands on three days in a row and shows in the grid', async () => {
    const start = await shift(today, 2);
    const vIcon = await page.evaluate(() => Core.eventPreset('vacation').icon);
    await page.evaluate(k => App.openLogDay(k), start);
    assert.strictEqual(await edDay(), start);
    assert.ok(await page.isHidden('#log-quick-days-wrap'), 'repeat control only for trips and vacations');
    await page.fill('#log-quick-input', 'Beach vacation');
    assert.ok(await page.isVisible('#log-quick-days-wrap'));
    await page.fill('#log-quick-days', '3');
    await page.press('#log-quick-input', 'Enter');
    for (let i = 0; i < 3; i++) {
      const k = await shift(start, i);
      const d = await day(k);
      assert.ok(d && d.events.some(e => e.type === 'vacation' && e.label === 'Beach vacation'), 'vacation on ' + k);
      const c = await page.$(`#log-grid .log-cell[data-day="${k}"] .log-cell-ev`);
      if (c) assert.ok((await c.textContent()).includes(vIcon), 'grid symbol on ' + k);
    }
    assert.strictEqual(await day(await shift(start, 3)), null, 'not on the fourth day');
    assert.ok((await page.textContent('#toasts')).includes('3 days'));
    const id = (await day(start)).events[0].id;
    await page.click(`.log-ev[data-ev="${id}"] [data-action="log-ev-repeat"]`);
    assert.ok(await page.isVisible(`#log-ev-r-${id}`));
    await page.click(`[data-action="log-ev-repeat"][data-ev="${id}"]`);
    assert.ok(await page.isHidden(`#log-ev-r-${id}`));
  });

  await check('log: prev/next month buttons and Today change the month; the date input opens a day', async () => {
    await page.evaluate(k => App.openLogDay(k), today);
    const m0 = today.slice(0, 7);
    const mPrev = await page.evaluate(m => Core.dayKey(Core.addMonths(Core.fromDayKey(m + '-01'), -1)).slice(0, 7), m0);
    const mNext = await page.evaluate(m => Core.dayKey(Core.addMonths(Core.fromDayKey(m + '-01'), 1)).slice(0, 7), m0);
    await page.click('[data-action="log-month-prev"]');
    assert.strictEqual(await gridMonth(), mPrev);
    assert.strictEqual(await active(), 'm-prev', 'focus stays on the button');
    assert.strictEqual(await edDay(), today, 'the open day stays open while browsing');
    await page.click('[data-action="log-month-next"]');
    await page.click('[data-action="log-month-next"]');
    assert.strictEqual(await gridMonth(), mNext);
    const nextName = await page.evaluate(m => Core.MONTHS_LONG[+m.slice(5) - 1], mNext);
    assert.ok((await page.textContent('#log-title')).includes(nextName));
    await page.click('[data-action="log-month-today"]');
    assert.strictEqual(await gridMonth(), m0);
    await page.fill('#log-date', '2026-09-03');
    assert.strictEqual(await cursor(), '2026-09-03');
    assert.strictEqual(await gridMonth(), '2026-09');
    assert.strictEqual(await edDay(), '2026-09-03');
    assert.ok((await page.textContent('#log-ed-title')).includes('September 3'));
    /* Clicking a dimmed day of the next month opens it and shows its month. */
    const out = await page.$eval('#log-grid .log-cell.is-out:last-child', el => el.dataset.day);
    await page.click(`#log-grid .log-cell[data-day="${out}"]`);
    assert.strictEqual(await edDay(), out);
    assert.strictEqual(await gridMonth(), out.slice(0, 7));
  });

  await check('log: openLogDay(\'2026-11-03\') shows November with that day\'s editor open', async () => {
    await page.evaluate(() => App.setView('week'));
    await page.evaluate(() => App.openLogDay('2026-11-03'));
    assert.ok(await page.isVisible('.view[data-view="log"].active #log-ed'));
    assert.strictEqual(await gridMonth(), '2026-11');
    assert.strictEqual(await edDay(), '2026-11-03');
    assert.ok((await page.textContent('#log-title')).includes('November 2026'));
    assert.ok((await page.textContent('#log-ed-title')).includes('November 3, 2026'));
    assert.strictEqual(await page.getAttribute(cell('2026-11-03'), 'aria-pressed'), 'true');
  });

  await check('log: grid keys (arrows, Home/End, PageUp/PageDown, T, Enter) and Esc closes, restoring focus', async () => {
    await page.evaluate(k => { App.openLogDay(k); }, today);
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.$('#log-ed'), null, 'Esc closed the editor');
    assert.strictEqual(await active(), today, 'focus back on the day cell');
    assert.strictEqual(await page.$$eval('#log-grid .log-cell[tabindex="0"]', a => a.length), 1, 'one tab stop in the grid');
    await page.keyboard.press('ArrowRight');
    assert.strictEqual(await active(), tomorrow);
    await page.keyboard.press('ArrowDown');
    const plus8 = await shift(today, 8);
    assert.strictEqual(await active(), plus8);
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('ArrowLeft');
    assert.strictEqual(await active(), today);
    assert.strictEqual(await cursor(), today, 'moving focus does not select');
    await page.keyboard.press('PageDown');
    const nextM = await page.evaluate(k => Core.dayKey(Core.addMonths(Core.fromDayKey(k), 1)).slice(0, 7), today);
    assert.strictEqual(await gridMonth(), nextM);
    assert.ok((await active()).startsWith(nextM), 'focus moved into the next month');
    await page.keyboard.press('PageUp');
    assert.strictEqual(await gridMonth(), today.slice(0, 7));
    await page.keyboard.press('PageUp');
    await page.keyboard.press('t');
    assert.strictEqual(await gridMonth(), today.slice(0, 7));
    assert.strictEqual(await active(), today);
    await page.keyboard.press('Home');
    const ws = await page.evaluate(k => Core.dayKey(Core.startOfWeek(Core.fromDayKey(k), App.state.settings.weekStartsOn)), today);
    assert.strictEqual(await active(), ws);
    await page.keyboard.press('End');
    assert.strictEqual(await active(), await shift(ws, 6));
    await page.keyboard.press('t');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#log-ed');
    assert.strictEqual(await edDay(), today);
    assert.strictEqual(await active(), 'log-ed-title', 'focus moves into the editor');
    await page.keyboard.press('ArrowRight');
    assert.strictEqual(await edDay(), today, 'arrows do nothing while the editor is focused');
    /* Never act while typing; Esc in a field of the editor still closes it. */
    await page.focus('#log-note');
    await page.keyboard.press('End');
    await page.keyboard.press('t');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('ArrowLeft');
    assert.strictEqual(await cursor(), today);
    assert.strictEqual(await active(), 'log-note');
    await page.waitForTimeout(500);
    assert.strictEqual((await day(today)).note, 'Scored a goal! Pizza after.');
    await page.focus('#log-note');
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.$('#log-ed'), null);
    assert.strictEqual(await active(), today);
    /* Space opens too, and the ✕ button closes back to the cell. */
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press(' ');
    await page.waitForSelector('#log-ed');
    assert.strictEqual(await edDay(), yesterday);
    await page.click('#log-ed [data-action="log-close"]');
    assert.strictEqual(await page.$('#log-ed'), null);
    assert.strictEqual(await active(), yesterday);
  });

  await check('log: cells show mood, symbols, weight, markers; history lists the day; screenshots', async () => {
    await page.evaluate(k => App.openLogDay(k), today);
    const c = cell(today);
    assert.ok(await page.isVisible(`${c} .log-cell-mood`));
    assert.ok((await page.textContent(`${c} .log-cell-ev`)).includes('🏆'));
    assert.ok(await page.isVisible(`${c} .log-mark-note`));
    const label = await page.getAttribute(c, 'aria-label');
    assert.ok(label.includes('Good day') && label.includes('weight 150.4 lb') && label.includes('note'), label);
    const row = `.log-hist-row[data-day="${today}"]`;
    assert.ok(await page.isVisible(row));
    const t = await page.textContent(row);
    assert.ok(t.includes('150.4 lb') && t.includes('Scored a goal!') && t.includes('🏆'), t);
    assert.ok((await page.textContent('.log-summary')).includes('logging streak'));
    assert.ok((await page.textContent('.log-summary')).includes('days logged') || (await page.textContent('.log-summary')).includes('day logged'));
    await page.click(`.log-hist-row[data-day="${yesterday}"]`);
    assert.strictEqual(await cursor(), yesterday);
    assert.strictEqual(await edDay(), yesterday);
    await page.evaluate(k => App.openLogDay(k), today);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(1000);
    await shot('log-1440-dark.png');
    await setTheme('light');
    await page.waitForTimeout(400);
    await shot('log-1440-light.png');
    await setTheme('dark');
  });

  await check('log: month cells show the mood dot and symbols; the month day panel opens the log editor', async () => {
    await page.evaluate(() => { App.state.ui.monthCursor = null; App.setView('month'); });
    const mc = `.view[data-view="month"] .mcell[data-day="${today}"]`;
    await page.waitForSelector(`${mc} .mlog`);
    assert.ok(await page.isVisible(`${mc} .mlog-mood`));
    assert.ok((await page.textContent(`${mc} .mlog-ev`)).includes('🏆'));
    await page.click(`${mc} .mcell-day`);
    await page.waitForSelector('#panel-root .mday-log');
    assert.ok((await page.textContent('#panel-root .mday-log')).includes('Basketball vs North'));
    await page.click('#panel-root [data-action="month-open-log"]');
    assert.strictEqual(await page.$('#panel-root .panel'), null, 'panel closed');
    assert.ok(await page.isVisible('.view[data-view="log"].active #log-ed'));
    assert.strictEqual(await cursor(), today);
    assert.strictEqual(await edDay(), today);
  });

  await check('log: an event label with markup renders as text', async () => {
    const evil = '<img src=x onerror=alert(1)>';
    await page.fill('#log-quick-input', evil);
    await page.press('#log-quick-input', 'Enter');
    const e = (await day(today)).events.find(x => x.label === evil);
    assert.ok(e, 'stored verbatim');
    assert.strictEqual(await page.inputValue(`#log-ev-l-${e.id}`), evil);
    assert.strictEqual(await page.$('img[src="x"]'), null, 'no injected image in the log');
    assert.ok((await page.getAttribute(cell(today), 'aria-label')).includes(evil), 'cell label is plain text');
    await page.evaluate(() => App.setView('month'));
    await page.click(`.view[data-view="month"] .mcell[data-day="${today}"] .mcell-day`);
    assert.ok((await page.textContent('#panel-root .mday-log')).includes(evil), 'panel shows the label as text');
    assert.strictEqual(await page.$('img[src="x"]'), null, 'no injected image in the panel');
    await page.keyboard.press('Escape');
    await page.evaluate(id => { App.removeLogEvent(Core.dayKey(App.now()), id); App.setView('log'); }, e.id);
  });

  await check('log: 360px: compact grid, editor as a bottom sheet, no horizontal overflow; screenshots', async () => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.evaluate(() => { App.state.ui.logOpen = false; App.render(); });
    await page.evaluate(k => App.openLogDay(k), today);
    await page.waitForTimeout(700);
    const measure = () => page.evaluate(() => ({
      over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      wide: Array.from(document.querySelectorAll('.view[data-view="log"] *')).filter(e => e.offsetParent !== null && e.getBoundingClientRect().right > window.innerWidth + 1).map(e => e.className).slice(0, 5)
    }));
    let r = await measure();
    assert.ok(r.over <= 0, 'horizontal overflow: ' + r.over);
    assert.deepStrictEqual(r.wide, []);
    const sheet = await page.$eval('#log-ed', el => { const cs = getComputedStyle(el), b = el.getBoundingClientRect(); return { pos: cs.position, bottom: Math.round(b.bottom), w: Math.round(b.width) }; });
    assert.strictEqual(sheet.pos, 'fixed', 'bottom sheet on phones');
    assert.strictEqual(sheet.w, 360);
    assert.ok(Math.abs(sheet.bottom - 740) <= 1, 'sheet sits on the bottom edge');
    await shot('log-360-sheet-dark.png');
    await page.click('.log-scrim', { position: { x: 180, y: 20 } });
    assert.strictEqual(await page.$('#log-ed'), null, 'tapping the scrim closes the sheet');
    await page.waitForTimeout(400);
    r = await measure();
    assert.ok(r.over <= 0, 'horizontal overflow: ' + r.over);
    assert.deepStrictEqual(r.wide, []);
    const compact = await page.$eval(cell(today), el => ({ w: el.getBoundingClientRect().width, foot: getComputedStyle(el.querySelector('.log-cell-foot')).display, mood: !!el.querySelector('.log-cell-mood') }));
    assert.ok(compact.w >= 36 && compact.mood && compact.foot === 'none', JSON.stringify(compact));
    await shot('log-360-dark.png');
    await setTheme('light');
    await page.waitForTimeout(400);
    await shot('log-360-light.png');
    await setTheme('dark');
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await check('log: reduced motion still updates state and stops the animations', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(k => App.openLogDay(k), today);
    const edAnim = await page.$eval('#log-ed', el => parseFloat(getComputedStyle(el).animationDuration) || 0);
    assert.ok(edAnim < 0.01, 'editor open animation ' + edAnim);
    await page.click('.log-mood-btn[data-mood="bad"]');
    assert.strictEqual(await page.getAttribute('.log-mood-btn[data-mood="bad"]', 'aria-checked'), 'true');
    assert.strictEqual((await day(today)).mood, 'bad');
    const dur = await page.$eval('.log-mood-btn.is-pop', el => parseFloat(getComputedStyle(el).animationDuration) || 0);
    assert.ok(dur < 0.01, 'animation duration ' + dur);
    assert.ok(await page.$eval(cell(today), el => el.classList.contains('m-bad')), 'cell recoloured at once');
    await page.click('[data-fk="verse-new"]');
    await page.waitForTimeout(30);
    assert.strictEqual(await page.$eval('.log-quote', el => getComputedStyle(el).opacity), '1', 'verse visible at once');
    await page.click('#log-ed [data-action="log-next"]');
    assert.strictEqual(await cursor(), tomorrow);
    await page.click('[data-action="log-month-next"]');
    assert.strictEqual(await page.$eval('#log-grid .log-cell', el => getComputedStyle(el).opacity), '1', 'month slide does not hide cells');
    await page.click('#log-ed [data-action="log-close"]');
    assert.strictEqual(await page.$('#log-ed'), null);
    assert.strictEqual(await page.$('.log-ghost'), null, 'no exit ghost under reduced motion');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  });

  await check('log: works with no assignments at all and shows the intro', async () => {
    const backup = await page.evaluate(() => JSON.stringify({ a: App.state.assignments, c: App.state.classes, d: App.state.log.days }));
    await page.evaluate(() => { App.state.assignments = []; App.state.log.days = {}; App.state.ui.logOpen = false; App.setView('log'); App.render(); });
    assert.ok(await page.isVisible('.log-intro'));
    assert.ok(await page.isVisible('.log-hist-empty'));
    assert.strictEqual(await page.textContent('.log-sum-chip.is-logged b'), '0');
    await page.click('[data-action="log-open-today"]');
    assert.strictEqual(await edDay(), today);
    await page.click('.log-mood-btn[data-mood="good"]');
    assert.strictEqual((await day(today)).mood, 'good');
    assert.strictEqual(await page.$('.log-intro'), null, 'intro goes once something is logged');
    await page.evaluate(b => { const x = JSON.parse(b); App.state.assignments = x.a; App.state.classes = x.c; App.state.log.days = x.d; App.recomputePriorities(); App.save(); App.render(); }, backup);
  });

  await check('log: clean up test data', async () => {
    await page.evaluate(o => {
      App.state.log.days = JSON.parse(o.days);
      App.state.settings.weightUnit = o.unit;
      App.state.settings.weekStartsOn = o.wso;
      App.state.settings.theme = o.theme; App.applyTheme();
      App.state.ui.logCursor = o.cursor; App.state.ui.logCursorSet = o.cursorSet; App.state.ui.logOpen = o.open;
      App.closePanel(); App.closeModal();
      App.save(true); App.setView(o.view === 'log' ? 'today' : o.view);
      App.setNow(null);
      document.getElementById('toasts').innerHTML = '';
    }, original);
    assert.strictEqual(await page.evaluate(() => JSON.stringify(App.state.log.days)), original.days);
    await page.setViewportSize({ width: 1440, height: 900 });
  });
};
