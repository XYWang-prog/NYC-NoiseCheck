# 05 — API Reference

> Project: NYC NoiseCheck
> Version: v1.3
> Updated: 2026-10-26 (internal /api/point, /api/analyze summary, runtime 311; summary gains indoor facade fields)

---

## 1. Construction Permit Data

### Basic Info

```
Endpoint: https://data.cityofnewyork.us/resource/rbx6-tga4.json
Format:   JSON
Method:   GET
Total:    ~970k records
Paging:   1000 per request ($limit + $offset)
Auth:     Not required
```

### Query Syntax (SoQL)

| Parameter | Description | Example |
|-----------|-------------|---------|
| `$select` | Select fields | `$select=latitude,longitude,work_type` |
| `$where` | Filter conditions | `$where=issued_date >= '2025-01-01T00:00:00'` |
| `$group` | Group by / aggregate | `$group=work_type` |
| `$order` | Sort | `$order=issued_date DESC` |
| `$limit` | Per page | `$limit=5000` |
| `$offset` | Offset | `$offset=0` |

### Key Fields

| Field | Type | Description |
|-------|------|-------------|
| `latitude` | number | Latitude |
| `longitude` | number | Longitude |
| `work_type` | text | Work type category |
| `permit_status` | text | Permit status |
| `issued_date` | calendar_date | Date issued |
| `expired_date` | calendar_date | Expiry date |
| `job_description` | text | Construction description |
| `house_no` | text | House number |
| `street_name` | text | Street name |
| `borough` | text | Borough |
| `job_filing_number` | text | Filing number (join key to job filings) |
| `filing_reason` | text | `Initial Permit`, `Renewal Permit Without Changes`, `Renewal Permit with Changes`, `No Work Permit` |
| `owner_name` | text | Property owner |
| `estimated_job_costs` | text | Estimated cost |

### All work_type Values

```
Antenna, Boiler Equipment, Construction Fence, Curb Cut,
Earth Work, Foundation, Full Demolition, General Construction,
Green Roof, Mechanical Systems, Plumbing,
Protection and Mechanical Methods, Sidewalk Shed, Sign,
Solar, Sprinklers, Standpipe, Structural,
Supported Scaffold, Support of Excavation, Suspended Scaffold
```

This project uses 5: `Full Demolition`, `Foundation`, `Earth Work`, `Structural`, `Support of Excavation`

### Common Query Examples

**Spatial bounding box query:**
```
?$where=latitude between 40.74 and 40.77
     AND longitude between -74.01 and -73.97
     AND issued_date >= '2025-08-02T00:00:00'
     AND issued_date <= '2026-08-02T23:59:59'
     AND permit_status = 'Permit Issued'
     AND work_type in ('Full Demolition','Foundation','Earth Work','Structural','Support of Excavation')
&$limit=1000
```

---

## 2. Borough Boundaries GeoJSON

### Basic Info

```
Endpoint: https://data.cityofnewyork.us/resource/gthc-hcne.geojson
Format:   GeoJSON (FeatureCollection)
Method:   GET
Geometry: MultiPolygon
Purpose:  Land/water filtering for grid points
```

---

## 3. Geocoding (Address → Coordinates)

### Basic Info

```
Endpoint: https://nominatim.openstreetmap.org/search
Format:   JSON
Method:   GET
Rate:     1 request/second (fair use)
```

### Parameters

| Parameter | Description | Example |
|-----------|-------------|---------|
| `q` | Address string | `350 5th Ave, New York, NY` |
| `format` | Output format | `json` |
| `limit` | Max results | `1` |

### Response Example

```json
[{
  "lat": "40.7484",
  "lon": "-73.9856",
  "display_name": "350 5th Ave, New York, NY 10118",
  "type": "yes",
  "importance": 0.8
}]
```

---

## 4. Job Application Filings (New Building lookup)

```
Endpoint: https://data.cityofnewyork.us/resource/w9ak-ipjd.json
Dataset:  DOB NOW: Build – Job Application Filings
Join key: job_filing_number (matches the permits dataset)
Field:    job_type — Alteration | New Building | Alteration CO |
          ALT-CO - New Building with Existing Elements to Remain | No Work | Full Demolition
```

Used by `lib/grid.js`: Structural permits count in the noise grid only for jobs whose `job_type` is `New Building` or `ALT-CO - New Building with Existing Elements to Remain` (about 75k job numbers, cached 24 hours).

Paging: pages of 50,000 rows with `$order=:id` (without a stable order, pages can overlap or skip rows).

---

## 5. NYC 311 Service Requests

```
Endpoint: https://data.cityofnewyork.us/resource/erm2-nwe9.json
Used by:  scripts/activity-curves.js (offline calibration),
          app.js fetchComplaints (runtime address card)
Filter:   complaint_type = 'Noise' AND descriptor in (
            'Noise: Construction Before/After Hours (NM1)', 'Noise: Construction Equipment (NC1)',
            'Noise: Jack Hammering (NC2)', 'Construction', 'Construction Equipment')
```

311 renamed its descriptors at some point; both the old and the new spellings are included.

The runtime query (address card) additionally filters `created_date` to the last 3 months and counts complaints within 400 m of the searched point. Parameters live in `SUMMARY_CONFIG.complaints` (app.js); keep the descriptor list in sync with `DESCRIPTORS` in scripts/activity-curves.js.

---

## 6. NYC Building Footprints (offline calibration only)

```
Endpoint: https://data.cityofnewyork.us/resource/5zhs-2jue.json
Used for: building coverage B per borough (docs/07 §7.2)
Note:     shape_area is in Web Mercator square meters — multiply by cos²(latitude) × 10.7639 for true square feet
```

---

## 7. Internal API (this project)

### `POST /api/grid`

Request: `{ "dateStart": "2025-10-25T00:00:00", "dateEnd": "2026-10-25T23:59:59" }` (the as-of date is `dateEnd`)

Response `200`: array of grid points

```json
{ "lat": 40.712345, "lng": -74.006789, "dba": 71.4, "count": 3, "types": "Foundation×2, Structural×1", "newest": "2026-09-29" }
```

| Field | Meaning |
|-------|---------|
| `dba` | Modeled Leq, dBA, 1 decimal |
| `count` | Construction sites within 150 m |
| `types` | Each site's loudest work type |
| `newest` | Most recent issue date among contributing permits |

Response `500`: `{ "error": "Grid generation failed" }` (an upstream request failed or timed out).

### `POST /api/point`

Single-point noise at an exact lat/lng — the same model as the grid (used by the address search card).

Request: `{ "lat": 40.7546, "lng": -73.9774, "dateStart": "2025-10-25T00:00:00", "dateEnd": "2026-10-25T23:59:59" }`

Response `200`:

```json
{ "lat": 40.7546, "lng": -73.9774, "dba": 73.5, "count": 3, "types": "Earth Work×1, Full Demolition×1, Support of Excavation×1", "newest": "2026-10-20", "borough": "1" }
```

| Field | Meaning |
|-------|---------|
| `dba` | Modeled Leq at the exact point, 1 decimal; `null` when no site within 150 m |
| `count` | Construction sites within 150 m |
| `types` | Each site's loudest work type (same format as /api/grid) |
| `newest` | Most recent issue date among contributing permits |
| `borough` | borocode used for the building-coverage factor; `null` for points in water (coverage fallback 0.25) |

Fetches only permits in a bbox around the point — attenuation stops at 150 m, so the result matches what /api/grid returns for a lattice point at the same location (verified with the docs/08 worked example).

Response `400`: `{ "error": "Invalid coordinates" }`. Response `500`: `{ "error": "Point computation failed" }`.

### `POST /api/analyze`

AI noise summary for the search panel, anchored to the dBA model.

Request:

```json
{
  "projects": [{ "work_type": "Foundation", "job_description": "…", "issued_date": "2026-08-01", "distance": 45 }],
  "summary": { "dba": 73.5, "feeling": "Loud", "feelingDetail": "Marginally unacceptable", "indoorClosed": 53.5, "indoorClosedNew": 45.5, "indoorOpen": 63.5, "facadeClosedDb": 20, "facadeClosedNewDb": 28, "facadeOpenDb": 10, "complaints311": 7, "address": "350 5th Ave, New York", "asOf": "2026-10-26" }
}
```

`summary` is optional (absent = legacy prompt). `dba`/`feeling` are `null` when the model found no sites within 150 m; `complaints311` is `null` when the 311 fetch failed (the prompt tells the model not to invent numbers). `indoorClosed`/`indoorClosedNew`/`indoorOpen` are the modeled outdoor level minus a typical facade loss (`facadeClosedDb` = 20 dB typical building, `facadeClosedNewDb` = 28 dB new construction 2010+, `facadeOpenDb` = 10 dB window open); the prompt quotes indoor levels as the resident's actual exposure, defaulting to 20/28/10 if the fields are absent.

Response `200`: `{ "analysis": "…" }` (2-4 sentences, English). Response `500`: `{ "analysis": null, "error": "AI analysis unavailable. Please try again later." }`.
