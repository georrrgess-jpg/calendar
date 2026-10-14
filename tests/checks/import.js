/* Importer verification: re-imports, deletions in Classroom, exports without class calendars. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

module.exports = async ({ page, check, assert, fixtures }) => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ics-'));
  const write = (name, text) => { const p = path.join(tmp, name); fs.writeFileSync(p, text); return p; };
  const importFiles = async files => {
    await page.evaluate(() => { App.closeModal(); App.closePanel(); });
    await page.click('#btn-import');
    await page.setInputFiles('#file-ics', files);
    await page.waitForSelector('#import-summary:not([hidden])');
    return page.textContent('#import-summary');
  };
  const cal = events => 'BEGIN:VCALENDAR\r\nX-WR-CALNAME:Import Check Class\r\n' + events.map(e =>
    `BEGIN:VEVENT\r\nUID:${e.uid}\r\nSUMMARY:${e.title}\r\nDTSTART:${e.due}\r\nDTEND:${e.due}\r\nEND:VEVENT\r\n`).join('') + 'END:VCALENDAR\r\n';

  await check('re-import updates a moved due date, drops deleted open items, keeps deleted done items', async () => {
    const v1 = write('class.ics', cal([
      { uid: 'ic-1', title: 'Essay', due: '20261030T035900Z' },
      { uid: 'ic-2', title: 'Worksheet', due: '20261031T035900Z' },
      { uid: 'ic-3', title: 'Lab', due: '20261101T035900Z' }
    ]));
    let summary = await importFiles([v1]);
    assert.ok(summary.includes('3 new'), summary);
    await page.evaluate(() => App.completeAssignment('ic-3'));
    const v2 = write('class2.ics', cal([{ uid: 'ic-1', title: 'Essay (final)', due: '20261102T045900Z' }]));
    summary = await importFiles([v2]);
    assert.ok(summary.includes('deleted in Classroom'), summary);
    const r = await page.evaluate(() => ['ic-1', 'ic-2', 'ic-3'].map(id => { const a = App.byId(id); return a && { t: a.title, due: a.due, done: a.done }; }));
    assert.deepStrictEqual(r[0], { t: 'Essay (final)', due: '2026-11-02T04:59:00.000Z', done: false });
    assert.strictEqual(r[1], null, 'deleted open item removed');
    assert.ok(r[2] && r[2].done, 'deleted done item kept');
    await page.evaluate(() => { for (const id of ['ic-1', 'ic-3']) { const i = App.state.assignments.findIndex(a => a.id === id); if (i >= 0) App.state.assignments.splice(i, 1); } const c = App.state.classes.findIndex(c => c.name === 'Import Check Class'); if (c >= 0) App.state.classes.splice(c, 1); App.save(); App.render(); });
    await page.keyboard.press('Escape');
  });

  await check('an export with only personal and holiday calendars points to Paste from Classroom', async () => {
    const before = await page.evaluate(() => App.state.assignments.length);
    const personal = write('student@school.org.ics', 'BEGIN:VCALENDAR\r\nX-WR-CALNAME:student@school.org\r\nBEGIN:VEVENT\r\nUID:p1\r\nSUMMARY:Soccer\r\nDTSTART:20261015T220000Z\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n');
    const summary = await importFiles([personal, fixtures('holidays.ics')]);
    assert.ok(summary.includes('No class calendars were in this export'), summary);
    assert.strictEqual(await page.evaluate(() => App.state.assignments.length), before);
    await page.click('#import-summary [data-tab="paste"]');
    await page.waitForSelector('.paste-tab textarea', { state: 'visible' });
    await page.keyboard.press('Escape');
  });

  await check('a .zip dropped by mistake explains to unzip it first', async () => {
    const zip = write('calendar-export.zip', 'PK\u0003\u0004');
    await page.evaluate(() => App.closeModal());
    await page.setInputFiles('#file-ics', [zip]);
    await page.waitForSelector('.toast.is-err');
    assert.ok((await page.textContent('.toast.is-err')).includes('Unzip it first'));
  });
};
