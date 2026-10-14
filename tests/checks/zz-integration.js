/*
 * Cross-module regression checks: bugs that only appeared once every view and
 * feature lived in the same page. Runs last (file name sorts after the modules).
 */
'use strict';
const fs = require('fs');

module.exports = async ({ page, check, assert, fixtures }) => {
  await page.evaluate(() => { App.closeModal(); App.closePanel(); App.setView('today'); });

  await check('a hidden class still shows its overdue items in every view', async () => {
    const r = await page.evaluate(async () => {
      const cls = App.ensureClass('Hidden Overdue Class');
      const a = App.addAssignment({ title: 'Hidden class overdue item', classId: cls.id, due: new Date(Date.now() - 86400000).toISOString(), allDay: false });
      cls.hidden = true; App.save(); App.render();
      const seen = {};
      for (const v of ['today', 'month', 'week', 'board', 'classes']) {
        App.setView(v);
        seen[v] = !!document.querySelector(`.view[data-view="${v}"] [data-id="${CSS.escape(a.id)}"]`);
      }
      App.deleteAssignment(a.id);
      App.state.classes.splice(App.state.classes.indexOf(cls), 1);
      App.setView('today');
      return seen;
    });
    for (const v in r) assert.ok(r[v], 'overdue item missing in ' + v + ': ' + JSON.stringify(r));
  });

  await check('importing calendars after a paste does not duplicate pasted items', async () => {
    await page.evaluate(() => { App.clearAll(); });
    await page.click('#btn-import');
    await page.click('[role="tab"][data-tab="paste"]');
    const text = 'This week\nCellular respiration worksheet\nAP Biology - Period 3\nDue Oct 17\n';
    await page.evaluate(() => App.setNow(new Date(2026, 9, 14, 10, 0)));
    await page.fill('.paste-tab textarea', text);
    await page.click('.paste-tab [data-paste="preview"]');
    await page.click('[data-paste="import"]');
    const pastedId = await page.evaluate(() => App.state.assignments[0].id);
    await page.evaluate(id => { App.updateAssignment(id, { notes: 'kept' }); App.completeAssignment(id); }, pastedId);
    await page.click('#btn-import');
    await page.setInputFiles('#file-ics', [fixtures('ap-bio.ics')]);
    await page.waitForSelector('#import-summary:not([hidden])');
    const r = await page.evaluate(() => {
      const same = App.state.assignments.filter(a => a.title === 'Cellular respiration worksheet');
      return { n: same.length, src: same[0].source, done: same[0].done, notes: same[0].notes, total: App.state.assignments.length };
    });
    await page.keyboard.press('Escape');
    assert.strictEqual(r.n, 1, JSON.stringify(r));
    assert.strictEqual(r.src, 'ics'); assert.strictEqual(r.done, true); assert.strictEqual(r.notes, 'kept');
    assert.strictEqual(r.total, 7);
    await page.evaluate(() => App.setNow(null));
  });

  await check('merging a backup into an empty browser restores settings too', async () => {
    await page.evaluate(() => { App.loadDemo(); const s = App.state.settings; s.dailyBudgetMin = 200; s.pomodoroWorkMin = 40; s.weekStartsOn = 0; App.save(true); });
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-backup')]);
    const file = await download.path();
    await page.evaluate(() => App.clearAll());
    const text = fs.readFileSync(file, 'utf8');
    const r = await page.evaluate(t => { App.importJSONText(t, 'merge'); const s = App.state.settings; return { n: App.state.assignments.length, b: s.dailyBudgetMin, p: s.pomodoroWorkMin, w: s.weekStartsOn }; }, text);
    assert.ok(r.n > 0); assert.strictEqual(r.b, 200); assert.strictEqual(r.p, 40); assert.strictEqual(r.w, 0);
  });

  await check('done items from earlier days stay out of the "Due today" lane', async () => {
    const titles = await page.evaluate(() => {
      App.state.ui.filters.hideDone = false; App.setView('today');
      const t = Array.from(document.querySelectorAll('.lane[data-lane="today"] .item-title')).map(e => e.textContent.trim());
      App.state.ui.filters.hideDone = true; App.save(); App.render();
      return t;
    });
    assert.ok(!titles.includes('Problem set 4.2') && !titles.includes('Chapter 5 reading questions'), titles.join(' | '));
  });

  await check('switching view with 1-5 leaves focus mode; shortcuts pause while a panel is open', async () => {
    await page.evaluate(() => { App.setView('today'); if (!App.state.settings.focusMode) App.toggleFocusMode(); });
    await page.keyboard.press('4');
    let r = await page.evaluate(() => ({ v: App.state.ui.view, f: App.state.settings.focusMode, nav: getComputedStyle(document.getElementById('nav')).display !== 'none' }));
    assert.deepStrictEqual(r, { v: 'board', f: false, nav: true });
    await page.evaluate(() => { App.setView('month'); App.openPanel({ title: 'Test panel', body: App.html`<p>x</p>` }); });
    await page.keyboard.press('3');
    r = await page.evaluate(() => ({ v: App.state.ui.view, open: App.panelOpen() }));
    assert.deepStrictEqual(r, { v: 'month', open: true });
    await page.keyboard.press('Escape');
    await page.evaluate(() => App.setView('today'));
  });
};
