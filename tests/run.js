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
const sandbox = { module: { exports: {} }, console, TextDecoder, Intl };
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

test('decodeICSBytes unfolds before decoding, so a fold inside a multi-byte character is safe', () => {
  const line = Buffer.from('SUMMARY:' + 'a'.repeat(66) + 'é😀 ok', 'utf8');
  const bytes = Buffer.concat([Buffer.from('\ufeffBEGIN:VCALENDAR\r\nX-WR-CALNAME:Art\r\nBEGIN:VEVENT\r\nUID:x\r\nDTSTART;VALUE=DATE:20261101\r\n'), line.subarray(0, 75), Buffer.from('\r\n '), line.subarray(75), Buffer.from('\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n')]);
  assert.ok(line[74] === 0xc3, 'fixture really splits é');
  const r = C.parseICS(C.decodeICSBytes(new Uint8Array(bytes)));
  assert.strictEqual(r.calendarName, 'Art');
  assert.ok(r.events[0].summary.endsWith('aé😀 ok'), r.events[0].summary);
});
test('VALARM blocks inside an event do not leak their DESCRIPTION', () => {
  const r = C.parseICS('BEGIN:VCALENDAR\nX-WR-CALNAME:Art\nBEGIN:VEVENT\nUID:a\nSUMMARY:Sketch\nDESCRIPTION:real\nBEGIN:VALARM\nDESCRIPTION:Reminder\nEND:VALARM\nDTSTART;VALUE=DATE:20261101\nEND:VEVENT\nEND:VCALENDAR');
  assert.strictEqual(r.events.length, 1); assert.strictEqual(r.events[0].description, 'real');
  assert.ok(r.events[0].start && r.events[0].start.allDay, 'properties after VALARM still read');
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

/* ---------- smart prompt (Create assignment dialog and the quick-add bar) ---------- */
console.log('core-lib: smart prompt');
const CLASSES = [
  { id: 'psy', name: 'AP Psychology' }, { id: 'chem', name: 'Chemistry' }, { id: 'bio', name: 'AP Biology' },
  { id: 'ush', name: 'AP US History' }, { id: 'eng', name: 'English 11' }, { id: 'pre', name: 'Precalculus' }
];
const sp = (s, classes) => C.parseSmartPrompt(s, { now: NOW, classes: classes || CLASSES });
test('the student example: "Unit 1 test psych Est time 15 min due on the 10th"', () => {
  const p = sp('Unit 1 test psych Est time 15 min due on the 10th');
  assert.strictEqual(p.title, 'Unit 1 test');
  assert.strictEqual(p.classId, 'psy');
  assert.strictEqual(p.classWord, 'psych');
  assert.strictEqual(p.estimatedMin, 15);
  assert.strictEqual(p.allDay, true);
  assert.strictEqual(p.due.getTime(), local(2026, 11, 10, 23, 59).getTime());
});
test('the example also matches a class named just "Psychology"', () => {
  const p = sp('Unit 1 test psych Est time 15 min due on the 10th', [{ id: 'p2', name: 'Psychology' }]);
  assert.strictEqual(p.title, 'Unit 1 test');
  assert.strictEqual(p.classId, 'p2');
});
test('parseSmartPrompt and parseQuickAdd are the same parser', () => {
  assert.strictEqual(C.parseSmartPrompt, C.parseQuickAdd);
});
test('"the 10th" is today on the 10th, otherwise the coming 10th', () => {
  const on10 = C.parseQuickAdd('Essay due the 10th', { now: local(2026, 11, 10, 9, 0) });
  assert.strictEqual(on10.due.getTime(), local(2026, 11, 10, 23, 59).getTime());
  assert.strictEqual(on10.title, 'Essay');
  assert.strictEqual(sp('Lab due the 22nd').due.getTime(), local(2026, 10, 22, 23, 59).getTime());
  assert.strictEqual(sp('Read due the 3rd').due.getTime(), local(2026, 11, 3, 23, 59).getTime());
  assert.strictEqual(sp('Poster on the 22nd').title, 'Poster');
  /* The 31st skips months that do not have one. */
  assert.strictEqual(C.parseQuickAdd('Report due the 31st', { now: local(2026, 11, 2, 9, 0) }).due.getTime(), local(2026, 12, 31, 23, 59).getTime());
  assert.strictEqual(sp('Essay the 10th of november').due.getTime(), local(2026, 11, 10, 23, 59).getTime());
});
test('estimate forms: est 15m, estimated 2 hours, takes 45 minutes, ~30m, 15 min, est: 1h 30m', () => {
  const cases = [['Worksheet est 15m', 15, 'Worksheet'], ['Essay estimated 2 hours', 120, 'Essay'], ['Lab writeup takes 45 minutes', 45, 'Lab writeup'],
    ['Flashcards ~30m', 30, 'Flashcards'], ['Reading log 15 min', 15, 'Reading log'], ['Poster est: 1h 30m', 90, 'Poster'], ['Notes Est time 20 min', 20, 'Notes']];
  for (const [s, min, title] of cases) {
    const p = sp(s);
    assert.strictEqual(p.estimatedMin, min, s);
    assert.strictEqual(p.title, title, s);
  }
});
test('due forms: "due 10/20", "due friday", "due tomorrow at 3pm", "due next week"', () => {
  let p = sp('Quiz review due 10/20');
  assert.strictEqual(p.title, 'Quiz review');
  assert.strictEqual(p.due.getTime(), local(2026, 10, 20, 23, 59).getTime());
  p = sp('Outline due friday');
  assert.strictEqual(p.title, 'Outline');
  assert.strictEqual(p.due.getTime(), local(2026, 10, 16, 23, 59).getTime());
  p = sp('Slides due tomorrow at 3pm');
  assert.strictEqual(p.title, 'Slides');
  assert.strictEqual(p.due.getTime(), local(2026, 10, 15, 15, 0).getTime());
  assert.strictEqual(p.allDay, false);
  p = sp('Portfolio due next week');
  assert.strictEqual(p.title, 'Portfolio');
  assert.strictEqual(p.due.getTime(), local(2026, 10, 21, 23, 59).getTime());
});
test('bare class words: chem, bio, apush, "us history", "ap psych", math nickname', () => {
  let p = sp('chem lab report fri');
  assert.strictEqual(p.classId, 'chem'); assert.strictEqual(p.title, 'lab report');
  p = sp('Enzyme worksheet for bio');
  assert.strictEqual(p.classId, 'bio'); assert.strictEqual(p.title, 'Enzyme worksheet');
  p = sp('apush DBQ due thursday');
  assert.strictEqual(p.classId, 'ush'); assert.strictEqual(p.title, 'DBQ');
  p = sp('Chapter 9 outline us history');
  assert.strictEqual(p.classId, 'ush'); assert.strictEqual(p.title, 'Chapter 9 outline');
  p = sp('Unit 2 quiz in ap psych');
  assert.strictEqual(p.classId, 'psy'); assert.strictEqual(p.title, 'Unit 2 quiz');
  p = sp('math homework 4.3');
  assert.strictEqual(p.classId, 'pre'); assert.strictEqual(p.title, 'homework 4.3');
});
test('never strips a word that names no class, or that names two', () => {
  let p = sp('Unit 1 test tomorrow');
  assert.strictEqual(p.classId, null); assert.strictEqual(p.title, 'Unit 1 test');
  p = sp('Finish his lab notes');
  assert.strictEqual(p.classId, null); assert.strictEqual(p.title, 'Finish his lab notes');
  p = sp('AP review packet', CLASSES); /* "AP" alone is in three class names */
  assert.strictEqual(p.classId, null); assert.strictEqual(p.title, 'AP review packet');
  p = sp('bio test', [{ id: 'a', name: 'Biology' }, { id: 'b', name: 'AP Biology' }]);
  assert.strictEqual(p.classId, null, 'ambiguous'); assert.strictEqual(p.title, 'bio test');
  p = sp('biology test', [{ id: 'a', name: 'Biology' }, { id: 'b', name: 'AP Biology' }]);
  assert.strictEqual(p.classId, 'a', 'an exact name wins');
  p = sp('Chemistry due fri');
  assert.strictEqual(p.classId, 'chem'); assert.strictEqual(p.title, 'Chemistry', 'keeps the word when it is the whole title');
  p = sp('psych essay', []);
  assert.strictEqual(p.classId, null); assert.strictEqual(p.title, 'psych essay');
});
test('a #tag wins over bare words, and the existing example is unchanged with classes', () => {
  const p = sp('Chem lab report fri 11:59pm #chem !high 45m');
  assert.strictEqual(p.title, 'Chem lab report'); assert.strictEqual(p.classTag, 'chem'); assert.strictEqual(p.classId, null);
  assert.strictEqual(p.priority, 'high'); assert.strictEqual(p.estimatedMin, 45);
});
test('priority words: !high, high priority, urgent, important', () => {
  assert.strictEqual(sp('Essay !high').priority, 'high');
  let p = sp('Essay high priority fri');
  assert.strictEqual(p.priority, 'high'); assert.strictEqual(p.title, 'Essay');
  p = sp('urgent permission slip');
  assert.strictEqual(p.priority, 'critical'); assert.strictEqual(p.title, 'permission slip');
  p = sp('Important reading quiz');
  assert.strictEqual(p.priority, 'high'); assert.strictEqual(p.title, 'reading quiz');
  assert.strictEqual(sp('Essay low priority').priority, 'low');
  assert.strictEqual(sp('Essay priority: critical').priority, 'critical');
  assert.strictEqual(sp('Essay draft').priority, '');
});
test('progress: "50% done", "half done", "progress 30%", "almost done"', () => {
  let p = sp('Lab report 50% done due fri');
  assert.strictEqual(p.progress, 50); assert.strictEqual(p.title, 'Lab report');
  p = sp('Essay half done');
  assert.strictEqual(p.progress, 50); assert.strictEqual(p.title, 'Essay');
  assert.strictEqual(sp('Poster progress 30%').progress, 30);
  assert.strictEqual(sp('Poster almost done').progress, 90);
  assert.strictEqual(sp('Poster 25% complete').progress, 25);
  assert.strictEqual(sp('Poster').progress, null);
});
test('glue words next to removed pieces are trimmed, others are kept', () => {
  assert.strictEqual(sp('Study guide for chem due on the 10th').title, 'Study guide');
  assert.strictEqual(sp('Turn it in').title, 'Turn it in');
  assert.strictEqual(sp('The Great Gatsby essay due fri').title, 'The Great Gatsby essay');
  assert.strictEqual(sp('Notes on the reading est 20m').title, 'Notes on the reading');
});
test('matchClassWords and nextDayOfMonth are exported for the app', () => {
  assert.deepStrictEqual(JSON.parse(JSON.stringify(C.matchClassWords('test psych', CLASSES))), { id: 'psy', start: 1, count: 1 });
  assert.strictEqual(C.matchClassWords('test', CLASSES), null);
  assert.strictEqual(C.nextDayOfMonth(NOW, 14).getTime(), local(2026, 10, 14).getTime());
  assert.strictEqual(C.nextDayOfMonth(NOW, 15).getTime(), local(2026, 10, 15).getTime());
  assert.strictEqual(C.nextDayOfMonth(NOW, 0), null);
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
console.log('core-lib: paste import (Classroom To-do)');
/* Arrays built inside the core-lib VM context have a different prototype, so compare as main-realm arrays. */
const sameList = (actual, expected, msg) => assert.deepStrictEqual(Array.from(actual), expected, msg);
const paste = C.parseTodoPaste(fixture('todo-paste.txt'), { now: NOW });
const pItem = (r, title) => { const it = r.items.find(x => x.title === title); assert.ok(it, 'missing item ' + title + ' in ' + r.items.map(x => x.title).join(' | ')); return it; };
const isAt = (d, y, mo, day, h, mi) => { assert.ok(d instanceof Date || (d && typeof d.getTime === 'function'), 'expected a date, got ' + d); assert.strictEqual(d.getTime(), local(y, mo, day, h, mi).getTime(), 'expected ' + local(y, mo, day, h, mi) + ' got ' + d); };
test('todo-paste.txt: 11 items, page chrome and counts ignored, no warnings', () => {
  sameList(paste.items.map(i => i.title), [
    'Cellular respiration worksheet', 'Titration lab write-up', 'Gatsby chapter 4 annotations', 'Vectors practice set',
    'Unit 4 study guide', 'Limits problem set', 'Research paper outline', 'Chapter 6 test',
    'Extra credit: science fair reflection', 'Reconstruction primary sources', 'Summer reading reflection'
  ]);
  sameList(paste.warnings, []);
});
test('todo-paste.txt: class is the line above "Due", title the one above that', () => {
  sameList(paste.items.map(i => i.className), [
    'AP Biology - Period 3', 'Chemistry', 'English 11', 'Precalculus', 'US History', 'Precalculus', 'English 11', 'Precalculus',
    'AP Biology - Period 3', 'US History', 'English 11'
  ]);
  sameList(paste.items.map(i => i.section), ['this week', 'this week', 'this week', 'this week', 'next week', 'next week', 'later', 'later', 'no due date', 'missing', 'missing']);
});
test('todo-paste.txt: relative, weekday and month-day due formats resolve against now', () => {
  const ws = pItem(paste, 'Cellular respiration worksheet');        // "Due Saturday" (this week)
  isAt(ws.due, 2026, 10, 17, 23, 59); assert.strictEqual(ws.allDay, true);
  const lab = pItem(paste, 'Titration lab write-up');                // "Due Oct 16, 11:59 PM"
  isAt(lab.due, 2026, 10, 16, 23, 59); assert.strictEqual(lab.allDay, false);
  const today = pItem(paste, 'Gatsby chapter 4 annotations');        // "Due Today"
  isAt(today.due, 2026, 10, 14, 23, 59); assert.strictEqual(today.allDay, true);
  isAt(pItem(paste, 'Vectors practice set').due, 2026, 10, 15, 8, 0); // "Due Tomorrow, 8:00 AM"
  isAt(pItem(paste, 'Unit 4 study guide').due, 2026, 10, 21, 10, 30);
  const mon = pItem(paste, 'Limits problem set');                     // "Due Monday" under Next week
  isAt(mon.due, 2026, 10, 19, 23, 59); assert.strictEqual(mon.allDay, true);
  isAt(pItem(paste, 'Research paper outline').due, 2026, 10, 28, 23, 59);
  isAt(pItem(paste, 'Chapter 6 test').due, 2026, 11, 3, 23, 59);
});
test('todo-paste.txt: "No due date" items have no date; "Missing" items are overdue and never rolled forward', () => {
  const nd = pItem(paste, 'Extra credit: science fair reflection');
  assert.strictEqual(nd.due, null); assert.strictEqual(nd.missing, false);
  const rp = pItem(paste, 'Reconstruction primary sources');
  assert.strictEqual(rp.missing, true); isAt(rp.due, 2026, 10, 9, 23, 59);
  const summer = pItem(paste, 'Summer reading reflection');           // Aug 8 is >60 days back but Missing: stays 2026
  assert.strictEqual(summer.missing, true); isAt(summer.due, 2026, 8, 8, 23, 59);
  assert.ok(summer.due < NOW && rp.due < NOW);
  assert.strictEqual(paste.items.filter(i => i.missing).length, 2);
});
test('paste keys are p_ + hash(class|title), stable across re-parse, CRLF and spacing changes', () => {
  const it = pItem(paste, 'Titration lab write-up');
  assert.strictEqual(it.key, 'p_' + C.hash(C.normalizeName('Chemistry') + '|' + C.normalizeName('Titration lab write-up')));
  const again = C.parseTodoPaste(fixture('todo-paste.txt').replace(/\n/g, '\r\n').replace(/Chemistry/g, '  Chemistry '), { now: C.addDays(NOW, 2) });
  sameList(again.items.map(i => i.key), Array.from(paste.items.map(i => i.key)));
  assert.strictEqual(new Set(paste.items.map(i => i.key)).size, paste.items.length);
});
test('year rollover: a month-day more than ~60 days back rolls into next year (outside Missing)', () => {
  const r = C.parseTodoPaste('Later\nSemester project\nWorld History\nDue January 8\nRecital\nBand\nDue Aug 1\nRecap\nBand\nDue Sep 1', { now: NOW });
  isAt(pItem(r, 'Semester project').due, 2027, 1, 8, 23, 59);
  isAt(pItem(r, 'Recital').due, 2027, 8, 1, 23, 59);      // 74 days back: next year's Aug 1
  isAt(pItem(r, 'Recap').due, 2026, 9, 1, 23, 59);        // 43 days back: kept in 2026 (shows as overdue)
});
const messy = C.parseTodoPaste(fixture('paste-messy.txt'), { now: NOW });
test('paste-messy.txt: 14 items despite chrome, account lines, tabs, CRLF and odd spacing; no warnings', () => {
  sameList(messy.items.map(i => i.title), [
    'Peer review sign-up', 'Quick write: Hamlet act 1', 'Momentum lab', 'Vocab quiz corrections', 'Hamlet reading log',
    'DBQ essay draft', 'Lab notebook check', 'Semester project proposal', 'Unit 2 test', 'Summer reading journal',
    'Course syllabus signature', 'Lab equipment quiz', 'Cell phone policy form', 'Lit circle roles'
  ]);
  sameList(messy.warnings, []);
  assert.ok(!messy.items.some(i => /Jordan|@|Google|Privacy|Posted|View all|Woohoo/.test(i.title + i.className)), 'chrome leaked into items');
});
test('paste-messy.txt: unusual due formats (24h, bare time, non-US day-month, p.m., numeric, tab-separated)', () => {
  isAt(pItem(messy, 'Quick write: Hamlet act 1').due, 2026, 10, 14, 23, 59);  // "Due 11:59 PM" with a narrow no-break space
  assert.strictEqual(pItem(messy, 'Quick write: Hamlet act 1').allDay, false);
  isAt(pItem(messy, 'Momentum lab').due, 2026, 10, 15, 10, 0);                 // "Due Thursday 10:00"
  const tab = pItem(messy, 'Hamlet reading log');                              // title<TAB>class<TAB>Due Fri, 11:59 PM
  assert.strictEqual(tab.className, 'English Lit — Block A'); isAt(tab.due, 2026, 10, 16, 23, 59);
  isAt(pItem(messy, 'DBQ essay draft').due, 2026, 10, 20, 15, 0);              // "Due Oct. 20, 2026, 3:00 p.m."
  isAt(pItem(messy, 'Lab notebook check').due, 2026, 10, 21, 23, 59);          // "Due Wednesday" under Next week
  isAt(pItem(messy, 'Semester project proposal').due, 2027, 1, 8, 23, 59);     // rolled into next year
  isAt(pItem(messy, 'Unit 2 test').due, 2026, 10, 30, 23, 59);                 // "Due 10/30"
  isAt(pItem(messy, 'Lit circle roles').due, 2026, 10, 23, 23, 59);            // "Due 23 Oct"
  isAt(pItem(messy, 'Cell phone policy form').due, 2026, 10, 2, 23, 59);       // "Due 2 Oct, 23:59 Missing"
  assert.strictEqual(pItem(messy, 'Peer review sign-up').due, null);
  assert.strictEqual(pItem(messy, 'Momentum lab').className, 'Physics, Period 2');
});
test('paste-messy.txt: Missing / Turned in markers, inline or on their own line, attach to the item above', () => {
  const vocab = pItem(messy, 'Vocab quiz corrections');                        // "Due yesterday" then a "Missing" line
  assert.strictEqual(vocab.missing, true); isAt(vocab.due, 2026, 10, 13, 23, 59);
  assert.strictEqual(pItem(messy, 'Hamlet reading log').missing, false, 'marker did not leak onto the next item');
  assert.strictEqual(pItem(messy, 'Cell phone policy form').missing, true);
  const journal = pItem(messy, 'Summer reading journal');
  assert.strictEqual(journal.turnedIn, true); assert.strictEqual(journal.missing, false); isAt(journal.due, 2026, 8, 28, 23, 59);
  assert.strictEqual(pItem(messy, 'Lit circle roles').turnedIn, true);
  sameList(messy.items.filter(i => i.missing).map(i => i.title), ['Vocab quiz corrections', 'Course syllabus signature', 'Lab equipment quiz', 'Cell phone policy form']);
});
test('paste-messy.txt: Missing items without a date are due just before today; past weekdays go backwards', () => {
  const sig = pItem(messy, 'Course syllabus signature');
  assert.strictEqual(sig.dueGuessed, true);
  assert.strictEqual(sig.due.getTime(), C.startOfDay(NOW).getTime() - 60000);
  assert.ok(sig.due < NOW);
  isAt(pItem(messy, 'Lab equipment quiz').due, 2026, 10, 12, 9, 0);           // "Due Monday, 9:00 AM" under Missing
});
test('parseWhen: assorted forms', () => {
  const W = (s, section) => { const w = C.parseTodoPaste.parseWhen(s, { now: NOW, section }); if (!w) return null; const d = new Date(w.date); if (w.time) d.setHours(w.time.h, w.time.m); return C.dayKey(d) + (w.time ? ' ' + C.pad2(d.getHours()) + ':' + C.pad2(d.getMinutes()) : ''); };
  assert.strictEqual(W('Due today'), '2026-10-14');
  assert.strictEqual(W('Due Tomorrow'), '2026-10-15');
  assert.strictEqual(W('Due yesterday'), '2026-10-13');
  assert.strictEqual(W('Due Friday, 11:59 PM'), '2026-10-16 23:59');
  assert.strictEqual(W('Due Wednesday'), '2026-10-14');
  assert.strictEqual(W('Due Monday', 'this week'), '2026-10-12');              // already past within this week
  assert.strictEqual(W('Due Friday', 'missing'), '2026-10-09');
  assert.strictEqual(W('Due 17 Oct'), '2026-10-17');
  assert.strictEqual(W('Due October 17th, 2027'), '2027-10-17');
  assert.strictEqual(W('Due Fri, Oct 17 at 9 AM'), '2026-10-17 09:00');
  assert.strictEqual(W('Due: 2026-11-02'), '2026-11-02');
  assert.strictEqual(W('Due 17/10'), '2026-10-17');
  assert.strictEqual(W('Due noon'), '2026-10-14 12:00');
  assert.strictEqual(W('Due Dec 20', 'missing'), '2025-12-20');               // far-future date under Missing is last year
  assert.strictEqual(W('Due Feb 30'), null);
  assert.strictEqual(W('Due 25:00'), null);
  assert.strictEqual(W('Due process essay'), null);
});
test('a "Due ..." line that is not a date stays a title; unplaced lines produce warnings', () => {
  const r = C.parseTodoPaste('This week\nDue process essay\nUS Government\nDue Oct 16\nStray line\nNext week\nOrphan\nDue Oct 20\nDue Oct 21', { now: NOW });
  sameList(r.items.map(i => i.title + ' / ' + i.className), ['Due process essay / US Government', 'Orphan / ']);
  assert.ok(r.warnings.some(w => w.includes('Stray line') && w.includes('skipped')), r.warnings.join('\n'));
  assert.ok(r.warnings.some(w => w.includes('Orphan') && w.includes('no class line')), r.warnings.join('\n'));
  assert.ok(r.warnings.some(w => w.includes('Due Oct 21') && w.includes('no assignment title')), r.warnings.join('\n'));
});
test('pairs without a due line outside "No due date" are kept but warned; duplicates are dropped with a warning', () => {
  const r = C.parseTodoPaste('This week\nEssay\nEnglish\nEssay\nEnglish\nDue Oct 16', { now: NOW });
  assert.strictEqual(r.items.length, 1);
  assert.ok(r.warnings.some(w => w.includes('no due date found')), r.warnings.join('\n'));
  assert.ok(r.warnings.some(w => w.includes('more than once')), r.warnings.join('\n'));
  isAt(r.items[0].due, 2026, 10, 16, 23, 59);                                 // the duplicate's due date is kept
});
test('headings without counts, a bare date line and a split time line', () => {
  const r = C.parseTodoPaste('To-do\nThis week 2\nEssay\nEnglish\nFri, Oct 16\n11:59 PM\nLab\nChem\nOct 17', { now: NOW });
  sameList(r.items.map(i => i.title), ['Essay', 'Lab']);
  isAt(r.items[0].due, 2026, 10, 16, 23, 59); assert.strictEqual(r.items[0].allDay, false);
  isAt(r.items[1].due, 2026, 10, 17, 23, 59); assert.strictEqual(r.items[1].allDay, true);
});
test('empty or junk input gives no items and a helpful warning', () => {
  const e = C.parseTodoPaste('', { now: NOW });
  assert.strictEqual(e.items.length, 0); assert.strictEqual(e.warnings.length, 0);
  const r = C.parseTodoPaste('Classroom\nTo-do\nAll classes\nNo work due soon', { now: NOW });
  assert.strictEqual(r.items.length, 0);
  assert.ok(/No assignments were recognised/.test(r.warnings.join(' ')));
});
test('class matching: exact, without period noise, prefix; calendar-imported classes win ties', () => {
  const classes = [
    { id: 'demo', name: 'AP Biology' },
    { id: 'ics', name: 'AP Bio', sourceName: 'AP Biology - Period 3' },
    { id: 'chem', name: 'Chemistry' },
    { id: 'eng', name: 'English 11' },
    { id: 'hist', name: 'US History', sourceName: 'US History (P2) 2026-27' }
  ];
  const M = n => C.parseTodoPaste.matchClass(n, classes);
  assert.strictEqual(M('AP Biology - Period 3'), 'ics');
  assert.strictEqual(M('ap biology – period 3'), 'ics');
  assert.strictEqual(M('AP Biology'), 'demo');                       // exact name wins over fuzzy
  assert.strictEqual(M('AP Biology Pd 5'), 'ics');                    // fuzzy tie goes to the calendar class
  assert.strictEqual(M('Chemistry Honors'), 'chem');
  assert.strictEqual(M('English 11'), 'eng');
  assert.strictEqual(M('US History'), 'hist');
  assert.strictEqual(M('Physics, Period 2'), null);
  assert.strictEqual(M('English 12'), null);
  assert.strictEqual(M(''), null);
  const r = C.parseTodoPaste(fixture('todo-paste.txt'), { now: NOW, classes });
  assert.strictEqual(pItem(r, 'Cellular respiration worksheet').classId, 'ics');
  assert.strictEqual(pItem(r, 'Vectors practice set').classId, null);
});
test('recurring titles: same class + title on different days stay separate with day-suffixed keys', () => {
  const text = 'This week\nWarm-up\nAlgebra\nDue Thursday\nWarm-up\nAlgebra\nDue Friday\nWarm-up\nAlgebra\nDue Friday\nEssay\nEnglish\nDue Friday';
  const r = C.parseTodoPaste(text, { now: NOW });
  sameList(r.items.map(i => i.title), ['Warm-up', 'Warm-up', 'Essay']);
  const base = 'p_' + C.hash('algebra|warm up');
  sameList(r.items.slice(0, 2).map(i => i.key), [base + '~2026-10-15', base + '~2026-10-16']);
  assert.strictEqual(r.items[0].baseKey, base);
  assert.strictEqual(r.items[2].key, 'p_' + C.hash('english|essay'), 'a title listed once keeps the plain key');
  assert.strictEqual(r.warnings.filter(w => w.includes('more than once')).length, 1, 'the same-day repeat is still merged');
  sameList(C.parseTodoPaste(text, { now: NOW }).items.map(i => i.key), Array.from(r.items.map(i => i.key)));
});
test('non-Latin and accented titles and classes get distinct keys; ASCII keys are unchanged', () => {
  const r = C.parseTodoPaste('This week\n作业一\n数学\nDue Friday\n练习\n数学\nDue Friday\nEnsayo\nEspañol\nDue Friday\nEnsayo\nEspañol 2\nDue Friday', { now: NOW });
  assert.strictEqual(r.items.length, 4, r.warnings.join('\n'));
  assert.strictEqual(new Set(r.items.map(i => i.key)).size, 4);
  assert.strictEqual(C.parseTodoPaste.norm('Español'), 'espanol');
  assert.strictEqual(C.parseTodoPaste.norm('AP Biology - Period 3'), C.normalizeName('AP Biology - Period 3'));
  const classes = [{ id: 'math', name: '数学' }, { id: 'phys', name: '物理' }];
  assert.strictEqual(C.parseTodoPaste.matchClass('数学', classes), 'math');
  assert.strictEqual(C.parseTodoPaste.matchClass('化学', classes), null);
});
test('class matching: an ambiguous prefix matches nothing instead of guessing', () => {
  const classes = [{ id: 'e11', name: 'English 11' }, { id: 'e12', name: 'English 12' }, { id: 'chem', name: 'Chemistry' }];
  assert.strictEqual(C.parseTodoPaste.matchClass('English', classes), null);
  assert.strictEqual(C.parseTodoPaste.matchClass('English 11 - Period 4', classes), 'e11');
  assert.strictEqual(C.parseTodoPaste.matchClass('Chemistry Honors', classes), 'chem');
});
test('bare "Today"/"Tomorrow" after an item is its due line; a bare time under "Tomorrow" is tomorrow', () => {
  const r = C.parseTodoPaste('This week\nLab 1\nChem\nToday\nLab 2\nChem\nTomorrow\nNo due date\nSlip\nBio\nToday\nLab 3\nChem\nDue 11:59 PM\nTomorrow\nLab 4\nChem\nDue 8:00 AM', { now: NOW });
  sameList(r.items.map(i => i.title + ' ' + i.section), ['Lab 1 this week', 'Lab 2 this week', 'Slip no due date', 'Lab 3 today', 'Lab 4 tomorrow']);
  isAt(pItem(r, 'Lab 1').due, 2026, 10, 14, 23, 59);
  isAt(pItem(r, 'Lab 2').due, 2026, 10, 15, 23, 59);
  assert.strictEqual(pItem(r, 'Slip').due, null);
  isAt(pItem(r, 'Lab 3').due, 2026, 10, 14, 23, 59);
  isAt(pItem(r, 'Lab 4').due, 2026, 10, 15, 8, 0);
  sameList(r.warnings, []);
});
test('year boundary: a late-December date seen in early January is last year, not next December', () => {
  const jan2 = new Date(2027, 0, 2, 10, 0, 0);
  const r = C.parseTodoPaste('This week\nLab\nChem\nDue Dec 29\nNext week\nQuiz\nMath\nDue Jan 12\nLater\nFinal\nMath\nDue Mar 3', { now: jan2 });
  isAt(pItem(r, 'Lab').due, 2026, 12, 29, 23, 59);
  isAt(pItem(r, 'Quiz').due, 2027, 1, 12, 23, 59);
  isAt(pItem(r, 'Final').due, 2027, 3, 3, 23, 59);
});
/* === FEATURE:PASTE:TESTS:END === */

/* === FEATURE:LOG:TESTS:START === */
console.log('core-lib: daily log');
const LH = C.eventPreset.log;
const logSame = (a, b, msg) => assert.deepStrictEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);
test('VERSES: at least 120 entries, each with a non-empty ref and text, no duplicate refs', () => {
  assert.ok(C.VERSES.length >= 120, 'only ' + C.VERSES.length + ' verses');
  const refs = new Set();
  for (const v of C.VERSES) {
    assert.ok(typeof v.ref === 'string' && v.ref.trim().length > 0, 'empty ref');
    assert.ok(typeof v.text === 'string' && v.text.trim().length > 10, 'empty text for ' + v.ref);
    assert.ok(/^(\d )?[A-Z][a-z]+( of [A-Z][a-z]+)? \d+:\d+(-\d+)?$/.test(v.ref), 'odd ref ' + v.ref);
    assert.strictEqual(v.text, v.text.trim(), 'untrimmed text ' + v.ref);
    assert.ok(!/\s{2}/.test(v.text), 'double space in ' + v.ref);
    assert.ok(!refs.has(v.ref), 'duplicate ref ' + v.ref);
    refs.add(v.ref);
  }
});
test('VERSES: spot-check exact KJV wording', () => {
  const by = r => C.VERSES.find(v => v.ref === r);
  assert.strictEqual(by('Philippians 4:13').text, 'I can do all things through Christ which strengtheneth me.');
  assert.strictEqual(by('Psalm 23:1').text, 'The LORD is my shepherd; I shall not want.');
  assert.strictEqual(by('John 3:16').text, 'For God so loved the world, that he gave his only begotten Son, that whosoever believeth in him should not perish, but have everlasting life.');
  assert.strictEqual(by('Joshua 1:9').text.slice(0, 33), 'Have not I commanded thee? Be str');
});
test('pickVerse is deterministic for a given rand and maps [0,1) uniformly onto the list', () => {
  logSame(C.pickVerse(0.42), C.pickVerse(0.42));
  logSame(C.pickVerse(0), { ref: C.VERSES[0].ref, text: C.VERSES[0].text });
  const n = C.VERSES.length;
  assert.strictEqual(C.pickVerse(0.999999).ref, C.VERSES[n - 1].ref);
  assert.strictEqual(C.pickVerse(1).ref, C.VERSES[n - 1].ref, 'rand = 1 is clamped');
  assert.strictEqual(C.pickVerse(-3).ref, C.VERSES[0].ref, 'negative rand is clamped');
  assert.strictEqual(C.pickVerse(NaN).ref, C.VERSES[0].ref);
  /* Every verse is reachable and equally likely: n equal-width buckets map to n distinct verses. */
  const seen = new Set();
  for (let i = 0; i < n; i++) seen.add(C.pickVerse((i + 0.5) / n).ref);
  assert.strictEqual(seen.size, n);
  const v = C.pickVerse(0.3); v.text = 'changed';
  assert.notStrictEqual(C.pickVerse(0.3).text, 'changed', 'returns a copy');
});
test('pickVerse never returns exceptRef and stays uniform over the rest', () => {
  const n = C.VERSES.length;
  for (const except of [C.VERSES[0].ref, C.VERSES[5].ref, C.VERSES[n - 1].ref]) {
    const seen = new Set();
    for (let i = 0; i < n - 1; i++) {
      const v = C.pickVerse((i + 0.5) / (n - 1), except);
      assert.notStrictEqual(v.ref, except);
      seen.add(v.ref);
    }
    assert.strictEqual(seen.size, n - 1, 'every other verse reachable');
    for (const r of [0, 0.25, 0.5, 0.75, 0.9999]) assert.notStrictEqual(C.pickVerse(r, except).ref, except);
  }
  assert.ok(C.pickVerse(0.5, 'Not a ref'), 'unknown exceptRef is ignored');
});
test('guessEventType maps keywords to presets', () => {
  const cases = {
    'Soccer game vs Central': 'sports', 'Basketball game': 'sports', 'Volleyball match': 'sports', 'Lions vs Tigers': 'sports', 'track meet': 'sports',
    'Soccer practice': 'practice', "Mom's bday": 'birthday', 'Jake birthday party': 'birthday', 'b-day dinner': 'birthday',
    'Road trip to Austin': 'trip', 'Flight to Denver': 'trip', 'Beach vacation': 'vacation', 'Spring break': 'vacation',
    'Thanksgiving': 'holiday', 'No school - teacher workday': 'noschool', 'Snow day!': 'noschool', 'Chem exam': 'test', 'SAT': 'test',
    'Band concert': 'concert', 'School play': 'concert', 'Youth group': 'church', 'Dentist appointment': 'appointment',
    'Work shift': 'work', 'Robotics club': 'club', 'Food bank volunteering': 'volunteer', 'Family dinner': 'family',
    'Sleepover at Ana’s': 'friends', 'Stayed home sick': 'sick'
  };
  for (const k in cases) assert.strictEqual(LH.guessEventType(k), cases[k], k);
  assert.strictEqual(LH.guessEventType('homework'), null, 'word boundaries: homework is not work');
  assert.strictEqual(LH.guessEventType('gamer night'), null, 'gamer is not a game');
  assert.strictEqual(LH.guessEventType(''), null);
  assert.strictEqual(LH.guessEventType('Something random'), null);
  for (const [type] of LH.EVENT_KEYWORDS) assert.ok(C.EVENT_PRESETS.some(p => p.type === type), 'unknown preset ' + type);
});
test('parseEventInput pulls out the time and keeps the rest as the label', () => {
  logSame(LH.parseEventInput('Soccer game vs Central 6pm'), { type: 'sports', guessed: true, label: 'Soccer game vs Central', time: '18:00' });
  logSame(LH.parseEventInput('Basketball game 7pm'), { type: 'sports', guessed: true, label: 'Basketball game', time: '19:00' });
  assert.strictEqual(LH.parseEventInput('Dentist at 3:30 PM').time, '15:30');
  assert.strictEqual(LH.parseEventInput('Dentist at 3:30 PM').label, 'Dentist');
  assert.strictEqual(LH.parseEventInput('Practice 7:15a').time, '07:15');
  assert.strictEqual(LH.parseEventInput('Flight @ 18:45').time, '18:45');
  assert.strictEqual(LH.parseEventInput('Flight @ 18:45').label, 'Flight');
  assert.strictEqual(LH.parseEventInput('Lunch with grandma noon').time, '12:00');
  assert.strictEqual(LH.parseEventInput('Party 12am').time, '00:00');
  assert.strictEqual(LH.parseEventInput('Party 12pm').time, '12:00');
  assert.strictEqual(LH.parseEventInput('Game 13pm').time, '', 'invalid 12h hour ignored');
  assert.strictEqual(LH.parseEventInput('Room 205 meeting').time, '', 'bare numbers are not times');
  const other = LH.parseEventInput('  Something   fun  ');
  logSame(other, { type: 'other', guessed: false, label: 'Something fun', time: '' });
  logSame(LH.parseEventInput('7pm'), { type: 'other', guessed: false, label: 'Other', time: '19:00' });
  assert.strictEqual(LH.parseEventInput('x'.repeat(300)).label.length, 120);
});
test('convertWeight and weightSeries convert per-day units and keep the last N, oldest first', () => {
  assert.strictEqual(LH.convertWeight(100, 'kg', 'kg'), 100);
  assert.ok(Math.abs(LH.convertWeight(100, 'kg', 'lb') - 220.462) < 0.001);
  assert.ok(Math.abs(LH.convertWeight(220.462262, 'lb', 'kg') - 100) < 0.0001);
  assert.strictEqual(LH.convertWeight(null, 'kg', 'lb'), null);
  const days = {
    '2026-10-01': { weight: 150 }, '2026-10-02': { weight: null }, '2026-10-03': { weight: 70, weightUnit: 'kg' },
    '2026-10-05': { weight: 151.4, weightUnit: 'lb' }, '2026-10-20': { weight: 149 }
  };
  const s = LH.weightSeries(days, '2026-10-14', 30, 'lb');
  logSame(s.map(p => p.key), ['2026-10-01', '2026-10-03', '2026-10-05']);
  logSame(s.map(p => p.value), [150, 154.3, 151.4]);
  logSame(LH.weightSeries(days, '2026-10-14', 2, 'kg').map(p => p.value), [70, 68.7]);
  const many = {};
  for (let i = 1; i <= 40; i++) many['2026-09-' + String(i % 30 + 1).padStart(2, '0') + (i > 30 ? 'x' : '')] = { weight: 100 + i };
  assert.strictEqual(LH.weightSeries(many, null, 30, 'lb').length, 30);
});
test('logStreak counts consecutive logged days ending today (or yesterday)', () => {
  const d = { '2026-10-14': {}, '2026-10-13': {}, '2026-10-12': {}, '2026-10-10': {} };
  assert.strictEqual(LH.logStreak(d, '2026-10-14'), 3);
  assert.strictEqual(LH.logStreak(d, '2026-10-15'), 3, 'today not logged yet keeps the streak alive');
  assert.strictEqual(LH.logStreak(d, '2026-10-16'), 0);
  assert.strictEqual(LH.logStreak({}, '2026-10-14'), 0);
  assert.strictEqual(LH.logStreak({ '2026-11-01': {}, '2026-10-31': {}, '2026-10-30': {} }, '2026-11-01'), 3, 'crosses month ends');
  assert.strictEqual(LH.logStreak(d, 'nope'), 0);
});
test('moodCounts tallies one month', () => {
  const d = { '2026-10-01': { mood: 'good' }, '2026-10-02': { mood: 'good' }, '2026-10-03': { mood: 'bad' }, '2026-10-04': { mood: null }, '2026-09-30': { mood: 'medium' } };
  logSame(LH.moodCounts(d, '2026-10-'), { good: 2, medium: 0, bad: 1, logged: 4 });
  logSame(LH.moodCounts(d, '2026-09-'), { good: 0, medium: 1, bad: 0, logged: 1 });
  logSame(LH.moodCounts(null, '2026-09-'), { good: 0, medium: 0, bad: 0, logged: 0 });
});
/* === FEATURE:LOG:TESTS:END === */

/* === FEATURE:CATALOG:TESTS:START === */
console.log('core-lib: class catalog & symbols');
test('CLASS_SYMBOLS: ~50 unique symbols, each with a label and keywords', () => {
  assert.ok(C.CLASS_SYMBOLS.length >= 45 && C.CLASS_SYMBOLS.length <= 64, 'count ' + C.CLASS_SYMBOLS.length);
  const seen = new Set();
  for (const s of C.CLASS_SYMBOLS) {
    assert.ok(typeof s.symbol === 'string' && s.symbol.length > 0, JSON.stringify(s));
    assert.ok(!seen.has(s.symbol), 'duplicate ' + s.symbol); seen.add(s.symbol);
    assert.ok(s.label && Array.isArray(s.keywords) && s.keywords.length, 'label/keywords for ' + s.symbol);
  }
  for (const want of ['📐', '➗', '📊', '🧮', '🧬', '⚗️', '🧪', '🔬', '🌍', '🪐', '⚛️', '🦠', '🌱', '📚', '✍️', '📖', '🏛️', '🗺️', '⚖️', '💰',
    '🇪🇸', '🇫🇷', '🇩🇪', '🇨🇳', '🇯🇵', '🇮🇹', '🌐', '🎨', '🎭', '🎵', '🎸', '🎻', '📷', '🎬', '💻', '🤖', '⌨️', '🔧', '⚽', '🏀', '🏃', '🍎', '❤️',
    '💼', '📈', '✝️', '🙏', '🍳', '🧠', '🗣️', '📝', '⭐']) assert.ok(seen.has(want), 'missing ' + want);
});
test('suggestSymbol guesses from keywords, preferring the most specific match', () => {
  const cases = {
    'AP Chemistry': '⚗️', 'Spanish II': '🇪🇸', 'AP Biology - Period 3': '🧬', 'Algebra I': '➗', 'Geometry': '📐', 'AP Statistics': '📊', 'Calculus BC': '🧮',
    'AP Computer Science A': '💻', 'Earth Science': '🌍', 'Physical Science': '🧪', 'Physical Education': '🏃', 'PE': '🏃', 'Physics': '⚛️',
    'Language Arts': '📚', 'AP Lit': '📚', 'AP English Language & Composition': '✍️', 'AP Spanish Language': '🇪🇸', 'AP Chinese Language': '🇨🇳', 'Latin II': '🌐',
    'World History': '🗺️', 'AP US History': '🏛️', 'Art History': '🎨', 'Español 3': '🇪🇸', 'Français 2': '🇫🇷', "Driver's Ed": '🚗', 'Culinary Arts I': '🍳',
    'Intro to Engineering Design': '🔧', 'Theology IV: Christian Ethics': '✝️', 'Health': '❤️', 'Marching Band': '🎺',
    'AP Spanish Literature': '🇪🇸', 'French Cinema': '🇫🇷'
  };
  for (const [name, sym] of Object.entries(cases)) assert.strictEqual(C.suggestSymbol(name), sym, name);
  assert.strictEqual(C.suggestSymbol('Holidays in United States'), '');
  assert.strictEqual(C.suggestSymbol(''), '');
  assert.strictEqual(C.suggestSymbol(null), '');
  /* Short keywords are whole words: "pe" never matches "personal", "art" never matches "Martin". */
  assert.notStrictEqual(C.suggestSymbol('Personal Finance'), '🏃');
  assert.strictEqual(C.suggestSymbol('Mr Martin'), '');
});
test('CLASS_CATALOG: grades 9-12 and college, 25-45 unique courses each, every symbol known', () => {
  assert.deepStrictEqual([...C.CLASS_CATALOG.map(g => g.grade)], ['9', '10', '11', '12', 'college']);
  const symbols = new Set(C.CLASS_SYMBOLS.map(s => s.symbol));
  for (const g of C.CLASS_CATALOG) {
    assert.ok(g.label && g.short, 'labels for ' + g.grade);
    assert.ok(g.courses.length >= 25 && g.courses.length <= 45, g.grade + ': ' + g.courses.length + ' courses');
    const names = new Set();
    for (const c of g.courses) {
      const k = C.normalizeName(c.name);
      assert.ok(!names.has(k), 'duplicate in ' + g.grade + ': ' + c.name); names.add(k);
      assert.ok(symbols.has(c.symbol), c.name + ' uses unknown symbol ' + c.symbol);
      assert.ok(c.subject && typeof c.subject === 'string', 'subject for ' + c.name);
    }
  }
  const all = g => C.CLASS_CATALOG.find(x => x.grade === g).courses.map(c => c.name);
  for (const n of ['English 9', 'Algebra I', 'Biology', 'Spanish I', 'Health', 'Physical Education', 'Band', 'Choir']) assert.ok(all('9').includes(n), '9th: ' + n);
  for (const n of ['AP US History', 'AP Chemistry', 'AP English Language & Composition', 'Precalculus']) assert.ok(all('11').includes(n), '11th: ' + n);
  for (const n of ['AP Calculus BC', 'AP English Literature & Composition', 'AP US Government & Politics', 'Economics']) assert.ok(all('12').includes(n), '12th: ' + n);
  for (const n of ['Calculus I', 'General Chemistry I', 'Organic Chemistry I', 'Intro to Psychology', 'English Composition I', 'Data Structures', 'Anatomy & Physiology I']) assert.ok(all('college').includes(n), 'college: ' + n);
});
test('the catalog symbols agree with suggestSymbol (so custom names get the same look)', () => {
  const off = [];
  for (const g of C.CLASS_CATALOG) for (const c of g.courses) if (C.suggestSymbol(c.name) !== c.symbol) off.push(c.name);
  assert.deepStrictEqual(off, []);
});
test('searchCatalog finds courses across grades, once each, with their grades', () => {
  const r = C.searchCatalog('chem');
  const names = r.map(x => x.name);
  assert.ok(names.includes('Chemistry') && names.includes('AP Chemistry') && names.includes('Organic Chemistry I'), names.join(', '));
  assert.strictEqual(new Set(names).size, names.length, 'no duplicates');
  assert.deepStrictEqual([...r.find(x => x.name === 'AP Chemistry').grades], ['11', '12']);
  assert.strictEqual(names[0], 'Chemistry', 'names starting with the query first');
  assert.strictEqual(C.searchCatalog('   ').length, 0);
  assert.ok(C.searchCatalog('ap calc').every(x => /calc/i.test(x.name)));
  assert.ok(C.searchCatalog('spanish').length >= 4);
  assert.strictEqual(C.searchCatalog('<img src=x>').length, 0);
});
test('searchSymbols filters by label and keywords', () => {
  assert.strictEqual(C.searchSymbols('').length, C.CLASS_SYMBOLS.length);
  assert.ok(C.searchSymbols('chem').some(s => s.symbol === '⚗️'));
  assert.ok(C.searchSymbols('orchestra').map(s => s.symbol).includes('🎻'));
  assert.deepStrictEqual([...C.searchSymbols('🧬').map(s => s.symbol)], ['🧬']);
  assert.strictEqual(C.searchSymbols('qqqzzz').length, 0);
});
/* === FEATURE:CATALOG:TESTS:END === */

/* === FEATURE:CHECKLIST:TESTS:START === */
/* === FEATURE:CHECKLIST:TESTS:END === */

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed) { console.log('Failed: ' + failures.join(', ')); process.exit(1); }
