# Assignment Calendar — Build Spec for Claude Code

Paste this whole file into a new folder and tell Claude Code:
"Read ASSIGNMENT_CALENDAR_SPEC.md and build it. Work through the sections in order and check off the acceptance list at the end."

---

## 0. Situation and hard constraints (read first)

The user is a student. Their school Google account is locked down: it cannot talk to outside services, cannot install extensions or apps, and cannot use third-party API access. The user also has a personal computer (where you, Claude Code, are running) with normal internet.

Therefore the solution must:

1. Be **one self-contained HTML file** (`assignments.html`) — all CSS and JS inline, **no CDN links, no npm, no build step, no server, no fonts loaded from the web**. It must work when opened directly from the file system (`file://`) with no internet at all.
2. Get its data **without any network call**. The user will feed it data in one of three ways (Section 2). Never attempt to fetch from Google.
3. Store everything in **`localStorage`** (with a JSON export/import for backup). No accounts, no sign-in.
4. Need **zero installs** on the user's side and nothing that touches the school's Terms of Service — the user only ever uses Google's own built-in export/copy features on their own data.

Do not add a backend, a package.json, or any dependency. If you think a library would help, inline a small hand-written equivalent instead.

---

## 1. How the data gets in (the "automatic fill" part)

Google Classroom automatically puts every assignment with a due date onto a **per-class calendar** in the student's Google Calendar, and Google Calendar has a built-in export (Settings → Import & export → Export) that downloads a `.zip` of `.ics` files — one per calendar. That export works entirely inside the school account and is the primary auto-fill source.

Build **three importers**, in this priority order:

### 1a. ICS import (primary — fully automatic)
- Accept one or many `.ics` files via a drop zone and a file picker (`<input type="file" multiple accept=".ics">`). The user will unzip Google's export with the OS's built-in unzip and drop the `.ics` files in. (Do **not** parse the zip in-browser — that would need a library.)
- Write a small, forgiving iCalendar parser:
  - Handle **line unfolding** (lines starting with a space or tab continue the previous line).
  - Read `X-WR-CALNAME` → this is the **class name** (e.g. "AP Biology – Period 3"). Strip Google's trailing noise if present.
  - For each `VEVENT` read: `UID`, `SUMMARY` (assignment title), `DESCRIPTION` (often contains the class and a Classroom link — keep as notes), `DTSTART` / `DTEND` (handle `VALUE=DATE` all-day form `YYYYMMDD`, the `YYYYMMDDTHHMMSSZ` UTC form, and `TZID=` forms — convert to local), `URL` if present, `STATUS`.
  - Unescape `\,` `\;` `\n` `\\` in text fields.
  - Due date = `DTEND` if it's a date-time, else `DTSTART`. Classroom usually sets the due time; all-day events = due end of day.
- Ignore calendars that are clearly not classes (e.g. "Birthdays", "Holidays in United States", the user's primary personal calendar) — detect by `X-WR-CALNAME` and let the user un-ignore in settings.
- **Merge, don't replace**: key each assignment on `UID`. Re-importing a newer export updates title/due date/class but **preserves** the user's local edits: `done`, `priority` override, `notes`, `estimatedMinutes`.

### 1b. Paste import (fallback if the admin disabled Calendar export)
- A textarea labelled "Paste from Google Classroom's To-do page". The user opens Classroom → ☰ menu → **To-do**, selects all, copies, and pastes.
- Write a tolerant line-based parser for that text. The page groups items under headings like **"This week" / "Next week" / "Later" / "No due date" / "Missing"**, and each item is a few lines: assignment title, class name, and a line like `Due Oct 17` / `Due Oct 17, 11:59 PM` / `Due tomorrow` / `Due today`. Parse relative words and month-day forms (assume current year, roll into next year if the date is more than ~60 days in the past). Treat anything under "Missing" as overdue.
- Because this text format is undocumented, make the parser **show a preview table** before committing ("We found 14 assignments — does this look right?") with inline editing, and include a "Report a parse problem" button that just copies the raw text to clipboard so the user can give it to Claude Code for a parser fix.
- Key paste-imported items on `hash(class + title)` so re-pasting updates rather than duplicates.

### 1c. Manual add / edit
- A quick-add bar at the top: natural-ish input like `Chem lab report fri 11:59pm #chem !high 45m` → title, due date, class, priority, estimate. Parse day names, `tomorrow`, `mm/dd`, `in 3 days`, times, `#class` tags, `!low/!med/!high`, and durations like `45m`/`2h`.
- A full edit modal for everything.

---

## 2. Data model (localStorage, versioned)

```js
{
  version: 1,
  settings: { theme, weekStartsOn, hiddenCalendars: [], classColors: {}, defaultEstimateMin, focusMode },
  classes: [{ id, name, color, emoji }],
  assignments: [{
    id,            // UID from ICS, or hash for paste/manual
    source,        // "ics" | "paste" | "manual"
    title,
    classId,
    due,           // ISO string, local
    allDay,        // bool
    notes,
    url,
    priority,      // "low" | "medium" | "high" | "critical"
    priorityAuto,  // true until the user overrides it
    estimatedMin,
    done,          // bool
    doneAt,        // ISO
    createdAt, updatedAt
  }],
  stats: { streakDays, lastActiveDay, completedByDay: {"2026-10-14": 3} }
}
```

Write `save()`/`load()` with a schema version and a migration stub. Wrap all storage access in try/catch so the page still works if storage is blocked.

### Automatic priority (since ICS carries no priority)
Compute `priorityAuto` from a score; recompute on every load and whenever the clock ticks past midnight:

- **Time pressure**: due in < 24h → +40, < 3 days → +25, < 7 days → +10, overdue → +50.
- **Weight keywords** in title: `test|exam|quiz|midterm|final` → +30; `project|essay|paper|lab report|presentation` → +20; `homework|worksheet|practice|reading` → +5.
- **Estimated effort** if set: +1 per 10 minutes, capped at +20.
- **Class load**: if that class has ≥3 open items this week, +5.

Map: ≥70 critical, ≥45 high, ≥20 medium, else low. A user override sets `priorityAuto=false` and is never recomputed.

---

## 3. Views (the calendar "menu")

Single-page app with a top nav; remember the last view. All views share one filter bar: class chips, priority chips, "hide done" toggle, search.

1. **Today / Next Up (default landing)**
   - A large hero card: **the one thing to do next** (highest score, soonest due). Show title, class, a live countdown ("due in 1d 6h 12m"), estimate, and a single big "Start → I'm done" flow.
   - Below it: "Due today", "Due tomorrow", "This week" lanes.
   - Daily capacity bar: sum of estimates for items due in the next 48h vs. a configurable daily budget.

2. **Month calendar**
   - Standard 7-column grid, week starts on the user's chosen day. Each cell shows up to 3 colored pills (class color, priority-tinted left border), with a "+2 more" overflow that opens a day panel.
   - Cell background intensity scales with total estimated minutes that day (a soft heat map), so heavy days are visible at a glance.
   - Click a day → side panel listing that day's assignments.

3. **Week timeline**
   - 7 vertical columns, assignments placed at their due time, all-day items pinned to the top band. A "now" line that moves.

4. **Priority board (Kanban)**
   - Columns: Critical / High / Medium / Low / Done. Drag and drop between columns sets a manual priority override. Drag into Done completes it.

5. **By class**
   - One card per class with a progress ring (done ÷ total this term), its open items sorted by due, and a per-class color picker.

---

## 4. Anti-procrastination features (these matter — don't skip)

- **Countdowns, not just dates.** Every item shows time-remaining that ticks every minute. Under 24h the countdown turns warm and pulses gently.
- **Urgency color temperature.** Items drift from cool (far away) to hot (due soon) along a continuous hue scale, independent of class color, so the whole page reads as a weather map of pressure.
- **"Start" micro-commitment.** Clicking Start on the hero card launches a built-in **Pomodoro timer** (25/5 default, configurable) attached to that assignment. Completed pomodoros are logged on the item and count toward the estimate.
- **Satisfying completion.** Marking done triggers a short canvas confetti burst (hand-written, ~40 lines, no library), a strike-through animation, and the item slides into Done. The streak counter increments the first time each day.
- **Streak + weekly scoreboard.** A small header widget: current streak of days with ≥1 completion, and a 7-bar sparkline of completions per day.
- **Overdue honesty.** Overdue items get a red "Overdue by 2d" tag and float to the top of every view; they cannot be hidden by filters (only by completing or explicitly archiving with a reason).
- **Focus mode.** One toggle that hides everything except the hero card, the Pomodoro, and today's lane.
- **Gentle nudge copy.** Rotating one-line prompts on the hero card ("Just open the doc. That's the whole task for now."). Keep it kind, never shaming.
- **Future-self preview.** A small "If you do nothing until Friday…" line that shows how many items will be overdue — a concrete, non-preachy consequence.

---

## 5. Visual design direction

Load your `frontend-design` skill (if available) before styling. Target: feels like a premium, custom app, not a bootstrap template.

- **Dark theme by default** with a light option; respect `prefers-color-scheme`. Define all colors as CSS variables on `:root` and under `[data-theme="light"]`.
- Deep navy/charcoal base, a single vibrant accent (e.g. electric violet or warm amber) used sparingly for the hero card and primary action, and the per-class palette (8 distinct, accessible, muted-saturation colors).
- System font stack (no web fonts): `ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Inter, sans-serif`; tabular numerals for countdowns (`font-variant-numeric: tabular-nums`).
- Glass/elevation: subtle layered surfaces, 1px borders at ~8% white, soft large-radius cards, restrained shadows. No gradients on text.
- Motion: 150–250ms ease-out transitions, view changes slide/fade, countdown digits tick without layout shift, respect `prefers-reduced-motion`.
- Responsive: usable at 360px wide (phone) and 1440px; month grid collapses to an agenda list on narrow screens.
- Keyboard: `N` quick-add, `/` search, `1–5` switch views, `Esc` closes panels. Visible focus rings.

---

## 6. Settings & data safety

- Settings panel: theme, week start, daily minute budget, Pomodoro lengths, hidden calendars, class colors/emoji, "rename class" (ICS calendar names are long).
- **Export JSON** (downloads `assignments-backup-YYYY-MM-DD.json`) and **Import JSON** (merge or replace).
- Show "Last import: Oct 14, 12:40 PM · 6 calendars · 23 assignments" in the footer so the user knows when data is stale, and a soft reminder badge after 7 days.
- Nothing ever leaves the browser. State this plainly in the settings panel.

---

## 7. Build order (do these in sequence, committing after each)

1. Skeleton: single `assignments.html`, CSS variables, nav, storage layer with `load/save/migrate`, sample seed data behind a "Load demo data" button.
2. ICS parser + drop zone + merge logic. Write it as a pure function `parseICS(text) → {calendarName, events[]}` so it's testable.
3. Auto-priority scoring + the Today / Next Up view with the hero card and countdowns.
4. Month calendar + day panel.
5. Week timeline.
6. Priority board with drag and drop.
7. By-class view with progress rings.
8. Quick-add parser, edit modal, settings panel, JSON export/import.
9. Anti-procrastination layer: Pomodoro, confetti, streaks, focus mode, nudges, future-self line.
10. Paste importer with preview table.
11. Polish pass against Section 5; responsive and keyboard checks.

Also create `tests/` with a plain Node script (no framework) that runs `parseICS` and the quick-add parser against the fixtures below. Node is only used by you for testing; the deliverable itself needs nothing.

### Test fixture: `tests/fixtures/ap-bio.ics`
Generate a realistic Google-Classroom-style ICS: `X-WR-CALNAME:AP Biology - Period 3`, 6–8 VEVENTs mixing `DTSTART;VALUE=DATE`, `DTEND:…Z`, folded long `DESCRIPTION` lines with escaped commas and a `https://classroom.google.com/...` link, and one event with `STATUS:CANCELLED` (which should be skipped). Also a second fixture `holidays.ics` with `X-WR-CALNAME:Holidays in United States` that must be auto-ignored.

### Test fixture: `tests/fixtures/todo-paste.txt`
A plausible copy of Classroom's To-do page: headings This week / Next week / Later / Missing, ~10 items with varied "Due …" formats.

---

## 8. Acceptance checklist (verify every line before saying done)

- [ ] `assignments.html` opens from `file://` with Wi-Fi off and renders fully; devtools show zero network requests.
- [ ] Dropping both fixture `.ics` files imports only AP Biology, skips the cancelled event, keeps the holiday calendar out, and shows correct local due times.
- [ ] Re-dropping the same file after marking an item done and overriding its priority keeps both the done flag and the override.
- [ ] Pasting `todo-paste.txt` shows a preview with the right count and dates; confirming imports them; pasting again doesn't duplicate.
- [ ] Quick-add parses `Chem lab report fri 11:59pm #chem !high 45m` correctly.
- [ ] All five views work; filters persist across views; last view is restored on reload.
- [ ] Countdowns tick; an item set to due in 10 minutes shows the hot/pulse state; marking it done fires confetti and bumps the streak.
- [ ] Drag between Kanban columns changes priority and persists after reload.
- [ ] Settings changes, class renames and colors persist; JSON export then import on a cleared storage restores everything.
- [ ] Looks polished at 360px and 1440px; keyboard shortcuts work; reduced-motion disables animations.
- [ ] A short `README.md` exists with the user instructions in Section 9 copied in.

---

## 9. User instructions (put these in README.md, written for the student)

**Get your assignments out of Google (takes 1 minute, all inside your school account):**
1. On your school account, open Google Calendar → gear icon → **Settings** → left sidebar **Import & export** → **Export**. A `.zip` downloads.
2. Double-click the zip to unzip it (built into Windows/macOS/ChromeOS — nothing to install). Inside are `.ics` files, one per calendar; your classes are named after your Classroom classes.
3. Open `assignments.html` in any browser and drag those `.ics` files onto the drop zone. Done — repeat whenever you want a refresh (your check-offs and priorities are kept).

**If Export is greyed out or missing (your admin turned it off):**
1. Open Google Classroom → ☰ menu → **To-do**.
2. Press Ctrl/Cmd + A, then Ctrl/Cmd + C.
3. In `assignments.html`, open Import → "Paste from Classroom", paste, check the preview, confirm.

**Where to keep the file:** anywhere — Desktop, a USB stick, or your Google Drive (download it to open it; Drive won't run it in place). Bookmark the `file://` path in your browser. If your school Chromebook blocks opening local files, use it on your personal computer or phone instead.

**Backups:** Settings → Export JSON once a week. Everything lives only in this browser's storage; clearing site data clears your check-offs (your assignments can always be re-imported).

---

## 10. Optional later upgrade (only if the user asks)

If the user's school account has **Google Apps Script** enabled, a tiny script using only `CalendarApp` (no external services, no Classroom API) could write a JSON file of upcoming assignments to their Drive on a daily trigger, so the user just downloads one file instead of exporting calendars. Do not build this unless asked; many school domains disable Apps Script, and the ICS route already works everywhere.
