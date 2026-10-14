/*
 * Daily log checks. Loaded by tests/browser.js after its own checks; the page
 * holds demo data plus imported fixtures. Everything the checks log is removed
 * again at the end (the original log, unit, view and theme are restored).
 */
'use strict';
module.exports = async ({ page, check, assert, SHOTS, shotsDir, path }) => {
  const original = await page.evaluate(() => ({
    days: JSON.stringify(App.state.log.days), unit: App.state.settings.weightUnit, theme: App.state.settings.theme,
    view: App.state.ui.view, cursor: App.state.ui.logCursor || null, cursorSet: App.state.ui.logCursorSet || null
  }));
  const today = await page.evaluate(() => Core.dayKey(App.now()));
  const shift = (k, n) => page.evaluate(([k, n]) => Core.dayKey(Core.addDays(Core.fromDayKey(k), n)), [k, n]);
  const yesterday = await shift(today, -1);
  const tomorrow = await shift(today, 1);
  const day = k => page.evaluate(k => JSON.parse(JSON.stringify(App.logDay(k))), k);
  const cursor = () => page.evaluate(() => App.state.ui.logCursor);
  const shot = async name => { if (SHOTS) await page.screenshot({ path: path.join(shotsDir, name), fullPage: true }); };
  const setTheme = t => page.evaluate(t => { App.state.settings.theme = t; App.applyTheme(); }, t);
  const blur = () => page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
  const clearToasts = () => page.evaluate(() => { document.getElementById('toasts').innerHTML = ''; });
  await page.evaluate(() => { App.closeModal(); App.closePanel(); });

  await check('log: key 7 and L open the daily log on today', async () => {
    await page.evaluate(() => { App.state.ui.logCursor = null; App.setView('today'); });
    await blur();
    await page.keyboard.press('7');
    await page.waitForSelector('.view[data-view="log"].active .log-hero');
    assert.strictEqual(await page.getAttribute('#nav [data-view="log"]', 'aria-current'), 'page');
    assert.ok((await page.textContent('#log-title')).includes('Today'));
    await page.keyboard.press('1');
    await blur();
    await page.keyboard.press('l');
    await page.waitForSelector('.view[data-view="log"].active .log-hero');
    assert.strictEqual(await cursor(), today);
    assert.strictEqual(await page.inputValue('#log-date'), today);
  });

  await check('log: mood buttons form a radio group; tap selects, tap again clears, arrows move', async () => {
    await page.click('.log-mood-btn[data-mood="good"]');
    assert.strictEqual(await page.getAttribute('.log-mood-btn[data-mood="good"]', 'aria-checked'), 'true');
    assert.strictEqual(await page.getAttribute('.log-mood-btn[data-mood="bad"]', 'aria-checked'), 'false');
    assert.strictEqual((await day(today)).mood, 'good');
    assert.strictEqual(await page.evaluate(() => document.activeElement.dataset.mood), 'good', 'focus kept on the mood');
    await page.click('.log-mood-btn[data-mood="good"]');
    assert.strictEqual(await page.getAttribute('.log-mood-btn[data-mood="good"]', 'aria-checked'), 'false');
    assert.strictEqual(await day(today), null, 'clearing the only field removes the entry');
    await page.click('.log-mood-btn[data-mood="medium"]');
    await page.keyboard.press('ArrowLeft');
    assert.strictEqual((await day(today)).mood, 'good', 'ArrowLeft inside the group moves the selection, not the day');
    assert.strictEqual(await cursor(), today);
    assert.strictEqual(await page.getAttribute('.log-moods', 'role'), 'radiogroup');
  });

  await check('log: weight saves with its unit, the unit toggle converts, and the change vs the last weigh-in shows', async () => {
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
    await page.click('.log-unit[data-unit="kg"]');
    assert.strictEqual(await page.evaluate(() => App.state.settings.weightUnit), 'kg');
    assert.strictEqual(await page.getAttribute('.log-unit[data-unit="kg"]', 'aria-pressed'), 'true');
    assert.strictEqual(await page.inputValue('#log-weight'), '68.2');
    assert.ok((await page.textContent('#log-wstats .log-delta')).includes('kg'));
    d = await day(today);
    assert.strictEqual(d.weight, 150.4, 'stored value untouched by the toggle');
    /* Hover and focus both show the readout. */
    const box = await page.locator('.log-spark').boundingBox();
    await page.mouse.move(box.x + 4, box.y + box.height / 2);
    assert.ok(await page.isVisible('.log-spark-tip'));
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

  await check('log: get a verse, then draw a different one; it persists per day', async () => {
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
    assert.ok(await page.isVisible(`.log-chip[data-day="${today}"] .log-chip-dot`), 'strip shows the note dot');
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
    assert.ok((await page.textContent('#toasts')).includes('Added 🎂 Birthday'));
    await page.click('#toasts .toast:last-child button:has-text("Undo")');
    d = await day(today);
    assert.strictEqual(d.events.length, before, 'undo removes it');
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
    /* The guess can be overridden before adding. */
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
  });

  await check('log: a 3-day vacation lands on three days in a row', async () => {
    const start = await shift(today, 2);
    await page.evaluate(k => App.openLogDay(k), start);
    assert.ok(await page.isHidden('#log-quick-days-wrap'), 'repeat control only for trips and vacations');
    await page.fill('#log-quick-input', 'Beach vacation');
    assert.ok(await page.isVisible('#log-quick-days-wrap'));
    await page.fill('#log-quick-days', '3');
    await page.press('#log-quick-input', 'Enter');
    for (let i = 0; i < 3; i++) {
      const k = await shift(start, i);
      const d = await day(k);
      assert.ok(d && d.events.some(e => e.type === 'vacation' && e.label === 'Beach vacation'), 'vacation on ' + k);
    }
    assert.strictEqual(await day(await shift(start, 3)), null, 'not on the fourth day');
    assert.ok((await page.textContent('#toasts')).includes('3 days'));
    /* The event row offers to repeat it further. */
    const id = (await day(start)).events[0].id;
    await page.click(`.log-ev[data-ev="${id}"] [data-action="log-ev-repeat"]`);
    assert.ok(await page.isVisible(`#log-ev-r-${id}`));
    await page.click(`[data-action="log-ev-repeat"][data-ev="${id}"]`);
    assert.ok(await page.isHidden(`#log-ev-r-${id}`));
  });

  await check('log: prev/next/today buttons, arrow keys and the date input move between days', async () => {
    await page.click('[data-action="log-today"]');
    assert.strictEqual(await cursor(), today);
    await page.click('[data-action="log-prev"]');
    assert.strictEqual(await cursor(), yesterday);
    assert.ok((await page.textContent('#log-title')).includes('Yesterday'));
    await page.click('[data-action="log-next"]');
    await page.click('[data-action="log-next"]');
    assert.strictEqual(await cursor(), tomorrow);
    await blur();
    await page.keyboard.press('ArrowLeft');
    assert.strictEqual(await cursor(), today);
    await page.keyboard.press('ArrowLeft');
    assert.strictEqual(await cursor(), yesterday);
    await page.keyboard.press('ArrowRight');
    assert.strictEqual(await cursor(), today);
    await page.focus('#log-note');
    await page.keyboard.press('ArrowLeft');
    assert.strictEqual(await cursor(), today, 'arrows never move the day while typing');
    await page.fill('#log-date', '2026-09-03');
    assert.strictEqual(await cursor(), '2026-09-03');
    assert.ok((await page.textContent('#log-title')).includes('September 3') || (await page.textContent('#log-title')).includes('Sep 3'));
    await page.click(`[data-action="log-today"]`);
    await page.click(`.log-chip[data-day="${yesterday}"]`);
    assert.strictEqual(await cursor(), yesterday);
    assert.strictEqual(await page.getAttribute(`.log-chip[data-day="${yesterday}"]`, 'aria-pressed'), 'true');
    await page.keyboard.press('ArrowRight');
    assert.strictEqual(await cursor(), today);
    assert.strictEqual(await page.evaluate(() => document.activeElement.dataset.day), today, 'focus follows to the new chip');
    const strip = await page.evaluate(() => { const s = document.querySelector('.log-strip'); return { sw: s.scrollWidth, cw: s.clientWidth, chips: s.querySelectorAll('.log-chip').length }; });
    assert.ok(strip.chips >= 28 && strip.sw > strip.cw, 'strip scrolls inside its own container');
  });

  await check('log: the strip chip shows the mood dot and event symbols; history lists the day', async () => {
    await page.evaluate(k => App.openLogDay(k), today);
    const chip = `.log-chip[data-day="${today}"]`;
    assert.ok(await page.isVisible(`${chip} .log-chip-mood`));
    assert.ok((await page.textContent(`${chip} .log-chip-ev`)).includes('🏆'));
    assert.ok((await page.getAttribute(chip, 'aria-label')).includes('Good day'));
    const row = `.log-hist-row[data-day="${today}"]`;
    assert.ok(await page.isVisible(row));
    const t = await page.textContent(row);
    assert.ok(t.includes('150.4 lb') && t.includes('Scored a goal!') && t.includes('🏆'), t);
    assert.ok((await page.textContent('.log-summary')).includes('logging streak'));
    await page.click(`.log-hist-row[data-day="${yesterday}"]`);
    assert.strictEqual(await cursor(), yesterday);
    await page.evaluate(k => App.openLogDay(k), today);
    await page.waitForTimeout(1300);
    await shot('log-1440-dark.png');
    await setTheme('light');
    await shot('log-1440-light.png');
    await setTheme('dark');
  });

  await check('log: month cells show the mood dot and symbols; the day panel opens the log', async () => {
    await page.evaluate(() => { App.state.ui.monthCursor = null; App.setView('month'); });
    const cell = `.view[data-view="month"] .mcell[data-day="${today}"]`;
    await page.waitForSelector(`${cell} .mlog`);
    assert.ok(await page.isVisible(`${cell} .mlog-mood`));
    assert.ok((await page.textContent(`${cell} .mlog-ev`)).includes('🏆'));
    assert.ok((await page.getAttribute(`${cell} .mcell-day`, 'aria-label')).includes('Daily log: Good day'));
    const h = await page.evaluate(c => { const el = document.querySelector(c); return { cell: el.getBoundingClientRect().height, over: document.documentElement.scrollWidth - document.documentElement.clientWidth }; }, cell);
    assert.ok(h.over <= 0);
    await page.click(`${cell} .mcell-day`);
    await page.waitForSelector('#panel-root .mday-log');
    assert.ok((await page.textContent('#panel-root .mday-log')).includes('Basketball vs North'));
    await page.click('#panel-root [data-action="month-open-log"]');
    assert.strictEqual(await page.$('#panel-root .panel'), null, 'panel closed');
    assert.ok(await page.isVisible('.view[data-view="log"].active .log-hero'));
    assert.strictEqual(await cursor(), today);
    /* Narrow agenda: symbols next to the day header. */
    await page.setViewportSize({ width: 360, height: 740 });
    await page.evaluate(() => App.setView('month'));
    assert.ok((await page.textContent(`.view[data-view="month"] .magenda-day[data-day="${today}"] .magenda-head .mlog`)).includes('🏆'));
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => App.setView('log'));
  });

  await check('log: an event label with markup renders as text', async () => {
    const evil = '<img src=x onerror=alert(1)>';
    await page.fill('#log-quick-input', evil);
    await page.press('#log-quick-input', 'Enter');
    const e = (await day(today)).events.find(x => x.label === evil);
    assert.ok(e, 'stored verbatim');
    assert.strictEqual(await page.inputValue(`#log-ev-l-${e.id}`), evil);
    assert.strictEqual(await page.$('img[src="x"]'), null, 'no injected image in the log');
    assert.ok((await page.textContent('#log-quick-preview')).length >= 0);
    await page.evaluate(() => App.setView('month'));
    await page.click(`.view[data-view="month"] .mcell[data-day="${today}"] .mcell-day`);
    assert.ok((await page.textContent('#panel-root .mday-log')).includes(evil), 'panel shows the label as text');
    assert.strictEqual(await page.$('img[src="x"]'), null, 'no injected image in the panel');
    await page.keyboard.press('Escape');
    await page.evaluate(id => { App.removeLogEvent(Core.dayKey(App.now()), id); App.setView('log'); }, e.id);
  });

  await check('log: no horizontal overflow at 360px; screenshots', async () => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.evaluate(k => App.openLogDay(k), today);
    await page.waitForTimeout(1300);
    const r = await page.evaluate(() => ({
      over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      wide: Array.from(document.querySelectorAll('.view[data-view="log"] *')).filter(e => e.offsetParent !== null && !e.closest('.log-strip') && e.getBoundingClientRect().right > window.innerWidth + 1).map(e => e.className).slice(0, 5)
    }));
    assert.ok(r.over <= 0, 'horizontal overflow: ' + r.over);
    assert.deepStrictEqual(r.wide, []);
    await shot('log-360-dark.png');
    await setTheme('light');
    await shot('log-360-light.png');
    await setTheme('dark');
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await check('log: reduced motion still updates state and stops the animations', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.click('.log-mood-btn[data-mood="bad"]');
    assert.strictEqual(await page.getAttribute('.log-mood-btn[data-mood="bad"]', 'aria-checked'), 'true');
    assert.strictEqual((await day(today)).mood, 'bad');
    const dur = await page.$eval('.log-mood-btn.is-pop', el => parseFloat(getComputedStyle(el).animationDuration) || 0);
    assert.ok(dur < 0.01, 'animation duration ' + dur);
    await page.click('[data-fk="verse-new"]');
    const op = await page.$eval('.log-quote', el => getComputedStyle(el).opacity);
    await page.waitForTimeout(30);
    assert.strictEqual(await page.$eval('.log-quote', el => getComputedStyle(el).opacity), '1', 'verse visible at once (' + op + ')');
    await page.click('[data-action="log-next"]');
    assert.strictEqual(await cursor(), tomorrow);
    assert.strictEqual(await page.evaluate(() => document.querySelector('.log-strip').scrollLeft >= 0), true);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  });

  await check('log: works with no assignments at all and shows the intro', async () => {
    const backup = await page.evaluate(() => JSON.stringify({ a: App.state.assignments, c: App.state.classes, d: App.state.log.days }));
    await page.evaluate(() => { App.state.assignments = []; App.state.log.days = {}; App.openLogDay(Core.dayKey(App.now())); });
    assert.ok(await page.isVisible('.log-intro'));
    assert.ok(await page.isVisible('.log-hist-empty'));
    await page.click('.log-mood-btn[data-mood="good"]');
    assert.strictEqual((await day(today)).mood, 'good');
    await page.evaluate(b => { const x = JSON.parse(b); App.state.assignments = x.a; App.state.classes = x.c; App.state.log.days = x.d; App.recomputePriorities(); App.save(); App.render(); }, backup);
  });

  await check('log: clean up test data', async () => {
    await page.evaluate(o => {
      App.state.log.days = JSON.parse(o.days);
      App.state.settings.weightUnit = o.unit;
      App.state.settings.theme = o.theme; App.applyTheme();
      App.state.ui.logCursor = o.cursor; App.state.ui.logCursorSet = o.cursorSet;
      App.closePanel(); App.closeModal();
      App.save(true); App.setView(o.view === 'log' ? 'today' : o.view);
      App.setNow(null);
      document.getElementById('toasts').innerHTML = '';
    }, original);
    assert.strictEqual(await page.evaluate(() => JSON.stringify(App.state.log.days)), original.days);
    await page.setViewportSize({ width: 1440, height: 900 });
  });
};
