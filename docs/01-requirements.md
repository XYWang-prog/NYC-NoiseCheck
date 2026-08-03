# 01 — Requirements

> Project: NYC NoiseCheck
> Version: v1.0
> Updated: 2026-07-16

---

## Overview

A single-page website that visualizes construction projects across NYC on an interactive map, helping apartment renters assess noise impact before signing a lease.

Target users: People looking to rent in NYC who want to check nearby construction noise.

---

## Functional Requirements

### Feature A: Noise Score Grid

- 200m-spaced grid of points across NYC land areas
- Each point color-coded by noise score (green = quiet, red = loud)
- Point size scales with zoom level
- Hover tooltip shows score, project count, work types
- Affected by date filter
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
- Affected by date filter

### Feature C: Date Filter

- Top bar date button showing current range (e.g. `📅 2025/08/02 — 2026/08/02`)
- Click opens popup panel with:
  - Start date + end date pickers
  - Quick presets: 3 months | 6 months | 1 year (default)
- Selecting a range auto-closes panel and refreshes all data
- Click outside panel to close

---

## Work Type Filter

Only 4 high-noise work types are tracked:

| Work Type | Marker Color | Hex |
|-----------|-------------|------|
| Full Demolition | 🔴 Red | `#e31a1c` |
| Structural | 🟠 Orange | `#fd8d3c` |
| Foundation | 🟤 Brown | `#a65628` |
| Earth Work | 🟢 Green | `#238b45` |

---

## Data Filtering Rules

- Time range: default last 1 year (`issued_date` field)
- Permit status: only `Permit Issued`
- Work types: only the 4 types above
- Geographic bounds: NYC land area only (water areas excluded)

---

## Non-functional Requirements

- Single HTML file + backend server
- Zero-install for end users (just visit the URL)
- All external requests have timeout handling (30s)
- All errors have user-friendly messages
- Loading overlay during data fetch
