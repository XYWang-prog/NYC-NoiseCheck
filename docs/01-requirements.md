# 01 — Requirements

> Project: NYC NoiseCheck
> Version: v1.1
> Updated: 2026-10-25 (dBA noise model, as-of date, Support of Excavation)

---

## Overview

A single-page website that visualizes construction projects across NYC on an interactive map, helping apartment renters assess noise impact before signing a lease.

Target users: People looking to rent in NYC who want to check nearby construction noise.

---

## Functional Requirements

### Feature A: Construction Noise Grid (dBA)

- 200m-spaced grid of points across NYC land areas (≈200 m N–S × 152 m E–W)
- Each point shows a modeled construction noise level in dBA (Leq, weekday daytime, outdoor). Method: [07-noise-model.md](07-noise-model.md)
- Six color bands anchored to NYC CEQR and FTA thresholds (blue = acceptable … dark magenta = 10+ dB above the FTA 8-hr guideline)
- Points with no major construction within 150 m have no dot
- Point size scales with band and zoom level
- Hover tooltip shows "≈ NN dBA · rating" and the number of construction sites within 150 m
- Legend states that values are model estimates, not measurements or official determinations
- Affected by the as-of date
- Dims to low opacity during address search, restores on clear

### Feature B: Address Search + 150m Radius

- Floating search box for NYC addresses
- Auto geocoding (address → lat/lng) via Nominatim
- Map flies to location, places search pin
- Draws 150m radius circles (150m/100m/50m)
- Shows construction project markers inside radius, color-coded by work type
- Noise grid dims during search to highlight results
- Clear search restores grid and removes circles/markers
- Right side panel slides in with:
  - Total project count within 150m
  - Per-type breakdown
  - Project list (description, address, date)
  - AI noise analysis
- Affected by the as-of date

### Feature C: As-of Date

- The map shows the noise situation **as of one date** (real-time by default)
- The top bar date button shows the as-of date (e.g. `📅 As of 2026/10/25`), default today
- Click opens popup panel with:
  - One "Noise as of" date picker (no future dates)
  - Quick presets: Today (default) | 3 Months Ago | 6 Months Ago
- Included permits: issued in the 12 months before the as-of date and still active on it
- For a past date, a note says that permits signed off since then are not included
- Selecting a date auto-closes panel and refreshes all data (grid + search)
- Click outside panel to close

---

## Work Type Filter

5 high-noise work types are tracked:

| Work Type | Marker Color | Hex |
|-----------|-------------|------|
| Full Demolition | 🔴 Red | `#e31a1c` |
| Structural | 🟠 Orange | `#fd8d3c` |
| Foundation | 🟤 Brown | `#a65628` |
| Earth Work | 🟢 Green | `#238b45` |
| Support of Excavation | 🟣 Purple | `#6a51a3` |

In the noise grid, Structural permits count only for New Building jobs (DOB job type). The search list shows all Structural permits.

---

## Data Filtering Rules

- Time window: permits issued in the 12 months before the as-of date (`issued_date`), not expired on it
- Permit status: only `Permit Issued` (signed-off permits excluded)
- Work types: only the 5 types above
- Geographic bounds: NYC land area only (water areas excluded)

---

## Non-functional Requirements

- Single HTML file + backend server
- Zero-install for end users (just visit the URL)
- All external requests have timeout handling (server: 20 s per upstream request; browser: 60 s for the grid)
- All errors have user-friendly messages (grid failure: status bar "⚠️ Noise data unavailable — please refresh")
- Loading overlay during data fetch
