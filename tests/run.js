#!/usr/bin/env node
/*
 * Plain Node test runner (no framework). Extracts the <script id="core-lib">
 * block from assignments.html and runs its pure functions against fixtures.
 *
 *   node tests/run.js
 *
 * The clock is fixed to Wed Oct 14 2026 10:00 local time and the time zone
 * to America/New_York so date assertions are deterministic.
 */
'use strict';
process.env.TZ = 'America/New_York';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const htmlPath = path.join(root, 'assignments.html');
const html = fs.readFileSync(htmlPath, 'utf8');
const m = /<script id="core-lib">([\s\S]*?)<\/script>/.exec(html);
if (!m) { console.error('core-lib script block not found in assignments.html'); process.exit(1); }
const sandbox = { module: { exports: {} }, console };
vm.runInNewContext(m[1], sandbox, { filename: 'core-lib.js' });
const C = sandbox.module.exports;
const fixture = name => fs.readFileSync(path.join(__dirname, 'fixtures', name), 'utf8');

const NOW = new Date(2026, 9, 14, 10, 0, 0); // Wednesday
let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name); }
  catch (e) { failed++; failures.push(name); console.log('  FAIL ' + name + '\n       ' + String(e.message).split('\n').join('\n       ')); }
}
const local = (y, mo, d, h, mi) => new Date(y, mo - 1, d, h || 0, mi || 0, 0, 0);

console.log('core-lib: strings');
test('unescapeICS handles \\, \\; \\n \\N and \\\\', () => {
  assert.strictEqual(C.unescapeICS('a\\, b\\; c\\nd\\Ne\\\\f'), 'a, b; c\nd\ne\\f');
  assert.strictEqual(C.unescapeICS('back\\\\n'), 'back\\n');
});
test('escapeHtml escapes the five characters', () => {
  assert.strictEqual(C.escapeHtml('<b a="1">&\'</b>'), '&lt;b a=&quot;1&quot;&gt;&amp;&#39;&lt;/b&gt;');
});
test('hash is stable and hex', () => {
  assert.strictEqual(C.hash('AP Biology|Lab 1'), C.hash('AP Biology|Lab 1'));
  assert.match(C.hash('x'), /^[0-9a-f]{8}$/);
  assert.notStrictEqual(C.hash('a'), C.hash('b'));
});

console.log('core-lib: iCalendar');
test('parseICSLine splits name, params (quoted too) and value', () => {
  const r = C.parseICSLine('DTSTART;TZID="America/New_York";VALUE=DATE-TIME:20261023T150000');
  assert.strictEqual(r.name, 'DTSTART');
  assert.strictEqual(r.params.TZID, 'America/New_York');
  assert.strictEqual(r.params.VALUE, 'DATE-TIME');
  assert.strictEqual(r.value, '20261023T150000');
  const u = C.parseICSLine('URL:https://classroom.google.com/c/abc:def');
  assert.strictEqual(u.value, 'https://classroom.google.com/c/abc:def');
});
test('unfoldICS joins continuation lines and normalises CRLF', () => {
  assert.strictEqual(C.unfoldICS('A:one\r\n two\r\n\tthree\r\nB:x'), 'A:onetwothree\nB:x');
});
const bio = C.parseICS(fixture('ap-bio.ics'));
test('ap-bio.ics: calendar name comes from X-WR-CALNAME', () => {
  assert.strictEqual(bio.calendarName, 'AP Biology - Period 3');
  assert.strictEqual(bio.timezone, 'America/New_York');
});
test('ap-bio.ics: all 8 VEVENTs parse, VTIMEZONE is ignored, one is cancelled', () => {
  assert.strictEqual(bio.events.length, 8);
  assert.strictEqual(bio.events.filter(e => e.status === 'CANCELLED').length, 1);
  assert.strictEqual(bio.warnings.length, 0);
});
test('ap-bio.ics: folded DESCRIPTION is unfolded and unescaped, link survives folding', () => {
  const e = bio.events[0];
  assert.strictEqual(e.summary, 'Cellular respiration worksheet');
  assert.ok(e.description.includes('cellular respiration, including the glycolysis, Krebs cycle'), e.description);
  assert.ok(e.description.includes('partial credit is given.'), e.description);
  assert.ok(e.description.includes('\n'), 'newlines kept');
  assert.strictEqual(C.extractClassroomUrl(e.description), 'https://classroom.google.com/c/NzM0OTg3/a/MTIzNDU2/details');
});
test('ap-bio.ics: all-day event is due at the end of that local day', () => {
  const { due, allDay } = C.dueFromEvent(bio.events[0]);
  assert.strictEqual(allDay, true);
  assert.strictEqual(due.getTime(), local(2026, 10, 17, 23, 59).getTime());
});
test('ap-bio.ics: UTC (Z) date-time converts to local time', () => {
  const { due, allDay } = C.dueFromEvent(bio.events[1]);
  assert.strictEqual(allDay, false);
  assert.strictEqual(due.getTime(), Date.UTC(2026, 9, 21, 3, 59, 0));
  assert.strictEqual(due.getHours(), 23); assert.strictEqual(due.getMinutes(), 59); assert.strictEqual(due.getDate(), 20);
});
test('ap-bio.ics: TZID=America/New_York date-time is 3:00 PM local', () => {
  const { due } = C.dueFromEvent(bio.events[2]);
  assert.strictEqual(due.getTime(), Date.UTC(2026, 9, 23, 19, 0, 0));
  assert.strictEqual(due.getHours(), 15);
});
test('ap-bio.ics: TZID=Europe/London converts across zones (GMT in November)', () => {
  const { due } = C.dueFromEvent(bio.events[6]);
  assert.strictEqual(due.getTime(), Date.UTC(2026, 10, 5, 12, 0, 0));
});
test('ap-bio.ics: URL property is kept, classroom link extracted otherwise', () => {
  const a = C.eventToAssignment(bio.events[5], { classId: 'c1' });
  assert.strictEqual(a.url, 'https://classroom.google.com/c/NzM0OTg3/a/Njc4OTAx/details');
  const b = C.eventToAssignment(bio.events[4], { classId: 'c1' });
  assert.strictEqual(b.url, 'https://classroom.google.com/c/NzM0OTg3/a/NTY3ODkw/details');
  assert.strictEqual(b.id, 'classroom-assignment-734987-567890@classroom.google.com');
  assert.strictEqual(b.cancelled, false);
  assert.strictEqual(C.eventToAssignment(bio.events[3], { classId: 'c1' }).cancelled, true);
});
test('unknown TZID falls back to local time with a warning', () => {
  const w = [];
  const r = C.parseICSDateTime('20261023T150000', { TZID: 'Mars/Olympus' }, w);
  assert.strictEqual(r.date.getTime(), local(2026, 10, 23, 15, 0).getTime());
  assert.strictEqual(w.length, 1);
});
test('zonedToDate handles a DST transition hour', () => {
  // 2026-03-08 02:30 does not exist in New York; it should resolve without throwing to a sane instant
  const d = C.zonedToDate(2026, 3, 8, 2, 30, 0, 'America/New_York');
  assert.ok(Math.abs(d.getTime() - Date.UTC(2026, 2, 8, 7, 30, 0)) <= 3600000);
  const sum = C.zonedToDate(2026, 7, 4, 12, 0, 0, 'America/Los_Angeles');
  assert.strictEqual(sum.getTime(), Date.UTC(2026, 6, 4, 19, 0, 0));
});
test('holidays.ics is detected as a non-class calendar, class calendars are not', () => {
  const h = C.parseICS(fixture('holidays.ics'));
  assert.strictEqual(h.calendarName, 'Holidays in United States');
  assert.strictEqual(C.isNonClassCalendar(h.calendarName), true);
  assert.strictEqual(C.isNonClassCalendar('Birthdays'), true);
  assert.strictEqual(C.isNonClassCalendar('student@school.org'), true);
  assert.strictEqual(C.isNonClassCalendar('AP Biology - Period 3'), false);
  assert.strictEqual(C.isNonClassCalendar('Spanish 2'), false);
});
test('parseICS copes with a truncated file and missing UID', () => {
  const r = C.parseICS('BEGIN:VCALENDAR\nX-WR-CALNAME:Art\nBEGIN:VEVENT\nSUMMARY:Sketch\nDTSTART;VALUE=DATE:20261101\nEND:VEVENT\nBEGIN:VEVENT\nSUMMARY:Cut off');
  assert.strictEqual(r.events.length, 1);
  assert.ok(r.events[0].uid.startsWith('gen-'));
  assert.ok(r.warnings.length >= 1);
});

console.log('core-lib: quick add');
const qa = s => C.parseQuickAdd(s, { now: NOW });
test('spec example: "Chem lab report fri 11:59pm #chem !high 45m"', () => {
  const p = qa('Chem lab report fri 11:59pm #chem !high 45m');
  assert.strictEqual(p.title, 'Chem lab report');
  assert.strictEqual(p.classTag, 'chem');
  assert.strictEqual(p.priority, 'high');
  assert.strictEqual(p.estimatedMin, 45);
  assert.strictEqual(p.allDay, false);
  assert.strictEqual(p.due.getTime(), local(2026, 10, 16, 23, 59).getTime());
});
test('"Read ch 5 tomorrow 3pm" → tomorrow 15:00', () => {
  const p = qa('Read ch 5 tomorrow 3pm');
  assert.strictEqual(p.title, 'Read ch 5');
  assert.strictEqual(p.due.getTime(), local(2026, 10, 15, 15, 0).getTime());
});
test('"Essay in 3 days 2h" → +3 days end of day, 120 min', () => {
  const p = qa('Essay in 3 days 2h');
  assert.strictEqual(p.title, 'Essay');
  assert.strictEqual(p.estimatedMin, 120);
  assert.strictEqual(p.due.getTime(), local(2026, 10, 17, 23, 59).getTime());
  assert.strictEqual(p.allDay, true);
});
test('"Quiz 10/20 #math !crit" → Oct 20, critical', () => {
  const p = qa('Quiz 10/20 #math !crit');
  assert.strictEqual(p.title, 'Quiz');
  assert.strictEqual(p.priority, 'critical');
  assert.strictEqual(p.due.getTime(), local(2026, 10, 20, 23, 59).getTime());
});
test('"Problem set due next mon" → Monday after the coming one, title cleaned', () => {
  const p = qa('Problem set due next mon');
  assert.strictEqual(p.title, 'Problem set');
  assert.strictEqual(p.due.getTime(), local(2026, 10, 26, 23, 59).getTime());
});
test('"Lab 2h fri 3pm" keeps estimate and time apart', () => {
  const p = qa('Lab 2h fri 3pm');
  assert.strictEqual(p.estimatedMin, 120);
  assert.strictEqual(p.due.getTime(), local(2026, 10, 16, 15, 0).getTime());
});
test('"Study 1h30m oct 17" and "Notes 90 min nov 3rd"', () => {
  let p = qa('Study 1h30m oct 17');
  assert.strictEqual(p.estimatedMin, 90);
  assert.strictEqual(p.due.getTime(), local(2026, 10, 17, 23, 59).getTime());
  p = qa('Notes 90 min nov 3rd');
  assert.strictEqual(p.estimatedMin, 90);
  assert.strictEqual(p.due.getTime(), local(2026, 11, 3, 23, 59).getTime());
});
test('"Call at 7" → 7 PM today (time in the future, no date)', () => {
  const p = qa('Call at 7');
  assert.strictEqual(p.title, 'Call');
  assert.strictEqual(p.due.getTime(), local(2026, 10, 14, 19, 0).getTime());
});
test('"Thing 9am" when 9am has passed → tomorrow 9:00', () => {
  const p = qa('Thing 9am');
  assert.strictEqual(p.due.getTime(), local(2026, 10, 15, 9, 0).getTime());
});
test('mm/dd more than 60 days in the past rolls to next year', () => {
  const p = qa('Thing 1/15');
  assert.strictEqual(p.due.getFullYear(), 2027);
});
test('no date → due null, title intact', () => {
  const p = qa('Just a title with 45m');
  assert.strictEqual(p.due, null);
  assert.strictEqual(p.title, 'Just a title with');
  assert.strictEqual(p.estimatedMin, 45);
});
test('"today" with "in 2 hours"', () => {
  const p = qa('Email teacher in 2 hours');
  assert.strictEqual(p.title, 'Email teacher');
  assert.strictEqual(p.due.getTime(), NOW.getTime() + 2 * 3600000);
});

console.log('core-lib: priority & countdown');
test('overdue exam is critical; far-off reading is low; manual estimate adds effort', () => {
  const ctx = { now: NOW, classOpenThisWeek: 1 };
  const overdueExam = C.priorityScore({ title: 'Unit 4 Exam', due: C.toISO(local(2026, 10, 13, 23, 59)) }, ctx);
  assert.strictEqual(overdueExam.score, 80);
  assert.strictEqual(C.scoreToPriority(overdueExam.score), 'critical');
  const reading = C.priorityScore({ title: 'Chapter 9 reading questions', due: C.toISO(local(2026, 10, 30, 23, 59)) }, ctx);
  assert.strictEqual(reading.score, 5);
  assert.strictEqual(C.scoreToPriority(reading.score), 'low');
  const proj = C.priorityScore({ title: 'Project proposal', due: C.toISO(local(2026, 10, 16, 23, 59)), estimatedMin: 300 }, { now: NOW, classOpenThisWeek: 3 });
  assert.strictEqual(JSON.stringify(proj.breakdown), JSON.stringify({ time: 25, keyword: 20, effort: 20, load: 5 }));
  assert.strictEqual(C.scoreToPriority(proj.score), 'critical');
  assert.strictEqual(C.scoreToPriority(44), 'medium');
  assert.strictEqual(C.scoreToPriority(45), 'high');
});
test('countdown text and states', () => {
  assert.strictEqual(C.countdown(new Date(NOW.getTime() + (26 * 60 + 12) * 60000 + 24 * 3600000), NOW).text, '2d 2h 12m');
  const hot = C.countdown(new Date(NOW.getTime() + 10 * 60000), NOW);
  assert.strictEqual(hot.text, '10m'); assert.strictEqual(hot.state, 'hot');
  const od = C.countdown(new Date(NOW.getTime() - 2 * 86400000 - 3600000), NOW);
  assert.strictEqual(od.short, 'Overdue by 2d'); assert.strictEqual(od.state, 'overdue');
  assert.strictEqual(C.countdown(null, NOW).state, 'none');
  assert.ok(C.urgencyHue(14 * 86400000) >= 210 && C.urgencyHue(10 * 60000) < 30 && C.urgencyHue(-1) === 0);
});
test('formatDue', () => {
  assert.strictEqual(C.formatDue(local(2026, 10, 14, 23, 59), false, NOW), 'Today, 11:59 PM');
  assert.strictEqual(C.formatDue(local(2026, 10, 15, 8, 0), false, NOW), 'Tomorrow, 8:00 AM');
  assert.strictEqual(C.formatDue(local(2026, 10, 16, 23, 59), true, NOW), 'Friday');
  assert.strictEqual(C.formatDue(local(2026, 10, 30, 23, 59), true, NOW), 'Fri, Oct 30');
  assert.strictEqual(C.formatDue(null, true, NOW), 'No due date');
});

console.log('core-lib: merge & streaks');
test('mergeImported preserves done, priority override, notes and estimate; updates title/due', () => {
  const existing = [{ id: 'u1', source: 'ics', title: 'Old title', classId: 'c1', due: C.toISO(local(2026, 10, 17, 23, 59)), allDay: true, done: true, doneAt: 'x', priority: 'low', priorityAuto: false, notes: 'my notes', estimatedMin: 55, sourceNotes: 'd', url: '' }];
  const incoming = [
    { id: 'u1', source: 'ics', title: 'New title', classId: 'c1', due: C.toISO(local(2026, 10, 18, 23, 59)), allDay: true, sourceNotes: 'd', url: '' },
    { id: 'u2', source: 'ics', title: 'Brand new', classId: 'c1', due: null, allDay: false, sourceNotes: '', url: '' }
  ];
  const r = C.mergeImported(existing, incoming, NOW);
  assert.strictEqual(r.added, 1); assert.strictEqual(r.updated, 1);
  const a = r.assignments.find(x => x.id === 'u1');
  assert.strictEqual(a.title, 'New title');
  assert.strictEqual(a.due, C.toISO(local(2026, 10, 18, 23, 59)));
  assert.strictEqual(a.done, true); assert.strictEqual(a.priority, 'low'); assert.strictEqual(a.priorityAuto, false);
  assert.strictEqual(a.notes, 'my notes'); assert.strictEqual(a.estimatedMin, 55);
  const b = r.assignments.find(x => x.id === 'u2');
  assert.strictEqual(b.priorityAuto, true); assert.strictEqual(b.done, false);
  const again = C.mergeImported(r.assignments, incoming, NOW);
  assert.strictEqual(again.added, 0); assert.strictEqual(again.updated, 0); assert.strictEqual(again.unchanged, 2);
});
test('mergeImported removes a cancelled event unless it was completed', () => {
  const existing = [{ id: 'u1', source: 'ics', title: 'A', done: false }, { id: 'u2', source: 'ics', title: 'B', done: true }];
  const r = C.mergeImported(existing, [{ id: 'u1', cancelled: true }, { id: 'u2', cancelled: true }, { id: 'u3', cancelled: true }], NOW);
  assert.strictEqual(r.removed, 1);
  assert.deepStrictEqual(r.assignments.map(a => a.id), ['u2']);
});
test('computeStreak counts consecutive days and tolerates no completion yet today', () => {
  const k = d => C.dayKey(C.addDays(NOW, d));
  assert.strictEqual(C.computeStreak({ [k(-1)]: 1, [k(-2)]: 2, [k(-3)]: 1 }, NOW).streak, 3);
  assert.strictEqual(C.computeStreak({ [k(0)]: 1, [k(-1)]: 1, [k(-3)]: 1 }, NOW).streak, 2);
  assert.strictEqual(C.computeStreak({ [k(-2)]: 1 }, NOW).streak, 0);
  assert.strictEqual(C.computeStreak({}, NOW).streak, 0);
  assert.strictEqual(C.last7Days({ [k(0)]: 2 }, NOW).length, 7);
});
test('demoData is self-consistent', () => {
  const d = C.demoData(NOW);
  const ids = new Set(d.classes.map(c => c.id));
  for (const a of d.assignments) assert.ok(ids.has(a.classId), a.title);
  assert.ok(d.assignments.some(a => C.parseISO(a.due) < NOW && !a.done), 'has an overdue item');
});

/* === FEATURE:PASTE:TESTS:START === */
/* === FEATURE:PASTE:TESTS:END === */

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('Failed: ' + failures.join(', ')); process.exit(1); }
