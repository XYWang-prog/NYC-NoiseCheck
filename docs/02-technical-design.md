# 02 — Technical Design

> Project: NYC NoiseCheck
> Version: v1.1 (2026-10-25: dBA noise model)
> Updated: 2026-07-16

---

## Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Frontend | Vanilla HTML + CSS + JS | Zero install, double-click to open |
| Map Library | Leaflet.js 1.9.4 (CDN) | Free, open source, 42KB |
| Base Tiles | CARTO Basemaps (`light_all`) | Free tier 5M tiles/month, API key required |
| Backend | Node.js + Express | Grid computation (`lib/grid.js`, `lib/noise-model.js`) + AI analysis |
| Geocoding | Nominatim API (free) | Address → coordinates |
| AI Analysis | OpenAI GPT-4o-mini | Construction noise impact summary |
| Date Picker | Native `<input type="date">` | Zero dependency |

---

## Data Sources

### Construction Data

```
API:  https://data.cityofnewyork.us/resource/rbx6-tga4.json
Total: ~970k records
Limit: 1000 per request (paginated via $limit + $offset)
Query: SoQL ($select, $where, $group, $order, $limit, $offset)
```

### Job Types (New Building lookup)

```
API:     https://data.cityofnewyork.us/resource/w9ak-ipjd.json  (DOB NOW: Build – Job Application Filings)
Purpose: Structural permits count in the grid only for New Building jobs (joined on job_filing_number)
Cache:   24 hours in lib/grid.js
```

### Land Mask (Borough Boundaries)

```
GeoJSON: https://data.cityofnewyork.us/resource/gthc-hcne.geojson
Purpose: Filter grid points to NYC land areas, and give each point its borough (for building coverage B)
Geometry: MultiPolygon
```

### Model Calibration (offline only)

```
NYC 311 Service Requests (erm2-nwe9)   → activity curves (scripts/activity-curves.js)
NYC Building Footprints (5zhs-2jue)    → building coverage B per borough
See docs/07-noise-model.md
```

### Geocoding

```
API:   https://nominatim.openstreetmap.org/search?q={address}&format=json&limit=1
Rate:  1 request/second (fair use)
```

---

## Data Flow

### Flow 1: Initial Load (Noise Grid)

```
1. Load Leaflet → center on NYC [40.7128, -73.9660]
2. POST /api/grid {dateStart, dateEnd} (as-of date − 12 months → as-of date)
3. Backend fetches permits + New Building job list, computes dBA per grid point
4. Returns array of {lat, lng, dba, count, types, newest}
5. Frontend renders colored circle markers via Canvas
6. Legend shows the dBA bands (generated from NOISE_BANDS)
```

### Flow 2: Address Search + 150m Radius

```
1. Debounced input → Nominatim geocoding → lat/lng
2. Map flyTo target, add search pin + 150m/100m/50m circles
3. Grid layer opacity reduced to 0.1
4. Bounding box API query for nearby permits
5. Frontend Haversine filter ≤150m
6. Color-coded markers by work_type
7. Right panel slides in with results list
8. POST /api/analyze → AI noise analysis
```

### Flow 3: As-of Date Change

```
1. Click date button → popup panel opens
2. Pick a date or a preset (Today / 3 Months Ago / 6 Months Ago) → panel closes
3. Re-run Flow 1 (+ Flow 2 if search is active)
```

---

## Key Algorithms

### Haversine Distance (meters)

```js
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) *
    Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}
```

### Noise Model (full method: [07-noise-model.md](07-noise-model.md))

```
Site level = loudest permit at the site: stage L50 (CEQR Table 22-1 equipment) + 10·log10(activity)
Level at d = site level − 20·log10(max(d, 7.62)/15.24) − min(10, 0.1·B·d)
Grid dBA   = 10·log10 Σ 10^(level/10) over sites within 150 m
```

---

## Error Handling

| Scenario | Strategy |
|----------|----------|
| Leaflet CDN load fail | "Map failed to load, please check your network" |
| Grid API failure / timeout (server 20 s per upstream request, browser 60 s) | Grid removed; status bar "⚠️ Noise data unavailable — please refresh" |
| Nominatim failure | "Could not recognize that address, try a more detailed address" |
| 0 results within 150m | Panel shows "No construction projects nearby" |
| AI analysis failure | "Analysis temporarily unavailable" |
| Rate limiting | Debounce 500ms + Nominatim throttle 1s |
