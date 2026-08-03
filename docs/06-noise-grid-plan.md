# 06 — Noise Grid Implementation Plan

> Created: 2026-07-17
> Updated: 2026-07-17 (actual implementation)
> Status: ✅ Complete

---

## 1. Overview

Replace Census Tract choropleth with a noise evaluation point grid. Generate a 200m-spaced regular grid across NYC. Each point gets a noise score based on surrounding construction projects, displayed with color and size reflecting noise level.

---

## 2. Noise Score Formula

### 2.1 Per-Project Noise Score (P_noise)

```
P_noise = W_t × W_a

W_t (work type weight):
  Full Demolition = 1.00
  Foundation      = 0.90
  Earth Work      = 0.80
  Structural      = 0.65

W_a (time weight, based on months since issued_date):
  0–3   months = 1.00
  3–6   months = 0.80
  6–12  months = 0.50
  >12   months = 0
```

> Projects with P_noise = 0 are discarded early (performance optimization)

### 2.2 Structural Keyword Filter

Structural projects must pass a keyword check, otherwise P_noise = 0:

```
steel erection, structural steel, concrete frame,
columns, beams, deck, shoring, underpinning,
reinforcement, major structural alteration
```

Check: case-insensitive match against `job_description`

### 2.3 Grid Point Score

```
Grid Score = Σ (P_noise × W_d)   [sum over all projects within 150m]

W_d (distance weight):
  0–50m    = 1.00
  50–100m  = 0.65
  100–150m = 0.35
  >150m    = 0 (excluded)
```

> Only output points with Grid Score > 0.001

---

## 3. Server-Side Calculation (/api/grid)

### 3.1 Data Fetch

Pull all qualifying construction projects from NYC DOB NOW API:

```sql
WHERE issued_date BETWEEN dateStart AND dateEnd
  AND (expired_date > dateEnd OR expired_date IS NULL)
  AND permit_status = 'Permit Issued'
  AND latitude BETWEEN 40.49 AND 40.92
  AND longitude BETWEEN -74.26 AND -73.70
  AND work_type IN ('Full Demolition','Foundation','Earth Work','Structural')
```

Paginate (5000 per page) until all records fetched.

### 3.2 Precompute Noise Scores

Iterate all projects, compute P_noise. Discard zero-score projects to reduce downstream work.

### 3.3 Spatial Index

Bucket projects into ~500m cells (CELL = 0.005°):

```
Each project: cell key = floor(lat/CELL) + "," + floor(lng/CELL)
```

### 3.4 Grid Generation

```
Iterate NYC bounds [40.49 ~ 40.92] × [-74.26 ~ -73.70]
  Step = GRID_SPACING = 0.0018° (~200m)

  For each grid point:
    1. Skip if not on land (precomputed mask, O(1) lookup)
    2. Find its cell + adjacent 8 cells (3×3 = 9 cells total)
    3. Quick pre-filter per project:
       |lat diff| < 0.002° AND |lng diff| < 0.0025° (~200m)
       If passes → exact Haversine distance
    4. Distance ≤ 150m → accumulate P_noise × W_d
    5. Track: project count, per-type counts, latest issued date
    6. Output if Grid Score > 0.001
```

### 3.5 Performance Optimization

| Optimization | Effect |
|-------------|--------|
| Precompute P_noise (one pass) | Avoid repeated calculations |
| 500m spatial index | Each point checks ~300 projects (not 30,000) |
| Lat/lng pre-filter | Cheap subtraction before expensive Haversine |
| Total time | ~3–8 seconds (first load with ~30k projects) |

### 3.6 Response Format

```json
[
  { "lat": 40.712345, "lng": -74.006789, "score": 1.23, "count": 5, "types": "Full Demolition×2, Foundation×3", "newest": "2026-06-15" },
  ...
]
```

---

## 4. Frontend Display Rules

### 4.1 Color Mapping

| Score | Color | Hex |
|-------|-------|-----|
| 0 — 0.5 | Light Green | `#a8d65e` |
| 0.5 — 1.0 | Yellow | `#f1c40f` |
| 1.0 — 1.5 | Orange | `#e67e22` |
| 1.5 — 2.5 | Red | `#e74c3c` |
| 2.5 — 5.0 | Deep Red | `#c0392b` |
| 5+ | Dark Crimson | `#7b241c` |

### 4.2 Point Size vs Zoom

```
base = score < 0.5 ? 2.0 : score < 1.0 ? 2.6 : score < 1.5 ? 3.2 : score < 2.5 ? 3.8 : score < 5.0 ? 4.4 : 5.0
scale = 2^((zoom - 13) / 5)
radius = clamp(base × scale, 1, 5.5)
```

At zoom 12, scale ≈ 0.87 (smaller points). At zoom 17, scale ≈ 1.74 (larger points). Smooth transition.

### 4.3 Hover Tooltip

```
Score: 1.23
Projects: 5
```

### 4.4 Rendering

- Leaflet `circleMarker` with default Canvas renderer
- Inside `L.geoJSON` layerGroup
- On zoom: `eachLayer.setRadius()` updates in-place, no rebuild

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
| `server.js` | `/api/grid` — grid calculation + spatial index + Haversine |
| `app.js` | Grid rendering + zoom sync + search dimming + tooltips |
| `index.html` | Noise score legend |
| `style.css` | Base map desaturation filter |
