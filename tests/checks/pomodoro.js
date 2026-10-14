/* Browser checks for the Pomodoro timer (spec section 4). Loaded by tests/browser.js. */
'use strict';
module.exports = async ({ page, check, assert, SHOTS, shotsDir, path }) => {
  const MIN = 60000;
  const pomo = () => page.evaluate(() => App.state.ui.pomodoro && JSON.parse(JSON.stringify(App.state.ui.pomodoro)));
  const timeText = async () => (await page.textContent('#focus-root .pomo-time')).trim();
  const item = id => page.evaluate(id => { const a = App.byId(id); return a && { pomodoros: a.pomodoros || 0, focusedMin: a.focusedMin || 0, done: a.done }; }, id);
  const remainingMs = () => page.evaluate(() => { const p = App.state.ui.pomodoro; return p.paused ? p.pausedRemainingMs : Date.parse(p.endsAt) - Date.now(); });
  const setTimer = (patch) => page.evaluate(patch => {
    const p = App.state.ui.pomodoro;
    for (const k in patch) p[k] = typeof patch[k] === 'number' && k === 'endsAt' ? new Date(Date.now() + patch[k]).toISOString() : patch[k];
    App.save(true);
  }, patch);
  /* Edit the saved timer and reload, without the live page getting a chance to advance it first. */
  const reloadWith = async patch => {
    await page.evaluate(patch => {
      App.save(true);
      const s = JSON.parse(localStorage.getItem('assignments.v1'));
      for (const k in patch) s.ui.pomodoro[k] = k === 'endsAt' ? new Date(Date.now() + patch[k]).toISOString() : patch[k];
      localStorage.setItem('assignments.v1', JSON.stringify(s));
    }, patch);
    await page.reload(); await page.waitForSelector('#view-root');
  };
  const shot = async name => { if (SHOTS) await clearToasts(); if (SHOTS) await page.screenshot({ path: path.join(shotsDir, name), fullPage: false }); };
  const clearToasts = () => page.evaluate(() => document.querySelectorAll('#toasts .toast').forEach(t => t.remove()));
  const heroShot = async name => {
    if (!SHOTS) return;
    await clearToasts();
    const vp = page.viewportSize();
    const h = await page.$eval('.hero', el => el.getBoundingClientRect().height);
    if (h + 120 > vp.height) await page.setViewportSize({ width: vp.width, height: Math.ceil(h + 120) });
    const r = await page.$eval('.hero', el => {
      const top = el.getBoundingClientRect().top + window.scrollY;
      window.scrollTo(0, Math.max(0, top - document.querySelector('.topbar').offsetHeight - 12));
      const b = el.getBoundingClientRect();
      return { x: Math.max(0, b.left - 8), y: Math.max(0, b.top - 8), width: b.width + 16, height: b.height + 16 };
    });
    const cur = page.viewportSize();
    await page.screenshot({ path: path.join(shotsDir, name), clip: { x: r.x, y: r.y, width: Math.min(r.width, cur.width - r.x), height: Math.min(r.height, cur.height - r.y) } });
    await page.setViewportSize(vp);
    await page.evaluate(() => window.scrollTo(0, 0));
  };
  const noOverflow = async () => {
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(over <= 0, 'horizontal overflow: ' + over + 'px');
  };
  const reset = async () => {
    await page.evaluate(() => {
      App.closeModal(); App.closePanel();
      if (App.state.ui.activeId) App.stopAssignment();
      if (App.state.settings.focusMode) App.toggleFocusMode();
      App.setNow(null);
      App.setView('today');
    });
  };

  await reset();
  let heroId = null;

  await check('pomodoro: Start on the hero launches a ticking timer attached to that assignment', async () => {
    heroId = await page.getAttribute('.hero', 'data-id');
    assert.ok(heroId, 'hero has an assignment');
    await page.click('.hero [data-action="start"]');
    await page.waitForSelector('#focus-root .pomo');
    const p = await pomo();
    assert.strictEqual(p.id, heroId);
    assert.strictEqual(p.phase, 'work');
    assert.ok(!p.paused && p.endsAt, 'running with an end time');
    assert.strictEqual(await page.evaluate(() => App.state.ui.activeId), heroId);
    const t1 = await timeText();
    assert.match(t1, /^(25:00|24:5\d)$/, 'starts at the configured 25 minutes: ' + t1);
    assert.ok(await page.isVisible('#focus-root .pomo-arc'), 'progress ring shown');
    assert.strictEqual((await page.textContent('#focus-root .pomo-phase')).trim(), 'Focus');
    await page.waitForTimeout(1600);
    const t2 = await timeText();
    assert.notStrictEqual(t2, t1, 'seconds tick down');
    assert.match(await page.title(), /^\d\d:\d\d · Focus · Assignments$/);
    for (const a of ['pomo-toggle', 'pomo-add5', 'pomo-skip', 'pomo-stop']) assert.ok(await page.isVisible(`#focus-root [data-action="${a}"]`), a + ' control visible');
    assert.ok(await page.isHidden('.hero .hero-actions [data-action="stop"]'), 'duplicate hero Stop hidden while the timer shows');
    const width = await page.$eval('#focus-root .pomo-time', el => el.getBoundingClientRect().width);
    await page.waitForTimeout(1100);
    const width2 = await page.$eval('#focus-root .pomo-time', el => el.getBoundingClientRect().width);
    assert.ok(Math.abs(width - width2) < 0.5, 'tabular digits, no layout shift');
  });

  await check('pomodoro: Pause freezes the countdown, Resume continues; P toggles too', async () => {
    await page.click('#focus-root [data-action="pomo-toggle"]');
    let p = await pomo();
    assert.strictEqual(p.paused, true);
    assert.ok(p.pausedRemainingMs > 0 && !p.endsAt);
    const t1 = await timeText();
    await page.waitForTimeout(1300);
    assert.strictEqual(await timeText(), t1, 'frozen while paused');
    assert.match(await page.title(), /Paused/);
    assert.strictEqual((await page.textContent('#focus-root [data-action="pomo-toggle"]')).trim(), 'Resume');
    assert.strictEqual(await page.evaluate(() => document.activeElement && document.activeElement.dataset.action), 'pomo-toggle', 'focus stays on the toggle');
    await page.click('#focus-root [data-action="pomo-toggle"]');
    p = await pomo();
    assert.strictEqual(p.paused, false);
    await page.waitForTimeout(1300);
    assert.notStrictEqual(await timeText(), t1, 'counting again after resume');
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('p');
    assert.strictEqual((await pomo()).paused, true, 'P pauses');
    await page.keyboard.press('p');
    assert.strictEqual((await pomo()).paused, false, 'P resumes');
  });

  await check('pomodoro: +5 min extends the phase and Skip switches phases', async () => {
    const before = await remainingMs();
    await page.click('#focus-root [data-action="pomo-add5"]');
    const after = await remainingMs();
    assert.ok(after - before > 4.9 * MIN && after - before < 5.1 * MIN, 'added ~5 minutes: ' + (after - before));
    await page.click('#focus-root [data-action="pomo-skip"]');
    let p = await pomo();
    assert.strictEqual(p.phase, 'break');
    assert.match(await timeText(), /^(05:00|04:5\d)$/);
    assert.strictEqual((await page.textContent('#focus-root .pomo-phase')).trim(), 'Break');
    await page.click('#focus-root [data-action="pomo-skip"]');
    p = await pomo();
    assert.strictEqual(p.phase, 'work');
    assert.strictEqual(p.round, 2);
  });

  await check('pomodoro: a finished work phase logs a pomodoro, toasts and starts the break; break end resumes work', async () => {
    const before = await item(heroId);
    await setTimer({ endsAt: -500 });
    await page.waitForFunction(() => App.state.ui.pomodoro && App.state.ui.pomodoro.phase === 'break', null, { timeout: 3000 });
    const after = await item(heroId);
    assert.strictEqual(after.pomodoros, before.pomodoros + 1, 'pomodoro counted');
    assert.strictEqual(after.focusedMin, before.focusedMin + 25, 'work minutes count toward the estimate');
    await page.waitForSelector('.toast:has-text("Pomodoro done")');
    assert.match(await page.title(), /· Break ·/);
    const stats = await page.textContent('#focus-root .pomo-count');
    assert.ok(stats.includes(String(after.pomodoros)), stats);
    if (await page.evaluate(id => !!App.byId(id).estimatedMin, heroId)) assert.match(stats, /\d+ of ~\d+ pomodoros? · \d+ of \d+ min/, stats);
    await setTimer({ endsAt: -500 });
    await page.waitForFunction(() => App.state.ui.pomodoro && App.state.ui.pomodoro.phase === 'work', null, { timeout: 3000 });
    await page.waitForSelector('.toast:has-text("Break’s over")');
    assert.strictEqual((await item(heroId)).pomodoros, after.pomodoros, 'breaks are not counted');
  });

  await check('pomodoro: reload keeps the running timer', async () => {
    const p1 = await pomo();
    await page.reload(); await page.waitForSelector('#view-root');
    await page.waitForSelector('#focus-root .pomo');
    const p2 = await pomo();
    assert.strictEqual(p2.id, p1.id); assert.strictEqual(p2.phase, p1.phase); assert.strictEqual(p2.endsAt, p1.endsAt);
    const t1 = await timeText();
    await page.waitForTimeout(1300);
    assert.notStrictEqual(await timeText(), t1, 'still ticking after reload');
    assert.match(await page.title(), /^\d\d:\d\d · Focus · Assignments$/);
  });

  await check('pomodoro: catching up after time away credits elapsed phases, and stops after 2 hours', async () => {
    let before = await item(heroId);
    // Work ended 50 min ago: work(log) -> break 5 -> work 25 (log) -> break 5 -> work now running.
    await reloadWith({ phase: 'work', endsAt: -50 * MIN, durationMs: 25 * MIN, paused: false });
    await page.waitForSelector('#focus-root .pomo');
    let after = await item(heroId);
    assert.strictEqual(after.pomodoros, before.pomodoros + 2, 'two full work phases credited');
    let p = await pomo();
    assert.strictEqual(p.phase, 'work');
    assert.ok(Date.parse(p.endsAt) > Date.now(), 'current phase still running');
    before = after;
    await reloadWith({ phase: 'work', endsAt: -5 * 60 * MIN, durationMs: 25 * MIN, paused: false });
    await page.waitForSelector('.toast:has-text("Welcome back")');
    after = await item(heroId);
    assert.strictEqual(after.pomodoros, before.pomodoros + 4, 'catch-up capped at 4');
    assert.strictEqual(await pomo(), null, 'timer stopped after a long absence');
    assert.strictEqual(await page.title(), 'Assignments');
    await page.waitForSelector('#focus-root [data-action="pomo-start"]');
    await page.click('#focus-root [data-action="pomo-start"]');
    await page.waitForSelector('#focus-root .pomo');
    p = await pomo();
    assert.strictEqual(p.id, heroId); assert.strictEqual(p.phase, 'work');
  });

  await check('pomodoro: mini timer chip appears on other views and returns to Next Up', async () => {
    await page.keyboard.press('3');
    await page.waitForSelector('#pomo-chip');
    assert.match((await page.textContent('#pomo-chip .pomo-chip-time')).trim(), /^\d\d:\d\d$/);
    await shot('pomodoro-chip-1440.png');
    await page.click('#pomo-chip [data-action="pomo-toggle"]');
    assert.strictEqual((await pomo()).paused, true, 'chip pause works');
    await page.click('#pomo-chip [data-action="pomo-toggle"]');
    assert.strictEqual((await pomo()).paused, false);
    await page.setViewportSize({ width: 360, height: 740 });
    await page.waitForTimeout(150);
    await noOverflow();
    const box = await page.$eval('#pomo-chip', el => { const r = el.getBoundingClientRect(); const n = document.getElementById('nav').getBoundingClientRect(); return { left: r.left, right: r.right, bottom: r.bottom, navTop: n.top, vh: window.innerHeight }; });
    const navAtBottom = box.navTop > box.vh / 2;
    assert.ok(box.left >= 0 && box.right <= 360 && box.bottom <= box.vh && (!navAtBottom || box.bottom <= box.navTop), 'chip sits inside the viewport above the mobile nav: ' + JSON.stringify(box));
    await shot('pomodoro-chip-360.png');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.click('#pomo-chip .pomo-chip-main');
    await page.waitForSelector('.view[data-view="today"].active #focus-root .pomo');
    assert.ok(!(await page.$('#pomo-chip')), 'chip hidden when the hero timer is on screen');
    assert.strictEqual(await page.evaluate(() => document.activeElement && document.activeElement.dataset.action), 'pomo-toggle');
  });

  await check('pomodoro: screenshots and layout at 1440 and 360, dark and light', async () => {
    for (const theme of ['dark', 'light']) {
      await page.evaluate(t => { App.state.settings.theme = t; App.applyTheme(); }, theme);
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(100);
      await noOverflow();
      await heroShot(`pomodoro-hero-1440-${theme}.png`);
      await page.setViewportSize({ width: 360, height: 740 });
      await page.waitForTimeout(150);
      await noOverflow();
      const fits = await page.$eval('#focus-root .pomo', el => { const r = el.getBoundingClientRect(); return r.left >= 0 && r.right <= 360; });
      assert.ok(fits, 'timer fits at 360px');
      await heroShot(`pomodoro-hero-360-${theme}.png`);
    }
    await page.evaluate(() => { App.state.settings.theme = 'dark'; App.applyTheme(); App.save(); });
    await page.setViewportSize({ width: 1440, height: 900 });
  });

  await check('pomodoro: focus mode keeps the timer visible and usable', async () => {
    await page.keyboard.press('f');
    await page.waitForFunction(() => document.body.classList.contains('focus-mode'));
    assert.ok(await page.isVisible('#focus-root .pomo'));
    await page.click('#focus-root [data-action="pomo-toggle"]');
    assert.strictEqual((await pomo()).paused, true);
    await page.click('#focus-root [data-action="pomo-toggle"]');
    assert.strictEqual((await pomo()).paused, false);
    await page.evaluate(() => window.scrollTo(0, 0));
    await shot('pomodoro-focus-1440.png');
    await page.setViewportSize({ width: 360, height: 740 });
    await page.waitForTimeout(150);
    await noOverflow();
    assert.ok(await page.isVisible('#focus-root [data-action="pomo-skip"]'));
    await shot('pomodoro-focus-360.png');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.keyboard.press('f');
    await page.waitForFunction(() => !document.body.classList.contains('focus-mode'));
  });

  await check('pomodoro: starting another assignment switches the timer', async () => {
    const other = await page.evaluate(id => { const el = Array.from(document.querySelectorAll('.lane .item [data-action="start"]')).find(b => b.closest('.item').dataset.id !== id); return el ? el.closest('.item').dataset.id : null; }, heroId);
    assert.ok(other, 'another startable item exists');
    await page.click(`.lane .item[data-id="${other}"] [data-action="start"]`, { force: true });
    await page.waitForFunction(id => App.state.ui.pomodoro && App.state.ui.pomodoro.id === id, other);
    assert.strictEqual(await page.getAttribute('.hero', 'data-id'), other);
    assert.ok(await page.isVisible(`#focus-root[data-id="${other}"] .pomo`));
    const p = await pomo();
    assert.strictEqual(p.phase, 'work'); assert.strictEqual(p.round, 1);
  });

  await check('pomodoro: Stop clears the timer and restores the page title', async () => {
    await page.click('#focus-root [data-action="pomo-stop"]');
    assert.strictEqual(await pomo(), null);
    assert.strictEqual(await page.evaluate(() => document.activeElement && document.activeElement.closest('.hero') && document.activeElement.dataset.action), 'start', 'keyboard focus lands on the hero Start');
    assert.strictEqual(await page.evaluate(() => App.state.ui.activeId), null);
    assert.strictEqual(await page.title(), 'Assignments');
    assert.ok(!(await page.$('#focus-root .pomo')));
    await page.waitForTimeout(700);
    assert.strictEqual(await page.title(), 'Assignments', 'title stays restored');
  });

  await check('pomodoro: Done on the hero completes the item and clears the timer', async () => {
    const id = await page.getAttribute('.hero', 'data-id');
    await page.click('.hero [data-action="start"]');
    await page.waitForSelector('#focus-root .pomo');
    await page.click('.hero [data-action="done"]');
    await page.waitForFunction(id => App.byId(id).done, id);
    assert.strictEqual(await pomo(), null);
    assert.strictEqual(await page.title(), 'Assignments');
    await page.waitForFunction(() => !document.querySelector('#focus-root .pomo'));
    assert.ok(!(await page.$('#pomo-chip')));
    await page.evaluate(id => App.uncompleteAssignment(id), id);
  });

  await check('pomodoro: deleting the active assignment ends the timer', async () => {
    const id = await page.evaluate(() => App.addAssignment({ title: 'Pomodoro delete test', due: new Date(Date.now() + 2 * 3600000).toISOString(), allDay: false }).id);
    await page.evaluate(id => App.startAssignment(id), id);
    assert.strictEqual((await pomo()).id, id);
    await page.evaluate(id => App.deleteAssignment(id), id);
    assert.strictEqual(await pomo(), null);
    assert.strictEqual(await page.title(), 'Assignments');
  });

  await check('pomodoro: keyboard focus survives a phase change and a chip pause', async () => {
    await page.click('.hero [data-action="start"]');
    await page.waitForSelector('#focus-root .pomo');
    await page.focus('#focus-root [data-action="pomo-toggle"]');
    await setTimer({ endsAt: -500 });
    await page.waitForFunction(() => App.state.ui.pomodoro && App.state.ui.pomodoro.phase === 'break', null, { timeout: 3000 });
    await page.waitForTimeout(100);
    assert.strictEqual(await page.evaluate(() => document.activeElement && document.activeElement.closest('#focus-root') && document.activeElement.dataset.action), 'pomo-toggle', 'focus kept after the re-render that logs the pomodoro');
    await clearToasts();
    await page.evaluate(() => { App.state.settings.theme = 'light'; App.applyTheme(); });
    await heroShot('pomodoro-break-1440-light.png');
    const breakColor = await page.$eval('#focus-root .pomo-phase', el => getComputedStyle(el).color);
    assert.strictEqual(breakColor, 'rgb(4, 120, 87)', 'darker green for the break label in light theme: ' + breakColor);
    await page.evaluate(() => { App.state.settings.theme = 'dark'; App.applyTheme(); App.save(); });
    await page.keyboard.press('3');
    await page.waitForSelector('#pomo-chip');
    await page.focus('#pomo-chip [data-action="pomo-toggle"]');
    await page.keyboard.press('Enter');
    assert.strictEqual((await pomo()).paused, true, 'Enter on the chip pauses');
    assert.strictEqual(await page.evaluate(() => !!(document.activeElement && document.activeElement.closest('#pomo-chip'))), true, 'focus stays on the chip button');
    assert.strictEqual(await page.getAttribute('#pomo-chip [data-action="pomo-toggle"]', 'aria-label'), 'Resume timer');
    await page.keyboard.press('Enter');
    assert.strictEqual((await pomo()).paused, false, 'Enter again resumes');
    const pad = await page.$eval('.footer', el => parseFloat(getComputedStyle(el).paddingBottom));
    assert.ok(pad >= 80, 'footer leaves room under the chip: ' + pad);
    await page.keyboard.press('2');
    await page.evaluate(() => App.stopAssignment());
  });

  await check('pomodoro: titles with HTML render as text in the timer, chip and toasts', async () => {
    const evil = '<img src=x onerror="window.__pomoXss=1">Lab & "notes"';
    const id = await page.evaluate(t => App.addAssignment({ title: t, due: new Date(Date.now() + 3 * 3600000).toISOString(), allDay: false, estimatedMin: 60 }).id, evil);
    await page.evaluate(id => App.startAssignment(id), id);
    await page.waitForSelector(`#focus-root[data-id="${id}"] .pomo`);
    assert.strictEqual((await page.textContent('.hero .hero-title')).trim(), evil);
    assert.match(await page.textContent('#focus-root .pomo-count'), /^0 of ~3 pomodoros · 0 of 60 min$/);
    await setTimer({ endsAt: -500 });
    await page.waitForSelector('.toast:has-text("Pomodoro done")');
    assert.ok((await page.textContent('.toast:has-text("Pomodoro done")')).includes(evil), 'toast shows the raw title as text');
    await page.keyboard.press('4');
    await page.waitForSelector('#pomo-chip');
    assert.ok((await page.textContent('#pomo-chip .pomo-chip-label')).includes(evil));
    assert.strictEqual(await page.$$eval('img[src="x"]', els => els.length), 0, 'no injected <img>');
    await page.waitForTimeout(200);
    assert.strictEqual(await page.evaluate(() => window.__pomoXss), undefined);
    await page.keyboard.press('2');
    await page.evaluate(id => App.deleteAssignment(id), id);
    assert.strictEqual(await pomo(), null);
    await clearToasts();
  });

  await check('pomodoro: restoring a backup with an old running timer does not log phantom pomodoros', async () => {
    const id = await page.getAttribute('.hero', 'data-id');
    await page.click('.hero [data-action="start"]');
    await page.waitForSelector('#focus-root .pomo');
    const before = await item(id);
    const backup = await page.evaluate(id => {
      const s = JSON.parse(JSON.stringify(App.state));
      s.ui.activeId = id;
      s.ui.pomodoro = { id, phase: 'work', endsAt: new Date(Date.now() - 6 * 3600000).toISOString(), paused: false, pausedRemainingMs: null, durationMs: 25 * 60000, startedAt: new Date(Date.now() - 6.5 * 3600000).toISOString(), round: 1 };
      return JSON.stringify(s);
    }, id);
    await page.evaluate(t => App.importJSONText(t, 'replace'), backup);
    await page.waitForTimeout(1200);
    const after = await item(id);
    assert.strictEqual(after.pomodoros, before.pomodoros, 'no pomodoros credited for the backup’s old timer');
    assert.strictEqual(await pomo(), null);
    assert.strictEqual(await page.title(), 'Assignments');
    assert.ok(await page.isVisible('#focus-root [data-action="pomo-start"]'), 'item still in progress with a way to restart the timer');
    // A same-session reload of state (App.load) keeps the running timer.
    await page.click('#focus-root [data-action="pomo-start"]');
    const p1 = await pomo();
    await page.evaluate(() => { App.save(true); App.load(); App.render(); });
    assert.deepStrictEqual(await pomo(), p1, 'App.load keeps this session’s timer');
    await page.evaluate(() => App.stopAssignment());
    await clearToasts();
  });

  await check('pomodoro: empty data and a timer for a missing item clean up on load', async () => {
    const snapshot = await page.evaluate(() => { App.save(true); return localStorage.getItem('assignments.v1'); });
    await page.evaluate(() => {
      const s = JSON.parse(localStorage.getItem('assignments.v1'));
      s.assignments = []; s.ui.activeId = 'gone'; s.ui.view = 'today';
      s.ui.pomodoro = { id: 'gone', phase: 'work', endsAt: new Date(Date.now() + 600000).toISOString(), paused: false, durationMs: 1500000, startedAt: new Date().toISOString(), round: 1 };
      localStorage.setItem('assignments.v1', JSON.stringify(s));
    });
    await page.reload(); await page.waitForSelector('#view-root');
    await page.waitForTimeout(700);
    assert.strictEqual(await pomo(), null, 'orphaned timer removed');
    assert.ok(!(await page.$('#focus-root')) && !(await page.$('#pomo-chip')), 'no timer UI in the empty state');
    assert.ok(await page.isVisible('[data-action="load-demo"]'), 'empty state shown');
    assert.strictEqual(await page.title(), 'Assignments');
    await page.keyboard.press('p'); // no timer: P is a no-op, no errors
    await page.evaluate(s => localStorage.setItem('assignments.v1', s), snapshot);
    await page.reload(); await page.waitForSelector('#view-root');
  });

  await check('pomodoro: the shortcuts help lists P', async () => {
    await page.keyboard.press('?');
    await page.waitForSelector('#modal-root .modal');
    assert.ok((await page.textContent('#modal-root .shortcuts')).includes('Pause / resume focus timer'));
    await page.keyboard.press('Escape');
  });

  await reset();
  await page.setViewportSize({ width: 1440, height: 900 });
};
