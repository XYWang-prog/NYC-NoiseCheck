# 02 — Technical Design

> Project: NYC NoiseCheck
> Version: v1.0
> Updated: 2026-07-16

---

## Tech Stack

| Layer | Choice | Reason |
|-------|--------|--------|
| Frontend | Vanilla HTML + CSS + JS | Zero install, double-click to open |
| Map Library | Leaflet.js 1.9.4 (CDN) | Free, open source, 42KB |
| Base Tiles | OpenStreetMap (CDN tiles) | Free, no API key needed |
| Backend | Node.js + Express | Grid computation + AI analysis |
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

### Land Mask (Borough Boundaries)

```
GeoJSON: https://data.cityofnewyork.us/resource/gthc-hcne.geojson
Purpose: Filter grid points to NYC land areas only
Geometry: MultiPolygon
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
2. POST /api/grid → backend fetches all permits
3. Backend computes noise scores per grid point
4. Returns array of {lat, lng, score, count, types, newest}
5. Frontend renders colored circle markers via Canvas
6. Legend shows noise score color scale
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

### Flow 3: Date Change

```
1. Click date button → popup panel opens
2. Select new range → panel closes
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

### Noise Score Formula

```
Project Noise = WorkTypeWeight × TimeWeight

Grid Score = Σ (ProjectNoise × DistanceWeight) for all projects within 150m
```

---

## Error Handling

| Scenario | Strategy |
|----------|----------|
| Leaflet CDN load fail | "Map failed to load, please check your network" |
| Grid API timeout (30s) | "Data load timed out, please try again" |
| Nominatim failure | "Could not recognize that address, try a more detailed address" |
| 0 results within 150m | Panel shows "No construction projects nearby" |
| AI analysis failure | "Analysis temporarily unavailable" |
| Rate limiting | Debounce 500ms + Nominatim throttle 1s |
