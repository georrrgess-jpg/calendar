/* Browser checks for the By class view (spec 3.5). Loaded by tests/browser.js. */
'use strict';
module.exports = async ({ page, check, assert, SHOTS, shotsDir, path }) => {
  const openView = async () => {
    await page.evaluate(() => { App.closeModal(); App.closePanel(); App.setView('classes'); });
    await page.waitForSelector('.view[data-view="classes"].active .cls-grid');
  };
  /* Mirrors the view's own definition so the test checks behaviour, not code. */
  const expected = () => page.evaluate(() => {
    const s = App.state, n = App.now(), C = App.C;
    const termStart = n.getMonth() >= 7 ? new Date(n.getFullYear(), 7, 1) : new Date(n.getFullYear(), 0, 1);
    const visibleClasses = s.classes.filter(c => !c.hidden);
    const live = s.assignments.filter(a => !a.archived && !(App.getClass(a.classId) && App.getClass(a.classId).hidden));
    const unclassed = live.filter(a => !App.getClass(a.classId));
    const ring = id => {
      const items = live.filter(a => (id === '__none' ? !App.getClass(a.classId) : a.classId === id)).filter(a => { const d = C.parseISO(a.due); return !d || d >= termStart; });
      return { done: items.filter(a => a.done).length, total: items.length };
    };
    const rings = {};
    for (const c of visibleClasses) rings[c.id] = ring(c.id);
    if (unclassed.length) rings.__none = ring('__none');
    return { cards: visibleClasses.length + (unclassed.length ? 1 : 0), rings, ids: visibleClasses.map(c => c.id) };
  });

  await check('classes: one card per visible class (plus "No class" when needed)', async () => {
    await page.evaluate(() => { const f = App.state.ui.filters; f.classes = []; f.priorities = []; f.search = ''; App.save(true); });
    await openView();
    const exp = await expected();
    const keys = await page.$$eval('.cls-card', els => els.map(e => e.dataset.class));
    assert.strictEqual(keys.length, exp.cards, 'cards: ' + keys.join(','));
    for (const id of exp.ids) assert.ok(keys.includes(id), 'card for ' + id);
    assert.strictEqual(new Set(keys).size, keys.length, 'no duplicate cards');
    /* Ordering: classes with overdue items come first, then by open count. */
    const order = await page.evaluate(() => Array.from(document.querySelectorAll('.cls-card')).map(card => ({
      overdue: Number(card.querySelector('.cls-stat:nth-child(2) dd').textContent), open: Number(card.querySelector('.cls-stat:nth-child(1) dd').textContent)
    })));
    for (let i = 1; i < order.length; i++) {
      const a = order[i - 1], b = order[i];
      assert.ok((a.overdue > 0) > (b.overdue > 0) || ((a.overdue > 0) === (b.overdue > 0) && a.open >= b.open), 'sorted: ' + JSON.stringify(order));
    }
  });

  await check('classes: progress ring numbers match state (and the term boundary)', async () => {
    const verify = async () => {
      const exp = await expected();
      for (const [id, r] of Object.entries(exp.rings)) {
        const got = await page.$eval(`.cls-card[data-class="${id}"] .cls-ring`, el => ({ label: el.getAttribute('aria-label'), role: el.getAttribute('role'), frac: el.querySelector('.cls-ring-frac').textContent.trim() }));
        assert.strictEqual(got.role, 'img');
        assert.strictEqual(got.frac, r.done + '/' + r.total, id + ' ring text');
        if (r.total) assert.strictEqual(got.label, `${r.done} of ${r.total} done this term, ${Math.round(r.done / r.total * 100)}%`);
      }
      return exp;
    };
    const exp = await verify();
    assert.ok(Object.values(exp.rings).some(r => r.done > 0), 'some class has completed work');
    /* In February the term starts Jan 1, so autumn items drop out of the ring. */
    await page.evaluate(() => App.setNow(new Date(new Date().getFullYear() + 1, 1, 10, 12, 0)));
    await openView();
    await verify();
    await page.evaluate(() => App.setNow(null));
    await openView();
  });

  await check('classes: open items list collapses to 5 and "Show all" expands', async () => {
    const cid = await page.evaluate(() => App.state.classes.find(c => !c.hidden).id);
    await page.evaluate(cid => {
      const base = Date.now() + 2 * 86400000;
      for (let i = 0; i < 7; i++) App.state.assignments.push({ id: 'clstest_' + i, source: 'manual', title: 'Class view filler ' + i, classId: cid, due: new Date(base + i * 3600000).toISOString(), allDay: false, notes: '', sourceNotes: '', url: '', priority: 'low', priorityAuto: true, estimatedMin: 10, done: false, doneAt: null, archived: false, pomodoros: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      App.recomputePriorities(); App.save(true); App.render();
    }, cid);
    const card = `.cls-card[data-class="${cid}"]`;
    const total = await page.evaluate(cid => App.allOpen().filter(a => a.classId === cid).length, cid);
    assert.strictEqual(await page.$$eval(`${card} .cls-items .item`, els => els.length), 5);
    const btn = page.locator(`${card} .cls-more`);
    assert.strictEqual((await btn.textContent()).trim(), 'Show all ' + total);
    assert.strictEqual(await btn.getAttribute('aria-expanded'), 'false');
    await btn.focus(); await page.keyboard.press('Enter');
    assert.strictEqual(await page.$$eval(`${card} .cls-items .item`, els => els.length), total);
    assert.strictEqual(await page.getAttribute(`${card} .cls-more`, 'aria-expanded'), 'true');
    assert.ok(await page.evaluate(() => document.activeElement.classList.contains('cls-more')), 'focus stays on the toggle');
    /* Overdue first, then by due date. */
    const dues = await page.$$eval(`${card} .cls-items .item`, els => els.map(e => e.dataset.id));
    const ok = await page.evaluate(ids => {
      const list = ids.map(id => App.byId(id)); const t = a => a.due ? new Date(a.due).getTime() : Infinity;
      let seenNonOver = false;
      for (let i = 0; i < list.length; i++) {
        const o = App.isOverdue(list[i]); if (!o) seenNonOver = true; else if (seenNonOver) return false;
        if (i && App.isOverdue(list[i - 1]) === o && t(list[i - 1]) > t(list[i])) return false;
      }
      return true;
    }, dues);
    assert.ok(ok, 'items sorted overdue-first then by due');
    /* Expansion survives a re-render (kept in memory). */
    await page.evaluate(() => App.render());
    assert.strictEqual(await page.$$eval(`${card} .cls-items .item`, els => els.length), total);
    await page.click(`${card} .cls-more`);
    assert.strictEqual(await page.$$eval(`${card} .cls-items .item`, els => els.length), 5);
    await page.evaluate(() => { App.state.assignments = App.state.assignments.filter(a => !a.id.startsWith('clstest_')); App.recomputePriorities(); App.save(true); App.render(); });
  });

  await check('classes: clicking a swatch recolours the class everywhere and persists', async () => {
    await openView();
    const c0 = await page.evaluate(() => { const c = App.state.classes.find(c => !c.hidden); return { id: c.id, color: c.color }; });
    const target = c0.color === 6 ? 2 : 6;
    const card = `.cls-card[data-class="${c0.id}"]`;
    await page.click(`${card} .cls-sw:has(input[value="${target}"])`);
    assert.strictEqual(await page.evaluate(id => App.getClass(id).color, c0.id), target);
    assert.ok(await page.isChecked(`${card} .cls-sw input[value="${target}"]`));
    const cardC = await page.$eval(card, el => el.style.getPropertyValue('--c'));
    assert.ok(cardC.includes('--class-' + target), 'card accent: ' + cardC);
    await page.waitForTimeout(250);
    await page.reload(); await page.waitForSelector('.view[data-view="classes"].active .cls-grid');
    assert.strictEqual(await page.evaluate(id => App.getClass(id).color, c0.id), target, 'colour persisted');
    assert.ok(await page.isChecked(`${card} .cls-sw input[value="${target}"]`));
    const chipC = await page.$eval(`#filter-classes .chip[data-class="${c0.id}"]`, el => el.style.getPropertyValue('--c'));
    assert.ok(chipC.includes('--class-' + target), 'filter chip colour: ' + chipC);
    const itemId = await page.evaluate(id => (App.allOpen().find(a => a.classId === id) || {}).id, c0.id);
    if (itemId) {
      await page.evaluate(() => App.setView('today'));
      const rowC = await page.$eval(`.item[data-id="${itemId}"]`, el => el.style.getPropertyValue('--c')).catch(() => null);
      if (rowC !== null) assert.ok(rowC.includes('--class-' + target), 'item row colour: ' + rowC);
      await openView();
    }
    /* Keyboard: arrow keys move through the radio group and keep focus. */
    await page.focus(`${card} .cls-sw input[value="${target}"]`);
    await page.keyboard.press('ArrowRight');
    const after = await page.evaluate(id => App.getClass(id).color, c0.id);
    assert.strictEqual(after, target === 8 ? 1 : target + 1);
    assert.ok(await page.evaluate(id => { const el = document.activeElement; return el && el.dataset.class === id && el.checked; }, c0.id), 'focus kept on the checked swatch');
    await page.evaluate(c => { App.getClass(c.id).color = c.color; App.save(true); App.render(); }, c0);
  });

  await check('classes: inline rename and emoji persist after reload; Esc cancels', async () => {
    await openView();
    const c0 = await page.evaluate(() => { const c = App.state.classes.find(c => !c.hidden); return { id: c.id, name: c.name, emoji: c.emoji || '' }; });
    const card = `.cls-card[data-class="${c0.id}"]`;
    await page.click(`${card} .cls-edit-btn`);
    await page.waitForSelector(`${card} form.cls-edit`);
    assert.strictEqual(await page.evaluate(() => document.activeElement.name), 'name', 'name input focused');
    await page.keyboard.press('Escape');
    assert.ok(!(await page.$(`${card} form.cls-edit`)), 'Esc closes the editor');
    assert.ok(await page.evaluate(() => document.activeElement.classList.contains('cls-edit-btn')), 'focus back on edit button');
    await page.click(`${card} .cls-edit-btn`);
    await page.fill(`${card} input[name="emoji"]`, '🧪');
    await page.fill(`${card} input[name="name"]`, 'Renamed <b>Class</b>');
    await page.evaluate(() => App.render()); /* drafts survive a re-render */
    assert.strictEqual(await page.inputValue(`${card} input[name="name"]`), 'Renamed <b>Class</b>');
    await page.press(`${card} input[name="name"]`, 'Enter');
    await page.waitForSelector(`${card} .cls-name`);
    assert.strictEqual((await page.textContent(`${card} .cls-name`)).trim(), 'Renamed <b>Class</b>', 'escaped, not rendered as HTML');
    await page.waitForTimeout(250);
    await page.reload(); await page.waitForSelector('.view[data-view="classes"].active .cls-grid');
    const s = await page.evaluate(id => App.getClass(id), c0.id);
    assert.strictEqual(s.name, 'Renamed <b>Class</b>'); assert.strictEqual(s.emoji, '🧪');
    assert.ok((await page.textContent(`#filter-classes .chip[data-class="${c0.id}"]`)).includes('Renamed <b>Class</b>'));
    await page.evaluate(c => { const x = App.getClass(c.id); x.name = c.name; x.emoji = c.emoji; App.save(true); App.render(); }, c0);
  });

  await check('classes: "Filter to this class" sets the filter and switches to Next Up', async () => {
    await openView();
    const cid = await page.evaluate(() => App.state.classes.find(c => !c.hidden).id);
    await page.click(`.cls-card[data-class="${cid}"] [data-action="classes-filter"]`);
    await page.waitForSelector('.view[data-view="today"].active');
    const st = await page.evaluate(() => ({ f: App.state.ui.filters.classes, v: App.state.ui.view }));
    assert.deepStrictEqual(st.f, [cid]); assert.strictEqual(st.v, 'today');
    assert.strictEqual(await page.getAttribute(`#filter-classes .chip[data-class="${cid}"]`, 'aria-pressed'), 'true');
    /* The classes view respects the active filter (plus classes with overdue work). */
    await openView();
    const keys = await page.$$eval('.cls-card', els => els.map(e => e.dataset.class));
    assert.ok(keys.includes(cid));
    const others = await page.evaluate(keys => keys.filter(k => k !== App.state.ui.filters.classes[0]).every(k => App.state.assignments.some(a => (k === '__none' ? !App.getClass(a.classId) : a.classId === k) && App.isOverdue(a))), keys);
    assert.ok(others, 'other cards only for classes with overdue items: ' + keys.join(','));
    await page.evaluate(() => { App.state.ui.filters.classes = []; App.save(true); App.render(); });
  });

  await check('classes: hostile class names and titles render as text', async () => {
    await page.evaluate(() => { window.__clsXss = 0; });
    const evil = '<img src=x onerror="window.__clsXss=1">';
    await page.evaluate(evil => {
      App.state.classes.push({ id: 'c_xss "q\' <x>', name: evil + ' Class', sourceName: evil, color: 99, emoji: '<b>e</b>', hidden: false });
      App.state.assignments.push({ id: 'clsxss_1', source: 'manual', title: evil, classId: 'c_xss "q\' <x>', due: new Date(Date.now() + 86400000).toISOString(), allDay: false, notes: evil, sourceNotes: '', url: '', priority: 'high', priorityAuto: false, estimatedMin: 20, done: false, doneAt: null, archived: false, pomodoros: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      App.recomputePriorities(); App.save(true);
    }, evil);
    await openView();
    const card = '.cls-card[data-class="c_xss \\"q\' <x>"]';
    assert.ok(await page.$(card), 'card for the odd class id');
    assert.strictEqual(await page.$$eval('.view[data-view="classes"] img', els => els.length), 0, 'no <img> injected');
    assert.ok((await page.textContent(`${card} .cls-name`)).includes(evil), 'name shown as text');
    assert.ok((await page.textContent(`${card} .item-title`)).includes(evil), 'title shown as text');
    /* Out-of-range colour maps to the same swatch classColorVar shows (99 -> 3), and the heading id resolves. */
    assert.ok((await page.$eval(card, el => el.style.getPropertyValue('--c'))).includes('--class-3'));
    assert.ok(await page.isChecked(`${card} .cls-sw input[value="3"]`), 'colour 99 shows swatch 3 checked');
    assert.ok(await page.$eval(card, el => !!document.getElementById(el.getAttribute('aria-labelledby'))), 'aria-labelledby resolves');
    /* Rename editor with hostile values. */
    await page.click(`${card} .cls-edit-btn`);
    assert.strictEqual(await page.inputValue(`${card} input[name="name"]`), evil + ' Class');
    assert.strictEqual(await page.$$eval('.view[data-view="classes"] img', els => els.length), 0);
    await page.keyboard.press('Escape');
    await page.click(`${card} [data-action="classes-filter"]`);
    await page.waitForSelector('.view[data-view="today"].active');
    await page.waitForTimeout(50);
    assert.strictEqual(await page.$$eval('#toasts img, #filter-classes img', els => els.length), 0, 'no <img> in toast or chips');
    assert.strictEqual(await page.evaluate(() => window.__clsXss), 0, 'onerror never ran');
    await page.evaluate(() => {
      App.state.ui.filters.classes = [];
      App.state.assignments = App.state.assignments.filter(a => a.id !== 'clsxss_1');
      App.state.classes = App.state.classes.filter(c => !c.id.startsWith('c_xss'));
      document.getElementById('toasts').innerHTML = '';
      App.recomputePriorities(); App.save(true); App.render();
    });
  });

  await check('classes: background re-render keeps focus and caret in the rename field', async () => {
    await openView();
    const cid = await page.evaluate(() => App.state.classes.find(c => !c.hidden).id);
    const card = `.cls-card[data-class="${cid}"]`;
    await page.click(`${card} .cls-edit-btn`);
    await page.fill(`${card} input[name="name"]`, 'Half typed');
    await page.evaluate(() => { const el = document.activeElement; el.setSelectionRange(4, 4); App.render(); });
    const st = await page.evaluate(() => ({ name: document.activeElement.name, pos: document.activeElement.selectionStart, val: document.activeElement.value }));
    assert.deepStrictEqual(st, { name: 'name', pos: 4, val: 'Half typed' });
    await page.keyboard.press('Escape');
    /* Focus on a "Filter to this class" button survives a re-render too. */
    await page.focus(`${card} [data-action="classes-filter"]`);
    await page.evaluate(() => App.render());
    assert.ok(await page.evaluate(id => { const el = document.activeElement; return el.dataset.action === 'classes-filter' && el.dataset.class === id; }, cid), 'focus kept on the filter button');
    /* Its accessible name contains the visible label (WCAG 2.5.3). */
    const nm = await page.$eval(`${card} [data-action="classes-filter"]`, el => el.textContent.replace(/\s+/g, ' ').trim());
    assert.ok(nm.startsWith('Filter to this class'), nm);
    assert.ok(!(await page.getAttribute(`${card} [data-action="classes-filter"]`, 'aria-label')), 'no aria-label overriding the visible text');
  });

  await check('classes: empty states (no classes; filter that matches nothing)', async () => {
    const backup = await page.evaluate(() => JSON.stringify({ c: App.state.classes, a: App.state.assignments, f: App.state.ui.filters }));
    await page.evaluate(() => { App.state.classes = []; App.state.assignments = []; App.state.ui.filters.classes = []; App.render(); App.setView('classes'); });
    await page.waitForSelector('.view[data-view="classes"].active .cls-empty');
    assert.ok((await page.textContent('.cls-empty')).includes('No classes yet'));
    assert.ok(await page.isVisible('.cls-empty [data-action="open-import"]'));
    await page.evaluate(b => { const x = JSON.parse(b); App.state.classes = x.c; App.state.assignments = x.a; App.state.ui.filters.classes = ['c_does_not_exist']; App.render(); }, backup);
    await page.waitForSelector('.view[data-view="classes"].active');
    const overdueClasses = await page.evaluate(() => App.state.classes.filter(c => !c.hidden && App.state.assignments.some(a => a.classId === c.id && App.isOverdue(a))).length);
    if (!overdueClasses) {
      assert.ok((await page.textContent('.cls-empty')).includes('No classes match'));
      await page.click('.cls-empty [data-action="clear-filters"]');
    } else {
      /* Overdue work stays visible even when the filter excludes its class. */
      assert.strictEqual(await page.$$eval('.cls-card', els => els.length), overdueClasses + (await page.evaluate(() => App.state.assignments.some(a => !App.getClass(a.classId) && App.isOverdue(a)) ? 1 : 0)));
      await page.click('.cls-head-note [data-action="clear-filters"]');
    }
    assert.deepStrictEqual(await page.evaluate(() => App.state.ui.filters.classes), []);
    await page.evaluate(b => { const x = JSON.parse(b); App.state.ui.filters = x.f; App.save(true); App.render(); }, backup);
  });

  await check('classes: screenshots and no horizontal overflow at 360px', async () => {
    await page.evaluate(() => { document.getElementById('toasts').innerHTML = ''; });
    await openView();
    for (const theme of ['dark', 'light']) {
      await page.evaluate(t => { App.state.settings.theme = t; App.applyTheme(); }, theme);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.evaluate(() => window.scrollTo(0, 0)); /* a sticky topbar mid-page in a full-page shot is only a scroll artifact */
      await page.waitForTimeout(100);
      if (SHOTS) await page.screenshot({ path: path.join(shotsDir, `classes-1440-${theme}.png`), fullPage: true });
      await page.setViewportSize({ width: 360, height: 740 });
      await page.waitForTimeout(150);
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(over <= 0, 'horizontal overflow at 360px: ' + over + 'px');
      const wide = await page.$$eval('.cls-card', els => els.filter(e => e.getBoundingClientRect().right > window.innerWidth + 0.5).length);
      assert.strictEqual(wide, 0, 'cards fit the viewport');
      const cols = await page.$eval('.cls-grid', el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
      assert.strictEqual(cols, 1, 'single column at 360px');
      if (SHOTS) {
        await page.screenshot({ path: path.join(shotsDir, `classes-360-${theme}.png`), fullPage: true });
        await page.evaluate(() => window.scrollTo(0, document.querySelector('.cls-grid').getBoundingClientRect().top + window.scrollY - 70));
        await page.screenshot({ path: path.join(shotsDir, `classes-360-${theme}-card.png`) });
        await page.evaluate(() => window.scrollTo(0, 0));
      }
    }
    await page.evaluate(() => { App.state.settings.theme = 'dark'; App.applyTheme(); App.save(true); });
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => { App.closeModal(); App.closePanel(); App.setView('today'); });
  });

  await check('classes: a long unbroken calendar name does not widen the page at 360px', async () => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.evaluate(() => {
      const nm = 'AP_Biology_Period_3_Ms_Henderson_Fall_2026_Section_B';
      App.state.classes.push({ id: 'c_clslong', name: nm, sourceName: nm, color: 2, emoji: '', hidden: false });
      App.state.assignments.push({ id: 'clslong_1', source: 'manual', title: 'Supercalifragilisticexpialidocious_title_without_any_spaces_at_all', classId: 'c_clslong', due: new Date(Date.now() + 86400000).toISOString(), allDay: false, notes: '', sourceNotes: '', url: '', priority: 'high', priorityAuto: false, estimatedMin: 20, done: false, doneAt: null, archived: false, pomodoros: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      App.recomputePriorities(); App.render(); App.setView('classes');
    });
    await page.waitForSelector('.cls-card[data-class="c_clslong"]');
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 0, 'horizontal overflow at 360px: ' + over + 'px');
    await page.evaluate(() => {
      App.state.classes = App.state.classes.filter(c => c.id !== 'c_clslong');
      App.state.assignments = App.state.assignments.filter(a => a.id !== 'clslong_1');
      App.recomputePriorities(); App.save(true); App.setView('today');
    });
    await page.setViewportSize({ width: 1440, height: 900 });
  });
};
