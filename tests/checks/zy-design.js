/* Design / navigation checks: the shared frame (toolbar per view, Filters popover), keyboard
   reach of quick add and search, the sliding nav indicator, phone layout and modal focus.
   Loaded by tests/browser.js after its own checks. Runs on demo data and restores the
   previous state at the end. */
'use strict';
module.exports = async ({ page, check, assert, SHOTS, shotsDir, path }) => {
  const VIEWS = ['overview', 'today', 'month', 'week', 'board', 'classes', 'log'];
  const snap = await page.evaluate(() => { App.closeModal(); App.closePanel(); App.save(true); return localStorage.getItem('assignments.v1'); });
  const blur = () => page.evaluate(() => { if (document.activeElement && document.activeElement.blur) document.activeElement.blur(); });
  const clearToasts = () => page.evaluate(() => { document.getElementById('toasts').innerHTML = ''; });
  await page.evaluate(() => {
    App.clearAll();
    App.loadDemo();
    const f = App.state.ui.filters; f.classes = []; f.priorities = []; f.search = ''; f.hideDone = true;
    App.save(true); App.render();
  });
  await clearToasts();

  try {
    await check('design: the assignment toolbar shows on list views and hides on Home and Log', async () => {
      for (const v of VIEWS) {
        await page.evaluate(v => App.setView(v), v);
        const vis = { quick: await page.isVisible('#quickadd'), search: await page.isVisible('#filter-search'), bar: await page.isVisible('#filterbar') };
        const want = !['overview', 'log'].includes(v);
        assert.deepStrictEqual(vis, { quick: want, search: want, bar: want }, v + ': ' + JSON.stringify(vis));
      }
      /* Import stays reachable from every view (it lives in the top bar). */
      await page.evaluate(() => App.setView('overview'));
      assert.ok(await page.isVisible('#btn-import'), 'Import button on Home');
    });

    await check('design: Filters popover holds the chips, its badge counts active filters, chips remove them', async () => {
      await page.evaluate(() => App.setView('today'));
      assert.ok(await page.isHidden('#filter-pop'), 'popover closed by default');
      assert.ok(await page.isHidden('#filter-badge'), 'no badge with no filters');
      assert.ok(await page.isHidden('#filter-active'), 'no active-filter row');
      await page.click('#btn-filters');
      assert.ok(await page.isVisible('#filter-pop'));
      assert.strictEqual(await page.getAttribute('#btn-filters', 'aria-expanded'), 'true');
      assert.ok(await page.isVisible('#filter-hide-done + .track'), 'hide-done switch inside the popover');
      const cls = await page.getAttribute('#filter-classes .chip >> nth=0', 'data-class');
      await page.click(`#filter-classes .chip[data-class="${cls}"]`);
      assert.ok(await page.isVisible('#filter-pop'), 'stays open while picking');
      await page.click('#filter-priorities .chip[data-priority="high"]');
      assert.strictEqual((await page.textContent('#filter-badge')).trim(), '2');
      assert.strictEqual(await page.getAttribute('#btn-filters', 'aria-label'), 'Filters, 2 active');
      assert.deepStrictEqual(await page.evaluate(() => ({ c: App.state.ui.filters.classes.length, p: App.state.ui.filters.priorities })), { c: 1, p: ['high'] });
      /* Clicking outside closes it; the active filters stay visible as removable chips. */
      await page.mouse.click(5, 400);
      await page.waitForSelector('#filter-pop', { state: 'hidden', timeout: 2000 });
      assert.strictEqual(await page.getAttribute('#btn-filters', 'aria-expanded'), 'false');
      assert.strictEqual(await page.$$eval('#filter-active .fchip', els => els.length), 2);
      /* Overdue items still show whatever the filters say. */
      const overdueShown = await page.evaluate(() => {
        const od = App.state.assignments.filter(a => !a.done && !a.archived && App.isOverdue(a)).map(a => a.id);
        return od.every(id => document.querySelector(`.view.active .item[data-id="${id}"]`));
      });
      assert.ok(overdueShown, 'overdue items stay visible under filters');
      await page.click('#filter-active .fchip[data-priority="high"]');
      assert.strictEqual((await page.textContent('#filter-badge')).trim(), '1');
      assert.deepStrictEqual(await page.evaluate(() => App.state.ui.filters.priorities), []);
      await page.fill('#filter-search', 'lab');
      await page.waitForSelector('#filter-active [data-action="clear-search"]');
      await page.click('#filter-active button:has-text("Clear all")');
      assert.ok(await page.isHidden('#filter-badge'), 'badge gone after Clear all');
      assert.ok(await page.isHidden('#filter-active'));
      assert.deepStrictEqual(await page.evaluate(() => App.state.ui.filters), { classes: [], priorities: [], hideDone: true, search: '' });
      /* Keyboard: Esc closes it and returns focus to the button. */
      await page.focus('#btn-filters');
      await page.keyboard.press('Enter');
      assert.ok(await page.isVisible('#filter-pop'));
      await page.keyboard.press('Escape');
      await page.waitForSelector('#filter-pop', { state: 'hidden', timeout: 2000 });
      assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'btn-filters');
      /* The hide-done switch still works from inside the popover. */
      await page.click('#btn-filters');
      await page.click('#filter-pop .switch');
      assert.strictEqual(await page.evaluate(() => App.state.ui.filters.hideDone), false);
      await page.click('#filter-pop .switch');
      assert.strictEqual(await page.evaluate(() => App.state.ui.filters.hideDone), true);
      await page.keyboard.press('Escape');
    });

    await check('design: N and / work from Home; Add assignment on Home reveals quick add', async () => {
      await page.evaluate(() => App.setView('overview'));
      await blur();
      await page.keyboard.press('n');
      assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'quickadd');
      assert.ok(await page.isVisible('#quickadd'), 'quick add slides in on Home');
      assert.ok(await page.isHidden('#filterbar'), 'only quick add, not the filters, on Home');
      assert.strictEqual(await page.evaluate(() => App.state.ui.view), 'overview', 'stays on Home');
      await page.fill('#quickadd', 'Design check essay tomorrow 3pm');
      await page.press('#quickadd', 'Enter');
      await page.waitForFunction(() => App.state.assignments.some(a => a.title === 'Design check essay'));
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.getElementById('tools').classList.contains('is-peek'));
      assert.ok(await page.isHidden('#quickadd'), 'tucked away again');
      await page.keyboard.press('/');
      assert.strictEqual(await page.evaluate(() => App.state.ui.view), 'today', '/ opens Next Up');
      assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'filter-search');
      await page.keyboard.press('Escape');
      await page.keyboard.press('7');
      await blur();
      await page.keyboard.press('n');
      assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'quickadd', 'N from the Log');
      await page.keyboard.press('Escape');
      await page.evaluate(() => App.setView('overview'));
      await page.click('.ov-greet [data-action="ov-add"]');
      assert.strictEqual(await page.evaluate(() => document.activeElement.id), 'quickadd');
      assert.ok(await page.isVisible('#quickadd'));
      await page.keyboard.press('Escape');
      await page.evaluate(() => { App.state.assignments = App.state.assignments.filter(a => a.title !== 'Design check essay'); App.recomputePriorities(); App.save(true); App.render(); });
      await clearToasts();
    });

    const indicatorMatches = () => page.evaluate(() => {
      const ind = document.getElementById('nav-ind').getBoundingClientRect();
      const btn = document.querySelector('#nav .nav-btn[aria-current="page"]').getBoundingClientRect();
      return { dx: Math.abs(ind.left - btn.left), dw: Math.abs(ind.width - btn.width), view: document.querySelector('#nav .nav-btn[aria-current="page"]').dataset.view };
    });
    await check('design: the nav indicator slides to the active view; views slide in the nav direction', async () => {
      await page.evaluate(() => App.setView('overview'));
      await blur();
      for (const [i, v] of VIEWS.entries()) {
        await page.keyboard.press(String(i + 1));
        await page.waitForTimeout(450);
        const m = await indicatorMatches();
        assert.strictEqual(m.view, v);
        assert.ok(m.dx < 1.5 && m.dw < 1.5, v + ': indicator off by ' + JSON.stringify(m));
      }
      assert.strictEqual(await page.evaluate(() => document.getElementById('view-root').dataset.dir), 'next');
      await page.keyboard.press('3');
      assert.strictEqual(await page.evaluate(() => document.getElementById('view-root').dataset.dir), 'prev', 'moving left in the nav slides the other way');
      const anim = await page.$eval('.view.active', el => getComputedStyle(el).animationName);
      assert.strictEqual(anim, 'view-in-prev');
      /* The entrance stagger is applied once, not on every re-render. */
      await page.keyboard.press('2');
      assert.ok(await page.evaluate(() => document.querySelectorAll('.view.active .stg').length > 0), 'staggered entrance on first view');
      await page.evaluate(() => App.render());
      assert.strictEqual(await page.evaluate(() => document.querySelectorAll('.view.active .stg').length), 0, 'no replay on re-render');
    });

    await check('design: 360px: no horizontal overflow on any view; bottom nav has 44px targets and clears content', async () => {
      await page.setViewportSize({ width: 360, height: 740 });
      for (const v of VIEWS) {
        await page.evaluate(v => { App.setView(v); window.scrollTo(0, 0); }, v);
        await page.waitForTimeout(350);
        const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        assert.ok(over <= 0, v + ': horizontal overflow ' + over + 'px');
        const m = await indicatorMatches();
        assert.ok(m.dx < 1.5 && m.dw < 1.5, v + ': indicator ' + JSON.stringify(m));
        if (SHOTS) await page.screenshot({ path: path.join(shotsDir, `design-${v}-360.png`) });
      }
      const nav = await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('#nav .nav-btn')).map(b => { const r = b.getBoundingClientRect(); const l = b.querySelector('.nav-label'); return { w: r.width, h: r.height, right: r.right, left: r.left, cut: l.scrollWidth > l.clientWidth + 1 }; });
        const navR = document.getElementById('nav').getBoundingClientRect();
        return { btns, navTop: navR.top, navBottom: navR.bottom, pos: getComputedStyle(document.getElementById('nav')).position };
      });
      assert.strictEqual(nav.pos, 'fixed');
      assert.strictEqual(nav.btns.length, 7);
      for (const b of nav.btns) {
        assert.ok(b.w >= 44 && b.h >= 44, 'touch target ' + JSON.stringify(b));
        assert.ok(b.left >= 0 && b.right <= 360, 'inside the screen');
        assert.ok(!b.cut, 'label not cut off');
      }
      /* The end of the page and toasts sit above the nav. */
      await page.evaluate(() => { App.setView('today'); window.scrollTo(0, document.body.scrollHeight); });
      await page.waitForTimeout(200);
      const foot = await page.evaluate(() => document.querySelector('.footer button, .footer span').getBoundingClientRect().bottom);
      assert.ok(foot <= nav.navTop, 'footer content clears the nav: ' + foot + ' vs ' + nav.navTop);
      await page.evaluate(() => App.toast('Design toast', 'ok'));
      await page.waitForTimeout(450);
      const tb = await page.evaluate(() => document.querySelector('#toasts .toast:last-child').getBoundingClientRect().bottom);
      assert.ok(tb <= nav.navTop, 'toast above the nav: ' + tb + ' vs ' + nav.navTop);
      await clearToasts();
      /* Filters open as a bottom sheet above the nav. */
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.click('#btn-filters');
      await page.waitForTimeout(350);
      const sheet = await page.evaluate(() => { const r = document.getElementById('filter-pop').getBoundingClientRect(); return { left: r.left, right: r.right, bottom: r.bottom }; });
      assert.ok(sheet.left >= 0 && sheet.right <= 360 && Math.round(sheet.bottom) <= 740, JSON.stringify(sheet));
      if (SHOTS) await page.screenshot({ path: path.join(shotsDir, 'design-filters-360.png') });
      await page.click('#filter-scrim', { position: { x: 180, y: 60 } });
      await page.waitForSelector('#filter-pop', { state: 'hidden', timeout: 2000 });
      await page.setViewportSize({ width: 1440, height: 900 });
    });

    await check('design: modals still trap focus and close at once; help groups the shortcuts', async () => {
      await page.evaluate(() => App.setView('today'));
      await blur();
      await page.keyboard.press(',');
      await page.waitForSelector('#modal-root .modal');
      const focusables = sel => page.evaluate(sel => Array.from(document.querySelectorAll(sel)).filter(el => el.offsetParent !== null).length, sel);
      assert.ok(await focusables('#modal-root .modal button') > 2);
      await page.evaluate(() => { const all = Array.from(document.querySelectorAll('#modal-root .modal button:not([disabled])')).filter(el => el.offsetParent !== null); all[all.length - 1].focus(); });
      await page.keyboard.press('Tab');
      assert.ok(await page.evaluate(() => !!document.activeElement.closest('#modal-root .modal')), 'Tab from the last control stays in the dialog');
      await page.evaluate(() => document.querySelector('#modal-root .modal [data-action="close-modal"]').focus());
      for (let i = 0; i < 40; i++) {
        await page.keyboard.press('Shift+Tab');
        assert.ok(await page.evaluate(() => !!document.activeElement.closest('#modal-root .modal')), 'Shift+Tab stays in the dialog (step ' + i + ')');
      }
      await page.keyboard.press('Escape');
      assert.strictEqual(await page.evaluate(() => document.querySelectorAll('.modal').length), 0, 'closed dialog is gone from the document at once');
      await page.keyboard.press('?');
      await page.waitForSelector('#modal-root .sc-group');
      const groups = await page.$$eval('#modal-root .sc-group h3', els => els.map(e => e.lastChild.textContent.trim()));
      assert.deepStrictEqual(groups, ['Anywhere', 'Switch views', 'Inside a view']);
      assert.strictEqual(await page.$$eval('#modal-root .sc-group:nth-child(2) dt', els => els.length), 7, 'one row per view');
      await page.keyboard.press('Escape');
      assert.ok(!(await page.$('#modal-root .modal')));
    });

    await check('design: reduced motion: no stagger, no sliding, brand mark still', async () => {
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate(() => App.setView('board'));
      assert.strictEqual(await page.evaluate(() => document.querySelectorAll('.view.active .stg').length), 0);
      const t = await page.$eval('#nav-ind', el => getComputedStyle(el).transitionDuration);
      assert.ok(t.split(',').every(x => parseFloat(x) < 0.01), 'indicator transition ' + t);
      assert.strictEqual(await page.$eval('.brand-mark', el => getComputedStyle(el).animationName), 'none');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
    });

    await check('design: first run on Home offers classes, Google import (paste first), demo data and the log', async () => {
      await page.evaluate(() => { App.closeModal(); App.clearAll(); App.setView('overview'); });
      await clearToasts();
      const steps = await page.$$eval('.view.active .start-step h3', els => els.map(e => e.textContent.trim()));
      assert.deepStrictEqual(steps, ['Add your classes', 'Import from Google', 'Try demo data', 'Start your daily log']);
      for (const sel of ['[data-action="ov-add-class"]', '[data-action="open-import"][data-tab="paste"]', '[data-action="load-demo"]', '[data-action="ov-log"]']) {
        assert.ok(await page.isVisible('.view.active .start-card ' + sel), sel);
      }
      await page.click('.view.active .start-card [data-action="open-import"][data-tab="paste"]');
      await page.waitForSelector('#paste-text', { state: 'visible' });
      assert.strictEqual(await page.getAttribute('#modal-root [role="tab"][data-tab="paste"]', 'aria-selected'), 'true');
      await page.keyboard.press('Escape');
      await page.click('.view.active .start-card [data-action="ov-add-class"]');
      await page.waitForSelector('.cp-modal');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('#modal-root .modal'));
      if (SHOTS) {
        for (const theme of ['dark', 'light']) {
          await page.evaluate(t => { App.state.settings.theme = t; App.applyTheme(); }, theme);
          await page.waitForTimeout(500);
          await page.screenshot({ path: path.join(shotsDir, `design-first-run-1440-${theme}.png`) });
        }
      }
    });
  } finally {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.evaluate(snap => {
      App.closeModal(); App.closePanel();
      localStorage.setItem('assignments.v1', snap);
      App.load(); App.recomputePriorities(); App.applyTheme(); App.renderAll();
      document.getElementById('toasts').innerHTML = '';
    }, snap);
    await page.keyboard.press('Escape');
  }
};
