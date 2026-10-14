/*
 * Round 3 regression checks (reviewer's findings, clock Wed Oct 14 2026 3:30pm).
 * Runs last. Each check cleans up after itself; the clock override is cleared at the end.
 */
'use strict';
module.exports = async ({ page, check, assert, SHOTS, shotsDir, path }) => {
  const NOW = '2026-10-14T15:30:00';
  const reset = () => page.evaluate(() => {
    App.closeModal(); App.closePanel();
    document.querySelectorAll('.pm-pop').forEach(p => p.remove());
    document.getElementById('toasts').innerHTML = '';
  });
  const focusInfo = () => page.evaluate(() => {
    const a = document.activeElement;
    return { body: !a || a === document.body, inView: !!(a && a.closest('.view.active')), inModal: !!(a && a.closest('#modal-root')), cls: a ? String(a.className) : '', id: a && a.closest('[data-id]') ? a.closest('[data-id]').dataset.id : null };
  });
  const shot = async name => { if (SHOTS) await page.screenshot({ path: path.join(shotsDir, name) }); };
  await reset();
  await page.evaluate(n => { App.loadDemo(); App.setNow(n); App.setView('today'); }, NOW);
  await reset();

  await check('round3: smart prompt understands "chem test due at 11:59 tonight" (Chem test, tonight 11:59 PM)', async () => {
    await page.evaluate(() => { App.ensureClass('Chemistry'); App.openCreateAssignment(); });
    await page.waitForSelector('#ca-prompt');
    await page.fill('#ca-prompt', 'chem test due at 11:59 tonight');
    await page.waitForTimeout(150);
    assert.strictEqual(await page.inputValue('#ca-title'), 'Chem test');
    assert.strictEqual(await page.inputValue('#ca-date'), '2026-10-14');
    assert.strictEqual(await page.inputValue('#ca-time'), '23:59');
    await reset();
  });

  await check('round3: Create dialog on a phone uses a short placeholder that fits beside the Enter hint', async () => {
    await page.setViewportSize({ width: 360, height: 740 });
    await page.evaluate(() => App.openCreateAssignment());
    await page.waitForSelector('#ca-prompt');
    await page.waitForTimeout(350);
    const r = await page.evaluate(() => {
      const i = document.getElementById('ca-prompt'), k = document.querySelector('.ca-prompt-kbd');
      const cs = getComputedStyle(i);
      const ctx = document.createElement('canvas').getContext('2d');
      ctx.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
      const room = i.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
      const ir = i.getBoundingClientRect(), kr = k.getBoundingClientRect();
      return { ph: i.placeholder, text: ctx.measureText(i.placeholder).width, room, kbdInside: kr.left >= ir.left && kr.right <= ir.right + 0.5 };
    });
    await shot('round3-create-360.png');
    await reset();
    await page.setViewportSize({ width: 1440, height: 900 });
    assert.ok(r.ph.length <= 24, r.ph);
    assert.ok(r.text <= r.room, JSON.stringify(r));
    assert.ok(r.kbdInside, 'Enter hint sits inside the prompt');
  });

  await check('round3: the "Mark it as done?" toast goes away when progress drops, never stacks, and cannot complete below 100%', async () => {
    await page.evaluate(() => App.setView('today'));
    const id = await page.evaluate(() => App.state.assignments.find(a => !a.done && !a.archived && document.querySelector(`.view.active .item[data-id="${a.id}"] [data-action=progress]`)).id);
    const count = () => page.evaluate(() => [...document.querySelectorAll('.toast:not(.is-leaving)')].filter(t => /Mark it as done/.test(t.textContent)).length);
    await page.click(`.view.active .item[data-id="${id}"] [data-action=progress]`);
    await page.waitForSelector('.pm-pop');
    await page.keyboard.press('End');
    await page.waitForTimeout(100);
    assert.strictEqual(await count(), 1, 'toast shown at 100%');
    await page.keyboard.press('Home');
    await page.waitForTimeout(100);
    assert.strictEqual(await count(), 0, 'toast taken back below 100%');
    await page.keyboard.press('End'); await page.waitForTimeout(60);
    await page.keyboard.press('Home'); await page.waitForTimeout(60);
    await page.keyboard.press('End'); await page.waitForTimeout(100);
    assert.strictEqual(await count(), 1, 'one toast, not a stack');
    await page.keyboard.press('Escape');
    /* Dropped from another surface: the toast goes too, and a stale action would not complete it. */
    await page.evaluate(id => App.setProgress(id, 60), id);
    await page.waitForTimeout(60);
    assert.strictEqual(await count(), 0);
    assert.strictEqual(await page.evaluate(id => App.byId(id).done, id), false);
    await page.evaluate(id => App.setProgress(id, 0), id);
    await reset();
  });

  await check('round3: the "Mark done" toast action completes only while progress is still 100%', async () => {
    const id = await page.evaluate(() => App.state.assignments.find(a => !a.done && !a.archived && document.querySelector(`.view.active .item[data-id="${a.id}"] [data-action=progress]`)).id);
    await page.click(`.view.active .item[data-id="${id}"] [data-action=progress]`);
    await page.waitForSelector('.pm-pop');
    await page.keyboard.press('End');
    await page.waitForTimeout(100);
    /* Lower progress without the event (as a stale toast would see it), then press the button. */
    await page.evaluate(id => { App.byId(id).progress = 40; }, id);
    await page.click('.toast button:has-text("Mark done")');
    await page.waitForTimeout(100);
    assert.strictEqual(await page.evaluate(id => App.byId(id).done, id), false);
    await page.evaluate(id => App.setProgress(id, 0), id);
    await reset();
  });

  await check('round3: archiving or rescheduling a checklist item keeps past days intact', async () => {
    const r = await page.evaluate(() => {
      App.setNow('2026-10-10T09:00:00');
      const a = App.addChecklistItem({ title: 'R3 Water', repeat: { type: 'daily' } });
      const b = App.addChecklistItem({ title: 'R3 Bed', repeat: { type: 'daily' } });
      const c = App.addChecklistItem({ title: 'R3 Stretch', repeat: { type: 'daily' } });
      App.toggleChecklist('2026-10-10', a.id, true); App.toggleChecklist('2026-10-10', b.id, true);
      App.setNow('2026-10-14T15:30:00');
      const ids = new Set([a.id, b.id, c.id]);
      const mine = k => App.checklistFor(k).filter(it => ids.has(it.id)).map(it => it.title).sort();
      const out = { before10: mine('2026-10-10'), before12: mine('2026-10-12') };
      App.updateChecklistItem(a.id, { archived: true });
      App.updateChecklistItem(b.id, { repeat: { type: 'weekly', days: [3] } });
      App.updateChecklistItem(c.id, { repeat: { type: 'weekly', days: [3] } });
      out.after10 = mine('2026-10-10');
      out.after12 = mine('2026-10-12');
      out.today = mine('2026-10-14');
      out.next = mine('2026-10-15');
      out.nextWed = mine('2026-10-21');
      const stored = App.state.checklist.items.find(it => it.id === a.id);
      const storedB = App.state.checklist.items.find(it => it.id === b.id);
      out.archivedAt = stored.archivedAt; out.repeatSince = storedB.repeatSince;
      App.updateChecklistItem(a.id, { archived: false });
      out.restored = mine('2026-10-15');
      out.restoredAt = App.state.checklist.items.find(it => it.id === a.id).archivedAt;
      for (const id of ids) App.removeChecklistItem(id);
      App.toggleChecklist('2026-10-10', a.id, false); App.toggleChecklist('2026-10-10', b.id, false);
      return out;
    });
    assert.deepStrictEqual(r.before10, ['R3 Bed', 'R3 Stretch', 'R3 Water']);
    assert.deepStrictEqual(r.after10, ['R3 Bed', 'R3 Stretch', 'R3 Water'], 'Oct 10 keeps both checks and the old daily rule');
    assert.deepStrictEqual(r.after12, ['R3 Bed', 'R3 Stretch', 'R3 Water'], 'days before the change keep the old rule');
    assert.deepStrictEqual(r.today, ['R3 Bed', 'R3 Stretch'], 'archived from today on; Wednesday rule today');
    assert.deepStrictEqual(r.next, [], 'Thursday: neither Wednesday item nor the archived one');
    assert.deepStrictEqual(r.nextWed, ['R3 Bed', 'R3 Stretch']);
    assert.strictEqual(r.archivedAt, '2026-10-14');
    assert.strictEqual(r.repeatSince, '2026-10-14');
    assert.deepStrictEqual(r.restored, ['R3 Water'], 'restoring brings it back');
    assert.strictEqual(r.restoredAt, null);
  });

  await check('round3: checklist settings say archived items can be restored', async () => {
    await page.evaluate(() => App.openChecklistSettings());
    await page.waitForSelector('#modal-root .cks-note');
    assert.ok(/restored/i.test(await page.textContent('#modal-root .cks-note')));
    await reset();
  });

  await check('round3: the Daily log phone sheet is a modal dialog: role, Tab trap, page scroll locked and restored', async () => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => { App.state.ui.logOpen = false; App.setView('log'); });
    await page.waitForSelector('#log-grid');
    const overflow = () => page.evaluate(() => [getComputedStyle(document.documentElement).overflow, getComputedStyle(document.body).overflow]);
    const before = await overflow();
    await page.evaluate(() => App.openLogDay(Core.dayKey(App.now())));
    await page.waitForSelector('#log-ed');
    await page.waitForTimeout(400);
    const a = await page.evaluate(() => { const e = document.getElementById('log-ed'); return { role: e.getAttribute('role'), modal: e.getAttribute('aria-modal'), lab: e.getAttribute('aria-labelledby'), labOk: !!document.getElementById(e.getAttribute('aria-labelledby')) }; });
    assert.deepStrictEqual(a, { role: 'dialog', modal: 'true', lab: 'log-ed-title', labOk: true });
    assert.deepStrictEqual(await overflow(), ['hidden', 'hidden']);
    let escaped = 0;
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press('Tab');
      if (!(await page.evaluate(() => !!document.activeElement.closest('#log-ed')))) escaped++;
    }
    for (let i = 0; i < 10; i++) {
      await page.keyboard.press('Shift+Tab');
      if (!(await page.evaluate(() => !!document.activeElement.closest('#log-ed')))) escaped++;
    }
    assert.strictEqual(escaped, 0, 'Tab stays inside the sheet');
    const y0 = await page.evaluate(() => window.scrollY);
    await page.mouse.move(195, 40);
    await page.mouse.wheel(0, 600);
    await page.waitForTimeout(200);
    assert.strictEqual(await page.evaluate(() => window.scrollY), y0, 'the page behind does not scroll');
    await shot('round3-log-sheet-390.png');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.getElementById('log-ed'));
    assert.deepStrictEqual(await overflow(), before, 'scroll restored on close');
    /* Wide screens: the side panel is not modal. */
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => App.openLogDay(Core.dayKey(App.now())));
    await page.waitForSelector('#log-ed');
    assert.strictEqual(await page.getAttribute('#log-ed', 'role'), null);
    assert.strictEqual(await page.getAttribute('#log-ed', 'aria-modal'), null);
    assert.deepStrictEqual(await overflow(), before);
    await page.evaluate(() => { App.state.ui.logOpen = false; App.setView('today'); });
  });

  await check('round3: Home plays the wave and starter animations on entry only; the drift keeps its phase', async () => {
    await page.evaluate(() => { App.setView('today'); App.setView('overview'); });
    await page.waitForSelector('.view.active .ov-hello .wave');
    const anim = () => page.evaluate(() => ({
      wave: getComputedStyle(document.querySelector('.view.active .ov-hello .wave')).animationName,
      starter: (s => s ? getComputedStyle(s).animationName : 'n/a')(document.querySelector('.view.active .ck-starters .ck-starter')),
      drift: getComputedStyle(document.querySelector('.view.active .ov-greet')).getPropertyValue('--ov-drift-at').trim()
    }));
    const first = await anim();
    assert.strictEqual(first.wave, 'ov-wave');
    if (first.starter !== 'n/a') assert.strictEqual(first.starter, 'ck-in');
    await page.waitForTimeout(120);
    await page.evaluate(() => { const a = App.state.assignments.find(x => !x.done); App.updateAssignment(a.id, { notes: (a.notes || '') + ' ' }); });
    const second = await anim();
    assert.strictEqual(second.wave, 'none', 'a data re-render does not replay the wave');
    if (second.starter !== 'n/a') assert.strictEqual(second.starter, 'none');
    assert.ok(/^-\d/.test(first.drift) && /^-\d/.test(second.drift), JSON.stringify([first.drift, second.drift]));
    assert.ok(parseFloat(second.drift) < parseFloat(first.drift), 'drift continues instead of restarting');
  });

  await check('round3: Home Next up progress meter is editable', async () => {
    const btn = '.view.active .ov-next-progress [data-action="progress"]';
    await page.waitForSelector(btn);
    await page.click(btn);
    await page.waitForSelector('.pm-pop');
    await page.keyboard.press('Escape');
    await reset();
  });

  await check('round3: first run on Home has "Create your first assignment", which opens the Create dialog', async () => {
    const saved = await page.evaluate(() => JSON.stringify(App.state.assignments));
    await page.evaluate(() => { App.state.assignments.length = 0; App.render(); });
    const steps = await page.$$eval('.view.active .start-step h3', els => els.map(e => e.textContent.trim()));
    assert.ok(steps.includes('Create your first assignment'), steps.join(', '));
    await page.click('.view.active .start-card [data-action="ov-create"]');
    await page.waitForSelector('#ca-prompt');
    await reset();
    await page.evaluate(s => { App.state.assignments.push(...JSON.parse(s)); App.save(); App.render(); }, saved);
  });

  /* ---------- detail view: focus and Cancel ---------- */
  const openDetailFromToday = async () => {
    await page.evaluate(() => App.setView('today'));
    const id = await page.evaluate(() => { const b = document.querySelector('.view.active .item:not(.is-done) .item-title-btn'); return b.closest('[data-id]').dataset.id; });
    await page.focus(`.view.active .item[data-id="${id}"] .item-title-btn`);
    await page.keyboard.press('Enter');
    await page.waitForSelector('#modal-root .ad-modal');
    await page.waitForTimeout(60);
    return id;
  };
  await check('round3: Edit then Cancel returns to the detail view; Esc there returns focus to the item', async () => {
    const id = await openDetailFromToday();
    await page.click('#modal-root [data-role="edit"]');
    await page.waitForSelector('#ed-title');
    await page.click('#modal-root [data-role="cancel"]');
    await page.waitForSelector('#modal-root .ad-modal');
    assert.strictEqual(await page.getAttribute('#modal-root .ad-modal', 'data-id'), id);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(80);
    const f = await focusInfo();
    assert.ok(!f.body && f.inView && f.id === id, JSON.stringify(f));
  });
  await check('round3: Delete then Cancel returns to the detail view', async () => {
    const id = await openDetailFromToday();
    await page.click('#modal-root [data-role="delete"]');
    await page.waitForSelector('#modal-root [data-role="ok"]');
    await page.click('#modal-root [data-role="cancel"]');
    await page.waitForSelector('#modal-root .ad-modal');
    assert.strictEqual(await page.getAttribute('#modal-root .ad-modal', 'data-id'), id);
    assert.ok(await page.evaluate(id => !!App.byId(id), id));
    await page.keyboard.press('Escape');
  });
  await check('round3: focus is not lost to <body> after Edit+Save, Start, Mark done and Delete from the detail view', async () => {
    const results = {};
    let id = await openDetailFromToday();
    await page.click('#modal-root [data-role="edit"]');
    await page.waitForSelector('#ed-title');
    await page.fill('#ed-title', 'R3 renamed item');
    await page.click('#modal-root [data-role="save"]');
    await page.waitForTimeout(120);
    results.save = await focusInfo();
    assert.strictEqual(results.save.id, id, 'focus back on the edited item: ' + JSON.stringify(results.save));

    id = await openDetailFromToday();
    if (await page.$('#modal-root [data-role="start"]')) {
      await page.click('#modal-root [data-role="start"]');
      await page.waitForTimeout(120);
      results.start = await focusInfo();
      await page.evaluate(() => { if (App.state.ui.activeId) App.stopAssignment(App.state.ui.activeId); });
    }
    id = await openDetailFromToday();
    await page.click('#modal-root [data-role="done"]');
    await page.waitForTimeout(150);
    results.done = await focusInfo();
    await page.evaluate(id => App.uncompleteAssignment(id), id);

    id = await openDetailFromToday();
    const saved = await page.evaluate(id => JSON.stringify(App.byId(id)), id);
    await page.click('#modal-root [data-role="delete"]');
    await page.waitForSelector('#modal-root [data-role="ok"]');
    await page.click('#modal-root [data-role="ok"]');
    await page.waitForTimeout(150);
    results.del = await focusInfo();
    await page.evaluate(s => { App.state.assignments.push(JSON.parse(s)); App.save(); App.render(); }, saved);
    for (const k in results) assert.ok(!results[k].body && !results[k].inModal, k + ': ' + JSON.stringify(results[k]));
    await reset();
  });

  await page.evaluate(() => { App.setNow(null); App.setView('today'); });
};
