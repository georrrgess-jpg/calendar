/*
 * Month calendar checks (spec 3.2). Loaded by tests/browser.js after its own
 * checks; the page already holds demo data plus the imported AP Biology fixture.
 */
'use strict';
module.exports = async ({ page, check, assert, SHOTS, shotsDir, path }) => {
  const original = await page.evaluate(() => ({
    weekStartsOn: App.state.settings.weekStartsOn,
    theme: App.state.settings.theme,
    view: App.state.ui.view,
    cursor: App.state.ui.monthCursor,
    filters: JSON.parse(JSON.stringify(App.state.ui.filters))
  }));
  const thisMonth = await page.evaluate(() => { const n = App.now(); return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0'); });
  const gotoMonth = async ym => {
    await page.evaluate(ym => { App.closePanel(); App.closeModal(); App.state.ui.monthCursor = ym; App.setView('month'); }, ym);
    await page.waitForSelector('.view[data-view="month"].active .month-grid', { state: 'attached' });
  };
  const shot = async name => { if (SHOTS) await page.screenshot({ path: path.join(shotsDir, name), fullPage: true }); };
  const setTheme = async t => { await page.evaluate(t => { App.state.settings.theme = t; App.applyTheme(); }, t); };
  const testIds = [];

  await check('month: grid has 7 columns and the first weekday follows weekStartsOn (Mon, Sun, Sat)', async () => {
    await page.evaluate(() => { App.state.ui.filters.classes = []; App.state.ui.filters.priorities = []; App.state.ui.filters.search = ''; });
    for (const [ws, label, first] of [[1, 'Mon', '2026-09-28'], [0, 'Sun', '2026-09-27'], [6, 'Sat', '2026-09-26']]) {
      await page.evaluate(ws => { App.state.settings.weekStartsOn = ws; }, ws);
      await gotoMonth('2026-10');
      const g = await page.evaluate(() => {
        const root = document.querySelector('.view[data-view="month"]');
        const grid = root.querySelector('.month-grid');
        const cells = Array.from(grid.querySelectorAll('.mcell'));
        return {
          cols: getComputedStyle(grid).gridTemplateColumns.split(' ').filter(Boolean).length,
          heads: Array.from(root.querySelectorAll('.month-wd')).map(e => e.textContent.trim()),
          first: cells[0].dataset.day, count: cells.length,
          firstWeekday: new Date(cells[0].dataset.day + 'T12:00').getDay(),
          out: cells.filter(c => c.classList.contains('is-out')).map(c => c.dataset.day),
          title: root.querySelector('#month-heading').textContent.replace(/\s+/g, ' ').trim()
        };
      });
      assert.strictEqual(g.cols, 7, 'grid columns');
      assert.strictEqual(g.heads.length, 7);
      assert.strictEqual(g.heads[0], label, 'first header for weekStartsOn=' + ws);
      assert.strictEqual(g.first, first, 'first cell for weekStartsOn=' + ws);
      assert.strictEqual(g.firstWeekday, ws);
      assert.strictEqual(g.count % 7, 0);
      assert.ok(g.out.includes(first) && !g.out.includes('2026-10-15'), 'leading days dimmed, in-month not');
      assert.strictEqual(g.title, 'October 2026');
    }
    await page.evaluate(ws => { App.state.settings.weekStartsOn = ws; App.save(); App.render(); }, original.weekStartsOn);
  });

  await check('month: visible items sit on their due-day cells, overdue first, max 3 pills; today is marked', async () => {
    await gotoMonth(thisMonth);
    const r = await page.evaluate(() => {
      const root = document.querySelector('.view[data-view="month"]');
      const bad = [];
      let checked = 0;
      for (const p of root.querySelectorAll('.mcell .pill')) {
        const a = App.byId(p.dataset.id);
        const key = Core.dayKey(new Date(a.due));
        if (p.closest('.mcell').dataset.day !== key) bad.push(a.title);
        checked++;
      }
      const tooMany = Array.from(root.querySelectorAll('.mcell')).filter(c => c.querySelectorAll('.pill').length > 3).length;
      const demo = App.visible().filter(a => a.id.startsWith('demo_') && a.due && root.querySelector(`.mcell[data-day="${Core.dayKey(new Date(a.due))}"]`));
      const missing = demo.filter(a => {
        const cell = root.querySelector(`.mcell[data-day="${Core.dayKey(new Date(a.due))}"]`);
        const inCell = cell.querySelector(`.pill[data-id="${a.id}"]`);
        return !inCell && !cell.querySelector('.mcell-more');
      }).map(a => a.title);
      const order = Array.from(root.querySelectorAll('.mcell')).every(c => {
        const ps = Array.from(c.querySelectorAll('.pill')).map(p => App.isOverdue(App.byId(p.dataset.id)));
        return ps.indexOf(false) === -1 || ps.lastIndexOf(true) < ps.indexOf(false);
      });
      const today = root.querySelector('.mcell.is-today');
      return { bad, checked, tooMany, missing, demoCount: demo.length, order, todayKey: today && today.dataset.day, todayCurrent: today && today.querySelector('.mcell-day').getAttribute('aria-current'), nowKey: Core.dayKey(App.now()) };
    });
    assert.deepStrictEqual(r.bad, [], 'pills on wrong day');
    assert.ok(r.checked > 0 && r.demoCount > 0, 'some demo items in this month grid');
    assert.deepStrictEqual(r.missing, [], 'demo items missing from their cells');
    assert.strictEqual(r.tooMany, 0, 'no cell shows more than 3 pills');
    assert.ok(r.order, 'overdue pills come first');
    assert.strictEqual(r.todayKey, r.nowKey);
    assert.strictEqual(r.todayCurrent, 'date');
  });

  await check('month: "+N more" appears for busy days and opens a day panel listing all of them', async () => {
    const info = await page.evaluate(() => {
      const n = App.now();
      const day = Core.addDays(Core.startOfDay(n), 20);
      const ids = [];
      for (let i = 0; i < 5; i++) {
        const d = new Date(day); d.setHours(9 + i, 0, 0, 0);
        ids.push(App.addAssignment({ title: 'Month busy ' + (i + 1), due: d.toISOString(), allDay: false, estimatedMin: 60 }).id);
      }
      const light = Core.addDays(Core.startOfDay(n), 22);
      const ld = new Date(light); ld.setHours(12, 0, 0, 0);
      ids.push(App.addAssignment({ title: 'Month light', due: ld.toISOString(), allDay: false, estimatedMin: 20 }).id);
      const ym = day.getFullYear() + '-' + String(day.getMonth() + 1).padStart(2, '0');
      return { ids, key: Core.dayKey(day), lightKey: Core.dayKey(light), ym };
    });
    testIds.push(...info.ids);
    await gotoMonth(info.ym);
    const expected = await page.evaluate(key => App.visible().filter(a => a.due && Core.dayKey(new Date(a.due)) === key).length, info.key);
    assert.ok(expected >= 5);
    const cell = `.view[data-view="month"] .mcell[data-day="${info.key}"]`;
    assert.strictEqual(await page.locator(`${cell} .pill`).count(), 3);
    assert.strictEqual((await page.textContent(`${cell} .mcell-more`)).trim(), '+' + (expected - 3) + ' more');
    const label = await page.getAttribute(`${cell} .mcell-day`, 'aria-label');
    assert.match(label, new RegExp(expected + ' assignments, about \\d+h'), label);
    await page.click(`${cell} .mcell-more`);
    await page.waitForSelector('#panel-root .panel[data-month-day]');
    assert.strictEqual(await page.locator('#panel-root .panel .item').count(), expected);
    const panelText = await page.textContent('#panel-root .panel');
    for (let i = 1; i <= 5; i++) assert.ok(panelText.includes('Month busy ' + i), 'panel lists Month busy ' + i);
    assert.ok(/estimated work/.test(panelText) && /5h/.test(panelText), 'panel shows total estimated time');
    assert.ok(await page.isVisible('#panel-root [data-action="month-add"]'), 'Add for this day button');
    if (SHOTS) { await page.waitForTimeout(400); await page.screenshot({ path: path.join(shotsDir, 'month-panel-1440.png') }); }
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.$('#panel-root .panel'), null, 'Escape closes the panel');
    assert.strictEqual(await page.evaluate(() => document.activeElement && document.activeElement.dataset.day), info.key, 'focus returns to the day');

    /* Heat: the 5 x 60m day is darker than the 20m day, and both than an empty day. */
    const heat = await page.evaluate(k => {
      const get = key => { const c = document.querySelector(`.view[data-view="month"] .mcell[data-day="${key}"]`); return c ? { a: parseFloat(c.style.getPropertyValue('--heat-a')), min: +c.dataset.min, title: c.title } : null; };
      const empty = Array.from(document.querySelectorAll('.view[data-view="month"] .mcell')).find(c => +c.dataset.min === 0);
      return { busy: get(k.key), light: get(k.lightKey), empty: empty ? parseFloat(empty.style.getPropertyValue('--heat-a')) : 0 };
    }, info);
    assert.ok(heat.busy && heat.light, 'both test days rendered');
    assert.ok(heat.busy.min >= 300 && heat.busy.a > heat.light.a && heat.light.a > heat.empty, JSON.stringify(heat));
    assert.ok(Math.abs(heat.busy.a - 0.30) < 0.001, 'capped at max intensity');
    assert.ok(heat.busy.title.includes(heat.busy.min + ' min'), 'hover title gives exact minutes: ' + heat.busy.title);
    assert.ok(await page.isVisible('.heat-legend'));
    assert.strictEqual(await page.locator('.heat-legend .heat-scale i').count(), 5);
    assert.ok((await page.textContent('.heat-legend')).includes('Lighter = less work, darker = more'));
  });

  await check('month: clicking a day number or the empty area opens its panel; panel updates on completion', async () => {
    const key = await page.evaluate(() => Core.dayKey(Core.addDays(Core.startOfDay(App.now()), 22)));
    await page.click(`.view[data-view="month"] .mcell[data-day="${key}"] .mcell-num`);
    await page.waitForSelector(`#panel-root .panel[data-month-day="${key}"]`);
    assert.ok((await page.textContent('#panel-root .panel')).includes('Month light'));
    await page.evaluate(() => { App.state.ui.filters.hideDone = true; App.render(); });
    await page.click('#panel-root .panel .item:has-text("Month light") .item-check');
    const lightId = testIds[testIds.length - 1];
    const gone = await page.waitForFunction(id => !document.querySelector(`#panel-root .panel .item[data-id="${id}"]`) && document.querySelector('#panel-root .panel'), lightId, { timeout: 3000 }).then(() => true).catch(() => false);
    const diag = await page.evaluate(() => ({ hideDone: App.state.ui.filters.hideDone, done: (App.state.assignments.find(a => a.title === 'Month light') || {}).done, panel: (document.querySelector('#panel-root .panel-body') || {}).textContent }));
    assert.ok(gone, 'completed item left the panel: ' + JSON.stringify(diag).replace(/\s+/g, ' ').slice(0, 400));
    const expectLeft = await page.evaluate(key => App.visible().filter(a => a.due && Core.dayKey(new Date(a.due)) === key).length, key);
    assert.strictEqual(await page.locator('#panel-root .panel .item').count(), expectLeft, 'panel re-rendered with the remaining items');
    await page.click('#panel-root [data-action="close-panel"]');
    const box = await page.locator(`.view[data-view="month"] .mcell[data-day="${key}"]`).boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + box.height - 8);
    await page.waitForSelector(`#panel-root .panel[data-month-day="${key}"]`);
    await page.keyboard.press('Escape');
  });

  await check('month: "Add for this day" pre-fills quick-add with the date', async () => {
    const key = await page.evaluate(() => { App.closePanel(); return Core.dayKey(Core.addDays(Core.startOfDay(App.now()), 20)); });
    await page.click(`.view[data-view="month"] .mcell[data-day="${key}"] .mcell-day`);
    await page.click('#panel-root [data-action="month-add"]');
    assert.strictEqual(await page.$('#panel-root .panel'), null);
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'quickadd');
    await page.keyboard.type('Month quick add');
    await page.keyboard.press('Enter');
    const a = await page.evaluate(() => { const x = App.state.assignments.find(a => a.title === 'Month quick add'); return x && { id: x.id, key: Core.dayKey(new Date(x.due)) }; });
    assert.ok(a, 'added through quick-add');
    testIds.push(a.id);
    assert.strictEqual(a.key, key);
  });

  await check('month: prev/next/today change month and the cursor persists across reload', async () => {
    await gotoMonth('2026-10');
    await page.click('.view[data-view="month"] [data-action="month-next"]');
    assert.strictEqual((await page.textContent('#month-heading')).replace(/\s+/g, ' ').trim(), 'November 2026');
    await page.click('.view[data-view="month"] [data-action="month-next"]');
    await page.click('.view[data-view="month"] [data-action="month-next"]');
    assert.strictEqual((await page.textContent('#month-heading')).replace(/\s+/g, ' ').trim(), 'January 2027', 'rolls over the year');
    await page.click('.view[data-view="month"] [data-action="month-prev"]');
    assert.strictEqual(await page.evaluate(() => App.state.ui.monthCursor), '2026-12');
    await page.waitForTimeout(250);
    await page.reload(); await page.waitForSelector('#view-root');
    assert.ok(await page.isVisible('.view[data-view="month"].active'), 'month view restored');
    assert.strictEqual((await page.textContent('#month-heading')).replace(/\s+/g, ' ').trim(), 'December 2026');
    await page.click('.view[data-view="month"] [data-action="month-today"]');
    assert.strictEqual(await page.evaluate(() => App.state.ui.monthCursor), thisMonth);
  });

  await check('month: keyboard arrows move between days, PageDown changes month, Enter opens the day', async () => {
    await page.evaluate(() => App.setNow(new Date(2026, 9, 14, 10, 0)));
    await gotoMonth('2026-11');
    await page.click('.view[data-view="month"] [data-action="month-today"]');
    const tabbable = await page.$$eval('.view[data-view="month"] .mcell-day[tabindex="0"]', els => els.map(e => e.dataset.day));
    assert.deepStrictEqual(tabbable, ['2026-10-14'], 'roving tabindex starts on today');
    await page.focus('.view[data-view="month"] .mcell-day[data-day="2026-10-14"]');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowDown');
    assert.strictEqual(await page.evaluate(() => document.activeElement.dataset.day), '2026-10-22');
    await page.keyboard.press('PageDown');
    assert.strictEqual(await page.evaluate(() => document.activeElement.dataset.day), '2026-11-22');
    assert.strictEqual(await page.evaluate(() => App.state.ui.monthCursor), '2026-11');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#panel-root .panel[data-month-day="2026-11-22"]');
    assert.strictEqual(await page.getAttribute('#panel-root .panel', 'aria-label'), 'Sunday, November 22');
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.evaluate(() => document.activeElement.dataset.day), '2026-11-22');
    await page.keyboard.press('t');
    assert.strictEqual(await page.evaluate(() => App.state.ui.monthCursor), '2026-10');
    await page.evaluate(() => App.setNow(null));
  });

  await check('month: shared filters apply but overdue items always show', async () => {
    await gotoMonth(thisMonth);
    const r = await page.evaluate(() => {
      const prec = App.state.classes.find(c => c.name === 'Precalculus');
      App.state.ui.filters.classes = [prec.id]; App.render();
      const root = document.querySelector('.view[data-view="month"]');
      const ids = Array.from(root.querySelectorAll('.mcell .pill, .month-overdue .pill')).map(p => App.byId(p.dataset.id));
      const res = { wrong: ids.filter(a => a.classId !== prec.id && !App.isOverdue(a)).map(a => a.title), overdue: ids.filter(a => App.isOverdue(a)).length, strip: root.querySelectorAll('.month-overdue .pill').length };
      App.state.ui.filters.classes = []; App.render();
      return res;
    });
    assert.deepStrictEqual(r.wrong, []);
    assert.ok(r.overdue > 0 && r.strip > 0, 'overdue still shown (and in the overdue strip)');
  });

  await check('month: grid dates are contiguous across DST changes and year ends, for every week start', async () => {
    const r = await page.evaluate(() => {
      const bad = [];
      for (const ym of ['2026-03', '2026-11', '2026-12', '2027-01', '2027-02']) {
        for (const ws of [0, 1, 6, '1']) {
          App.state.settings.weekStartsOn = ws; App.state.ui.monthCursor = ym; App.render();
          const days = Array.from(document.querySelectorAll('.view[data-view="month"] .mcell')).map(c => c.dataset.day);
          const [y, m] = ym.split('-').map(Number);
          const last = new Date(y, m, 0).getDate();
          const inMonth = days.filter(d => d.startsWith(ym + '-'));
          for (let i = 1; i < days.length; i++) {
            const a = new Date(days[i - 1] + 'T12:00'), b = new Date(days[i] + 'T12:00');
            if (Math.round((b - a) / 864e5) !== 1) bad.push(ym + '/' + ws + ': gap after ' + days[i - 1]);
          }
          if (days.length % 7 || days.length > 42) bad.push(ym + '/' + ws + ': ' + days.length + ' cells');
          if (inMonth.length !== last) bad.push(ym + '/' + ws + ': ' + inMonth.length + ' in-month days');
          if (new Date(days[0] + 'T12:00').getDay() !== Number(ws)) bad.push(ym + '/' + ws + ': wrong first weekday');
        }
      }
      return bad;
    });
    await page.evaluate(ws => { App.state.settings.weekStartsOn = ws; App.render(); }, original.weekStartsOn);
    assert.deepStrictEqual(r, []);
  });

  await check('month: untrusted titles and class names render as text, never as HTML', async () => {
    const info = await page.evaluate(() => {
      window.__monthXss = 0;
      const cls = App.ensureClass('<img src=x onerror="window.__monthXss++">Evil class');
      const n = App.now();
      const d = Core.addDays(Core.startOfDay(n), 2); d.setHours(15, 0, 0, 0);
      const a = App.addAssignment({ title: '<img src=x onerror="window.__monthXss++"><b>XSS</b>', due: d.toISOString(), allDay: false, estimatedMin: 30, classId: cls.id });
      const od = new Date(n.getTime() - 3 * 3600e3);
      const b = App.addAssignment({ title: '"><svg onload="window.__monthXss++">', due: od.toISOString(), allDay: false, classId: cls.id });
      return { ids: [a.id, b.id], clsId: cls.id, key: Core.dayKey(d), ym: d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') };
    });
    testIds.push(...info.ids);
    await gotoMonth(info.ym);
    await page.click(`.view[data-view="month"] .mcell[data-day="${info.key}"] .mcell-day`);
    await page.waitForSelector('#panel-root .panel[data-month-day]');
    await page.keyboard.press('Escape');
    await page.click('.view[data-view="month"] [data-action="month-overdue"]');
    await page.waitForSelector('#panel-root .panel[data-month-overdue]');
    await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 360, height: 740 });
    await page.waitForTimeout(100);
    const r = await page.evaluate(id => {
      const root = document.querySelector('.view[data-view="month"]');
      return {
        fired: window.__monthXss,
        injected: root.querySelectorAll('img, svg[onload], .pill b, .item b').length + document.querySelectorAll('#panel-root img').length,
        pillText: (root.querySelector(`.mcell .pill[data-id="${id}"]`) || {}).textContent || ''
      };
    }, info.ids[0]);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(({ clsId, ids }) => {
      App.state.assignments = App.state.assignments.filter(a => !ids.includes(a.id));
      App.state.classes = App.state.classes.filter(c => c.id !== clsId);
      App.recomputePriorities(); App.render();
    }, info);
    assert.strictEqual(r.fired, 0, 'an injected handler ran');
    assert.strictEqual(r.injected, 0, 'markup from a title was parsed into elements');
    assert.ok(r.pillText.includes('<b>XSS</b>'), 'title shown literally: ' + r.pillText);
  });

  await check('month: empty states (no data, filters that match nothing) stay helpful', async () => {
    await gotoMonth(thisMonth);
    const r = await page.evaluate(() => {
      const root = document.querySelector('.view[data-view="month"]');
      const f = App.state.ui.filters;
      f.search = 'zzz-no-such-assignment'; App.render();
      const filtered = {
        sub: root.querySelector('.month-sub').textContent,
        clear: !!root.querySelector('.month-sub [data-action="clear-filters"]'),
        nonOverdue: Array.from(root.querySelectorAll('.mcell .pill')).filter(p => !App.isOverdue(App.byId(p.dataset.id))).length,
        cells: root.querySelectorAll('.mcell').length
      };
      root.querySelector('.month-sub [data-action="clear-filters"]').click();
      const cleared = App.state.ui.filters.search === '';
      const saved = App.state.assignments;
      App.state.assignments = []; App.render();
      const none = {
        cells: root.querySelectorAll('.mcell').length,
        pills: root.querySelectorAll('.pill').length,
        cta: !!root.querySelector('.month-empty [data-action="open-import"]'),
        strip: !!root.querySelector('.month-overdue'),
        sub: root.querySelector('.month-sub').textContent
      };
      App.state.assignments = saved; App.render();
      return { filtered, cleared, none, after: !!root.querySelector('.month-empty') };
    });
    assert.ok(/with the current filters|filtered/.test(r.filtered.sub), r.filtered.sub);
    assert.ok(r.filtered.clear, 'clear filters button');
    assert.strictEqual(r.filtered.nonOverdue, 0);
    assert.ok(r.filtered.cells >= 28);
    assert.ok(r.cleared, 'clear filters works');
    assert.ok(r.none.cells >= 28 && r.none.pills === 0 && !r.none.strip, JSON.stringify(r.none));
    assert.ok(r.none.cta, 'import call to action when there is no data');
    assert.ok(!r.after, 'call to action goes away once there is data');
  });

  await check('month: PageDown outside the view scrolls the page; month changes are announced', async () => {
    await gotoMonth('2026-10');
    await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
    await page.keyboard.press('PageDown');
    assert.strictEqual(await page.evaluate(() => App.state.ui.monthCursor), '2026-10', 'PageDown on the page body must not change month');
    await page.click('.view[data-view="month"] [data-action="month-next"]');
    await page.waitForFunction(() => (document.getElementById('month-live') || {}).textContent === 'November 2026', null, { timeout: 2000 });
    assert.strictEqual(await page.evaluate(() => document.activeElement && document.activeElement.dataset.action), 'month-next', 'focus stays on the next button');
    await page.focus('.view[data-view="month"] [data-action="month-next"]');
    await page.keyboard.press('PageUp');
    assert.strictEqual(await page.evaluate(() => App.state.ui.monthCursor), '2026-10', 'PageUp with focus inside the view changes month');
  });

  if (SHOTS) {
    await gotoMonth(thisMonth);
    await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
    await setTheme('dark'); await shot('month-1440-dark.png');
    await setTheme('light'); await shot('month-1440-light.png');
    await setTheme('dark');
  }

  await check('month: agenda list at 360px with no horizontal overflow', async () => {
    await page.setViewportSize({ width: 360, height: 740 });
    await gotoMonth(thisMonth);
    await page.waitForTimeout(150);
    assert.ok(await page.isHidden('.view[data-view="month"] .month-card'), 'grid hidden on narrow screens');
    assert.ok(await page.isVisible('.view[data-view="month"] .month-agenda'), 'agenda visible');
    const r = await page.evaluate(() => {
      const root = document.querySelector('.view[data-view="month"]');
      const days = Array.from(root.querySelectorAll('.magenda-day')).map(s => s.dataset.day);
      return {
        over: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        days, sorted: days.slice().sort().join() === days.join(),
        today: !!root.querySelector(`.magenda-day.is-today[data-day="${Core.dayKey(App.now())}"]`),
        items: root.querySelectorAll('.magenda-day .item').length,
        wide: Array.from(root.querySelectorAll('*')).filter(e => e.getBoundingClientRect().right > window.innerWidth + 1 && e.offsetParent !== null).map(e => e.className).slice(0, 5)
      };
    });
    assert.ok(r.over <= 0, 'horizontal overflow: ' + r.over + 'px');
    assert.deepStrictEqual(r.wide, [], 'elements past the right edge');
    assert.ok(r.days.length > 0 && r.sorted, 'day groups in order');
    assert.ok(r.today, 'today group present');
    assert.ok(r.items > 0);
    assert.ok(await page.isVisible('.view[data-view="month"] [data-action="month-next"]'));
    /* Switching views scrolls the view into place: its heading must not hide under the sticky top bar. */
    await page.evaluate(() => { App.setView('today'); window.scrollTo(0, 0); App.setView('month'); });
    await page.waitForTimeout(250);
    const hd = await page.evaluate(() => {
      const h = document.querySelector('#month-heading').getBoundingClientRect();
      const bar = document.querySelector('.topbar').getBoundingClientRect();
      return { top: h.top, barBottom: bar.bottom };
    });
    assert.ok(hd.top >= hd.barBottom - 1, 'heading hidden under the top bar: ' + JSON.stringify(hd));
    await page.click('.view[data-view="month"] .magenda-day.is-today .magenda-date');
    await page.waitForSelector('#panel-root .panel[data-month-day]');
    const pOver = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(pOver <= 0, 'panel causes overflow');
    if (SHOTS) {
      await page.waitForTimeout(400);
      await page.screenshot({ path: path.join(shotsDir, 'month-panel-360.png') });
    }
    await page.keyboard.press('Escape');
    if (SHOTS) {
      await setTheme('dark'); await shot('month-360-dark.png');
      await setTheme('light'); await shot('month-360-light.png');
      await setTheme('dark');
    }
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  /* Clean up: remove test items, restore settings, view and theme. */
  await page.evaluate(({ ids, o }) => {
    App.closePanel(); App.closeModal();
    App.setNow(null);
    App.state.assignments = App.state.assignments.filter(a => !ids.includes(a.id));
    App.state.settings.weekStartsOn = o.weekStartsOn;
    App.state.settings.theme = o.theme; App.applyTheme();
    App.state.ui.filters = o.filters;
    App.state.ui.monthCursor = o.cursor;
    App.recomputePriorities();
    App.setView(o.view);
    App.save();
  }, { ids: testIds, o: original });
  const qa = await page.$('#quickadd'); if (qa) await qa.evaluate(e => { e.value = ''; e.blur(); });
};
