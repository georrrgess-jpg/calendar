/* Week timeline checks (spec 3.3). Loaded by tests/browser.js after its own checks. */
'use strict';
module.exports = async ({ page, check, assert, SHOTS, shotsDir, path }) => {
  const HOUR_PX = 36;
  // Wednesday Oct 14 2026, 10:00 local (the browser context runs in America/New_York).
  const NOW = 'new Date(2026, 9, 14, 10, 0, 0)';
  let ids = null, saved = null;
  const setup = async () => {
    [ids, saved] = await page.evaluate(nowExpr => {
      const saved = { ws: App.state.settings.weekStartsOn, cursor: App.state.ui.weekCursor, theme: App.state.settings.theme };
      App.setNow(eval(nowExpr));
      App.state.ui.weekCursor = null;
      const at = (d, h, m) => new Date(2026, 9, d, h, m || 0, 0).toISOString();
      const mk = (title, due, extra) => App.addAssignment(Object.assign({ title, due, allDay: false, estimatedMin: 30 }, extra || {})).id;
      const ids = {
        morning: mk('WK morning item', at(15, 9, 0)),
        afternoon: mk('WK afternoon item', at(15, 15, 0)),
        twinA: mk('WK twin A', at(15, 15, 10)),
        twinB: mk('WK twin B', at(15, 15, 10)),
        allday: mk('WK all-day item', at(16, 23, 59), { allDay: true }),
        old: mk('WK old overdue', at(2, 23, 59)),
        late: mk('WK late night', at(17, 23, 59))
      };
      App.setView('week');
      return [ids, saved];
    }, NOW);
    await page.waitForSelector('.view[data-view="week"].active .wk-col');
  };
  const cols = () => page.$$eval('.view[data-view="week"] .wk-col', els => els.map(e => e.dataset.day));
  const box = id => page.$eval(`.wk-block[data-id="${id}"]`, el => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, day: el.closest('.wk-col').dataset.day, offsetTop: el.offsetTop };
  });

  await setup();

  await check('week: 7 day columns in order for weekStartsOn 1 and 0', async () => {
    for (const ws of [1, 0]) {
      await page.evaluate(ws => { App.state.settings.weekStartsOn = ws; App.render(); }, ws);
      const keys = await cols();
      assert.strictEqual(keys.length, 7, 'seven columns');
      const info = await page.evaluate(keys => keys.map(k => { const d = Core.fromDayKey(k); return { dow: d.getDay(), t: d.getTime() }; }), keys);
      assert.strictEqual(info[0].dow, ws, 'first column weekday for weekStartsOn=' + ws);
      for (let i = 1; i < 7; i++) assert.strictEqual(info[i].dow, (ws + i) % 7, 'consecutive days');
      assert.ok(keys.includes('2026-10-14'), 'week contains today');
      const heads = await page.$$eval('.wk-dh', els => els.map(e => e.dataset.day));
      assert.deepStrictEqual(heads, keys, 'day headers line up with columns');
      assert.ok(await page.isVisible('.wk-dh.is-today[data-day="2026-10-14"]'), 'today highlighted');
    }
    await page.evaluate(() => { App.state.settings.weekStartsOn = 1; App.render(); });
    const range = await page.textContent('#wk-range');
    assert.strictEqual(range.trim(), 'Oct 12 – 18, 2026');
    const meta = await page.textContent('.wk-dh[data-day="2026-10-15"] .wk-dh-meta');
    assert.ok(/\d+ due/.test(meta) && /h|m/.test(meta), 'day header shows count and estimate: ' + meta);
  });

  await check('week: 15:00 item sits lower than 9:00 item; collisions do not overlap', async () => {
    const m = await box(ids.morning), a = await box(ids.afternoon);
    assert.strictEqual(m.day, '2026-10-15'); assert.strictEqual(a.day, '2026-10-15');
    assert.ok(a.offsetTop > m.offsetTop, '15:00 below 9:00');
    assert.ok(Math.abs(m.offsetTop - 9 * HOUR_PX) <= 1, '9:00 block placed at 9:00: ' + m.offsetTop);
    assert.ok(Math.abs((a.offsetTop - m.offsetTop) - 6 * HOUR_PX) <= 1, 'six hours apart');
    const blocks = [a, await box(ids.twinA), await box(ids.twinB)].sort((x, y) => x.top - y.top);
    for (let i = 1; i < blocks.length; i++) assert.ok(blocks[i].top >= blocks[i - 1].bottom - 0.5, 'colliding blocks must not overlap');
    const late = await box(ids.late);
    const colH = await page.$eval('.wk-col[data-day="2026-10-17"]', el => el.getBoundingClientRect().bottom);
    assert.ok(late.bottom <= colH + 0.5, '23:59 block stays inside its column');
  });

  await check('week: all-day item is in the all-day band, overdue strip lists older overdue work', async () => {
    assert.ok(await page.$(`.wk-ad-cell[data-day="2026-10-16"] [data-id="${ids.allday}"]`), 'in all-day band for its day');
    assert.ok(!(await page.$(`.wk-col [data-id="${ids.allday}"]`)), 'not in the timed grid');
    assert.ok(await page.isVisible(`.wk-overdue .wk-od[data-id="${ids.old}"]`), 'old overdue item in the strip');
    const tag = await page.textContent(`.wk-od[data-id="${ids.old}"] .tag-overdue`);
    assert.ok(/Overdue by \d+d/.test(tag), tag);
    // a class filter must not hide overdue work
    const cls = await page.evaluate(() => App.state.classes.find(c => !c.hidden).id);
    await page.evaluate(c => { App.state.ui.filters.classes = [c]; App.render(); }, cls);
    assert.ok(await page.isVisible(`.wk-od[data-id="${ids.old}"]`), 'overdue survives filters');
    assert.ok(!(await page.$(`.wk-block[data-id="${ids.morning}"]`)), 'filtered item hidden');
    await page.evaluate(() => { App.state.ui.filters.classes = []; App.render(); });
  });

  await check('week: now line is in today\'s column and moves', async () => {
    const t1 = await page.$eval('.wk-col.is-today .wk-now', el => ({ day: el.closest('.wk-col').dataset.day, top: parseFloat(el.style.top) }));
    assert.strictEqual(t1.day, '2026-10-14');
    assert.ok(Math.abs(t1.top - 10 * HOUR_PX) < 1, 'at 10:00: ' + t1.top);
    assert.strictEqual(await page.$$eval('.wk-now', els => els.length), 1, 'exactly one now line');
    await page.evaluate(() => App.setNow(new Date(App.now().getTime() + 2 * 3600000)));
    const t2 = await page.$eval('.wk-col.is-today .wk-now', el => parseFloat(el.style.top));
    assert.ok(Math.abs(t2 - t1.top - 2 * HOUR_PX) < 1, 'moved down two hours: ' + t1.top + ' -> ' + t2);
    // The tick repositions the existing element without a re-render.
    const same = await page.evaluate(() => {
      const el = document.querySelector('.wk-col.is-today .wk-now');
      el.dataset.mark = 'x'; el.style.top = '0px';
      App.updateTickers();
      const el2 = document.querySelector('.wk-col.is-today .wk-now');
      return { same: el2.dataset.mark === 'x', top: parseFloat(el2.style.top), label: document.querySelector('.wk-now-label').textContent };
    });
    assert.ok(same.same, 'same element after tick');
    assert.ok(Math.abs(same.top - 12 * HOUR_PX) < 1, 'tick restored position: ' + same.top);
    assert.strictEqual(same.label, '12:00p');
    await page.evaluate(nowExpr => App.setNow(eval(nowExpr)), NOW);
    const sc = await page.$eval('.wk-scroll', el => ({ top: el.scrollTop, h: el.clientHeight }));
    assert.ok(10 * HOUR_PX >= sc.top && 10 * HOUR_PX <= sc.top + sc.h, 'current time scrolled into view');
  });

  await check('week: blocks open the detail by click and keyboard, then Edit opens the edit modal', async () => {
    await page.click(`.wk-block[data-id="${ids.afternoon}"]`);
    await page.waitForSelector('#modal-root .ad-modal');
    assert.strictEqual((await page.textContent('#modal-root #modal-title')).trim(), 'WK afternoon item');
    await page.click('#modal-root [data-role="edit"]');
    await page.waitForSelector('#modal-root .modal #ed-title');
    assert.strictEqual(await page.inputValue('#ed-title'), 'WK afternoon item');
    await page.keyboard.press('Escape'); /* back to the detail view */
    await page.waitForSelector('#modal-root .ad-modal');
    await page.keyboard.press('Escape');
    await page.focus(`.wk-block[data-id="${ids.morning}"]`);
    await page.keyboard.press('Enter');
    await page.waitForSelector('#modal-root .ad-modal');
    await page.click('#modal-root [data-role="edit"]');
    await page.waitForSelector('#modal-root .modal #ed-title');
    assert.strictEqual(await page.inputValue('#ed-title'), 'WK morning item');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#modal-root .ad-modal');
    await page.keyboard.press('Escape');
    assert.ok(!(await page.$('#modal-root .modal')));
    const label = await page.getAttribute(`.wk-block[data-id="${ids.morning}"]`, 'aria-label');
    assert.ok(/WK morning item/.test(label) && /9:00 AM/.test(label), label);
  });

  if (SHOTS) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: path.join(shotsDir, 'week-1440-dark-viewport.png') });
    await page.screenshot({ path: path.join(shotsDir, 'week-1440-dark.png'), fullPage: true });
    await page.evaluate(() => { App.state.settings.theme = 'light'; App.applyTheme(); });
    await page.screenshot({ path: path.join(shotsDir, 'week-1440-light.png'), fullPage: true });
    await page.evaluate(() => { App.state.settings.theme = 'dark'; App.applyTheme(); });
  }

  await check('week: prev / next / this week persist across reload', async () => {
    await page.click('[data-action="wk-next"]');
    assert.strictEqual(await page.evaluate(() => App.state.ui.weekCursor), '2026-10-19');
    assert.strictEqual((await page.textContent('#wk-range')).trim(), 'Oct 19 – 25, 2026');
    assert.strictEqual(await page.evaluate(() => document.activeElement.dataset.action), 'wk-next', 'focus stays on the button');
    await page.click('[data-action="wk-next"]');
    await page.click('[data-action="wk-prev"]');
    assert.strictEqual(await page.evaluate(() => App.state.ui.weekCursor), '2026-10-19');
    await page.keyboard.press(']');
    assert.strictEqual(await page.evaluate(() => App.state.ui.weekCursor), '2026-10-26', '] goes forward');
    await page.keyboard.press('[');
    await page.waitForTimeout(300);
    await page.reload(); await page.waitForSelector('#view-root');
    assert.ok(await page.isVisible('.view[data-view="week"].active .wk'), 'week view restored');
    assert.strictEqual(await page.evaluate(() => App.state.ui.weekCursor), '2026-10-19');
    assert.strictEqual((await page.textContent('#wk-range')).trim(), 'Oct 19 – 25, 2026');
    await page.evaluate(nowExpr => App.setNow(eval(nowExpr)), NOW);
    await page.click('[data-action="wk-today"]');
    assert.strictEqual(await page.evaluate(() => App.state.ui.weekCursor), null);
    assert.strictEqual((await page.textContent('#wk-range')).trim(), 'Oct 12 – 18, 2026');
    assert.strictEqual(await page.getAttribute('[data-action="wk-today"]', 'aria-pressed'), 'true');
  });

  await check('week: narrow layout at 360px is an agenda without horizontal overflow', async () => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.waitForSelector('.wk-agenda');
    assert.ok(!(await page.$('.wk-col')), 'grid replaced by agenda');
    assert.strictEqual(await page.$$eval('.wk-ag-day', els => els.length), 7);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 0, 'horizontal overflow: ' + over + 'px');
    const order = await page.$$eval('.wk-ag-day[data-day="2026-10-15"] .wk-ag-row .item', els => els.map(e => e.dataset.id));
    assert.ok(order.indexOf(ids.morning) < order.indexOf(ids.afternoon), 'time order');
    const fri = await page.$$eval('.wk-ag-day[data-day="2026-10-16"] .wk-ag-row .item', els => els.map(e => e.dataset.id));
    assert.strictEqual(fri[0], ids.allday, 'all-day first');
    assert.ok(await page.isVisible('.wk-ag-day.is-today .wk-ag-now'), 'now marker in today');
    // marker moves past items as time passes, without a re-render
    const moved = await page.evaluate(() => {
      const list = document.querySelector('.wk-ag-day.is-today .wk-ag-list');
      const mk = list.querySelector('.wk-ag-now'); mk.dataset.mark = 'x';
      list.insertBefore(mk, list.firstElementChild);
      App.updateTickers();
      const rows = Array.from(list.children);
      const i = rows.indexOf(mk);
      const n = App.now().getTime();
      const ok = rows.every((r, j) => !r.dataset.ts || (j < i ? +r.dataset.ts <= n : +r.dataset.ts > n));
      return { ok, same: list.querySelector('.wk-ag-now').dataset.mark === 'x' };
    });
    assert.ok(moved.ok && moved.same, 'marker sits between past and future items');
    if (SHOTS) {
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(shotsDir, 'week-360-dark-viewport.png') });
      await page.screenshot({ path: path.join(shotsDir, 'week-360-dark.png'), fullPage: true });
      await page.evaluate(() => { App.state.settings.theme = 'light'; App.applyTheme(); });
      await page.screenshot({ path: path.join(shotsDir, 'week-360-light.png'), fullPage: true });
      await page.evaluate(() => { App.state.settings.theme = 'dark'; App.applyTheme(); });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.waitForSelector('.wk-col');
  });

  const extra = [];
  const extraClasses = [];

  await check('week: hostile titles and class names render as text; bad priority cannot break out of style', async () => {
    const r = await page.evaluate(() => {
      window.__wkxss = 0;
      const cls = App.ensureClass('<img src=x onerror="window.__wkxss=1">Evil class');
      const at = (d, h, m) => new Date(2026, 9, d, h, m || 0, 0).toISOString();
      const a = App.addAssignment({ title: '<img src=x onerror="window.__wkxss=1">WK xss', classId: cls.id, due: at(13, 9, 0), allDay: false });
      const b = App.addAssignment({ title: '"><svg onload="window.__wkxss=1">WK xss2', classId: cls.id, due: at(16, 0, 0), allDay: true });
      const c = App.addAssignment({ title: 'WK bad pri', due: at(15, 18, 0), allDay: false, priority: 'x)" onfocus="window.__wkxss=1" data-x="' });
      App.render();
      return { ids: [a.id, b.id, c.id], cls: cls.id };
    });
    extra.push(...r.ids); extraClasses.push(r.cls);
    await page.waitForTimeout(150);
    assert.strictEqual(await page.$$eval('.view[data-view="week"] img, .view[data-view="week"] .wk-ad-cell svg:not(:has(use))', els => els.length), 0, 'no injected elements');
    assert.strictEqual(await page.evaluate(() => window.__wkxss), 0, 'no script ran');
    const t = await page.textContent(`.wk-block[data-id="${r.ids[0]}"] .wk-block-title`);
    assert.ok(t.startsWith('<img src=x'), 'title shown as text: ' + t);
    // past and overdue this week: also listed in the overdue strip, with the class name as text
    const od = await page.textContent(`.wk-od[data-id="${r.ids[0]}"] .wk-od-class`);
    assert.ok(od.includes('<img src=x'), 'class shown as text: ' + od);
    assert.ok(await page.$(`.wk-ad-cell [data-id="${r.ids[1]}"]`), 'all-day hostile title rendered');
    const attrs = await page.$eval(`.wk-block[data-id="${r.ids[2]}"]`, el => ({ onfocus: el.hasAttribute('onfocus'), x: el.hasAttribute('data-x') }));
    assert.ok(!attrs.onfocus && !attrs.x, 'priority text stayed inside the style attribute');
    await page.focus(`.wk-block[data-id="${r.ids[2]}"]`);
    assert.strictEqual(await page.evaluate(() => window.__wkxss), 0, 'focus ran nothing');
  });

  await check('week: a very busy day never overlaps, and every block stays inside its column', async () => {
    const r = await page.evaluate(() => {
      const ids = [];
      for (let i = 0; i < 30; i++) ids.push(App.addAssignment({ title: 'WK busy ' + i, due: new Date(2026, 9, 18, 23, 59, 0).toISOString(), allDay: false }).id);
      App.render();
      return ids;
    });
    extra.push(...r);
    const boxes = await page.$$eval('.wk-col[data-day="2026-10-18"] .wk-block', els => els.map(e => { const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; }));
    const col = await page.$eval('.wk-col[data-day="2026-10-18"]', el => { const b = el.getBoundingClientRect(); return { top: b.top, bottom: b.bottom }; });
    assert.strictEqual(boxes.length, 30);
    boxes.sort((a, b) => a.top - b.top);
    for (let i = 1; i < boxes.length; i++) assert.ok(boxes[i].top >= boxes[i - 1].bottom - 0.5, 'overlap at ' + i);
    assert.ok(boxes[0].top >= col.top - 0.5 && boxes[boxes.length - 1].bottom <= col.bottom + 0.5, 'inside the column');
    await page.evaluate(ids => { for (const id of ids) { const a = App.byId(id); if (a) App.state.assignments.splice(App.state.assignments.indexOf(a), 1); } App.render(); }, r);
  });

  await check('week: overdue work earlier this week is in the strip; empty weeks and filtered-out weeks say so', async () => {
    // "WK xss" (Tue 9:00) is overdue inside the shown week: it is in the grid and in the strip.
    assert.ok(await page.$(`.wk-col[data-day="2026-10-13"] [data-id="${extra[0]}"]`), 'in its column');
    assert.ok(await page.isVisible(`.wk-overdue [data-id="${extra[0]}"]`), 'and in the overdue strip');
    // Far-future empty week.
    await page.evaluate(() => { App.state.ui.weekCursor = '2027-06-09'; App.render(); });
    assert.ok(/Nothing due this week/.test(await page.textContent('.wk-summary')), 'empty summary');
    assert.ok(await page.isVisible('.wk-empty-note'), 'empty note shown');
    assert.strictEqual(await page.$$eval('.wk-col', e => e.length), 7, 'still seven columns');
    assert.strictEqual(await page.$$eval('.wk-now', e => e.length), 0, 'no now line outside the current week');
    // Current week with a search that matches nothing: only overdue items stay.
    await page.evaluate(() => { App.state.ui.weekCursor = null; App.state.ui.filters.search = 'zzzz-no-match'; App.render(); });
    assert.strictEqual(await page.$$eval('.wk-block:not(.is-overdue), .wk-ad-cell .pill:not(.is-overdue)', e => e.length), 0, 'only overdue items survive the search');
    assert.ok(await page.isVisible(`.wk-od[data-id="${ids.old}"]`), 'overdue still visible under a search');
    await page.evaluate(() => { App.state.ui.filters.search = ''; App.render(); });
    // Paging back onto the current week stores null so the view follows today.
    await page.click('[data-action="wk-next"]');
    await page.click('[data-action="wk-prev"]');
    assert.strictEqual(await page.evaluate(() => App.state.ui.weekCursor), null, 'current week stored as null');
  });

  // Clean up: remove test items, restore settings, return to Next Up.
  await page.evaluate(([ids, extra, extraClasses]) => {
    for (const id of extra) { const a = App.byId(id); if (a) App.state.assignments.splice(App.state.assignments.indexOf(a), 1); }
    App.state.classes = App.state.classes.filter(c => !extraClasses.includes(c.id));
  }, [ids, extra, extraClasses]);
  await page.evaluate(([ids, s]) => {
    for (const id of Object.values(ids || {})) { const a = App.byId(id); if (a) App.state.assignments.splice(App.state.assignments.indexOf(a), 1); }
    s = s || {};
    App.state.settings.weekStartsOn = s.ws == null ? 1 : s.ws;
    App.state.ui.weekCursor = null;
    App.state.settings.theme = s.theme || 'dark'; App.applyTheme();
    App.closeModal(); App.closePanel();
    App.setNow(null);
    App.recomputePriorities(); App.save(true);
    App.setView('today');
  }, [ids, saved]);
};
