# 06 — Noise Grid Implementation Plan

> Created: 2026-07-17
> Updated: 2026-10-25 (unitless score replaced by the dBA noise model — see [07-noise-model.md](07-noise-model.md))
> Status: ✅ Complete

---

## 1. Overview

A 200m-spaced grid of points covers NYC land areas. Each point gets a **modeled construction noise level in dBA** (Leq, weekday daytime, outdoor) from the construction sites around it, shown as a color band and point size.

---

## 2. Noise Model

The formula, equipment levels, activity curves, attenuation and thresholds are documented in **[07-noise-model.md](07-noise-model.md)**. The code is in `lib/noise-model.js`.

Summary:

```
Site level  = loudest permit at the site: stage L50 (CEQR Table 22-1 equipment) + 10·log10(activity)
Level at d  = site level − 20·log10(max(d, 7.62)/15.24) − min(10, 0.1·B·d)
Grid dBA    = 10·log10 Σ 10^(level/10)   over sites within 150 m
```

The old weights (work type 1.00/0.90/0.80/0.65, time 1.0/0.8/0.5, distance 1.0/0.65/0.35) and the Structural keyword filter are no longer used.

---

## 3. Server-Side Calculation (`lib/grid.js`, used by `server.js` and `api/grid.js`)

### 3.1 Data Fetch

Fetch all qualifying permits for the as-of window from NYC DOB NOW:

```sql
WHERE issued_date BETWEEN dateStart AND dateEnd        -- dateStart = as-of − 12 months
  AND (expired_date > dateEnd OR expired_date IS NULL)
  AND permit_status = 'Permit Issued'
  AND latitude BETWEEN 40.49 AND 40.92
  AND longitude BETWEEN -74.26 AND -73.70
  AND work_type IN ('Full Demolition','Earth Work','Foundation','Support of Excavation','Structural')
$select = latitude, longitude, work_type, issued_date, filing_reason, job_filing_number
$order  = :id     -- stable paging (without it, pages can overlap or skip rows)
```

- Pages of 50,000 rows.
- Every request has a timeout (20 s). A failed request throws, so the API returns 500 instead of a silently incomplete grid.
- **New Building jobs:** the `job_filing_number`s of jobs whose `job_type` is New Building or ALT-CO New Building with Existing Elements come from DOB NOW Job Application Filings (about 75k rows). They are cached for 24 hours. Structural permits count only for these jobs.

### 3.2 Site Levels

1. Compute an activity-adjusted source level for each permit (`sourceLevel()`).
2. Skip permits that do not count: wrong job type, or activity 0.
3. Merge permits with the same coordinates (rounded to 5 decimals) into one site. Each site keeps its loudest level.

### 3.3 Spatial Index

Bucket sites into ~500m cells (CELL = 0.005°):

```
Each site: cell key = floor(lat/CELL) + "," + floor(lng/CELL)
```

### 3.4 Land Mask (cached)

- Borough polygons come from `gthc-hcne`.
- Every polygon part has its own bounding box, followed by a real point-in-polygon test (holes excluded).
- The mask maps each land grid point to its `borocode`. The borocode selects the building coverage B used for building attenuation.
- Result: 25,693 land points.

> Fixed 2026-10-25: the old mask accepted any point inside a borough's bounding box (45,459 points, including rivers and bays).

### 3.5 Grid Generation

```
Iterate NYC bounds [40.49 ~ 40.92] × [-74.26 ~ -73.70], step 0.0018°
  For each land grid point:
    1. Check its cell + 8 neighbors
    2. Quick pre-filter |Δlat| < 0.002°, |Δlng| < 0.0025°, then Haversine distance
    3. Distance ≤ 150 m → add 10^(levelAtDistance/10) to the energy sum
    4. Track: site count, dominant work type per site, newest issued date
    5. Output if at least one site contributes: dba = 10·log10(energy sum)
```

### 3.6 Performance (measured 2026-10-25, local)

| Step | Time |
|------|------|
| First request (land mask + New Building jobs + permits) | ~3.6 s |
| Later requests (caches warm) | ~1.6 s |
| Grid computation itself | ~0.15 s |

### 3.7 Response Format

```json
[
  { "lat": 40.712345, "lng": -74.006789, "dba": 71.4, "count": 3, "types": "Foundation×2, Structural×1", "newest": "2026-09-29" },
  ...
]
```

- `count`: construction sites within 150 m
- `types`: each site's loudest work type
- On error: HTTP 500 `{ "error": "Grid generation failed" }`

---

## 4. Frontend Display Rules

### 4.1 Color Bands (`NOISE_BANDS` in `app.js`)

| Leq dBA | Color | Label |
|---------|-------|-------|
| > 90 | `#9e0142` dark magenta | 10+ dB above FTA 8-hr guideline |
| 80–90 | `#d7191c` red | Above FTA 8-hr guideline |
| 77–80 | `#f46d43` orange-red | Clearly unacceptable |
| 67–77 | `#fdae61` light orange | Marginally unacceptable |
| 62–67 | `#66c2a5` teal | Marginally acceptable |
| ≤ 62 | `#3288bd` blue | Acceptable |

- Bands include their upper bound.
- Threshold sources: [07-noise-model.md §10](07-noise-model.md). Why these colors and how they were checked: [§10.2](07-noise-model.md).
- The legend is generated from `NOISE_BANDS`. It also has a "No dot: no major construction within 150m" row and a model-estimate disclaimer.

### 4.2 Point Size vs Zoom

```
base  = band radius: 1.5 (≤62) / 2.2 / 3.2 / 4.3 / 5.4 / 6.4 (>90)
scale = 2^((zoom - 13) / 5)
radius = clamp(base × scale, 1, 9)
```

### 4.3 Hover Tooltip

```
≈ 71 dBA · Marginally unacceptable
Estimate at this grid point · Sites within 150m: 3
```

### 4.4 Rendering

- Leaflet `circleMarker` with the default Canvas renderer
- Inside an `L.geoJSON` layer group
- On zoom, `eachLayer.setRadius()` updates markers in place without a rebuild
- If the grid request fails, the grid is removed and the status bar shows "⚠️ Noise data unavailable — please refresh"

### 4.5 Search Interaction

| State | Grid Points |
|-------|-------------|
| No search | fillOpacity 0.85 |
| During search | fillOpacity 0.1 |
| Search cleared | Restore 0.85 |

---

## 5. Files Involved

| File | Content |
|------|---------|
| `lib/noise-model.js` | Noise model: equipment levels, stages, activity curves, attenuation |
| `lib/grid.js` | Data fetch, New Building job lookup, land mask, grid computation |
| `server.js` / `api/grid.js` | `/api/grid` route (local Express / Vercel) → `computeGrid()` |
| `scripts/activity-curves.js` | Offline re-derivation of activity curves |
| `app.js` | Bands, legend, grid rendering, tooltip, as-of date, error message |
| `index.html` | Legend containers, as-of date popup |
| `style.css` | Legend and date-note styles |
