/* Overview (Home) dashboard checks. Loaded by tests/browser.js after its own checks. */
'use strict';
module.exports = async ({ page, check, assert, SHOTS, shotsDir, path }) => {
  const TODAY = '2026-10-14';
  // Wednesday Oct 14 2026, 18:30 local (America/New_York) -> "Good evening".
  const saved = await page.evaluate(() => {
    const s = App.state;
    const out = {
      ws: s.settings.weekStartsOn, theme: s.settings.theme, view: s.ui.view, unit: s.settings.weightUnit,
      filters: JSON.parse(JSON.stringify(s.ui.filters)), weekCursor: s.ui.weekCursor, logCursor: s.ui.logCursor,
      log: JSON.stringify(s.log.days)
    };
    App.closeModal(); App.closePanel();
    if (s.ui.activeId) App.stopAssignment();
    App.setNow(new Date(2026, 9, 14, 18, 30, 0));
    s.ui.filters = { classes: [], priorities: [], hideDone: true, search: '' };
    s.settings.weekStartsOn = 1;
    delete s.log.days['2026-10-14'];
    App.setView('overview');
    return out;
  });
  const added = [];
  const blur = () => page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
  const undoToast = async text => {
    const btn = page.locator(`.toast:has-text("${text}") button:has-text("Undo")`).last();
    await btn.click();
  };

  await check('overview: key 1 shows the overview; Daily log button opens today in the log view', async () => {
    await page.evaluate(() => App.setView('today'));
    await blur();
    await page.keyboard.press('1');
    await page.waitForSelector('.view[data-view="overview"].active .ov-greet');
    assert.ok(!(await page.$('.view[data-view="today"] .ov-greet')), 'overview markup lives only in its own view');
    const hello = await page.textContent('#ov-hello');
    assert.ok(hello.includes('Good evening'), hello);
    const date = await page.textContent('.ov-date');
    assert.ok(/Wednesday, October 14, 2026/.test(date), date);
    assert.ok(/due today/.test(await page.textContent('.ov-status')), 'status line');
    await page.click('.ov-logbtn');
    await page.waitForSelector('.view[data-view="log"].active');
    assert.strictEqual(await page.evaluate(() => App.state.ui.logCursor), TODAY);
    await blur();
    await page.keyboard.press('1');
    await page.waitForSelector('.view[data-view="overview"].active .ov-greet');
    assert.ok(!(await page.$('.view[data-view="log"].active')));
  });

  await check('overview: quick mood and quick events write the log and Undo reverts them', async () => {
    assert.strictEqual(await page.$$eval('.ov-mood', els => els.length), 3);
    await page.click('.ov-mood[data-mood="good"]');
    assert.strictEqual(await page.evaluate(d => App.state.log.days[d] && App.state.log.days[d].mood, TODAY), 'good');
    assert.strictEqual(await page.getAttribute('.ov-mood[data-mood="good"]', 'aria-pressed'), 'true');
    assert.ok((await page.textContent('.ov-summary')).includes('Good day'), 'summary shows the mood');
    await undoToast('Logged');
    assert.strictEqual(await page.evaluate(d => App.state.log.days[d] || null, TODAY), null, 'undo removed the mood (day empty again)');
    assert.strictEqual(await page.getAttribute('.ov-mood[data-mood="good"]', 'aria-pressed'), 'false');

    assert.strictEqual(await page.$$eval('.ov-ev', els => els.length), 6, 'six quick events');
    const type = await page.getAttribute('.ov-ev >> nth=0', 'data-type');
    await page.click('.ov-ev >> nth=0');
    const evs = await page.evaluate(d => App.state.log.days[d].events, TODAY);
    assert.strictEqual(evs.length, 1); assert.strictEqual(evs[0].type, type);
    assert.ok(await page.isVisible('.ov-summary .ov-syms'), 'event symbol in today summary');
    assert.ok(await page.isVisible(`.ov-day[data-day="${TODAY}"] .ov-dsyms`), 'week strip shows the symbol');
    assert.ok((await page.textContent('.ov-evlist')).length > 0, 'shows in coming up');
    await undoToast('added to today');
    assert.strictEqual(await page.evaluate(d => App.state.log.days[d] || null, TODAY), null, 'undo removed the event');
  });

  await check('overview: verse card hides its button without verses and saves a picked verse', async () => {
    const r = await page.evaluate(() => {
      const keep = Core.VERSES.slice(), orig = Core.pickVerse;
      Core.VERSES.length = 0; App.render();
      const without = !!document.querySelector('[data-action="ov-verse"]');
      Core.VERSES.push({ ref: 'Test 1:1', text: 'Be <b>kind</b>.' });
      Core.pickVerse = () => ({ ref: 'Test 1:1', text: 'Be <b>kind</b>.' });
      App.render();
      const withBtn = !!document.querySelector('[data-action="ov-verse"]');
      document.querySelector('[data-action="ov-verse"]').click();
      const v = App.state.log.days['2026-10-14'] && App.state.log.days['2026-10-14'].verse;
      const shown = document.querySelector('.ov-verse') ? document.querySelector('.ov-verse').textContent : '';
      const injected = !!document.querySelector('.ov-verse b');
      Core.VERSES.length = 0; keep.forEach(x => Core.VERSES.push(x)); Core.pickVerse = orig;
      App.updateLogDay('2026-10-14', { verse: null });
      return { without, withBtn, v, shown, injected };
    });
    assert.strictEqual(r.without, false, 'no verse button when verses are unavailable');
    assert.strictEqual(r.withBtn, true, 'verse button when verses exist');
    assert.deepStrictEqual(r.v, { ref: 'Test 1:1', text: 'Be <b>kind</b>.' });
    assert.ok(r.shown.includes('Test 1:1') && r.shown.includes('<b>kind</b>'), 'verse text rendered escaped: ' + r.shown);
    assert.strictEqual(r.injected, false);
  });

  await check('overview: Next up shows the top-scored item with Start and Done working', async () => {
    const xss = '<img src=x onerror=alert(1)>';
    const id = await page.evaluate(t => App.addAssignment({ title: t, due: new Date(2026, 9, 1, 23, 59).toISOString(), allDay: true, estimatedMin: 20 }).id, xss);
    added.push(id);
    const expectTop = await page.evaluate(() => App.sortByScore(App.visible().filter(a => !a.done))[0].id);
    const top = await page.getAttribute('.ov-next-top', 'data-id');
    assert.strictEqual(top, expectTop);
    assert.ok(await page.$('.ov-next-top [data-due]'), 'countdown carries data-due for the ticker');
    assert.ok((await page.$$('.ov-list .ov-row')).length <= 4);
    // XSS-safe title
    assert.strictEqual(await page.$$eval('#ov-mount img', els => els.length), 0, 'no injected img');
    assert.ok((await page.textContent('#ov-mount')).includes(xss), 'title rendered as text');
    await page.click(`.ov-next-top [data-action="start"][data-id="${top}"]`);
    assert.strictEqual(await page.evaluate(() => App.state.ui.activeId), top);
    assert.ok(await page.isVisible(`.ov-next-top[data-id="${top}"] [data-action="stop"]`), 'shows Stop while in progress');
    await page.click(`.ov-next-top [data-action="done"][data-id="${top}"]`);
    await page.waitForFunction(id => App.byId(id).done, top);
    assert.strictEqual(await page.evaluate(() => App.state.ui.activeId), null);
    await page.evaluate(id => App.uncompleteAssignment(id), top);
    await page.waitForFunction(() => !document.getElementById('confetti-canvas').classList.contains('is-on'), null, { timeout: 5000 });
  });

  await check('overview: week strip has 7 days in order for weekStartsOn 0 and 1; clicking goes to week or log', async () => {
    for (const ws of [0, 1]) {
      await page.evaluate(ws => { App.state.settings.weekStartsOn = ws; App.render(); }, ws);
      const keys = await page.$$eval('.ov-day', els => els.map(e => e.dataset.day));
      assert.strictEqual(keys.length, 7);
      const dows = await page.evaluate(keys => keys.map(k => Core.fromDayKey(k).getDay()), keys);
      for (let i = 0; i < 7; i++) assert.strictEqual(dows[i], (ws + i) % 7, 'weekday order for weekStartsOn=' + ws);
      for (let i = 1; i < 7; i++) assert.ok(keys[i] > keys[i - 1], 'consecutive days');
      assert.ok(keys.includes(TODAY));
      assert.ok(await page.$(`.ov-day.is-today[data-day="${TODAY}"]`));
    }
    const k = '2026-10-16';
    await page.click(`.ov-day-btn[data-day="${k}"]`);
    await page.waitForSelector('.view[data-view="week"].active');
    assert.strictEqual(await page.evaluate(() => App.state.ui.weekCursor), k);
    await page.evaluate(() => App.setView('overview'));
    await page.click(`.ov-daylog[data-day="${k}"]`);
    await page.waitForSelector('.view[data-view="log"].active');
    assert.strictEqual(await page.evaluate(() => App.state.ui.logCursor), k);
    await page.evaluate(() => App.setView('overview'));
  });

  await check('overview: stat numbers match App.state', async () => {
    await page.evaluate(() => { App.setView('today'); App.setView('overview'); }); // re-enter: count-up runs
    const exp = await page.evaluate(() => {
      const n = App.now(), ws = App.state.settings.weekStartsOn, start = Core.startOfWeek(n, ws);
      let done = 0; for (let i = 0; i < 7; i++) done += App.state.stats.completedByDay[Core.dayKey(Core.addDays(start, i))] || 0;
      const open = App.visible().filter(a => !a.done);
      const overdue = open.filter(a => App.isOverdue(a, n)).length;
      const lim = n.getTime() + 48 * 3600000;
      const next48 = open.filter(a => { const d = Core.parseISO(a.due); return d && d >= n && d.getTime() < lim; }).length;
      return { done: String(done), overdue: String(overdue), next48: String(next48), streak: String(App.state.stats.streakDays) };
    });
    await page.waitForFunction(() => [...document.querySelectorAll('.ov-stat-n')].every(el => el.textContent === el.dataset.count), null, { timeout: 3000 });
    const got = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('.ov-stat')].map(s => [s.dataset.stat, s.querySelector('.ov-stat-n').textContent])));
    assert.deepStrictEqual(got, exp);
    if (Number(exp.overdue) > 0) assert.ok(await page.$('.ov-stat[data-stat="overdue"].is-bad'), 'overdue tile is red');
  });

  await check('overview: class snapshot click filters to that class and opens Next Up', async () => {
    const cls = await page.getAttribute('.ov-cls >> nth=0', 'data-class');
    await page.click('.ov-cls >> nth=0');
    await page.waitForSelector('.view[data-view="today"].active');
    assert.deepStrictEqual(await page.evaluate(() => App.state.ui.filters.classes), [cls]);
    await page.evaluate(() => { App.state.ui.filters.classes = []; App.setView('overview'); });
  });

  await check('overview: upcoming events and weight trend', async () => {
    assert.ok(!(await page.$('#ov-h-weight')), 'weight card hidden with fewer than 2 weights');
    await page.evaluate(() => {
      App.state.settings.weightUnit = 'kg';
      App.updateLogDay('2026-10-17', { events: [{ id: 'ovt1', type: 'sports', label: 'Final <game>', time: '19:00' }] });
      App.updateLogDay('2026-10-12', { weight: 60.5 });
      App.updateLogDay('2026-10-13', { weight: 60.1 });
    });
    const row = await page.textContent('.ov-evlist');
    assert.ok(row.includes('Final <game>') && row.includes('7:00 PM'), row);
    assert.ok(await page.isVisible('#ov-h-weight'));
    const wt = await page.textContent('.ov-wt');
    assert.ok(wt.includes('60.1') && wt.includes('kg'), wt);
    await page.click('.ov-evrow >> nth=0');
    await page.waitForSelector('.view[data-view="log"].active');
    assert.strictEqual(await page.evaluate(() => App.state.ui.logCursor), '2026-10-17');
    await page.evaluate(() => App.setView('overview'));
  });

  await check('overview: no horizontal overflow at 360px; screenshots', async () => {
    await page.evaluate(() => App.updateLogDay('2026-10-14', { mood: 'good', note: 'Overview screenshot day', events: [{ id: 'ovt2', type: 'practice', label: '', time: '16:00' }] }));
    for (const theme of ['dark', 'light']) {
      await page.evaluate(t => { App.state.settings.theme = t; App.applyTheme(); }, theme);
      for (const [w, h] of [[1440, 900], [360, 740]]) {
        await page.setViewportSize({ width: w, height: h });
        await page.evaluate(() => { document.querySelectorAll('#toasts .toast').forEach(t => t.remove()); App.setView('today'); App.setView('overview'); window.scrollTo(0, 0); });
        await page.waitForTimeout(w === 360 ? 300 : 1300);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(over <= 0, `horizontal overflow ${over}px at ${w} ${theme}`);
        if (SHOTS) await page.screenshot({ path: path.join(shotsDir, `overview-${w}-${theme}.png`), fullPage: w === 360 });
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await check('overview: empty state keeps load-demo / open-import and the Daily log still works', async () => {
    const snap = await page.evaluate(() => { App.save(true); return localStorage.getItem('assignments.v1'); });
    try {
      await page.evaluate(() => { App.clearAll(); App.setNow(new Date(2026, 9, 14, 18, 30, 0)); App.setView('overview'); });
      assert.ok(await page.isVisible('.view[data-view="overview"].active [data-action="load-demo"]'));
      assert.ok(await page.isVisible('.view[data-view="overview"].active .hero [data-action="open-import"]'));
      assert.ok(await page.isVisible('.ov-mood[data-mood="medium"]'), 'log card shows in the empty state');
      await page.click('.ov-mood[data-mood="medium"]');
      assert.strictEqual(await page.evaluate(d => App.state.log.days[d].mood, TODAY), 'medium');
      await page.click('.ov-logbtn');
      await page.waitForSelector('.view[data-view="log"].active');
      assert.strictEqual(await page.evaluate(() => App.state.ui.logCursor), TODAY);
    } finally {
      await page.evaluate(snap => {
        localStorage.setItem('assignments.v1', snap);
        App.load(); App.recomputePriorities(); App.applyTheme(); App.renderAll();
      }, snap);
    }
    assert.ok(await page.evaluate(() => App.state.assignments.length > 0), 'state restored');
  });

  // Clean up.
  await page.evaluate(({ saved, added }) => {
    const s = App.state;
    App.closeModal(); App.closePanel();
    if (s.ui.activeId) App.stopAssignment();
    s.assignments = s.assignments.filter(a => !added.includes(a.id));
    s.log.days = JSON.parse(saved.log);
    s.settings.weekStartsOn = saved.ws; s.settings.theme = saved.theme; s.settings.weightUnit = saved.unit;
    s.ui.filters = saved.filters; s.ui.weekCursor = saved.weekCursor; s.ui.logCursor = saved.logCursor;
    document.querySelectorAll('#toasts .toast').forEach(t => t.remove());
    App.applyTheme(); App.recomputePriorities(); App.save(true);
    App.setNow(null);
    App.setView(saved.view);
  }, { saved, added });
  await page.setViewportSize({ width: 1440, height: 900 });
};
