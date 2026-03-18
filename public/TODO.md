# The Miner Locator - Roadmap

## Frontend
- [x] Build the main HTML UI
- [x] Add dynamic, sortable columns
- [x] Implement smooth drag-and-drop column management
- [x] Setup Dark Mode
- [x] change all green text to orange
- [x] change hash column to show the TH/S on each number down.
- [x] small subtle box around filter columns area
- [x] Add "Load Test Data" button to populate the table with realistic fake miner data for frontend testing
- [x] Create sidebar with categories and menu selection
- [x] Reduce sidebar width and add category icons above labels
- [x] Make sidebar about half-width and use monochromatic minimal category icons
- [x] Restyle sidebar to match stacked icon-over-text reference layout
- [x] Make sidebar full-height, move Settings above version, and set version to v1.0.1
- [x] Remove sidebar outer gaps, add collapse toggle, and change Settings icon to wrench
- [x] Reposition collapse toggle to vertical center and extend it left outside sidebar
- [x] Move collapse toggle to the right side of the sidebar
- [x] Make collapsed sidebar narrower while keeping icon size unchanged
- [x] Increase expanded sidebar icon and text size
- [x] Remove sidebar title and shrink tab height by about 25%
- [x] Add section comments throughout index.html for maintainability
- [x] Match sidebar surface color to the main screen background
- [x] Correct sidebar color to match main panel container surface
- [x] Reduce main panel corner radius and outer spacing by about half
- [x] Make remaining main panel content use the same 8px roundness
- [x] Move and shrink column configuration button above table, right-aligned
- [x] Style column button like sidebar and add 'Edit Columns' label
- [x] Change Edit Columns icon to a minimalistic gear
- [x] Change Edit Columns icon to a screwdriver
- [x] Split Edit Columns into drag-toggle hand and screwdriver modal controls
- [x] Remove icon outlines and add dividers to the Edit Columns tool
- [x] Simplify Edit Columns to text plus grab-hand control
- [x] Move grab-hand control to the left of Edit Columns
- [x] Match top and bottom spacing around the Edit Columns control
- [x] Normalize Edit Columns spacing with equal top and bottom padding
- [x] Move sorting to outlined up/down arrow controls in each column header
- [x] Stack column sort arrows vertically and increase their size
- [x] Set active sort arrow color to orange and tighten header vertical spacing
- [x] Move Edit Columns control to left above IP and place label before grab hand
- [x] Keep Edit Columns toolbar fixed during horizontal table scroll
- [x] A way to save IP ranges with a Title for each range
- [x] Build IP Ranges tab with subnet host-range builder and direct CIDR/range entry
- [ ] Add a Settings control to resize the sidebar width
- [ ] Create a site map view

## Backend
- [x] Upgrade `server.js` to send the `stats` command to port 4028.
- [x] Parse the `stats` data to get **Hardware Temps**, **Miner Type**, and **Active Hashboards**.
- [x] Upgrade `server.js` to send the `pools` command to get **Pool** data.
- [x] Add lightweight fallback enrichment for **MAC Address**, **OS**, and **Hostname** (ARP cache + reverse DNS + best-effort HTTP hints).
- [x] Implement CGMiner joined-command queries (`summary+stats+pools+version+devs`) to reduce per-host TCP round-trips from 5 to 1.
- [x] Add `requestMinerCommands()` helper with join + per-command fallback for older firmware.
- [x] Defer `devdetails` / `edevs` / `config` to a conditional extra pass (only when fields are still missing after base pass).
- [x] Add `MINER_API_TIMEOUT_MS` env variable (default 1200 ms, min 200 ms).
- [x] Add `client.setNoDelay(true)` to reduce TCP Nagle latency on miner connections.

## Other
- [ ] //TODO function and VS Code Extensions