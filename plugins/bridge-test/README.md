# bridge-test

Throwaway test mod for Carl's Bridge companion. v0.2 draws one pane, styled with the Bridge design system's `hud-*` tokens, with a PASS / FAIL / PARTIAL section per test:

1. Connectors from the mod (`$.mcp.call`): ClickUp, calendar, Outlook unread and favourites, Teams, plus the MCP servers and tools the mod can see
2. Skills and connectors (the mod's view of slash commands)
3. Vault read (Context.md, 01-Inbox, stale notes) and Capture to 01-Inbox
4. Persistence (`$.store` width and opens counter, auto-open on start)
5. Collapse, the band above the prompt with Reopen, the status strip
6. Hotkeys B / C / M / E and '/'
7. Theme
8. Run morning (`$.prompt.submit`)
9. Rich SVG: day-clock ring, 270° gauges, feature probe
10. Open board link
11. Redraw cost (render time, gaps, CPU sample)
12. Update flow (version, load time, plugin root)

Commands: `/bridge` toggles the pane, `/bridge-width <columns>` requests a width, `/bridge-run` re-runs the tests. Typing `bridge` also toggles it. Diagnostics go to `/tmp/bridge-test-diag-*.log`.

Delete once the real companion is built.
