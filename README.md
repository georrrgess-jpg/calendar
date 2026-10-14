# Assignments

A calendar for your Google Classroom assignments that lives in **one file**, `assignments.html`.

- Works offline straight from your desktop: no internet, no server, no install, no sign-in.
- Fills itself from Google Calendar's own export, which works inside a locked-down school account.
- Remembers everything (check-offs, priorities, notes, streaks) in your browser.
- Shows countdowns, auto-priorities, a month calendar with a workload heat map, a week timeline, a drag-and-drop priority board, per-class progress and a built-in Pomodoro timer.

To start, download `assignments.html` and double-click it.

## Get your assignments out of Google

**Takes 1 minute, all inside your school account:**

1. On your school account, open Google Calendar → gear icon → **Settings** → left sidebar **Import & export** → **Export**. A `.zip` downloads.
2. Double-click the zip to unzip it (built into Windows/macOS/ChromeOS — nothing to install). Inside are `.ics` files, one per calendar; your classes are named after your Classroom classes.
3. Open `assignments.html` in any browser and drag those `.ics` files onto the drop zone. Done — repeat whenever you want a refresh (your check-offs and priorities are kept).

**If Export is greyed out or missing (your admin turned it off):**

1. Open Google Classroom → ☰ menu → **To-do**.
2. Press Ctrl/Cmd + A, then Ctrl/Cmd + C.
3. In `assignments.html`, open Import → "Paste from Classroom", paste, check the preview, confirm.

**Where to keep the file:** anywhere — Desktop, a USB stick, or your Google Drive (download it to open it; Drive won't run it in place). Bookmark the `file://` path in your browser. If your school Chromebook blocks opening local files, use it on your personal computer or phone instead.

**Backups:** Settings → Export JSON once a week. Everything lives only in this browser's storage; clearing site data clears your check-offs (your assignments can always be re-imported).

## Using it

| Key | What it does |
|---|---|
| `N` | Quick add |
| `/` | Search |
| `1` to `5` | Next Up, Month, Week, Board, Classes |
| `F` | Focus mode: only the next thing, the timer and today |
| `I` | Import |
| `,` | Settings |
| `Esc` | Close panels and dialogs |
| `?` | Show all shortcuts |

**Quick add** understands plain typing. For example, `Chem lab report fri 11:59pm #chem !high 45m` adds "Chem lab report", due this Friday at 11:59 PM, in your Chemistry class, high priority, about 45 minutes.

- Days: `today`, `tomorrow`, `fri`, `next mon`, `10/17`, `oct 17`, `in 3 days`.
- Times: `11:59pm`, `3pm`, `15:00`, `noon`.
- Class: `#chem` matches the first class whose name starts with "chem".
- Priority: `!low`, `!med`, `!high`, `!crit`.
- Estimate: `45m`, `2h`, `1h30m`.

**Priorities are automatic** until you change one. The score comes from how soon it's due, words like test, exam, project or essay in the title, your time estimate, and how busy that class is this week. Change a priority in the edit dialog or by dragging on the Board, and it stays the way you set it.

**Overdue work** is always shown, whatever filters you pick. To make an overdue item go away, finish it or archive it with a reason from its edit dialog.

## For developers

The deliverable is `assignments.html` and nothing else. The tests use Node, and the browser checks use Playwright with Chromium. Neither is needed to run the app.

```bash
node tests/run.js                 # parser, quick-add, priority and merge unit tests
node tests/browser.js --shots     # opens the file from file:// with the network blocked
```

The browser checks walk through the spec's acceptance checklist and save screenshots to `tests/.shots/`. Fixtures live in `tests/fixtures/`. The pure functions live in the `<script id="core-lib">` block of `assignments.html`, which `tests/run.js` extracts and runs. `ASSIGNMENT_CALENDAR_SPEC.md` is the build spec.
