# 05 — API Reference

> Project: NYC NoiseCheck
> Version: v1.0
> Updated: 2026-07-16

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
| `job_filing_number` | text | Filing number |
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

This project uses only 4: `Full Demolition`, `Foundation`, `Earth Work`, `Structural`

### Common Query Examples

**Spatial bounding box query:**
```
?$where=latitude between 40.74 and 40.77
     AND longitude between -74.01 and -73.97
     AND issued_date >= '2025-08-02T00:00:00'
     AND issued_date <= '2026-08-02T23:59:59'
     AND permit_status = 'Permit Issued'
     AND work_type in ('Full Demolition','Foundation','Earth Work','Structural')
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
