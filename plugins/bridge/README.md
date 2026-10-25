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
