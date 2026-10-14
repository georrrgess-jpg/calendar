'use strict';
/* Browser checks for the paste importer (spec 1b). Loaded by tests/browser.js. */
const fs = require('fs');

module.exports = async ({ page, check, assert, fixtures, SHOTS, shotsDir, path }) => {
  /* These checks count every fixture row; keep long-missing rows ticked here (zz-integration covers the default). */
  const lookback = await page.evaluate(() => { const v = App.state.settings.importLookbackDays; App.state.settings.importLookbackDays = 400; return v; });
  const todo = fs.readFileSync(fixtures('todo-paste.txt'), 'utf8');
  const messy = fs.readFileSync(fixtures('paste-messy.txt'), 'utf8');
  /* Theme switches animate colours, so let them settle (and move the pointer off the table) before a screenshot. */
  const shot = async name => { if (SHOTS) { await page.mouse.move(1, 1); await page.waitForTimeout(450); await page.screenshot({ path: path.join(shotsDir, name) }); } };
  const openPaste = async () => {
    if (await page.$('#modal-root .modal')) await page.keyboard.press('Escape');
    await page.click('#btn-import');
    await page.click('#modal-root [role="tab"][data-tab="paste"]');
    await page.waitForSelector('#paste-text', { state: 'visible' });
  };
  const preview = async text => {
    await page.fill('#paste-text', text);
    await page.click('.paste-tab [data-paste="preview"]');
    await page.waitForSelector('.paste-preview:not([hidden]) .paste-count');
  };
  const row = title => page.locator('.paste-table tbody tr', { has: page.locator(`[data-f="title"][value="${title}"]`) });
  const snapshot = () => page.evaluate(() => ({
    total: App.state.assignments.length,
    classes: App.state.classes.length,
    lastImport: App.state.ui.lastImport
  }));
  const byTitle = title => page.evaluate(t => App.state.assignments.filter(a => a.title === t).map(a => ({
    id: a.id, source: a.source, due: a.due, allDay: a.allDay, done: a.done, overdue: App.isOverdue(a), cls: App.className(a.classId), classId: a.classId
  })), title);
  const localIso = (y, mo, d, h, mi) => page.evaluate(([y, mo, d, h, mi]) => new Date(y, mo - 1, d, h, mi).toISOString(), [y, mo, d, h, mi]);

  await page.evaluate(() => { App.setNow(new Date(2026, 9, 14, 10, 0, 0)); App.setView('today'); });
  const before = await snapshot();
  const prevTheme = await page.evaluate(() => App.state.settings.theme);

  await check('paste tab: how-to steps, labelled textarea, preview with the right count', async () => {
    await openPaste();
    assert.strictEqual((await page.textContent('label[for="paste-text"]')).trim(), 'Paste from Google Classroom\'s To-do page');
    const steps = await page.textContent('.paste-steps');
    assert.ok(/To-do/.test(steps) && /Ctrl/.test(steps) && /A/.test(steps), steps);
    await preview(todo);
    const head = await page.textContent('.paste-count');
    assert.ok(head.includes('We found 11 assignments') && head.includes('does this look right?'), head);
    assert.strictEqual(await page.locator('.paste-table tbody tr').count(), 11);
    assert.strictEqual(await page.$('.paste-warnings'), null, 'no warnings for the clean fixture');
    assert.strictEqual((await page.textContent('[data-paste="import"]')).trim(), 'Import 11 assignments');
    // The worksheet already came in from the AP Biology .ics file: it maps to that class and is flagged.
    const ws = row('Cellular respiration worksheet');
    const apId = await page.evaluate(() => App.state.classes.find(c => c.sourceName === 'AP Biology - Period 3').id);
    assert.strictEqual(await ws.locator('[data-f="class"]').inputValue(), apId);
    assert.ok((await ws.locator('.c-status').textContent()).includes('From calendar'));
    // Dates and times are prefilled; the Missing items carry the marker.
    const lab = row('Titration lab write-up');
    assert.strictEqual(await lab.locator('[data-f="date"]').inputValue(), '2026-10-16');
    assert.strictEqual(await lab.locator('[data-f="time"]').inputValue(), '23:59');
    assert.strictEqual(await row('Chapter 6 test').locator('[data-f="time"]').inputValue(), '', 'all-day item has an empty time');
    assert.ok((await row('Reconstruction primary sources').locator('.c-status').textContent()).includes('Missing'));
    assert.strictEqual(await row('Summer reading reflection').locator('[data-f="date"]').inputValue(), '2026-08-08');
    // Class names match existing classes, so no "new:" option is preselected.
    const newSel = await page.$$eval('.paste-table [data-f="class"]', els => els.filter(s => s.value.startsWith('new:')).length);
    assert.strictEqual(newSel, 0);
    if (SHOTS) {
      await page.$eval('.paste-count', el => el.scrollIntoView({ block: 'start' }));
      await shot('paste-preview-1440-dark.png');
      await page.evaluate(() => { App.state.settings.theme = 'light'; App.applyTheme(); });
      await shot('paste-preview-1440-light.png');
      await page.evaluate(t => { App.state.settings.theme = t; App.applyTheme(); }, prevTheme);
    }
  });

  let afterFirst;
  await check('inline edit and untick, then import: items exist with the right dates; missing ones are overdue; no duplicate of the calendar item', async () => {
    await row('Titration lab write-up').locator('[data-f="title"]').fill('Titration lab write-up (final)');
    await row('Extra credit: science fair reflection').locator('[data-f="inc"]').uncheck();
    assert.strictEqual((await page.textContent('[data-paste="import"]')).trim(), 'Import 10 assignments');
    assert.ok(await row('Extra credit: science fair reflection').evaluate(tr => tr.classList.contains('is-excluded')));
    await page.click('[data-paste="import"]');
    await page.waitForSelector('#modal-root .modal', { state: 'detached' });
    const toast = await page.textContent('.toast.is-ok >> nth=-1');
    assert.ok(/Imported 10 assignments from Classroom/.test(toast), toast);
    assert.ok(/matched your calendar import/.test(toast), toast);
    afterFirst = await snapshot();
    assert.strictEqual(afterFirst.total, before.total + 9, 'nine new items (the worksheet updated the .ics one)');
    assert.strictEqual(afterFirst.classes, before.classes, 'every class name matched an existing class');
    assert.strictEqual(afterFirst.lastImport.source, 'paste');
    assert.strictEqual(afterFirst.lastImport.assignments, 10);

    const lab = await byTitle('Titration lab write-up (final)');
    assert.strictEqual(lab.length, 1);
    assert.strictEqual(lab[0].source, 'paste'); assert.strictEqual(lab[0].cls, 'Chemistry');
    assert.strictEqual(lab[0].due, await localIso(2026, 10, 16, 23, 59)); assert.strictEqual(lab[0].allDay, false);
    const vec = await byTitle('Vectors practice set');
    assert.strictEqual(vec[0].due, await localIso(2026, 10, 15, 8, 0));
    const lim = await byTitle('Limits problem set');
    assert.strictEqual(lim[0].due, await localIso(2026, 10, 19, 23, 59)); assert.strictEqual(lim[0].allDay, true);
    const ws = await byTitle('Cellular respiration worksheet');
    assert.strictEqual(ws.length, 1, 'calendar item not duplicated');
    assert.strictEqual(ws[0].source, 'ics');
    assert.deepStrictEqual(await byTitle('Extra credit: science fair reflection'), []);
    for (const t of ['Reconstruction primary sources', 'Summer reading reflection']) {
      const m = await byTitle(t);
      assert.strictEqual(m.length, 1, t);
      assert.strictEqual(m[0].overdue, true, t + ' is overdue');
      await page.waitForSelector(`.lane[data-lane="overdue"] .item[data-id="${m[0].id}"]`);
    }
    assert.strictEqual((await byTitle('Summer reading reflection'))[0].due, await localIso(2026, 8, 8, 23, 59), 'Missing item not rolled into next year');
    assert.ok((await page.textContent('#footer-import')).includes('10 assignments'));
  });

  await check('pasting again updates instead of duplicating and keeps edits and done state', async () => {
    const vec = (await byTitle('Vectors practice set'))[0];
    await page.evaluate(id => { App.completeAssignment(id); App.updateAssignment(id, { notes: 'show work' }); }, vec.id);
    await page.waitForTimeout(600);
    await openPaste();
    await preview(todo);
    assert.ok((await page.textContent('.paste-count')).includes('We found 11 assignments'));
    // The edited title is shown (and kept) for the row that was imported before.
    const edited = row('Titration lab write-up (final)');
    assert.strictEqual(await edited.count(), 1, 'preview shows the title you edited');
    assert.ok((await edited.locator('.c-status').textContent()).includes('Will update'));
    await row('Extra credit: science fair reflection').locator('[data-f="inc"]').uncheck();
    await page.click('[data-paste="import"]');
    await page.waitForSelector('#modal-root .modal', { state: 'detached' });
    const toast = await page.textContent('.toast.is-ok >> nth=-1');
    assert.ok(/0 new/.test(toast), toast);
    const s = await snapshot();
    assert.strictEqual(s.total, afterFirst.total, 'no duplicates after a second paste');
    assert.strictEqual(s.classes, afterFirst.classes);
    const again = (await byTitle('Vectors practice set'))[0];
    assert.strictEqual(again.id, vec.id); assert.strictEqual(again.done, true, 'done kept');
    assert.strictEqual(await page.evaluate(id => App.byId(id).notes, vec.id), 'show work');
    assert.strictEqual((await byTitle('Titration lab write-up (final)')).length, 1, 'edited title kept');
    assert.deepStrictEqual(await byTitle('Titration lab write-up'), []);
  });

  await check('"Report a parse problem" copies the raw paste (clipboard API, then execCommand fallback)', async () => {
    await openPaste();
    await preview(todo);
    await page.evaluate(() => {
      window.__copied = null;
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { window.__copied = t; } } });
    });
    await page.click('[data-paste="report"]');
    await page.waitForFunction(() => window.__copied !== null);
    assert.strictEqual(await page.evaluate(() => window.__copied), todo);
    assert.ok((await page.textContent('.toast >> nth=-1')).includes('Copied what you pasted'));
    await page.evaluate(() => {
      window.__exec = null;
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('denied')) } });
      const orig = document.execCommand.bind(document);
      document.execCommand = cmd => { window.__exec = { cmd, text: document.activeElement && document.activeElement.value }; orig(cmd); return true; };
      window.__restoreExec = () => { delete document.execCommand; };
    });
    await page.click('[data-paste="report"]');
    await page.waitForFunction(() => window.__exec !== null);
    const ex = await page.evaluate(() => window.__exec);
    assert.strictEqual(ex.cmd, 'copy'); assert.strictEqual(ex.text, todo);
    assert.strictEqual(await page.evaluate(() => document.activeElement && document.activeElement.dataset.paste), 'report', 'focus returns to the button');
    await page.evaluate(() => { window.__restoreExec(); delete navigator.clipboard; });
    assert.ok(await page.evaluate(() => !!navigator.clipboard && typeof navigator.clipboard.writeText === 'function'), 'clipboard restored');
    await page.click('[data-paste="cancel"]');
    await page.waitForSelector('#modal-root .modal', { state: 'detached' });
  });

  await check('messy paste auto-previews on paste: chrome ignored, new classes offered, keyboard operable', async () => {
    const s0 = await snapshot();
    await openPaste();
    await page.fill('#paste-text', messy);
    await page.$eval('#paste-text', el => el.dispatchEvent(new Event('paste', { bubbles: true })));
    await page.waitForSelector('.paste-preview:not([hidden]) .paste-count');
    assert.ok((await page.textContent('.paste-count')).includes('We found 14 assignments'));
    assert.strictEqual(await page.$('.paste-warnings'), null);
    assert.strictEqual(await page.evaluate(() => document.activeElement.classList.contains('paste-count')), true, 'focus moves to the result heading');
    assert.strictEqual(await row('Momentum lab').locator('[data-f="class"]').inputValue(), 'new:Physics, Period 2');
    assert.ok((await row('Summer reading journal').locator('.c-status').textContent()).includes('Turned in'));
    assert.strictEqual(await row('Course syllabus signature').locator('.paste-src').textContent(), 'no date given');
    // Keyboard: Tab to "Select all", then to the first row checkbox; Space unticks it.
    await page.keyboard.press('Tab');
    assert.strictEqual(await page.evaluate(() => document.activeElement.dataset.f), 'all');
    await page.keyboard.press('Tab');
    assert.strictEqual(await page.evaluate(() => document.activeElement.dataset.f), 'inc');
    await page.keyboard.press('Space');
    assert.strictEqual((await page.textContent('[data-paste="import"]')).trim(), 'Import 13 assignments');
    assert.strictEqual(await page.$eval('[data-f="all"]', el => el.indeterminate), true);
    // Ctrl+Enter in the textarea re-runs the preview.
    await page.focus('#paste-text');
    await page.keyboard.press('Control+Enter');
    await page.waitForFunction(() => document.activeElement.classList.contains('paste-count'));
    assert.strictEqual((await page.textContent('[data-paste="import"]')).trim(), 'Import 14 assignments');
    await page.click('[data-paste="cancel"]');
    await page.waitForSelector('#modal-root .modal', { state: 'detached' });
    const s1 = await snapshot();
    assert.strictEqual(s1.total, s0.total, 'cancel imports nothing'); assert.strictEqual(s1.classes, s0.classes);
  });

  const importNow = async () => {
    await page.click('[data-paste="import"]');
    await page.waitForSelector('#modal-root .modal', { state: 'detached' });
  };

  await check('untrusted titles and class names stay text in the preview and in every view', async () => {
    const evil = '<img src=x onerror="window.__xss=1">';
    const evilClass = '<b class="pwn">Evil</b> & "class"';
    await page.evaluate(() => { window.__xss = 0; });
    await openPaste();
    await preview(`This week\n${evil}\n${evilClass}\nDue Oct 16, 9:00 AM\n`);
    assert.strictEqual(await page.locator('.paste-table tbody tr').count(), 1);
    assert.strictEqual(await page.$('#modal-root img, #modal-root b.pwn'), null, 'markup was injected into the preview');
    assert.strictEqual(await page.locator('.paste-table [data-f="title"]').inputValue(), evil);
    assert.strictEqual((await page.locator('.paste-table [data-f="class"] option:checked').textContent()).trim(), 'new: ' + evilClass);
    await importNow();
    const it = await byTitle(evil);
    assert.strictEqual(it.length, 1); assert.strictEqual(it[0].cls, evilClass);
    let seen = 0;
    for (const v of ['today', 'month', 'week', 'board', 'classes']) {
      await page.evaluate(v => App.setView(v), v);
      await page.waitForTimeout(80);
      assert.strictEqual(await page.$('img[src="x"], b.pwn'), null, 'markup was injected in the ' + v + ' view');
      if ((await page.textContent('#view-root')).includes(evil)) seen++;
    }
    assert.ok(seen >= 1, 'the title shows as literal text somewhere');
    assert.strictEqual(await page.evaluate(() => window.__xss), 0);
    await page.evaluate(id => { App.deleteAssignment(id); App.setView('today'); }, it[0].id);
  });

  await check('nothing recognised: helpful empty state, no Import button, Report and Clear still work', async () => {
    const s0 = await snapshot();
    await openPaste();
    await preview('Classroom\nTo-do\nAll classes\nNo work due soon\nsome stray words');
    assert.ok((await page.textContent('.paste-count')).includes('couldn’t find any assignments'));
    assert.strictEqual(await page.evaluate(() => document.activeElement.classList.contains('paste-count')), true);
    assert.strictEqual(await page.$('[data-paste="import"]'), null);
    assert.ok((await page.textContent('.paste-warnings')).includes('No assignments were recognised'));
    assert.ok(await page.isVisible('[data-paste="report"]'));
    await page.click('.paste-tab [data-paste="clear"]');
    assert.strictEqual(await page.inputValue('#paste-text'), '');
    assert.strictEqual(await page.isHidden('[data-paste="result"]'), true);
    assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'paste-text');
    await page.click('.paste-tab [data-paste="preview"]');
    assert.ok((await page.textContent('.toast >> nth=-1')).includes('Paste your Classroom To-do page'));
    assert.strictEqual(await page.isHidden('[data-paste="result"]'), true);
    await page.keyboard.press('Escape');
    await page.waitForSelector('#modal-root .modal', { state: 'detached' });
    assert.strictEqual((await snapshot()).total, s0.total);
  });

  await check('recurring titles: a new "Warm-up" on another day is added, not merged into the checked-off one', async () => {
    const s0 = await snapshot();
    await openPaste();
    await preview('This week\nWarm-up\nChemistry\nDue Today\n');
    await importNow();
    const w1 = await byTitle('Warm-up');
    assert.strictEqual(w1.length, 1);
    await page.evaluate(id => App.completeAssignment(id), w1[0].id);
    await page.waitForTimeout(600);
    await openPaste();
    await preview('This week\nWarm-up\nChemistry\nDue Tomorrow\n');
    assert.ok((await page.textContent('.paste-table .c-status')).includes('New'));
    await importNow();
    const w2 = await byTitle('Warm-up');
    assert.strictEqual(w2.length, 2, 'the new occurrence was added');
    const old = w2.find(a => a.id === w1[0].id), fresh = w2.find(a => a.id !== w1[0].id);
    assert.strictEqual(old.done, true); assert.strictEqual(old.due, await localIso(2026, 10, 14, 23, 59), 'the done one keeps its date');
    assert.strictEqual(fresh.done, false); assert.strictEqual(fresh.due, await localIso(2026, 10, 15, 23, 59));
    // Both listed in one paste: both are recognised and nothing new is added.
    await openPaste();
    await preview('This week\nWarm-up\nChemistry\nDue Today\nWarm-up\nChemistry\nDue Tomorrow\n');
    const statuses = await page.$$eval('.paste-table .c-status', els => els.map(e => e.textContent));
    assert.ok(statuses.length === 2 && statuses.every(t => t.includes('Will update')), statuses.join(' | '));
    await importNow();
    assert.strictEqual((await byTitle('Warm-up')).length, 2);
    assert.strictEqual((await snapshot()).total, s0.total + 2);
  });

  await check('a day-only paste keeps the exact time of a matching hand-added item; an explicit time updates it', async () => {
    const id = await page.evaluate(() => {
      const c = App.state.classes.find(x => x.name === 'Chemistry');
      return App.addAssignment({ title: 'Buffer lab', classId: c.id, due: new Date(2026, 9, 22, 14, 30).toISOString(), allDay: false }).id;
    });
    await openPaste();
    await preview('Next week\nBuffer lab\nChemistry\nDue Oct 22\n');
    assert.ok((await page.textContent('.paste-table .c-status')).includes('Already added'));
    await importNow();
    let b = await byTitle('Buffer lab');
    assert.strictEqual(b.length, 1); assert.strictEqual(b[0].id, id);
    assert.strictEqual(b[0].due, await localIso(2026, 10, 22, 14, 30)); assert.strictEqual(b[0].allDay, false);
    await openPaste();
    await preview('Next week\nBuffer lab\nChemistry\nDue Oct 23, 9:00 AM\n');
    await importNow();
    b = await byTitle('Buffer lab');
    assert.strictEqual(b.length, 1); assert.strictEqual(b[0].due, await localIso(2026, 10, 23, 9, 0));
  });

  await check('paste preview is usable at 360px without horizontal page overflow (dark and light)', async () => {
    await page.setViewportSize({ width: 360, height: 740 });
    try {
      await openPaste();
      if (SHOTS) await shot('paste-tab-360-dark.png');
      await preview(todo);
      await page.waitForTimeout(150);
      const m = await page.evaluate(() => {
        const modal = document.querySelector('#modal-root .modal');
        const tr = document.querySelector('.paste-table tbody tr');
        const inputs = Array.from(document.querySelectorAll('.paste-table tbody tr:first-child .input, .paste-table tbody tr:first-child .select'));
        return {
          page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          backdrop: (b => b.scrollHeight - b.clientHeight)(document.querySelector('#modal-root .modal-backdrop')),
          modal: modal.scrollWidth - modal.clientWidth,
          body: document.querySelector('#modal-root .modal-body').scrollWidth - document.querySelector('#modal-root .modal-body').clientWidth,
          rowDisplay: getComputedStyle(tr).display,
          tooNarrow: inputs.filter(el => el.getBoundingClientRect().width < 100).length,
          offRight: inputs.filter(el => el.getBoundingClientRect().right > window.innerWidth).length
        };
      });
      assert.ok(m.page <= 0, 'page overflow ' + m.page);
      assert.ok(m.modal <= 0 && m.body <= 0, 'modal overflow ' + JSON.stringify(m));
      assert.strictEqual(m.rowDisplay, 'grid', 'rows become cards on phones');
      assert.ok(m.backdrop <= 0, 'the bottom sheet can be dragged up off the screen: backdrop overflows by ' + m.backdrop);
      assert.strictEqual(m.tooNarrow, 0); assert.strictEqual(m.offRight, 0);
      if (SHOTS) {
        await page.$eval('.paste-count', el => el.scrollIntoView({ block: 'start' }));
        await shot('paste-preview-360-dark.png');
        await page.evaluate(() => { App.state.settings.theme = 'light'; App.applyTheme(); });
        await shot('paste-preview-360-light.png');
        await page.$eval('.paste-foot', el => el.scrollIntoView({ block: 'end' }));
        await shot('paste-foot-360-light.png');
      }
    } finally {
      await page.evaluate(t => { App.state.settings.theme = t; App.applyTheme(); }, prevTheme);
      if (await page.$('#modal-root .modal')) await page.keyboard.press('Escape');
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.evaluate(() => App.setNow(null));
    }
  });
  await page.evaluate(v => { App.state.settings.importLookbackDays = v; App.save(); }, lookback);
};
