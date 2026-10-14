/* Daily checklist checks: the Home card, the settings modal, recurrence, persistence and backups.
   Loaded by tests/browser.js after its own checks. Leaves the page as it found it. */
'use strict';
const fs = require('fs');
module.exports = async ({ page, check, assert, SHOTS, shotsDir, path }) => {
  const TODAY = '2026-10-14'; // a Wednesday
  const WED_EVENING = [2026, 9, 14, 18, 30];
  const snap = await page.evaluate(() => {
    App.closeModal(true); App.closePanel();
    App.save(true);
    return { data: localStorage.getItem('assignments.v1'), theme: App.state.settings.theme };
  });
  const setNow = parts => page.evaluate(p => App.setNow(p ? new Date(p[0], p[1], p[2], p[3] || 12, p[4] || 0) : null), parts);
  const home = async () => { await page.evaluate(() => { App.closeModal(true); App.setView('overview'); }); await page.waitForSelector('.view[data-view="overview"].active .ck-card'); };
  const card = `.view[data-view="overview"].active .ck-card`;
  const titles = () => page.$$eval(`${card} .ck-item .ck-tt`, els => els.map(e => e.textContent));
  const clearToasts = () => page.evaluate(() => document.querySelectorAll('#toasts .toast').forEach(t => t.remove()));
  const reset = () => page.evaluate(() => { App.state.checklist.items = []; App.state.checklist.done = {}; App.save(true); App.render(); });
  const openSettings = async () => {
    await page.click(`${card} [data-action="ck-settings"]`);
    await page.waitForSelector('#modal-root .cks-modal [data-ed="add"] .cks-title');
  };
  const addInSettings = async (title, type, opts) => {
    opts = opts || {};
    await page.fill('[data-ed="add"] .cks-title', title);
    if (type) await page.click(`[data-ed="add"] [data-cs="type"][data-type="${type}"]`);
    for (const d of opts.toggleDays || []) await page.click(`[data-ed="add"] [data-cs="day"][data-d="${d}"]`);
    if (opts.date) await page.fill('[data-ed="add"] [data-cs="date"]', opts.date);
    if (opts.icon) { await page.click('[data-ed="add"] [data-cs="picker"]'); await page.click(`[data-ed="add"] [data-cs="pick"][data-icon="${opts.icon}"]`); }
    if (opts.preview) assert.strictEqual((await page.textContent('[data-ed="add"] [data-role="preview"]')).trim(), opts.preview);
    await page.click('[data-ed="add"] [data-cs="add"]');
  };

  try {
    await setNow(WED_EVENING);
    await reset();
    await home();

    await check('checklist: empty card offers starters; one tap adds a daily item', async () => {
      const starters = await page.$$eval(`${card} .ck-starter`, els => els.map(e => e.textContent.replace('+', '').trim()));
      assert.strictEqual(starters.length, 6, starters.join(','));
      assert.ok(starters.some(s => s.includes('Drink water')) && starters.some(s => s.includes('Pack bag')));
      await page.click(`${card} .ck-starter[data-title="Drink water"]`);
      const it = await page.evaluate(() => App.state.checklist.items[0]);
      assert.strictEqual(it.title, 'Drink water'); assert.strictEqual(it.icon, '💧'); assert.strictEqual(it.repeat.type, 'daily');
      assert.deepStrictEqual(await titles(), ['Drink water']);
      assert.ok((await page.textContent(`${card} .ck-count`)).includes('0 of 1 done'));
      assert.strictEqual(await page.evaluate(() => document.activeElement && document.activeElement.dataset.action), 'ck-toggle', 'focus moves to the new item');
      await clearToasts();
    });

    await check('checklist: a daily item added in settings shows on Home today', async () => {
      await openSettings();
      assert.strictEqual(await page.textContent('#modal-title'), 'Daily checklist');
      assert.strictEqual(await page.$$eval('[data-ed="add"] [data-cs="type"]', els => els.length), 5, 'five repeat choices');
      await page.click('[data-ed="add"] [data-cs="picker"]');
      assert.ok(await page.$$eval('[data-ed="add"] [data-cs="pick"]', els => els.length) >= 24, 'icon picker');
      await page.click('[data-ed="add"] [data-cs="picker"]');
      await addInSettings('Stretch', 'daily', { icon: '🧘', preview: 'Repeats every day' });
      assert.ok(await page.isVisible('.cks-list [data-ck] .cks-t >> text=Stretch'));
      assert.strictEqual(await page.evaluate(() => document.activeElement.classList.contains('cks-title')), true, 'focus back in the title for the next item');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('#modal-root .modal'));
      assert.deepStrictEqual(await titles(), ['Drink water', 'Stretch']);
      assert.strictEqual(await page.textContent(`${card} .ck-item[data-ck] .ck-icon >> nth=1`), '🧘');
      await clearToasts();
    });

    await check('checklist: a Mon/Wed item shows only on Mondays and Wednesdays', async () => {
      await openSettings();
      // The day chips start on today (Wednesday); add Monday.
      await addInSettings('Piano', 'weekly', { toggleDays: [1], preview: 'Repeats every Mon, Wed' });
      const it = await page.evaluate(() => App.state.checklist.items.find(x => x.title === 'Piano'));
      assert.deepStrictEqual(it.repeat.days, [1, 3]);
      assert.ok((await page.textContent('.cks-list')).includes('Repeats every Mon, Wed'), 'preview line on the item');
      await page.keyboard.press('Escape');
      const seen = {};
      for (const [d, day] of [[19, 'Mon'], [20, 'Tue'], [21, 'Wed'], [22, 'Thu'], [24, 'Sat']]) {
        await setNow([2026, 9, d, 9, 0]);
        await home();
        seen[day] = (await titles()).includes('Piano');
      }
      assert.deepStrictEqual(seen, { Mon: true, Tue: false, Wed: true, Thu: false, Sat: false });
      await setNow([2026, 9, 12, 9, 0]);
      assert.ok(!(await page.evaluate(() => App.checklistFor('2026-10-12').some(x => x.title === 'Piano'))), 'not before it was created');
      await setNow(WED_EVENING);
      await home();
      await clearToasts();
    });

    await check('checklist: a once item applies on its date only', async () => {
      await openSettings();
      await addInSettings('Return library book', 'once', { date: '2026-10-16', preview: 'Just once, on Fri, Oct 16' });
      await page.keyboard.press('Escape');
      const r = await page.evaluate(() => ['2026-10-14', '2026-10-15', '2026-10-16', '2026-10-17'].map(k => App.checklistFor(k).some(x => x.title === 'Return library book')));
      assert.deepStrictEqual(r, [false, false, true, false]);
      await setNow([2026, 9, 16, 8, 0]);
      await home();
      assert.ok((await titles()).includes('Return library book'));
      assert.ok(await page.isVisible(`${card} .ck-once`), 'once badge');
      await setNow(WED_EVENING);
      await home();
      await clearToasts();
    });

    await check('checklist: the inline add creates a one-off for that day (emoji becomes the icon)', async () => {
      await page.fill(`${card} .ck-add-input`, '🧺 Laundry');
      await page.press(`${card} .ck-add-input`, 'Enter');
      const it = await page.evaluate(() => App.state.checklist.items.find(x => x.title === 'Laundry'));
      assert.ok(it, 'added');
      assert.strictEqual(it.icon, '🧺');
      assert.deepStrictEqual({ type: it.repeat.type, date: it.repeat.date }, { type: 'once', date: TODAY });
      assert.ok((await titles()).includes('Laundry'));
      assert.strictEqual(await page.evaluate(() => document.activeElement.classList.contains('ck-add-input')), true, 'ready for the next one');
      assert.strictEqual(await page.inputValue(`${card} .ck-add-input`), '');
      // Empty input does nothing.
      const n = await page.evaluate(() => App.state.checklist.items.length);
      await page.press(`${card} .ck-add-input`, 'Enter');
      assert.strictEqual(await page.evaluate(() => App.state.checklist.items.length), n);
      await clearToasts();
    });

    await check('checklist: ticking toggles with keyboard and persists across a reload', async () => {
      const id = await page.getAttribute(`${card} .ck-item >> nth=0`, 'data-ck');
      await page.focus(`${card} .ck-item[data-ck="${id}"]`);
      await page.keyboard.press('Space');
      assert.strictEqual(await page.getAttribute(`${card} .ck-item[data-ck="${id}"]`, 'aria-checked'), 'true');
      assert.ok(await page.$(`${card} .ck-item[data-ck="${id}"].is-pop`), 'tick animation class');
      assert.strictEqual(await page.evaluate(() => document.activeElement.dataset.ck), id, 'focus stays on the item');
      assert.ok((await page.textContent(`${card} .ck-count`)).startsWith('1 of'));
      await page.evaluate(() => App.save(true));
      await page.reload();
      await page.waitForSelector('#view-root');
      await setNow(WED_EVENING);
      await home();
      assert.strictEqual(await page.getAttribute(`${card} .ck-item[data-ck="${id}"]`, 'aria-checked'), 'true', 'still ticked after reload');
      await page.click(`${card} .ck-item[data-ck="${id}"]`);
      assert.strictEqual(await page.getAttribute(`${card} .ck-item[data-ck="${id}"]`, 'aria-checked'), 'false', 'click unticks');
      assert.strictEqual(await page.evaluate(d => App.state.checklist.done[d] || null, TODAY), null);
    });

    await check('checklist: finishing the last item fires confetti and shows the all-done banner', async () => {
      await page.waitForFunction(() => !document.getElementById('confetti-canvas').classList.contains('is-on'), null, { timeout: 5000 });
      const ids = await page.$$eval(`${card} .ck-item`, els => els.map(e => e.dataset.ck));
      assert.ok(ids.length >= 3);
      for (const id of ids.slice(0, -1)) {
        await page.click(`${card} .ck-item[data-ck="${id}"]`);
        assert.ok(!(await page.evaluate(() => document.getElementById('confetti-canvas').classList.contains('is-on'))), 'no confetti before the last one');
      }
      await page.click(`${card} .ck-item[data-ck="${ids[ids.length - 1]}"]`);
      assert.ok(await page.evaluate(() => document.getElementById('confetti-canvas').classList.contains('is-on')), 'confetti');
      assert.ok(await page.isVisible(`${card}.is-complete .ck-done`), 'all-done banner');
      assert.ok((await page.textContent('.ov-status')).includes(`${ids.length}/${ids.length}`), 'header status shows the checklist');
      await page.waitForFunction(() => !document.getElementById('confetti-canvas').classList.contains('is-on'), null, { timeout: 6000 });
    });

    await check('checklist: settings edit, reorder, archive, delete and Undo', async () => {
      await openSettings();
      const order = () => page.$$eval('.cks > .cks-list > [data-ck] .cks-t', els => els.map(e => e.textContent));
      const before = await order();
      assert.strictEqual(before[0], 'Drink water');
      // Edit inline.
      await page.click('.cks-list [data-ck] [data-cs="edit"] >> nth=1');
      await page.fill('[data-ed="edit"] .cks-title', 'Stretch 10 min');
      await page.click('[data-ed="edit"] [data-cs="type"][data-type="weekdays"]');
      assert.strictEqual((await page.textContent('[data-ed="edit"] [data-role="preview"]')).trim(), 'Repeats every weekday, Mon to Fri');
      await page.click('[data-ed="edit"] [data-cs="save"]');
      const edited = await page.evaluate(() => App.state.checklist.items.find(x => x.title === 'Stretch 10 min'));
      assert.ok(edited && edited.repeat.type === 'weekdays', 'saved');
      assert.strictEqual(edited.icon, '🧘', 'icon kept');
      // Reorder: move the first item down.
      await page.click('.cks-list [data-ck] [data-cs="down"] >> nth=0');
      assert.deepStrictEqual((await order()).slice(0, 2), ['Stretch 10 min', 'Drink water']);
      assert.strictEqual(await page.evaluate(() => document.activeElement.dataset.cs), 'down', 'focus follows the moved item');
      // Archive with Undo.
      const archId = await page.evaluate(() => App.state.checklist.items.find(x => x.title === 'Piano').id);
      await page.click(`.cks-list [data-ck="${archId}"] [data-cs="archive"]`);
      assert.ok(await page.evaluate(id => App.state.checklist.items.find(x => x.id === id).archived, archId));
      assert.ok(await page.isVisible('.cks-arch summary'), 'archived section');
      await page.click('.toast:has-text("Archived") button:has-text("Undo")');
      assert.ok(!(await page.evaluate(id => App.state.checklist.items.find(x => x.id === id).archived, archId)));
      // Delete with Undo restores the item in place (with its ticks).
      const list = await page.evaluate(() => App.state.checklist.items.map(x => x.id));
      const victim = list[1];
      await page.click(`.cks-list [data-ck="${victim}"] [data-cs="delete"]`);
      assert.ok(!(await page.evaluate(id => App.state.checklist.items.some(x => x.id === id), victim)), 'deleted');
      assert.ok(!(await page.$(`.cks-list [data-ck="${victim}"]`)), 'gone from the list');
      await page.click('.toast:has-text("Deleted") button:has-text("Undo")');
      assert.deepStrictEqual(await page.evaluate(() => App.state.checklist.items.map(x => x.id)), list, 'restored at the same position');
      assert.ok(await page.isVisible(`.cks-list [data-ck="${victim}"]`), 'list refreshed after undo');
      assert.strictEqual(await page.evaluate(d => App.isChecked(d, App.state.checklist.items[1].id), TODAY), true, 'ticks survive undo');
      // Weekly with no days cannot be saved.
      await page.fill('[data-ed="add"] .cks-title', 'Nothing');
      await page.click('[data-ed="add"] [data-cs="type"][data-type="weekly"]');
      await page.click('[data-ed="add"] [data-cs="day"][data-d="3"]');
      await page.click('[data-ed="add"] [data-cs="add"]');
      assert.ok(await page.isVisible('.cks-err'), 'error shown');
      assert.ok(!(await page.evaluate(() => App.state.checklist.items.some(x => x.title === 'Nothing'))));
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('#modal-root .modal'));
      await clearToasts();
    });

    await check('checklist: titles are rendered as text (XSS)', async () => {
      const xss = '<img src=x onerror="window.__ckx=1">';
      await page.fill(`${card} .ck-add-input`, xss);
      await page.press(`${card} .ck-add-input`, 'Enter');
      assert.ok((await titles()).includes(xss));
      await openSettings();
      assert.ok((await page.textContent('.cks-list')).includes(xss));
      assert.strictEqual(await page.$$eval('.ck-card img, .cks img', els => els.length), 0);
      assert.strictEqual(await page.evaluate(() => window.__ckx || 0), 0);
      await page.keyboard.press('Escape');
      await page.evaluate(t => { const it = App.state.checklist.items.find(x => x.title === t); App.removeChecklistItem(it.id); }, xss);
      await clearToasts();
    });

    await check('checklist: the card works when mounted in a side panel', async () => {
      await page.evaluate(d => App.openPanel({ title: 'Checklist', body: App.checklistCard(d) }), '2026-10-15');
      try { await panelChecks(); } finally { await page.evaluate(() => App.closePanel()); await clearToasts(); }
    });
    async function panelChecks() {
      const sel = '#panel-root .ck-card[data-day="2026-10-15"]';
      await page.waitForSelector(sel);
      const id = await page.getAttribute(`${sel} .ck-item >> nth=0`, 'data-ck');
      await page.click(`${sel} .ck-item[data-ck="${id}"]`);
      assert.strictEqual(await page.getAttribute(`${sel} .ck-item[data-ck="${id}"]`, 'aria-checked'), 'true', 'panel card refreshed');
      assert.ok(await page.evaluate(i => App.isChecked('2026-10-15', i), id));
      await page.fill(`${sel} .ck-add-input`, 'Panel item');
      await page.press(`${sel} .ck-add-input`, 'Enter');
      assert.ok((await page.textContent(sel)).includes('Panel item'));
      assert.ok(await page.evaluate(() => App.checklistFor('2026-10-15').some(x => x.title === 'Panel item')));
      assert.ok(!(await page.evaluate(() => App.checklistFor('2026-10-14').some(x => x.title === 'Panel item'))), 'one-off for that day only');
      assert.strictEqual(await page.evaluate(() => document.activeElement.classList.contains('ck-add-input') && !!document.activeElement.closest('#panel-root')), true, 'focus stays in the panel');
    }

    await check('checklist: JSON export then import into cleared storage keeps the checklist', async () => {
      const before = await page.evaluate(() => JSON.stringify(App.state.checklist));
      const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-backup')]);
      const text = fs.readFileSync(await download.path(), 'utf8');
      const r = await page.evaluate(t => {
        App.clearAll();
        const empty = App.state.checklist.items.length;
        App.importJSONText(t, 'merge');
        return { empty, after: JSON.stringify(App.state.checklist) };
      }, text);
      assert.strictEqual(r.empty, 0);
      assert.strictEqual(r.after, before);
      await setNow(WED_EVENING);
      await home();
      assert.ok((await titles()).length > 0, 'card shows the restored items');
      await clearToasts();
    });

    await check('checklist: no horizontal overflow at 360px; screenshots', async () => {
      // Untick one so the card shows progress in the screenshots.
      await page.evaluate(d => { const it = App.checklistFor(d)[0]; App.toggleChecklist(d, it.id, false); }, TODAY);
      for (const theme of ['dark', 'light']) {
        await page.evaluate(t => { App.state.settings.theme = t; App.applyTheme(); }, theme);
        for (const [w, h] of [[1440, 900], [360, 740]]) {
          await page.setViewportSize({ width: w, height: h });
          await home();
          await clearToasts();
          await page.waitForTimeout(500);
          let over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          assert.ok(over <= 0, `home overflow ${over}px at ${w} ${theme}`);
          const el = await page.$(card);
          if (SHOTS) await el.screenshot({ path: path.join(shotsDir, `checklist-card-${w}-${theme}.png`) });
          await openSettings();
          await page.click('.cks-list [data-ck] [data-cs="edit"] >> nth=0');
          await page.click('[data-ed="add"] [data-cs="type"][data-type="weekly"]');
          await page.waitForTimeout(350);
          over = await page.evaluate(() => Math.max(document.documentElement.scrollWidth - document.documentElement.clientWidth, document.querySelector('.modal').scrollWidth - document.querySelector('.modal').clientWidth));
          assert.ok(over <= 0, `settings overflow ${over}px at ${w} ${theme}`);
          if (SHOTS) await page.screenshot({ path: path.join(shotsDir, `checklist-settings-${w}-${theme}.png`) });
          await page.keyboard.press('Escape');
          await page.waitForFunction(() => !document.querySelector('#modal-root .modal'));
        }
      }
      await page.setViewportSize({ width: 1440, height: 900 });
    });
  } finally {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(s => {
      App.closeModal(true); App.closePanel();
      document.querySelectorAll('#toasts .toast').forEach(t => t.remove());
      localStorage.setItem('assignments.v1', s.data);
      App.load(); App.recomputePriorities();
      App.state.settings.theme = s.theme;
      App.applyTheme(); App.setNow(null); App.renderAll();
    }, snap);
  }
};
