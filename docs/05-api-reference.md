# 05 — API Reference

> Project: NYC NoiseCheck
> Version: v1.1
> Updated: 2026-10-25 (job filings, Support of Excavation, internal /api/grid)

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

## 5. NYC 311 Service Requests (offline calibration only)

```
Endpoint: https://data.cityofnewyork.us/resource/erm2-nwe9.json
Used by:  scripts/activity-curves.js (not called at runtime)
Filter:   complaint_type = 'Noise' AND descriptor in (
            'Noise: Construction Before/After Hours (NM1)', 'Noise: Construction Equipment (NC1)',
            'Noise: Jack Hammering (NC2)', 'Construction', 'Construction Equipment')
```

311 renamed its descriptors at some point; both the old and the new spellings are included.

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

### `POST /api/analyze`

Unchanged: AI noise summary for the search panel (not yet connected to the dBA model).
