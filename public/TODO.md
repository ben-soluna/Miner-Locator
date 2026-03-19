<!-- Version: 0.2.2 -->
# Miner-Finder - Roadmap

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
- [x] Make sidebar full-height, move Settings above version, and set version to v0.2.2
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
- [x] Add a Settings control to resize the sidebar width
- [x] Replace IP range edit browser prompts with an in-app modal matching UI style
- [x] Change IP range delete to two-step in-row confirmation (click delete twice within timeout)
- [x] Show current app version under the Miner-Finder title on Home tab
- [x] Align IP Ranges tab header with shared gradient title styling (`app-title`)
- [x] Move IP Ranges title above the main panel box (outside `ip-ranges-panel`)
- [x] Add `Export CSV` action for Home and Flagged miner tables
- [x] Add export popup to choose CSV columns and order before download
- [x] Make export popup column ordering drag-and-drop like Edit Columns
- [x] Show live selected-column count in export popup
- [x] Add Select All action in export popup
- [x] Move export Select All above count and toggle label to Deselect All when fully selected
- [x] Make export Select All control compact and pinned left
- [x] Add distinct color styling for Deselect All vs Select All visibility states
- [x] Add USB-first Windows launcher and docs for no-install portable execution
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
- [ ] Map `Hashboard Number` from `devs` call `STATUS[0].Msg` format (for example, `"3 ASC(s)"` means 3 active hashboards).

## Other
- [x] Add Windows portable distribution workflow (`npm run bundle:portable:win`) to generate `portable-win/` with launcher docs.
- [ ] //TODO function and VS Code Extensions

## Security and Optimization Findings (2026-03-18)
- [ ] Add optional auth/token guard for `/api/scan` and `/api/debug/:ip` if this app is ever exposed beyond localhost.
- [x] Keep `/api/debug/:ip` available in normal local runtime.
- [ ] Add optional lightweight per-IP request rate limit middleware for scan/debug endpoints.
- [x] Replace blocking Linux ARP read with async cached ARP lookup (`ARP_CACHE_TTL_MS`).
- [x] Add global miner-check throttle to smooth load across concurrent scans (`GLOBAL_CHECK_CONCURRENCY`).
- [x] Batch frontend scan table renders and cache writes to reduce UI/storage churn.
- [x] Escape miner table cell output and IP links to reduce XSS risk from malformed device data.
- [ ] Add automated regression tests for scan stream parsing and frontend table rendering safety.

## Column Data-Link Review (One By One)
- Rule: use only the explicitly assigned miner API call(s) per column; if absent, keep `N/A` (no cross-call or HTTP/ARP/DNS fallback fill-ins).
- [ ] `ip` column: verify mapping from backend `result.ip` to frontend `miner.ip` and link rendering.
- [ ] `status` column: confirm current hardcoded `Online` behavior vs backend `status` field.
- [x] `hostname` column: removed from table/column manager as redundant with IP Address column.
- [x] `mac` column: backend source is `config[0].CONFIG[0].MACAddr` only; if missing/invalid, value stays `N/A`; frontend displays backend `mac` value.
- [ ] `ipMode` column: verify backend normalization (`DHCP`/`Static`) and frontend display.
- [ ] `os` column: verify backend aliasing (`osType` to `os`) and frontend fallback behavior.
- [ ] `osVersion` column: verify backend source keys and frontend display.
- [x] `minerType` column: backend source is `stats[].Type` only in `deriveProfile()`; if missing, value stays `N/A`; frontend displays `miner.minerType`.
- [ ] `cbType` column: verify backend control-board derivation and alias mapping.
- [ ] `psuInfo` column: verify backend field extraction and frontend display.
- [x] `temp` column: backend source is `stats[0].STATS[1].temp_max` (strict priority), else `N/A`; frontend displays backend `temp` value.
- [ ] `fans` column: verify backend fan-speed aggregation and frontend display.
- [ ] `fanStatus` column: verify backend active/total derivation and frontend alert styling.
- [ ] `voltage` column: verify backend derivation and frontend display.
- [ ] `frequencyMHz` column: verify backend derivation and frontend display.
- [ ] `hashrate` column: verify backend TH/s derivation plus frontend summary fallback path.
- [ ] `activeHashboards` column: verify backend derivation and frontend display; source rule is `devs` call `STATUS[0].Msg` (for example, `"3 ASC(s)"` means 3 active hashboards).
- [ ] `hashboards` column: verify backend active/total derivation and frontend display.
- [ ] `pools` column: verify backend pool URL extraction/joining and frontend display.
- [ ] `flag` action column: verify frontend-only state model (`flaggedMinerIps`) independent of backend payload fields.
- [ ] `Debug JSON` action button: verify visibility condition (`hasDebugPayload`) and endpoint behavior (`/api/scan/last?ip=`).