/* Create assignment, smart prompt, progress meters and the read-only detail view. Loaded by tests/browser.js after its own checks. */
'use strict';
module.exports = async ({ page, check, assert, SHOTS, shotsDir, path }) => {
  // Wednesday Oct 14 2026, 10:00 local (the browser context runs in America/New_York).
  const NOW = 'new Date(2026, 9, 14, 10, 0, 0)';
  const PROMPT = 'Unit 1 test psych Est time 15 min due on the 10th';
  const shot = async name => {
    if (!SHOTS) return;
    await page.waitForTimeout(450); // let entrance animations settle
    await page.evaluate(() => { const c = document.getElementById('confetti-canvas'); if (c) c.classList.remove('is-on'); document.querySelectorAll('.toast').forEach(t => t.remove()); });
    await page.screenshot({ path: path.join(shotsDir, name) });
  };
  const theme = t => page.evaluate(t => { App.state.settings.theme = t; App.applyTheme(); }, t);
  const created = [];
  const saved = await page.evaluate(nowExpr => {
    const s = { theme: App.state.settings.theme, view: App.state.ui.view, hideDone: App.state.ui.filters.hideDone, classes: App.state.classes.map(c => c.id) };
    App.setNow(eval(nowExpr));
    App.state.ui.filters = { classes: [], priorities: [], hideDone: true, search: '' };
    App.state.settings.theme = 'dark'; App.applyTheme();
    App.setView('today');
    return s;
  }, NOW);
  const psychId = await page.evaluate(() => App.ensureClass('AP Psychology').id);
  await page.evaluate(() => App.render());

  await check('assign: the top bar has a Create assignment button that opens the dialog', async () => {
    assert.ok(await page.isVisible('#btn-create'), 'Create button visible');
    assert.ok((await page.textContent('#btn-create')).includes('Create'), 'labelled Create');
    await page.click('#btn-create');
    await page.waitForSelector('#modal-root .ca-modal #ca-prompt');
    assert.strictEqual((await page.textContent('#modal-root #modal-title')).trim(), 'Create assignment');
    await page.waitForFunction(() => document.activeElement && document.activeElement.id === 'ca-prompt');
    assert.ok(await page.isVisible('#ca-understood .ca-example'), 'example prompts offered while empty');
    await shot('assign-create-empty-1440.png');
    await page.keyboard.press('Escape');
    assert.ok(!(await page.$('#modal-root .modal')), 'Esc closes');
    // C opens it from the keyboard too.
    await page.keyboard.press('c');
    await page.waitForSelector('#modal-root .ca-modal');
    await page.keyboard.press('Escape');
  });

  let newId = null;
  await check('assign: typing the example prompt fills every field, then Create makes the assignment', async () => {
    await page.click('#btn-create');
    await page.waitForSelector('#ca-prompt');
    await page.type('#ca-prompt', PROMPT, { delay: 4 });
    const f = await page.evaluate(() => {
      const v = s => document.querySelector(s);
      return {
        title: v('#ca-title').value, cls: v('#ca-class').value, date: v('#ca-date').value, time: v('#ca-time').value, timeDisabled: v('#ca-time').disabled,
        allDay: v('#ca-allday').checked, est: v('#ca-est').value, progress: v('#ca-progress').value,
        pri: (document.querySelector('.ca-seg-btn[aria-checked="true"]') || {}).dataset.pri,
        chips: Array.from(document.querySelectorAll('#ca-understood .ca-tok')).map(c => c.textContent.trim()),
        filled: document.querySelectorAll('.ca-field.is-filled').length
      };
    });
    assert.strictEqual(f.title, 'Unit 1 test');
    assert.strictEqual(f.cls, psychId, 'class matched from "psych"');
    assert.strictEqual(f.date, '2026-11-10', 'the coming 10th');
    assert.strictEqual(f.allDay, true, 'end of day');
    assert.strictEqual(f.time, '');
    assert.strictEqual(f.timeDisabled, true);
    assert.strictEqual(f.est, '15');
    assert.strictEqual(f.pri, 'auto');
    assert.strictEqual(f.progress, '0');
    assert.ok(f.filled >= 1, 'filled fields are highlighted');
    assert.ok(f.chips.some(c => c.includes('AP Psychology')) && f.chips.some(c => c.includes('15m')), JSON.stringify(f.chips));
    await shot('assign-create-filled-1440.png');
    await theme('light'); await shot('assign-create-filled-light-1440.png'); await theme('dark');
    // Fields stay editable after parsing, and the prompt no longer overwrites a field the student changed.
    await page.fill('#ca-est', '20');
    await page.type('#ca-prompt', ' ');
    assert.strictEqual(await page.inputValue('#ca-est'), '20', 'a field the student changed is kept');
    await page.fill('#ca-est', '15');
    await page.press('#ca-prompt', 'Enter');
    await page.waitForFunction(() => !document.querySelector('#modal-root .modal'));
    const a = await page.evaluate(() => { const a = App.state.assignments.find(x => x.title === 'Unit 1 test'); return a && { id: a.id, classId: a.classId, due: a.due, allDay: a.allDay, est: a.estimatedMin, auto: a.priorityAuto, progress: a.progress, source: a.source }; });
    assert.ok(a, 'assignment stored');
    newId = a.id; created.push(a.id);
    assert.strictEqual(a.classId, psychId);
    assert.strictEqual(a.est, 15);
    assert.strictEqual(a.allDay, true);
    assert.strictEqual(a.auto, true);
    assert.strictEqual(a.progress, 0);
    assert.strictEqual(a.source, 'manual');
    const due = await page.evaluate(iso => { const d = new Date(iso); return [d.getFullYear(), d.getMonth() + 1, d.getDate(), d.getHours(), d.getMinutes()]; }, a.due);
    assert.deepStrictEqual(due, [2026, 11, 10, 23, 59]);
    const toast = await page.textContent('.toast:last-child');
    assert.ok(/Created: Unit 1 test/.test(toast) && /View/.test(toast), toast);
    // "View" opens the read-only detail.
    await page.click('.toast:last-child button:has-text("View")');
    await page.waitForSelector('#modal-root .ad-modal');
    assert.strictEqual((await page.textContent('#modal-root #modal-title')).trim(), 'Unit 1 test');
    await page.keyboard.press('Escape');
  });

  await check('assign: Create needs a title; Enter with no title does not add anything', async () => {
    const before = await page.evaluate(() => App.state.assignments.length);
    await page.click('#btn-create');
    await page.waitForSelector('#ca-prompt');
    await page.type('#ca-prompt', 'due friday 30m');
    await page.press('#ca-prompt', 'Enter');
    assert.ok(await page.$('#modal-root .ca-modal'), 'dialog stays open');
    assert.ok(await page.$('.ca-field[data-f="title"].is-error'), 'title flagged');
    assert.strictEqual(await page.evaluate(() => App.state.assignments.length), before);
    // Priority segmented control works with the keyboard.
    await page.focus('.ca-seg-btn[aria-checked="true"]');
    await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight'); await page.keyboard.press('ArrowRight');
    assert.strictEqual(await page.$eval('.ca-seg-btn[aria-checked="true"]', b => b.dataset.pri), 'high');
    await page.keyboard.press('Escape');
  });

  const meterSel = `.view.active [data-action="progress"][data-pm-id="${'ID'}"]`;
  await check('assign: the progress popover sets 60%, which persists after reload and shows on Next Up, Board and Week', async () => {
    await page.evaluate(() => App.setView('today'));
    const sel = meterSel.replace('ID', newId);
    await page.waitForSelector(sel);
    await page.locator(sel).first().scrollIntoViewIfNeeded();
    await page.click(sel);
    await page.waitForSelector('.pm-pop .pm-range');
    assert.ok(!(await page.$('#modal-root .modal')), 'the row did not open its detail');
    await page.waitForFunction(() => document.activeElement && document.activeElement.classList.contains('pm-range'));
    await page.click('.pm-pop .pm-chip[data-p="50"]');
    assert.strictEqual(await page.evaluate(id => App.byId(id).progress, newId), 50);
    await page.focus('.pm-pop .pm-range');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    assert.strictEqual(await page.evaluate(id => App.byId(id).progress, newId), 60, 'arrows change by 5');
    assert.strictEqual((await page.textContent('.pm-pop .pm-pop-val')).trim(), '60%');
    await shot('assign-progress-pop-1440.png');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => !document.querySelector('.pm-pop:not(.is-closing)'));
    assert.ok(!(await page.$('#modal-root .modal')), 'Enter closed only the popover');
    await page.waitForTimeout(150);
    await page.reload(); await page.waitForSelector('#view-root');
    await page.evaluate(nowExpr => App.setNow(eval(nowExpr)), NOW);
    assert.strictEqual(await page.evaluate(id => App.byId(id).progress, newId), 60, 'persisted');
    await page.evaluate(() => App.setView('today'));
    await page.waitForSelector(sel);
    assert.strictEqual((await page.textContent(`${sel} .pm-pct`)).trim(), '60%', 'Next Up row');
    await page.evaluate(() => App.setView('board'));
    const bsel = `#board-mount .bcard[data-id="${newId}"] .pm`;
    await page.waitForSelector(bsel);
    assert.strictEqual((await page.textContent(`${bsel} .pm-pct`)).trim(), '60%', 'Board card');
    await page.evaluate(() => { App.state.ui.weekCursor = '2026-11-10'; App.setView('week'); });
    const wsel = `.view[data-view="week"] [data-id="${newId}"] [data-pm-id="${newId}"] .pm-fill`;
    await page.waitForSelector(wsel);
    await page.waitForFunction(s => document.querySelector(s).style.width === '60%', wsel);
    assert.ok((await page.getAttribute(`.view[data-view="week"] [data-id="${newId}"]`, 'title')).includes('60% done'), 'Week pill says 60%');
    await page.evaluate(() => { App.state.ui.weekCursor = null; App.setView('today'); });
  });

  await check('assign: the hero card has an editable progress meter and a title that opens the detail', async () => {
    const heroId = await page.$eval('.hero[data-id]', el => el.dataset.id);
    assert.ok(await page.$(`.hero [data-action="progress"][data-pm-id="${heroId}"]`), 'hero meter');
    await page.click('.hero .hero-title-btn');
    await page.waitForSelector('#modal-root .ad-modal');
    assert.strictEqual(await page.$eval('#modal-root .ad-modal', m => m.dataset.id), heroId);
    await page.keyboard.press('Escape');
    // The hero keeps an explicit Edit button.
    await page.click('.hero [data-action="edit"]');
    await page.waitForSelector('#modal-root #ed-title');
    await page.keyboard.press('Escape');
  });

  await check('assign: reaching 100% offers "Mark as done?"', async () => {
    const sel = meterSel.replace('ID', newId);
    await page.click(sel);
    await page.waitForSelector('.pm-pop');
    await page.click('.pm-pop .pm-chip[data-p="100"]');
    await page.waitForSelector('.toast button:has-text("Mark done")');
    assert.ok((await page.textContent('.toast:last-child')).includes('Mark it as done?'));
    await page.click('.toast:last-child button:has-text("Mark done")');
    await page.waitForFunction(id => App.byId(id).done, newId);
    assert.ok(!(await page.$('.pm-pop:not(.is-closing)')), 'popover closed');
    assert.strictEqual(await page.evaluate(id => App.progressOf(App.byId(id)), newId), 100, 'a done item shows 100%');
    await page.evaluate(id => App.uncompleteAssignment(id), newId);
    await page.evaluate(id => App.setProgress(id, 60), newId);
  });

  await check('assign: clicking a title opens a read-only detail with no inputs; Edit opens the form', async () => {
    await page.evaluate(id => { App.updateAssignment(id, { notes: 'Chapters 1-3\nFlashcards', url: 'https://classroom.google.com/c/abc', pomodoros: 2 }); }, newId);
    const sel = `.view.active .item[data-id="${newId}"] .item-title-btn`;
    await page.locator(sel).first().scrollIntoViewIfNeeded();
    await page.click(sel);
    await page.waitForSelector('#modal-root .ad-modal');
    const d = await page.evaluate(() => {
      const m = document.querySelector('#modal-root .modal');
      return {
        inputs: m.querySelectorAll('input, select, textarea, [contenteditable]').length,
        text: m.textContent, link: (m.querySelector('a.ad-link') || {}).getAttribute ? { href: m.querySelector('a.ad-link').getAttribute('href'), target: m.querySelector('a.ad-link').getAttribute('target'), rel: m.querySelector('a.ad-link').getAttribute('rel') } : null,
        meter: (m.querySelector('.pm[role="progressbar"]') || {}).getAttribute ? m.querySelector('.pm[role="progressbar"]').getAttribute('aria-valuenow') : null,
        editableMeter: m.querySelectorAll('[data-action="progress"]').length,
        primary: (m.querySelector('.modal-foot .btn-primary') || {}).textContent
      };
    });
    assert.strictEqual(d.inputs, 0, 'no inputs in the detail view');
    assert.strictEqual(d.editableMeter, 0, 'progress is read-only here');
    assert.strictEqual(d.meter, '60');
    for (const want of ['Unit 1 test', 'AP Psychology', 'Tuesday, November 10', 'End of day', '15m', 'Open', 'Added by you', 'Chapters 1-3', 'Created', 'Updated', 'Pomodoros', 'Open in Google Classroom']) assert.ok(d.text.includes(want), 'detail shows ' + want);
    assert.deepStrictEqual(d.link, { href: 'https://classroom.google.com/c/abc', target: '_blank', rel: 'noopener noreferrer' });
    assert.ok(/Edit/.test(d.primary), 'Edit is the primary action');
    await shot('assign-detail-1440.png');
    await theme('light'); await shot('assign-detail-light-1440.png'); await theme('dark');
    await page.click('#modal-root [data-role="edit"]');
    await page.waitForSelector('#modal-root #ed-title');
    assert.strictEqual(await page.inputValue('#ed-title'), 'Unit 1 test');
    assert.strictEqual(await page.inputValue('#ed-progress'), '60', 'edit form has a progress slider');
    await page.$eval('#ed-progress', el => { el.value = '75'; el.dispatchEvent(new Event('input', { bubbles: true })); });
    await page.click('#modal-root [data-role="save"]');
    assert.strictEqual(await page.evaluate(id => App.byId(id).progress, newId), 75, 'saved from the edit form');
    // The pencil on a row still edits directly.
    await page.click(`.view.active .item[data-id="${newId}"] .item-actions [data-action="edit"]`);
    await page.waitForSelector('#modal-root #ed-title');
    await page.keyboard.press('Escape');
    // Mark done from the detail is a clear action button.
    await page.click(sel);
    await page.waitForSelector('#modal-root .ad-modal [data-role="done"]');
    await page.click('#modal-root [data-role="done"]');
    await page.waitForFunction(id => App.byId(id).done, newId);
    await page.evaluate(id => App.uncompleteAssignment(id), newId);
  });

  await check('assign: month pills, board cards and class rows open the detail', async () => {
    await page.evaluate(() => { App.state.ui.monthCursor = '2026-11'; App.setView('month'); });
    const pill = `.view[data-view="month"] .pill[data-id="${newId}"]`;
    await page.waitForSelector(pill);
    await page.click(pill);
    await page.waitForSelector('#modal-root .ad-modal');
    await page.keyboard.press('Escape');
    await page.evaluate(() => { App.state.ui.monthCursor = null; App.setView('board'); });
    const card = `#board-mount .bcard[data-id="${newId}"]`;
    await page.waitForSelector(card);
    await page.waitForTimeout(700); // column entrance animation
    await page.locator(card).scrollIntoViewIfNeeded();
    await page.click(`${card} .bcard-title`);
    await page.waitForSelector('#modal-root .ad-modal');
    await page.keyboard.press('Escape');
    // The board meter opens the popover, not the card.
    await page.click(`${card} [data-action="progress"]`);
    await page.waitForSelector('.pm-pop');
    assert.ok(!(await page.$('#modal-root .modal')));
    await shot('assign-board-pop-1440.png');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('.pm-pop:not(.is-closing)'));
    await page.evaluate(() => App.setView('classes'));
    const row = `.view[data-view="classes"] .item[data-id="${newId}"] .item-title-btn`;
    await page.waitForSelector(row);
    await page.click(row);
    await page.waitForSelector('#modal-root .ad-modal');
    await page.keyboard.press('Escape');
    await page.evaluate(() => App.setView('today'));
  });

  await check('assign: the detail view is XSS safe', async () => {
    const evil = '<img src=x onerror="window.__adXss=1">';
    const id = await page.evaluate(evil => App.addAssignment({
      title: 'XSS ' + evil, notes: '<script>window.__adXss=2</script>' + evil, sourceNotes: '<b>bold</b>' + evil,
      url: 'javascript:window.__adXss=3', location: evil, classId: App.ensureClass('<i>Evil</i> class').id, due: new Date(2026, 9, 20, 15, 0).toISOString(), allDay: false
    }).id, evil);
    created.push(id);
    await page.evaluate(id => App.openAssignmentDetail(id), id);
    await page.waitForSelector('#modal-root .ad-modal');
    await page.waitForTimeout(100);
    const r = await page.evaluate(() => {
      const m = document.querySelector('#modal-root .modal');
      return { injected: m.querySelectorAll('img, script, b:not(.ad-link b), i').length, xss: window.__adXss || null, link: m.querySelectorAll('a.ad-link').length, title: document.querySelector('#modal-title').textContent };
    });
    assert.strictEqual(r.injected, 0, 'no injected elements');
    assert.strictEqual(r.xss, null);
    assert.strictEqual(r.link, 0, 'javascript: URLs are dropped');
    assert.ok(r.title.includes('<img'), 'title shown as text');
    await page.keyboard.press('Escape');
    await page.evaluate(id => App.openCreateAssignment({ prompt: 'Quiz #<b>evil</b> fri' }), id);
    await page.waitForSelector('#ca-understood');
    assert.strictEqual(await page.$$eval('#modal-root .modal b, #modal-root .modal img', els => els.length), 0, 'create dialog escapes too');
    await page.keyboard.press('Escape');
  });

  await check('assign: no horizontal overflow at 360px; the Create button floats above the bottom nav', async () => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.evaluate(() => { App.closeModal(); App.setView('today'); document.querySelectorAll('.toast').forEach(t => t.remove()); });
    await page.waitForTimeout(700); // the floating button pops in
    const fab = await page.$eval('#btn-create', b => { const r = b.getBoundingClientRect(); const nav = document.querySelector('#nav').getBoundingClientRect(); return { pos: getComputedStyle(b).position, above: r.bottom <= nav.top + 1, right: window.innerWidth - r.right, w: b.offsetWidth }; });
    assert.strictEqual(fab.pos, 'fixed'); assert.ok(fab.above, 'above the nav'); assert.ok(fab.w >= 44, 'big enough target');
    const over = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(await over() <= 0, 'Next Up overflow');
    await shot('assign-today-360.png');
    await page.click('#btn-create');
    await page.waitForSelector('#ca-prompt');
    await page.type('#ca-prompt', PROMPT);
    assert.ok(await over() <= 0, 'create dialog overflow');
    const modalOver = await page.$eval('#modal-root .modal', m => m.scrollWidth - m.clientWidth);
    assert.ok(modalOver <= 0, 'dialog content overflow ' + modalOver);
    await shot('assign-create-360.png');
    await theme('light'); await shot('assign-create-light-360.png'); await theme('dark');
    await page.keyboard.press('Escape');
    await page.evaluate(id => App.openAssignmentDetail(id), newId);
    await page.waitForSelector('#modal-root .ad-modal');
    assert.ok(await over() <= 0, 'detail overflow');
    assert.ok(await page.$eval('#modal-root .modal', m => m.scrollWidth - m.clientWidth) <= 0, 'detail content overflow');
    await shot('assign-detail-360.png');
    await theme('light'); await shot('assign-detail-light-360.png'); await theme('dark');
    await page.keyboard.press('Escape');
    const sel = meterSel.replace('ID', newId);
    await page.locator(sel).first().scrollIntoViewIfNeeded();
    await page.click(sel);
    await page.waitForSelector('.pm-pop');
    const pop = await page.$eval('.pm-pop', p => { const r = p.getBoundingClientRect(); return { l: r.left, r: r.right }; });
    assert.ok(pop.l >= 0 && pop.r <= 360, 'popover inside the screen ' + JSON.stringify(pop));
    assert.ok(await over() <= 0, 'popover overflow');
    await shot('assign-pop-360.png');
    await page.keyboard.press('Escape');
    await page.evaluate(() => App.setView('board'));
    await page.waitForTimeout(150);
    assert.ok(await over() <= 0, 'board overflow');
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await check('assign: screenshots of Next Up and Board with meters (both themes)', async () => {
    await page.evaluate(() => App.setView('today'));
    await page.waitForTimeout(200);
    await shot('assign-today-1440.png');
    await theme('light'); await shot('assign-today-light-1440.png'); await theme('dark');
    await page.evaluate(() => App.setView('board'));
    await page.waitForTimeout(200);
    await shot('assign-board-1440.png');
  });

  // Clean up.
  await page.evaluate(([ids, s]) => {
    App.closeModal(); App.closePanel();
    for (const id of ids) { const a = App.byId(id); if (a) App.state.assignments.splice(App.state.assignments.indexOf(a), 1); }
    App.state.classes = App.state.classes.filter(c => s.classes.includes(c.id));
    App.state.ui.filters.hideDone = s.hideDone;
    App.state.ui.weekCursor = null; App.state.ui.monthCursor = null;
    App.state.settings.theme = s.theme || 'dark'; App.applyTheme();
    App.setNow(null);
    App.recomputePriorities(); App.save(true);
    App.setView('today');
  }, [created, saved]);
  await page.evaluate(() => document.querySelectorAll('.toast').forEach(t => t.remove()));
};
