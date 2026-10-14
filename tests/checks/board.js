/*
 * Browser checks for the Priority board (Kanban) view.
 * Loaded by tests/browser.js after its own checks; the page already holds demo
 * data plus the imported AP Biology fixture.
 */
'use strict';

module.exports = async ({ page, check, assert, SHOTS, shotsDir, path }) => {
  const colOf = id => page.evaluate(id => { const c = document.querySelector(`#board-mount .bcard[data-id="${id}"]`); return c ? c.dataset.col : null; }, id);
  const item = id => page.evaluate(id => { const a = App.byId(id); return a && { p: a.priority, auto: a.priorityAuto, done: a.done }; }, id);
  const openBoard = async () => {
    await page.evaluate(() => { App.closeModal(); App.closePanel(); App.setView('board'); });
    await page.waitForSelector('.view[data-view="board"].active .board');
  };
  /* Pick an open, visible card that is not already critical, and make it an automatic-priority card in Medium. */
  const prepareMediumCard = async (exclude) => page.evaluate(exclude => {
    const a = App.visible().find(x => !x.done && !App.isOverdue(x) && x.due && !(exclude || []).includes(x.id));
    App.updateAssignment(a.id, { priority: 'medium', priorityAuto: false });
    return a.id;
  }, exclude || []);
  const center = async sel => { const b = await page.locator(sel).first().boundingBox(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };
  /* Drag with real mouse events starting on the card's grip handle: exercises the pointer-events path. */
  const pointerDrag = async (id, toCol) => {
    await page.locator(`#board-mount .bcard[data-id="${id}"]`).scrollIntoViewIfNeeded();
    const from = await center(`#board-mount .bcard[data-id="${id}"] .bcard-grip`);
    const to = await center(`#board-mount .board-col[data-col="${toCol}"] .board-col-head`);
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    const steps = 12;
    for (let i = 1; i <= steps; i++) await page.mouse.move(from.x + (to.x - from.x) * i / steps, from.y + (to.y + 40 - from.y) * i / steps);
    return { from, to };
  };

  await check('board: five columns with counts that match the cards', async () => {
    await openBoard();
    const cols = await page.$$eval('#board-mount .board-col', els => els.map(c => ({ key: c.dataset.col, count: +c.querySelector('.count-badge').textContent, cards: c.querySelectorAll('.bcard').length })));
    assert.deepStrictEqual(cols.map(c => c.key), ['critical', 'high', 'medium', 'low', 'done']);
    for (const c of cols) if (c.key !== 'done') assert.strictEqual(c.count, c.cards, c.key + ' count badge matches cards');
    const expected = await page.evaluate(() => {
      const out = { critical: 0, high: 0, medium: 0, low: 0 };
      for (const a of App.visible()) if (!a.done) out[a.priority]++;
      return out;
    });
    for (const k of Object.keys(expected)) assert.strictEqual(cols.find(c => c.key === k).cards, expected[k], k + ' holds every visible open item of that priority');
    const pc = await page.$eval('#board-mount .board-col[data-col="critical"]', el => [getComputedStyle(el).getPropertyValue('--pc').trim(), getComputedStyle(document.documentElement).getPropertyValue('--pri-critical').trim()]);
    assert.strictEqual(pc[0], pc[1], 'critical column uses the priority colour');
  });

  await check('board: open cards are sorted overdue first, then by due date', async () => {
    const ok = await page.evaluate(() => {
      const n = App.now();
      for (const col of document.querySelectorAll('#board-mount .board-col:not([data-col="done"])')) {
        const items = [...col.querySelectorAll('.bcard')].map(c => App.byId(c.dataset.id));
        for (let i = 1; i < items.length; i++) {
          const a = items[i - 1], b = items[i];
          const oa = App.isOverdue(a, n), ob = App.isOverdue(b, n);
          if (!oa && ob) return col.dataset.col + ': overdue item after a non-overdue one';
          if (oa === ob && a.due && b.due && new Date(a.due) > new Date(b.due)) return col.dataset.col + ': ' + a.title + ' before ' + b.title;
        }
      }
      return true;
    });
    assert.strictEqual(ok, true, ok);
  });

  await check('board: cards show class, due, countdown, estimate and auto vs. set-by-you markers', async () => {
    const id = await page.evaluate(() => {
      const a = App.visible().find(x => !x.done && x.estimatedMin && x.due && !App.isOverdue(x));
      App.resetPriorityAuto(a.id);
      return a.id;
    });
    const card = `#board-mount .bcard[data-id="${id}"]`;
    await page.waitForSelector(card);
    const info = await page.$eval(card, el => ({
      title: el.querySelector('.bcard-title').textContent, cls: el.querySelector('.bcard-class').textContent.trim(),
      due: !!el.querySelector('.bcard-due'), countdown: !!el.querySelector('[data-due]'), est: (el.querySelector('.est') || {}).textContent,
      auto: !!el.querySelector('.bmark-auto'), reset: !!el.querySelector('.bcard-reset'), tab: el.getAttribute('tabindex'), label: el.getAttribute('aria-label')
    }));
    assert.ok(info.title.length > 0 && info.cls.length > 0, JSON.stringify(info));
    assert.ok(info.due && info.countdown, 'due date and ticking countdown');
    assert.ok(/^~\d/.test(info.est || ''), 'estimate shown: ' + info.est);
    assert.ok(info.auto && !info.reset, 'auto card shows the auto marker and no reset control');
    assert.strictEqual(info.tab, '0');
    assert.ok(/automatic/.test(info.label), info.label);
  });

  await check('board: HTML5 drag from Medium to Critical pins the priority and survives reload', async () => {
    const id = await prepareMediumCard();
    await page.waitForSelector(`#board-mount .board-col[data-col="medium"] .bcard[data-id="${id}"]`);
    await page.dragAndDrop(`#board-mount .bcard[data-id="${id}"] .bcard-title`, '#board-mount .board-col[data-col="critical"] .board-col-head');
    await page.waitForSelector(`#board-mount .board-col[data-col="critical"] .bcard[data-id="${id}"]`);
    assert.deepStrictEqual(await item(id), { p: 'critical', auto: false, done: false });
    assert.ok(await page.$(`#board-mount .bcard[data-id="${id}"] .bmark-pin`), 'shows set-by-you marker');
    assert.ok(await page.$(`#board-mount .bcard[data-id="${id}"] .bcard-reset`), 'shows reset-to-auto control');
    assert.strictEqual(await page.$$eval('#board-mount .bph, #board-mount .is-over, .bcard-ghost', els => els.length), 0, 'drag visuals cleaned up');
    await page.waitForFunction(() => document.getElementById('board-live').textContent.includes('moved to Critical'), null, { timeout: 2000 });
    await page.waitForTimeout(250);
    await page.reload(); await page.waitForSelector('.view[data-view="board"].active .board');
    assert.deepStrictEqual(await item(id), { p: 'critical', auto: false, done: false });
    assert.strictEqual(await colOf(id), 'critical');
  });

  await check('board: an auto card dragged with HTML5 events becomes priorityAuto=false', async () => {
    const id = await page.evaluate(() => {
      const a = App.visible().find(x => !x.done && x.priorityAuto !== false && x.priority !== 'critical' && !App.isOverdue(x));
      return a.id;
    });
    assert.strictEqual((await item(id)).auto, true);
    await page.dragAndDrop(`#board-mount .bcard[data-id="${id}"] .bcard-title`, '#board-mount .board-col[data-col="critical"] .bcard .bcard-meta');
    await page.waitForSelector(`#board-mount .board-col[data-col="critical"] .bcard[data-id="${id}"]`);
    assert.deepStrictEqual(await item(id), { p: 'critical', auto: false, done: false });
  });

  await check('board: pointer drag (grip handle) shows a placeholder and drop highlight; Done completes and counts the streak', async () => {
    const id = await prepareMediumCard();
    await page.waitForSelector(`#board-mount .board-col[data-col="medium"] .bcard[data-id="${id}"]`);
    const before = await page.evaluate(() => { const k = Core.dayKey(App.now()); return App.state.stats.completedByDay[k] || 0; });
    await pointerDrag(id, 'done');
    assert.ok(await page.$('.bcard-ghost'), 'ghost follows the pointer');
    assert.ok(await page.$('#board-mount .board-col[data-col="done"].is-over'), 'Done column highlighted');
    assert.ok(await page.$('#board-mount .board-col[data-col="done"] .bph'), 'placeholder in Done');
    if (SHOTS) await page.screenshot({ path: path.join(shotsDir, 'board-dragging-1440.png') });
    await page.mouse.up();
    await page.waitForSelector(`#board-mount .board-col[data-col="done"] .bcard[data-id="${id}"]`);
    const s = await page.evaluate(id => { const a = App.byId(id); const k = Core.dayKey(App.now()); return { done: a.done, streak: App.state.stats.streakDays, today: App.state.stats.completedByDay[k] || 0 }; }, id);
    assert.strictEqual(s.done, true);
    assert.ok(s.streak >= 1, 'streak counted: ' + s.streak);
    assert.strictEqual(s.today, before + 1, 'completion counted for today');
    assert.strictEqual(await page.$$eval('.bcard-ghost, #board-mount .bph', els => els.length), 0, 'ghost and placeholder removed');
    assert.ok(!(await page.$('#modal-root .modal')), 'no edit modal opened by the drag');
  });

  await check('board: Done column shows completed items even when "hide done" is on', async () => {
    const hide = await page.evaluate(() => App.state.ui.filters.hideDone);
    assert.strictEqual(hide, true);
    const n = await page.$$eval('#board-mount .board-col[data-col="done"] .bcard', els => els.length);
    assert.ok(n >= 1, 'done cards present: ' + n);
    const newestFirst = await page.evaluate(() => {
      const t = [...document.querySelectorAll('#board-mount .board-col[data-col="done"] .bcard')].map(c => new Date(App.byId(c.dataset.id).doneAt).getTime());
      return t.every((v, i) => i === 0 || t[i - 1] >= v);
    });
    assert.ok(newestFirst, 'done column newest first');
  });

  await check('board: dragging a done card back to High un-completes it and sets High', async () => {
    const id = await page.$eval('#board-mount .board-col[data-col="done"] .bcard', el => el.dataset.id);
    await pointerDrag(id, 'high');
    assert.ok(await page.$('#board-mount .board-col[data-col="high"].is-over'));
    await page.mouse.up();
    await page.waitForSelector(`#board-mount .board-col[data-col="high"] .bcard[data-id="${id}"]`);
    assert.deepStrictEqual(await item(id), { p: 'high', auto: false, done: false });
  });

  await check('board: touch long-press pointer path moves a card (synthetic touch pointer events)', async () => {
    const id = await prepareMediumCard();
    await page.waitForSelector(`#board-mount .board-col[data-col="medium"] .bcard[data-id="${id}"]`);
    await page.locator(`#board-mount .bcard[data-id="${id}"]`).scrollIntoViewIfNeeded();
    const from = await center(`#board-mount .bcard[data-id="${id}"] .bcard-title`);
    const to = await center('#board-mount .board-col[data-col="low"] .board-col-head');
    await page.evaluate(({ id, from }) => {
      const el = document.querySelector(`#board-mount .bcard[data-id="${id}"] .bcard-title`);
      el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', isPrimary: true, clientX: from.x, clientY: from.y, button: 0 }));
    }, { id, from });
    await page.waitForSelector('.bcard-ghost', { timeout: 2000 });
    await page.evaluate(({ from, to }) => {
      for (let i = 1; i <= 8; i++) {
        const x = from.x + (to.x - from.x) * i / 8, y = from.y + (to.y + 40 - from.y) * i / 8;
        window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', clientX: x, clientY: y }));
      }
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 7, pointerType: 'touch', clientX: to.x, clientY: to.y + 40 }));
    }, { from, to });
    await page.waitForSelector(`#board-mount .board-col[data-col="low"] .bcard[data-id="${id}"]`);
    assert.deepStrictEqual(await item(id), { p: 'low', auto: false, done: false });
  });

  await check('board: Escape cancels a pointer drag without changing anything', async () => {
    const id = await prepareMediumCard();
    await pointerDrag(id, 'critical');
    await page.keyboard.press('Escape');
    await page.mouse.up();
    assert.strictEqual(await page.$$eval('.bcard-ghost, #board-mount .bph, #board-mount .is-over', els => els.length), 0);
    assert.deepStrictEqual(await item(id), { p: 'medium', auto: false, done: false });
  });

  await check('board: keyboard moves (ArrowRight, [), Space toggles done, focus follows, moves are announced', async () => {
    const id = await prepareMediumCard();
    const sel = `#board-mount .bcard[data-id="${id}"]`;
    await page.focus(sel);
    await page.keyboard.press('ArrowRight');
    await page.waitForSelector(`#board-mount .board-col[data-col="low"] ${sel.replace('#board-mount ', '')}`);
    assert.strictEqual((await item(id)).p, 'low');
    assert.strictEqual(await page.evaluate(() => document.activeElement.dataset.id), id, 'focus stays on the moved card');
    await page.waitForFunction(() => document.getElementById('board-live').textContent.includes('moved to Low'));
    await page.keyboard.press('[');
    await page.keyboard.press('[');
    await page.waitForFunction(id => App.byId(id).priority === 'high', id);
    assert.strictEqual(await colOf(id), 'high');
    assert.strictEqual(await page.evaluate(() => document.activeElement.dataset.id), id);
    await page.keyboard.press(' ');
    await page.waitForFunction(id => App.byId(id).done === true, id);
    assert.strictEqual(await colOf(id), 'done');
    assert.strictEqual(await page.evaluate(() => document.activeElement.dataset.id), id, 'focus follows into Done');
    await page.keyboard.press('x');
    await page.waitForFunction(id => App.byId(id).done === false, id);
    assert.strictEqual(await colOf(id), 'high', 'back to its priority column');
    assert.strictEqual(await page.evaluate(() => document.activeElement.dataset.id), id);
  });

  await check('board: Enter on a focused card opens the detail, and its Edit button the edit modal', async () => {
    const id = await page.$eval('#board-mount .board-col[data-col="high"] .bcard', el => el.dataset.id);
    await page.focus(`#board-mount .bcard[data-id="${id}"]`);
    await page.keyboard.press('Enter');
    await page.waitForSelector('#modal-root .ad-modal');
    assert.strictEqual(await page.$$eval('#modal-root .modal input, #modal-root .modal select, #modal-root .modal textarea', els => els.length), 0, 'detail is read-only');
    await page.click('#modal-root [data-role="edit"]');
    await page.waitForSelector('#modal-root .modal #ed-title');
    assert.strictEqual(await page.inputValue('#ed-title'), await page.evaluate(id => App.byId(id).title, id));
    await page.keyboard.press('Escape'); /* Esc in Edit goes back to the detail view, a second Esc closes it */
    await page.waitForSelector('#modal-root .ad-modal');
    await page.keyboard.press('Escape');
    assert.ok(!(await page.$('#modal-root .modal')));
  });

  await check('board: reset-to-auto control and the A key restore automatic priority', async () => {
    const id = await prepareMediumCard();
    const expected = await page.evaluate(id => App.autoPriorityFor(App.byId(id)), id);
    await page.click(`#board-mount .bcard[data-id="${id}"] .bcard-reset`);
    await page.waitForFunction(id => App.byId(id).priorityAuto === true, id);
    const s = await item(id);
    assert.strictEqual(s.p, expected);
    assert.strictEqual(await colOf(id), expected);
    assert.ok(await page.$(`#board-mount .bcard[data-id="${id}"] .bmark-auto`));
    assert.ok(!(await page.$('#modal-root .modal')), 'reset does not open the editor');
    const id2 = await prepareMediumCard([id]);
    await page.focus(`#board-mount .bcard[data-id="${id2}"]`);
    await page.keyboard.press('a');
    await page.waitForFunction(id => App.byId(id).priorityAuto === true, id2);
    assert.strictEqual(await page.evaluate(() => document.activeElement.dataset.id), id2);
  });

  await check('board: filters apply to open cards but overdue items stay', async () => {
    const r = await page.evaluate(() => {
      const cls = App.state.classes.find(c => c.name === 'Precalculus');
      App.state.ui.filters.classes = [cls.id]; App.render();
      const ids = [...document.querySelectorAll('#board-mount .board-col:not([data-col="done"]) .bcard')].map(c => App.byId(c.dataset.id));
      const bad = ids.filter(a => a.classId !== cls.id && !App.isOverdue(a));
      const overdue = App.state.assignments.filter(a => !a.done && !a.archived && App.isOverdue(a)).length;
      const overdueShown = ids.filter(a => App.isOverdue(a)).length;
      App.state.ui.filters.classes = []; App.save(); App.render();
      return { bad: bad.map(a => a.title), overdue, overdueShown };
    });
    assert.deepStrictEqual(r.bad, []);
    assert.strictEqual(r.overdueShown, r.overdue, 'all overdue items still on the board');
  });

  await check('board: Done column caps at 12 with "Show N more" and "N older hidden"; its badge counts every recent completion', async () => {
    const ids = await page.evaluate(() => {
      const n = App.now().getTime(), out = [];
      for (let i = 0; i < 20; i++) {
        const a = App.addAssignment({ title: 'Board cap test ' + i, due: new Date(n - (i + 2) * 86400e3).toISOString() });
        a.done = true; a.doneAt = new Date(n - (i * 86400e3 + 3600e3)).toISOString(); out.push(a.id);
      }
      App.save(); App.render();
      return out;
    });
    const expected = await page.evaluate(() => {
      const cut = App.now().getTime() - 14 * 86400e3;
      const done = App.visible({ includeDone: true }).filter(a => a.done);
      return { recent: done.filter(a => a.doneAt && new Date(a.doneAt).getTime() >= cut).length, older: done.filter(a => !a.doneAt || new Date(a.doneAt).getTime() < cut).length };
    });
    const sel = '#board-mount .board-col[data-col="done"]';
    const info = await page.$eval(sel, el => ({ cards: el.querySelectorAll('.bcard').length, badge: +el.querySelector('.count-badge').textContent, more: (el.querySelector('.board-more') || {}).textContent || '', note: (el.querySelector('.board-note') || {}).textContent || '' }));
    assert.strictEqual(info.cards, 12, 'capped at 12');
    assert.strictEqual(info.badge, expected.recent, 'badge counts all recent completions');
    assert.ok(info.more.includes('Show ' + (expected.recent - 12) + ' more'), info.more);
    assert.ok(info.note.includes(expected.older + ' older hidden'), info.note);
    await page.click(sel + ' .board-more button');
    assert.strictEqual(await page.$$eval(sel + ' .bcard', els => els.length), expected.recent, 'all recent shown after "Show more"');
    await page.click(sel + ' .board-more button');
    assert.strictEqual(await page.$$eval(sel + ' .bcard', els => els.length), 12);
    await page.evaluate(ids => { for (const id of ids) { const i = App.state.assignments.findIndex(a => a.id === id); if (i >= 0) App.state.assignments.splice(i, 1); } App.save(); App.render(); }, ids);
  });

  await check('board: hostile titles and class names render as text, also in the drag ghost', async () => {
    const id = await page.evaluate(() => {
      window.__boardXss = 0;
      const c = App.ensureClass('<img src=x onerror="window.__boardXss=1">');
      const a = App.addAssignment({ title: '<img src=x onerror="window.__boardXss=2"> "q" \'s\' & <b>bold</b>', classId: c.id, due: new Date(App.now().getTime() + 5 * 3600e3).toISOString(), allDay: false, estimatedMin: 20, priority: 'high' });
      App.setView('board');
      return a.id;
    });
    const card = `#board-mount .bcard[data-id="${id}"]`;
    await page.waitForSelector(card);
    const r = await page.$eval(card, el => ({ title: el.querySelector('.bcard-title').textContent, cls: el.querySelector('.bcard-class').textContent.trim(), html: el.innerHTML, label: el.getAttribute('aria-label') }));
    assert.strictEqual(r.title, '<img src=x onerror="window.__boardXss=2"> "q" \'s\' & <b>bold</b>');
    assert.ok(r.cls.includes('<img src=x'), r.cls);
    assert.ok(r.label.startsWith('<img src=x'), 'aria-label keeps the raw text');
    assert.strictEqual(await page.$$eval(`#board-mount img, ${card} b, #filterbar img`, els => els.length), 0, 'no injected elements');
    await pointerDrag(id, 'critical');
    assert.strictEqual(await page.$$eval('.bcard-ghost img, .bcard-ghost b', els => els.length), 0, 'ghost has no injected elements');
    await page.keyboard.press('Escape'); await page.mouse.up();
    await page.waitForTimeout(100);
    assert.strictEqual(await page.evaluate(() => window.__boardXss), 0, 'no script ran');
    await page.evaluate(id => {
      const a = App.byId(id); const cid = a.classId;
      App.state.assignments.splice(App.state.assignments.indexOf(a), 1);
      const ci = App.state.classes.findIndex(c => c.id === cid); if (ci >= 0) App.state.classes.splice(ci, 1);
      App.recomputePriorities(); App.save(); App.render();
    }, id);
  });

  await check('board: filters that hide cards say so and offer Clear filters; overdue cards stay', async () => {
    await page.evaluate(() => { App.state.ui.filters.search = 'zzzz-no-match-zzzz'; App.render(); });
    const r = await page.evaluate(() => ({
      note: (document.querySelector('#board-mount .board-filtered') || {}).textContent || '',
      open: document.querySelectorAll('#board-mount .board-col:not([data-col="done"]) .bcard').length,
      overdue: App.state.assignments.filter(a => !a.archived && App.isOverdue(a)).length,
      empties: document.querySelectorAll('#board-mount .board-empty').length
    }));
    assert.ok(/Filters are hiding \d+ open card/.test(r.note), r.note);
    assert.strictEqual(r.open, r.overdue, 'only overdue cards remain');
    assert.ok(r.empties >= 1, 'empty columns explain themselves');
    await page.click('#board-mount .board-filtered [data-action="clear-filters"]');
    assert.strictEqual(await page.evaluate(() => App.state.ui.filters.search), '');
    assert.ok(!(await page.$('#board-mount .board-filtered')), 'note gone once filters are cleared');
  });

  await check('board: empty state offers import and demo data', async () => {
    const empty = await page.evaluate(() => {
      window.__boardSaved = App.state.assignments.splice(0);
      App.render();
      const m = document.getElementById('board-mount');
      return { text: m.textContent, imp: !!m.querySelector('[data-action="open-import"]'), demo: !!m.querySelector('[data-action="load-demo"]'), cols: m.querySelectorAll('.board-col').length };
    });
    await page.evaluate(() => { App.state.assignments.push(...window.__boardSaved); delete window.__boardSaved; App.recomputePriorities(); App.save(); App.render(); });
    assert.ok(empty.text.includes('Nothing on the board yet'), empty.text);
    assert.ok(empty.imp && empty.demo, 'import and demo buttons');
    assert.strictEqual(empty.cols, 0);
    await page.waitForSelector('#board-mount .board-col');
  });

  await check('board: a pointer drag is cancelled when the window loses focus', async () => {
    const id = await prepareMediumCard();
    await pointerDrag(id, 'critical');
    assert.ok(await page.$('.bcard-ghost'));
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    assert.strictEqual(await page.$$eval('.bcard-ghost, #board-mount .bph, #board-mount .is-over', els => els.length), 0, 'drag visuals removed');
    await page.mouse.up();
    assert.deepStrictEqual(await item(id), { p: 'medium', auto: false, done: false });
  });

  await check('board: 360px has no page-level horizontal scroll; the board scrolls inside its own container', async () => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.waitForTimeout(250);
    const m = await page.evaluate(() => {
      const s = document.querySelector('#board-mount .board-scroll');
      return { over: document.documentElement.scrollWidth - document.documentElement.clientWidth, inner: s.scrollWidth - s.clientWidth, snap: getComputedStyle(s).scrollSnapType };
    });
    assert.ok(m.over <= 0, 'page overflow ' + m.over + 'px');
    assert.ok(m.inner > 0, 'board scrolls horizontally inside its container');
    assert.ok(/x/.test(m.snap), 'scroll snap: ' + m.snap);
    assert.ok(await page.isVisible('#board-mount .board-jump'), 'column jump bar visible on phones');
    await page.click('#board-mount .board-jump [data-col="done"]');
    await page.waitForFunction(() => { const s = document.querySelector('#board-mount .board-scroll'); return s.scrollLeft > 200; });
    await page.waitForFunction(() => document.querySelector('#board-mount .board-jump [data-col="done"]').getAttribute('aria-current') === 'true');
    const chipInView = await page.$eval('#board-mount .board-jump [data-col="done"]', el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= window.innerWidth; });
    assert.ok(chipInView, 'current column chip stays visible in the jump bar');
    if (SHOTS) {
      await page.evaluate(() => { document.getElementById('toasts').innerHTML = ''; document.querySelector('#board-mount .board-jump').scrollIntoView(); });
      await page.screenshot({ path: path.join(shotsDir, 'board-360-done-column.png') });
    }
    const first = await page.$eval('#board-mount .board-col[data-col="critical"]', el => el.getBoundingClientRect().width);
    assert.ok(first >= 240 && first <= 320, 'column width ' + first);
    await page.evaluate(() => { document.querySelector('#board-mount .board-scroll').scrollLeft = 0; });
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await check('board: screenshots (dark/light at 1440 and 360)', async () => {
    if (!SHOTS) return;
    await page.waitForFunction(() => !document.getElementById('confetti-canvas').classList.contains('is-on'), null, { timeout: 5000 });
    await page.evaluate(() => { document.getElementById('toasts').innerHTML = ''; if (document.activeElement) document.activeElement.blur(); });
    for (const theme of ['dark', 'light']) {
      await page.evaluate(t => { App.state.settings.theme = t; App.applyTheme(); }, theme);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(700); /* let the 600ms countdown colour transition settle */
      await page.screenshot({ path: path.join(shotsDir, `board-1440-${theme}.png`), fullPage: true });
      await page.setViewportSize({ width: 360, height: 740 });
      await page.waitForTimeout(150);
      await page.screenshot({ path: path.join(shotsDir, `board-360-${theme}.png`), fullPage: true });
      await page.focus('#board-mount .board-col[data-col="critical"] .bcard');
      await page.keyboard.press('ArrowDown'); await page.keyboard.press('ArrowUp');
      await page.screenshot({ path: path.join(shotsDir, `board-360-${theme}-focus.png`) });
    }
    await page.evaluate(() => { App.state.settings.theme = 'dark'; App.applyTheme(); App.save(); });
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await page.evaluate(() => { App.closeModal(); App.closePanel(); App.setNow(null); App.setView('today'); window.scrollTo(0, 0); });
  await page.setViewportSize({ width: 1440, height: 900 });
};
