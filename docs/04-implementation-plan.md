# 04 — Implementation Plan

> Project: NYC NoiseCheck
> Version: v1.0
> Updated: 2026-07-16

---

## Principles

- One thing per phase — complete and verify before moving on
- Each phase produces verifiable results
- Debug by isolating the issue, never guess

---

## Phase Overview

```
Phase 0 → Project scaffolding      (✅ done)
Phase 1 → Map + NYC base
Phase 2 → Data integration + noise grid
Phase 3 → Date filter
Phase 4 → Address search + 150m radius
Phase 5 → Results panel + AI analysis
Phase 6 → Polish & finish
```

---

## Phase 0: Project Scaffolding

**Goal:** All docs ready, CLAUDE.md can guide development

**Deliverables:**
- [x] `docs/01-requirements.md`
- [x] `docs/02-technical-design.md`
- [x] `docs/03-design-spec.md`
- [x] `docs/04-implementation-plan.md`
- [x] `docs/05-api-reference.md`
- [x] `docs/06-noise-grid-plan.md`
- [x] `devlog/` folder + first entry
- [x] `CLAUDE.md` work guide

**Verify:** All files exist and are complete

---

## Phase 1: Map Base

**Goal:** Create index.html, map is visible

**Deliverables:**
- `index.html` (HTML skeleton + Leaflet init)

**Key technical points:**
- Leaflet CDN
- Map center NYC [40.7128, -73.9660], zoom 12.5
- Loading state overlay

**Verify:**
1. Double-click index.html → browser opens
2. See NYC map (OpenStreetMap tiles)
3. Can zoom and pan

**Does NOT include:** construction data, search, date picker

---

## Phase 2: Data Integration + Noise Grid

**Goal:** Grid points color-coded by noise score

**Deliverables:**
- `server.js` with `/api/grid` endpoint
- Grid rendering in app.js

**Key technical points:**
- Fetch all permits via paginated API
- Compute noise scores (work type weight × time weight × distance weight)
- Spatial indexing for performance (~500m cells)
- Land/water filtering via borough boundaries
- 6-level color scale (green → dark crimson)
- Hover tooltip (score, project count)
- Legend (bottom-left)

**Verify:**
1. Open page → colored grid points appear across NYC
2. Midtown Manhattan shows higher scores (more construction)
3. Water areas are empty
4. Hover grid point → tooltip shows score and count
5. Legend shows 6-level color scale

**Does NOT include:** search, date picker

---

## Phase 3: Date Filter

**Goal:** Date button works, changing dates refreshes grid

**Deliverables:**
- Top bar (title + date button)
- Date popup panel
- Date change → re-query → grid update

**Key technical points:**
- Date button shows current range
- Popup: two `<input type="date">` + 3 preset buttons
- Click outside to close
- On change, re-fetch grid data and re-render

**Verify:**
1. Top bar shows date button, default 1 year
2. Click → panel appears
3. Select "3 Months" → panel closes → fewer grid points
4. Custom date range also works

**Does NOT include:** search

---

## Phase 4: Address Search + 150m Radius

**Goal:** Search address → map jumps → circles + markers appear

**Deliverables:**
- Floating search box
- Nominatim geocoding integration
- 150m/100m/50m circles + project markers
- Grid dims during search, restores on clear

**Key technical points:**
- Search debounce 500ms
- Nominatim throttle 1s
- Bounding box API query + Haversine frontend filter
- Markers color-coded by work type
- Grid opacity transition animation
- Clear button restores state

**Verify:**
1. Type "350 5th Ave, New York" → map flies to Empire State Building
2. Three concentric circles appear
3. Colored dots appear inside 150m radius
4. Grid points dim
5. Click ✕ → circles + dots disappear → grid restores

**Does NOT include:** results panel

---

## Phase 5: Results Panel + AI Analysis

**Goal:** Right panel slides in with stats, list, and AI noise summary

**Deliverables:**
- Results panel HTML + CSS + JS
- `/api/analyze` endpoint (OpenAI)

**Key technical points:**
- Panel slides from right (CSS transition 0.3s)
- Stats: total + per-type breakdown
- Project list: card style with left color bar
- Scrollable list
- AI analysis: GPT-4o-mini generates noise impact summary
- Close button

**Verify:**
1. Search address → right panel slides in
2. Panel shows "X projects"
3. Per-type breakdown with color dots
4. AI analysis generates relevant noise assessment
5. List is scrollable
6. Click close → panel slides out

---

## Phase 6: Polish & Finish

**Goal:** Loading states, error handling, mobile responsive, performance

**Deliverables:**
- Loading animation
- Error messages for all scenarios
- Responsive CSS
- Code cleanup and English comments

**Verify:**
1. Page load shows loading overlay
2. Network failure → friendly error message
3. Mobile width → panel slides from bottom
4. All interactions smooth, no lag
