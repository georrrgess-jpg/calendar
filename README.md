# Assignments

A calendar for your Google Classroom assignments that lives in **one file**, `assignments.html`.

- Works offline straight from your desktop: no internet, no server, no install, no sign-in.
- Fills itself from your own Google data, with nothing installed: Google Calendar's export, or a copy-paste of Classroom's To-do page.
- Remembers everything (check-offs, priorities, notes, streaks) in your browser.
- Shows countdowns, auto-priorities, a month calendar with a workload heat map, a week timeline, a drag-and-drop priority board, per-class progress and a built-in Pomodoro timer.
- Opens on a **Home** overview: what to do next, this week, your daily checklist, the verse of the day, your stats and classes.
- Has a **Daily log** month calendar for your mood, weight, a verse of the day, notes and events such as games, birthdays and vacations.
- Has a **daily checklist** with items that repeat every day, on weekdays, on weekends, on days you pick, or just once.
- Lets you **create assignments by describing them**, track **progress** on each one, and open any assignment to see everything about it.
- Comes with a **class catalog** for 9th to 12th grade and college, so adding your classes takes seconds.

To start, download `assignments.html` and double-click it.

## Get your assignments out of Google

**Takes 1 minute, all inside your school account:**

1. On your school account, open Google Calendar → gear icon → **Settings** → left sidebar **Import & export** → **Export**. A `.zip` downloads.
2. Double-click the zip to unzip it (built into Windows/macOS/ChromeOS — nothing to install). Inside are `.ics` files, one per calendar; your classes are named after your Classroom classes.
3. Open `assignments.html` in any browser and drag those `.ics` files onto the drop zone. Done — repeat whenever you want a refresh (your check-offs and priorities are kept).

**If your classes are missing from the export:** Google's Export only includes calendars listed under "My calendars". Classroom class calendars usually belong to your teacher, so for many students they aren't in the zip. The app tells you when that happens. Use Paste from Classroom below instead; it takes about a minute.

**If Export is greyed out, missing, or your classes weren't included:**

1. Open Google Classroom → ☰ menu → **To-do**.
2. Press Ctrl/Cmd + A, then Ctrl/Cmd + C.
3. In `assignments.html`, open Import → "Paste from Classroom", paste, check the preview, confirm.

**Where to keep the file:** anywhere — Desktop, a USB stick, or your Google Drive (download it to open it; Drive won't run it in place). Bookmark the `file://` path in your browser. If your school Chromebook blocks opening local files, use it on your personal computer or phone instead.

**Backups:** Settings → Export JSON once a week. Everything lives only in this browser's storage; clearing site data clears your check-offs (your assignments can always be re-imported).

## Using it

| Key | What it does |
|---|---|
| `C` | Create assignment |
| `N` | Quick add (it slides in on Home and the Daily log) |
| `/` | Search (opens Next Up from Home and the Daily log) |
| `1` to `7` | Home, Next Up, Month, Week, Board, Classes, Daily log |
| `L` | Open today's daily log |
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

**Create assignment** (the **＋ Create** button at the top, or `C`): describe it in plain words and the form fills itself in. For example, `Unit 1 test psych est time 15 min due on the 10th` becomes "Unit 1 test" in your AP Psychology class, due on the 10th, about 15 minutes. Check the fields, change anything, and press Create.

- Class names work without a `#`: `chem`, `psych`, `math`, `spanish`. Small typos are fine.
- Dates: `due on the 10th`, `friday`, `tomorrow`, `10/20`, `next tuesday`. `11:59` with no am/pm means 11:59 PM.
- Estimates: `est 15 min`, `2 hours`, `45m`. Progress: `half done`, `50% done`.

**Progress:** every assignment has a progress bar. Click it to set how far along you are, from 0 to 100%. At 100% the app offers to mark it done.

**Assignment details:** click any assignment to see everything about it: due date and countdown, class, priority, estimate, progress, notes and the Classroom link. Nothing changes until you press **Edit**.

**Daily checklist:** it sits on Home and in each day of the Daily log. Tap a starter like 💧 Drink water to begin, or add your own. The gear opens its settings, where you choose how each item repeats: every day, weekdays, weekends, specific days, or once. You can also edit, reorder, archive and delete items there. Changing or archiving an item never rewrites past days.

**Adding classes:** open Classes and choose **Add classes**. Pick your grade (9th, 10th, 11th, 12th or College), tap every class you take, and press Add. Can't find one? Type it under Custom class; a matching symbol is suggested for you. Tap a class's symbol later to change it.

**The daily log** (key `L`, or the Daily log button on Home) shows the whole month. Each day shows its mood, events, weight and checklist progress. Select a day to open it and fill it in:

- Tap 😊 😐 or 😞 for a good, medium or bad day.
- Enter your weight in lb or kg. The log shows the change since last time and a trend line.
- Press **Get a verse** for a random Bible verse (King James Version) that stays with that day. Press **New verse** to draw another.
- Write an optional description of the day. It saves as you type.
- Tap a symbol to add an event: 🏆 Sports game, 🎂 Birthday, 🏖️ Vacation, ✈️ Trip and more. Or type it, like `Basketball game 7pm`, and the symbol and time are filled in for you. Vacations can repeat over several days.
- Your events and moods also show on the Month and Week views.

**Priorities are automatic** until you change one. The score comes from how soon it's due, words like test, exam, project or essay in the title, your time estimate, and how busy that class is this week. Change a priority in the edit dialog or by dragging on the Board, and it stays the way you set it.

**Filters:** next to the search box, the **Filters** button opens your class and priority chips and the Hide done switch; its badge counts what is active, and active filters show as chips you can tap to remove.

**Overdue work** is always shown, whatever filters you pick. To make an overdue item go away, finish it or archive it with a reason from its edit dialog.

## For developers

The deliverable is `assignments.html` and nothing else. The tests use Node, and the browser checks use Playwright with Chromium. Neither is needed to run the app.

```bash
node tests/run.js                 # parser, quick-add, priority and merge unit tests
node tests/browser.js --shots     # opens the file from file:// with the network blocked
```

The browser checks walk through the spec's acceptance checklist and save screenshots to `tests/.shots/`. Fixtures live in `tests/fixtures/`. The pure functions live in the `<script id="core-lib">` block of `assignments.html`, which `tests/run.js` extracts and runs. `ASSIGNMENT_CALENDAR_SPEC.md` is the build spec.
