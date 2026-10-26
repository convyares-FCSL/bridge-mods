# bridge

The Bridge engineering command pane, docked beside the Claude chat. Built from the Bridge design system (`HudPaneWide80`, `HudPaneCollapsed`).

Phase 1 (this version): narrow layout and collapsed band, all live data.

- Masthead: Morning (M), Evening (E), Week (W) send `morning`, `evening` or `weekly review` into the chat. Board ↗ opens in the browser. Collapse (C).
- Next meeting from Outlook, with the timer folded into the card.
- Focus: ClickUp tasks assigned to 80462914 that are due today or overdue. ▶ / ■ start and stop ClickUp timers (the only connector writes). The close box shows NEEDS APPROVAL; nothing closes tasks.
- Comms: Outlook unread, Teams NOT WIRED, and counts for the nine categories by email search (key 4 expands).
- Radar: stale notes (vault frontmatter `review: stale`) and overdue ClickUp.
- Monitoring and Second brain as folded rows (keys 6, 7).
- Capture to `C:\vault\01-Inbox\YYYY-MM-DD HHmm capture.md` (key N).
- Collapsed: a band above the prompt and a status line under it.

Commands: `/hud` opens or collapses the pane, `/hud-refresh` refreshes everything. Key T toggles Dark and Daylight (the app does not report which it shows).

The pane redraws once a minute and when data changes, and holds while scrolled. Motion is SMIL only.

## Connector tools it calls

ClickUp server: `clickup_filter_tasks`, `clickup_get_current_time_entry`, `clickup_get_time_entries`, `clickup_start_time_tracking`, `clickup_stop_time_tracking`.
Microsoft 365 server: `outlook_calendar_search`, `outlook_email_search`, `read_resource`.

## v0.2.0 changes

- ClickUp's daily limit (2,500 calls, shared by every chat, page and agent) is handled: the pane says "ClickUp daily limit reached · resets ~HH:MM · showing saved copy from HH:MM" and keeps the last good tasks, timer and tracked time on disk (`$.store`).
- Polling is gentle and only while the pane is open: tasks every 15 min, timer every 2 min, time entries every 10 min, Outlook every 5 min, vault and categories every 10 min. The pane redraws each minute from what it has. `↻ Refresh` (R) and `/hud-refresh` fetch everything; a timer action refreshes the timer.
- The pane counts its own ClickUp calls per day (footer and log).
- A permission refusal shows the exact allow rule to add, not an error dump. A missing answer never reads as "nothing due".
- One capture control (Enter files it). Monitoring and Second brain link to the Bridge board (https://claude.ai/artifact/Xmi8Zam4rQdaYutpmBkbjT); Cortex, Team, Infrastructure, Projects, Products and Registers are pages inside it.
- Joins use keys: ClickUp user 80462914, four-digit project codes.
- The pane uses letters and digits only, never Space, so it can run beside the board's Space-to-expand.

## v0.3.0 (phase 2): three layouts

The layout follows the pane width in columns: narrow under 90 (one column), medium 90–150 (two), wide over 150 (three). Drawings change size only at a breakpoint.

- Medium: left next meeting, timer, Focus (8 rows), capture. Right Comms, Radar, Second brain panel (stale, inbox, search over note names, recent notes), Monitoring strip, Log.
- Wide: the timeline across the top (06:00–20:00, SMIL now marker), then left timer, Focus (10 rows), capture, Second brain; centre the day clock with the Monitoring strip beneath; right Comms, Radar, Log.
- Monitoring strip: an active card (art, status, title, link to the board, LEGACY VIEW tag on Engineering overview and ECR tracker) and narrow strips whose titles are drawn as SVG text. A and D move between cards. Fleet (Grafana) is NOT WIRED and dimmed. No figures are drawn: cards show —.
- The day clock and timeline use today's Outlook meetings only; there are no focus or school arcs because there is no source for them.
