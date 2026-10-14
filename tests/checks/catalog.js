/* Browser checks for the class catalog picker, class symbols and the Classes
   view polish (add / symbol popover / delete). Loaded by tests/browser.js. */
'use strict';
module.exports = async ({ page, check, assert, SHOTS, shotsDir, path }) => {
  const before = await page.evaluate(() => ({
    ids: App.state.classes.map(c => c.id),
    emoji: App.state.classes.map(c => [c.id, c.emoji, c.color]),
    filters: JSON.stringify(App.state.ui.filters),
    view: App.state.ui.view,
    theme: App.state.settings.theme
  }));
  const key = name => name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const card = name => `.cp-card[data-key="${key(name)}"]`;
  const clearToasts = () => page.evaluate(() => { document.getElementById('toasts').innerHTML = ''; });
  const classByName = name => page.evaluate(n => { const c = App.state.classes.find(x => x.name === n); return c ? { id: c.id, emoji: c.emoji, color: c.color, name: c.name } : null; }, name);
  const openPicker = async () => {
    await page.evaluate(() => { App.closeModal(); App.closePanel(); App.setView('classes'); });
    await clearToasts();
    await page.waitForSelector('.view[data-view="classes"].active .cls-add-btn');
    await page.click('.cls-add-btn');
    await page.waitForSelector('.cp-modal #cp-list .cp-card');
  };
  const closePicker = async () => { await page.evaluate(() => App.closeModal()); await page.waitForSelector('.cp-modal', { state: 'detached' }); };

  await check('catalog: "Add classes" in the Classes view opens the picker on 9th grade', async () => {
    await page.evaluate(() => { delete App.state.ui.catalogGrade; const f = App.state.ui.filters; f.classes = []; f.priorities = []; f.search = ''; App.save(true); });
    await openPicker();
    assert.strictEqual((await page.textContent('.cp-modal #modal-title')).trim(), 'Add classes');
    const tabs = await page.$$eval('.cp-seg-btn', els => els.map(e => [e.textContent.trim(), e.getAttribute('aria-selected')]));
    assert.deepStrictEqual(tabs.map(t => t[0]), ['9th', '10th', '11th', '12th', 'College']);
    assert.strictEqual(tabs[0][1], 'true', '9th selected by default');
    const n9 = await page.evaluate(() => App.C.CLASS_CATALOG.find(g => g.grade === '9').courses.length);
    assert.strictEqual(await page.$$eval('#cp-list .cp-card', els => els.length), n9);
    assert.ok(await page.isVisible(card('Algebra I')));
    assert.strictEqual((await page.textContent(`${card('Algebra I')} .cp-sym`)).trim(), '➗');
    assert.strictEqual(await page.getAttribute('#cp-list', 'aria-multiselectable'), 'true');
    await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'cp-q');
    assert.ok(await page.isDisabled('.cp-add'), 'Add is disabled until something is selected');
  });

  await check('catalog: grade tabs switch (and are remembered); classes you have show "Added ✓"', async () => {
    await page.click('#cp-tab-10');
    assert.strictEqual(await page.getAttribute('#cp-tab-10', 'aria-selected'), 'true');
    /* The demo data already has Chemistry. */
    const chem = card('Chemistry');
    assert.strictEqual(await page.getAttribute(chem, 'aria-disabled'), 'true');
    assert.ok((await page.textContent(chem)).includes('Added ✓'));
    await page.$eval(chem, el => el.click()); /* Playwright waits forever on aria-disabled, so click directly */
    assert.strictEqual(await page.getAttribute(chem, 'aria-selected'), 'false', 'an added class cannot be selected');
    await page.click('#cp-tab-college');
    assert.strictEqual(await page.getAttribute('#cp-tab-college', 'aria-selected'), 'true');
    assert.ok((await page.textContent('#cp-status')).includes('College'));
    assert.ok(await page.isVisible(card('Calculus I')));
    assert.strictEqual(await page.evaluate(() => App.state.ui.catalogGrade), 'college');
    assert.strictEqual(await page.$eval('.cp-seg', el => el.style.getPropertyValue('--i').trim()), '4', 'thumb slides to College');
  });

  await check('catalog: search "chem" finds courses across grades with grade badges', async () => {
    await page.fill('#cp-q', 'chem');
    await page.waitForSelector(card('AP Chemistry'));
    const names = await page.$$eval('#cp-list .cp-card .cp-name', els => els.map(e => e.textContent.trim()));
    for (const n of ['Chemistry', 'AP Chemistry', 'Honors Chemistry', 'General Chemistry I', 'Organic Chemistry I']) assert.ok(names.includes(n), n + ' in ' + names.join(', '));
    assert.strictEqual(new Set(names).size, names.length, 'each course once');
    const badges = await page.$$eval(`${card('AP Chemistry')} .cp-grade`, els => els.map(e => e.textContent.trim()));
    assert.deepStrictEqual(badges, ['11th', '12th']);
    assert.deepStrictEqual(await page.$$eval(`${card('Organic Chemistry I')} .cp-grade`, els => els.map(e => e.textContent.trim())), ['College']);
    assert.ok((await page.textContent('#cp-status')).includes('all grades'));
    /* A query with no match offers to create it as a custom class. */
    await page.fill('#cp-q', 'Underwater basket weaving');
    await page.waitForSelector('.cp-none');
    assert.ok((await page.textContent('.cp-none')).includes('Underwater basket weaving'));
    /* Esc clears the search first and keeps the picker open. */
    await page.press('#cp-q', 'Escape');
    assert.strictEqual(await page.inputValue('#cp-q'), '');
    assert.ok(await page.isVisible('.cp-modal'), 'still open');
    assert.ok(await page.isVisible(card('Calculus I')), 'back on the College list');
  });

  await check('catalog: select 3 courses, add them; symbols, chips and "Added ✓" on reopen', async () => {
    const picks = [['Calculus I', '🧮'], ['Intro to Psychology', '🧠'], ['Organic Chemistry I', '⚗️']];
    for (const [n] of picks) {
      await page.click(card(n));
      assert.strictEqual(await page.getAttribute(card(n), 'aria-selected'), 'true', n + ' selected');
    }
    assert.strictEqual((await page.textContent('.cp-add')).trim(), 'Add 3 classes');
    assert.ok((await page.textContent('.cp-tray')).includes('3 selected'));
    /* Toggling off and on again keeps the count right. */
    await page.click(card('Calculus I'));
    assert.strictEqual((await page.textContent('.cp-add')).trim(), 'Add 2 classes');
    await page.click(card('Calculus I'));
    await page.click('.cp-add');
    await page.waitForSelector('.cp-modal', { state: 'detached' });
    for (const [n, sym] of picks) {
      const c = await classByName(n);
      assert.ok(c, n + ' created');
      assert.strictEqual(c.emoji, sym, n + ' symbol');
      assert.ok(c.color >= 1 && c.color <= 8, 'colour assigned');
      assert.ok((await page.textContent(`#filter-classes .chip[data-class="${c.id}"]`)).includes(n), n + ' chip');
      assert.ok(await page.isVisible(`.cls-card[data-class="${c.id}"]`), n + ' card');
    }
    assert.ok((await page.textContent('#toasts')).includes('Added 3 classes'));
    await clearToasts();
    await page.click('.cls-add-btn');
    await page.waitForSelector('.cp-modal #cp-list .cp-card');
    assert.strictEqual(await page.getAttribute('#cp-tab-college', 'aria-selected'), 'true', 'reopens on the last grade used');
    for (const [n] of picks) {
      assert.strictEqual(await page.getAttribute(card(n), 'aria-disabled'), 'true', n + ' disabled');
      assert.ok((await page.textContent(card(n))).includes('Added ✓'), n + ' shows Added');
    }
    await closePicker();
  });

  await check('catalog: a custom class gets the picked symbol and colour', async () => {
    await openPicker();
    assert.ok(await page.isVisible('#cp-custom'), 'custom panel visible beside the catalog on desktop');
    await page.fill('#cp-name', 'Marine Robotics Club');
    assert.strictEqual((await page.textContent('.cp-preview-sym')).trim(), '🤖', 'suggested symbol shown live');
    assert.ok((await page.textContent('.cp-suggest')).includes('🤖'));
    await page.fill('#cp-sym-q', 'guitar');
    await page.click('.cp-syms .sym-opt[data-sym="🎸"]');
    assert.strictEqual(await page.getAttribute('.cp-syms .sym-opt[data-sym="🎸"]', 'aria-selected'), 'true');
    assert.strictEqual((await page.textContent('.cp-preview-sym')).trim(), '🎸');
    await page.click('.cp-sw:has(input[value="5"])');
    await page.press('#cp-name', 'Enter');
    await page.waitForFunction(() => App.state.classes.some(c => c.name === 'Marine Robotics Club'));
    const c = await classByName('Marine Robotics Club');
    assert.strictEqual(c.emoji, '🎸'); assert.strictEqual(c.color, 5);
    assert.ok(await page.isVisible('.cp-modal'), 'picker stays open to add more');
    assert.strictEqual(await page.inputValue('#cp-name'), '', 'name cleared');
    assert.strictEqual((await page.textContent('.cp-cancel')).trim(), 'Done');
    /* Empty and duplicate names are refused. */
    await page.press('#cp-name', 'Enter');
    assert.strictEqual(await page.getAttribute('#cp-name', 'aria-invalid'), 'true');
    await page.fill('#cp-name', 'marine robotics club');
    await page.press('#cp-name', 'Enter');
    assert.strictEqual(await page.evaluate(() => App.state.classes.filter(c => c.name.toLowerCase() === 'marine robotics club').length), 1);
    await closePicker();
    assert.ok(await page.isVisible(`.cls-card[data-class="${c.id}"]`));
  });

  await check('catalog: the symbol picker on a class card changes the emoji and it persists', async () => {
    const c = await classByName('Marine Robotics Club');
    const tile = `.cls-card[data-class="${c.id}"] .cls-sym-btn`;
    await clearToasts();
    await page.click(tile);
    await page.waitForSelector('.sym-pop .sym-opt');
    assert.strictEqual(await page.getAttribute(tile, 'aria-expanded'), 'true');
    assert.strictEqual(await page.getAttribute('.sym-pop .sym-opt[data-sym="🎸"]', 'aria-selected'), 'true', 'current symbol marked');
    assert.ok(await page.$('.sym-pop .sym-opt.is-suggested[data-sym="🤖"]'), 'suggested symbol marked');
    if (SHOTS) { await page.waitForTimeout(300); await page.screenshot({ path: path.join(shotsDir, 'catalog-popover-1440-dark.png') }); }
    /* Esc closes without a change and returns focus to the tile. */
    await page.keyboard.press('Escape');
    await page.waitForSelector('.sym-pop', { state: 'detached' });
    assert.ok(await page.evaluate(() => document.activeElement.classList.contains('cls-sym-btn')));
    assert.strictEqual((await classByName('Marine Robotics Club')).emoji, '🎸');
    /* Search and Enter picks the first match. */
    await page.click(tile);
    await page.fill('.sym-pop-search input', 'orchestra');
    await page.press('.sym-pop-search input', 'Enter');
    await page.waitForSelector('.sym-pop', { state: 'detached' });
    assert.strictEqual((await classByName('Marine Robotics Club')).emoji, '🎻');
    assert.ok(await page.evaluate(() => document.activeElement.classList.contains('cls-sym-btn')), 'focus back on the tile');
    await page.waitForTimeout(250);
    await page.reload(); await page.waitForSelector('.view[data-view="classes"].active .cls-grid');
    assert.strictEqual((await classByName('Marine Robotics Club')).emoji, '🎻', 'persisted');
    assert.ok((await page.textContent(tile)).includes('🎻'));
    assert.ok((await page.textContent(`#filter-classes .chip[data-class="${c.id}"]`)).includes('🎻'));
    /* Free-text emoji fallback; arrow keys move through the grid. */
    await page.click(tile);
    await page.waitForSelector('.sym-pop .sym-opt');
    const f0 = await page.evaluate(() => document.activeElement.dataset.sym);
    await page.keyboard.press('ArrowRight');
    const f1 = await page.evaluate(() => document.activeElement.dataset.sym);
    assert.ok(f1 && f1 !== f0, 'arrow moved focus in the symbol grid');
    await page.fill('.sym-pop [name="free"]', '🦄');
    await page.press('.sym-pop [name="free"]', 'Enter');
    await page.waitForSelector('.sym-pop', { state: 'detached' });
    assert.strictEqual((await classByName('Marine Robotics Club')).emoji, '🦄');
  });

  await check('catalog: deleting a class (empty, and one with assignments that move to No class)', async () => {
    const psych = await classByName('Intro to Psychology');
    await clearToasts();
    await page.click(`.cls-card[data-class="${psych.id}"] .cls-edit-btn`);
    await page.click(`.cls-card[data-class="${psych.id}"] .cls-del-btn`);
    await page.waitForSelector('.modal [data-role="ok"]');
    assert.ok((await page.textContent('.modal')).includes('no assignments'));
    await page.click('.modal [data-role="ok"]');
    await page.waitForFunction(id => !App.getClass(id), psych.id);
    assert.ok(!(await page.$(`.cls-card[data-class="${psych.id}"]`)), 'card removed');
    assert.ok(!(await page.$(`#filter-classes .chip[data-class="${psych.id}"]`)), 'chip removed');
    assert.ok((await page.textContent('#toasts')).includes('Deleted'));
    /* With an assignment: confirm says it moves, and it lands in "No class". */
    const calc = await classByName('Calculus I');
    await page.evaluate(cid => { App.addAssignment({ title: 'Catalog check homework', classId: cid, due: null, allDay: true }); }, calc.id);
    await clearToasts();
    await page.click(`.cls-card[data-class="${calc.id}"] .cls-edit-btn`);
    await page.click(`.cls-card[data-class="${calc.id}"] .cls-del-btn`);
    await page.waitForSelector('.modal [data-role="ok"]');
    assert.ok((await page.textContent('.modal')).includes('No class'));
    assert.ok((await page.textContent('.modal [data-role="ok"]')).includes('Delete and move 1'));
    await page.click('.modal [data-role="ok"]');
    await page.waitForFunction(id => !App.getClass(id), calc.id);
    const moved = await page.evaluate(() => { const a = App.state.assignments.find(x => x.title === 'Catalog check homework'); return a && a.classId; });
    assert.strictEqual(moved, null, 'assignment moved to No class');
    /* Undo puts the class and its assignment back. */
    await page.click('#toasts .toast button:has-text("Undo")');
    assert.ok(await page.evaluate(id => !!App.getClass(id), calc.id), 'undo restores the class');
    assert.strictEqual(await page.evaluate(() => App.state.assignments.find(x => x.title === 'Catalog check homework').classId), calc.id);
    await page.evaluate(() => { App.state.assignments = App.state.assignments.filter(a => a.title !== 'Catalog check homework'); App.recomputePriorities(); App.save(true); App.render(); });
  });

  await check('catalog: keyboard only: open, Tab into the grid, arrows, Space selects, Enter adds', async () => {
    await page.evaluate(() => { App.closeModal(); App.setView('classes'); });
    await clearToasts();
    await page.focus('.cls-add-btn');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.cp-modal #cp-list .cp-card');
    await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'cp-q');
    /* Arrow keys switch grade tabs. */
    await page.focus('.cp-seg-btn[aria-selected="true"]');
    await page.keyboard.press('ArrowLeft');
    assert.strictEqual(await page.getAttribute('#cp-tab-12', 'aria-selected'), 'true');
    assert.ok(await page.evaluate(() => document.activeElement.id === 'cp-tab-12'), 'focus follows the tab');
    await page.focus('#cp-q');
    await page.keyboard.press('Tab');
    const first = await page.evaluate(() => { const el = document.activeElement; return el.classList.contains('cp-card') ? el.dataset.key : null; });
    assert.ok(first, 'Tab lands on a course card');
    await page.keyboard.press('ArrowRight');
    const next = await page.evaluate(() => document.activeElement.dataset.key);
    assert.ok(next && next !== first, 'ArrowRight moves to the next card');
    assert.strictEqual(await page.evaluate(() => document.querySelectorAll('#cp-list .cp-card[tabindex="0"]').length), 1, 'one roving tab stop');
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press(' ');
    assert.strictEqual(await page.getAttribute(`.cp-card[data-key="${first}"]`, 'aria-selected'), 'true', 'Space selects');
    assert.ok(await page.isVisible('.cp-modal'));
    const name = await page.textContent(`.cp-card[data-key="${first}"] .cp-name`);
    await page.keyboard.press('Enter');
    await page.waitForSelector('.cp-modal', { state: 'detached' });
    assert.ok(await classByName(name.trim()), 'Enter added ' + name);
    assert.ok(await page.evaluate(() => document.activeElement && document.activeElement.classList.contains('cls-add-btn')), 'focus returns to Add classes');
    /* Tab wraps inside the picker instead of escaping to the page. */
    await page.keyboard.press('Enter');
    assert.ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'cp-q'), 'focus moves into the picker at once');
    await page.waitForTimeout(80); /* past openModal's own delayed focus */
    assert.ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'cp-q'), 'and stays in the search box');
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('Tab');
      assert.ok(await page.evaluate(() => !!document.activeElement.closest('.cp-modal')), 'focus stays in the picker (step ' + i + ')');
    }
    await page.keyboard.press('Escape');
    await page.waitForSelector('.cp-modal', { state: 'detached' });
  });

  await check('catalog: hostile custom names render as text', async () => {
    await page.evaluate(() => { window.__cpXss = 0; });
    const evil = '<img src=x onerror="window.__cpXss=1">Evil "class" & co';
    await openPicker();
    await page.fill('#cp-q', '<img src=x onerror="window.__cpXss=1">');
    await page.waitForSelector('.cp-none');
    await page.click('.cp-none [data-cp="make-custom"]');
    assert.strictEqual(await page.inputValue('#cp-name'), '<img src=x onerror="window.__cpXss=1">');
    await page.fill('#cp-name', evil);
    await page.press('#cp-name', 'Enter');
    await page.waitForFunction(n => App.state.classes.some(c => c.name === n), evil);
    await closePicker();
    assert.strictEqual(await page.$$eval('#view-root img, #filter-classes img, #toasts img, #modal-root img', els => els.length), 0, 'no <img> injected');
    const c = await classByName(evil);
    assert.ok((await page.textContent(`.cls-card[data-class="${c.id}"] .cls-name`)).includes(evil));
    await page.click(`.cls-card[data-class="${c.id}"] .cls-sym-btn`);
    await page.waitForSelector('.sym-pop');
    assert.ok((await page.textContent('.sym-pop-title')).includes(evil));
    assert.strictEqual(await page.$$eval('.sym-pop img', els => els.length), 0);
    await page.keyboard.press('Escape');
    assert.strictEqual(await page.evaluate(() => window.__cpXss), 0, 'onerror never ran');
  });

  await check('catalog: 360px bottom sheet scrolls inside with no horizontal overflow; screenshots', async () => {
    for (const theme of ['dark', 'light']) {
      await page.evaluate(t => { App.state.settings.theme = t; App.applyTheme(); }, theme);
      await page.setViewportSize({ width: 1440, height: 900 });
      await openPicker();
      await page.fill('#cp-name', 'Model UN');
      await page.click(card('Statistics')).catch(() => {});
      await page.waitForTimeout(400);
      if (SHOTS) await page.screenshot({ path: path.join(shotsDir, `catalog-1440-${theme}.png`) });
      await closePicker();
      await page.setViewportSize({ width: 360, height: 740 });
      await openPicker();
      await page.waitForTimeout(400);
      const box = await page.$eval('.cp-modal', el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, bottom: r.bottom, top: r.top }; });
      assert.ok(Math.abs(box.bottom - 740) <= 1, 'sheet sits on the bottom edge: ' + JSON.stringify(box));
      assert.ok(box.left >= -0.5 && box.right <= 360.5, 'sheet fits the width');
      const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(over <= 0, 'page overflow ' + over);
      const sc = await page.$eval('.cp-scroll', el => ({ sh: el.scrollHeight, ch: el.clientHeight, sw: el.scrollWidth, cw: el.clientWidth }));
      assert.ok(sc.sh > sc.ch, 'the course list scrolls inside the sheet');
      assert.ok(sc.sw <= sc.cw, 'no sideways scroll in the list');
      const wide = await page.$$eval('.cp-modal *', els => els.filter(e => { const r = e.getBoundingClientRect(); return r.width && (r.right > 360.5 || r.left < -0.5); }).map(e => e.className).slice(0, 5));
      assert.deepStrictEqual(wide, [], 'everything inside the sheet fits');
      const foot = await page.$eval('.cp-modal .modal-foot', el => el.getBoundingClientRect().bottom);
      assert.ok(foot <= 740.5, 'footer visible');
      await page.click(`#cp-list .cp-card:not(.is-added)`);
      if (SHOTS) await page.screenshot({ path: path.join(shotsDir, `catalog-360-${theme}.png`) });
      await page.click('.cp-custom-toggle');
      assert.ok(await page.isVisible('#cp-custom') && !(await page.isVisible('.cp-catalog')), 'custom pane replaces the list on phones');
      if (SHOTS) await page.screenshot({ path: path.join(shotsDir, `catalog-360-${theme}-custom.png`) });
      await closePicker();
      /* Symbol popover becomes a bottom sheet too. */
      const c = await classByName('Marine Robotics Club');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.click(`.cls-card[data-class="${c.id}"] .cls-sym-btn`);
      await page.waitForSelector('.sym-pop.is-sheet');
      await page.waitForTimeout(350); /* let the slide-up finish */
      const pb = await page.$eval('.sym-pop', el => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, bottom: r.bottom }; });
      assert.ok(pb.left >= -0.5 && pb.right <= 360.5 && Math.abs(pb.bottom - 740) <= 1, 'popover sheet ' + JSON.stringify(pb));
      if (SHOTS) await page.screenshot({ path: path.join(shotsDir, `catalog-360-${theme}-symbols.png`) });
      await page.keyboard.press('Escape');
      if (SHOTS) {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.evaluate(() => window.scrollTo(0, 0));
        await page.waitForTimeout(150);
        await page.screenshot({ path: path.join(shotsDir, `catalog-classes-1440-${theme}.png`) });
      }
    }
    /* First-run empty state invites the catalog. */
    const backup = await page.evaluate(() => JSON.stringify({ c: App.state.classes, a: App.state.assignments }));
    await page.evaluate(() => { App.state.classes = []; App.state.assignments = []; App.render(); });
    await page.waitForSelector('.cls-empty-start');
    assert.ok((await page.textContent('.cls-empty-start')).includes('Pick your classes from the catalog'));
    assert.ok(await page.isVisible('.cls-empty-start [data-action="open-class-picker"]'));
    assert.ok(await page.isVisible('.cls-empty-start [data-action="open-import"]'));
    if (SHOTS) await page.screenshot({ path: path.join(shotsDir, 'catalog-empty-1440-light.png') });
    await page.click('.cls-empty-start [data-action="open-class-picker"]');
    await page.waitForSelector('.cp-modal');
    await closePicker();
    await page.evaluate(b => { const x = JSON.parse(b); App.state.classes = x.c; App.state.assignments = x.a; App.recomputePriorities(); App.save(true); App.render(); }, backup);
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await check('catalog: ensureClass and the edit dialog give new classes a suggested symbol', async () => {
    const c = await page.evaluate(() => { const c = App.ensureClass('AP Spanish Literature'); return { id: c.id, emoji: c.emoji }; });
    assert.strictEqual(c.emoji, '🇪🇸');
    await page.evaluate(() => App.openEditModal());
    await page.fill('#ed-title', 'Catalog edit-dialog check');
    await page.selectOption('#ed-class', '__new');
    await page.fill('#ed-class-new', 'Honors Physics 2');
    await page.click('.modal [data-role="save"]');
    await page.waitForFunction(() => App.state.classes.some(c => c.name === 'Honors Physics 2'));
    assert.strictEqual((await classByName('Honors Physics 2')).emoji, '⚛️');
    await page.evaluate(() => { App.state.assignments = App.state.assignments.filter(a => a.title !== 'Catalog edit-dialog check'); App.save(true); });
  });

  await check('catalog: clean up (only the original classes remain)', async () => {
    await page.evaluate(b => {
      App.closeModal(); App.closePanel();
      const keep = new Set(b.ids);
      const gone = new Set(App.state.classes.filter(c => !keep.has(c.id)).map(c => c.id));
      for (const a of App.state.assignments) if (gone.has(a.classId)) a.classId = null;
      App.state.classes = App.state.classes.filter(c => keep.has(c.id));
      for (const [id, emoji, color] of b.emoji) { const c = App.getClass(id); if (c) { c.emoji = emoji; c.color = color; } }
      App.state.ui.filters = JSON.parse(b.filters);
      delete App.state.ui.catalogGrade;
      App.state.settings.theme = b.theme; App.applyTheme();
      document.getElementById('toasts').innerHTML = '';
      App.setNow(null);
      App.recomputePriorities(); App.save(true); App.setView(b.view);
    }, before);
    await page.setViewportSize({ width: 1440, height: 900 });
    const ids = await page.evaluate(() => App.state.classes.map(c => c.id));
    assert.deepStrictEqual(ids, before.ids);
    assert.ok(!(await page.$('.sym-pop')) && !(await page.$('.cp-modal')));
  });
};
