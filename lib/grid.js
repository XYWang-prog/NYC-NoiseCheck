/* ================================================================
   NYC NoiseCheck — Noise grid computation (used by server.js and api/grid.js)
   Model: lib/noise-model.js · Method: docs/07-noise-model.md
   ================================================================ */

const {
  WORK_TYPES, NB_JOB_TYPES, BUILDING_COVERAGE, MAX_RADIUS_M,
  sourceLevel, levelAtDistance, dbToEnergy, energyToDb,
} = require('./noise-model');

// ---- Constants ----
const NYC_BOUNDS = { minLat: 40.49, maxLat: 40.92, minLng: -74.26, maxLng: -73.70 };
const GRID_SPACING = 0.0018; // ~200m N–S × ~152m E–W

const PERMITS_URL = 'https://data.cityofnewyork.us/resource/rbx6-tga4.json';
const JOBS_URL    = 'https://data.cityofnewyork.us/resource/w9ak-ipjd.json';
const BORO_URL    = 'https://data.cityofnewyork.us/resource/gthc-hcne.geojson';
const PAGE_SIZE   = 50000;
const FETCH_TIMEOUT_MS = 20000;
const NB_CACHE_MS = 24 * 60 * 60 * 1000;

// ---- Caches (module scope: persists while the process / warm instance lives) ----
let landMask = null;                     // Map "lat,lng" → borocode
let nbJobsCache = { at: 0, jobs: null }; // Set of New Building job_filing_numbers

// ---- Fetch helpers ----
async function fetchJSON(url, timeoutMs = FETCH_TIMEOUT_MS) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${new URL(url).pathname}`);
  return resp.json();
}

// Paged SODA query; ordered by :id so pages never overlap or skip rows
async function fetchAllRows(base, params) {
  let all = [], offset = 0;
  while (true) {
    const qs = new URLSearchParams({ ...params, '$order': ':id', '$limit': String(PAGE_SIZE), '$offset': String(offset) });
    const rows = await fetchJSON(`${base}?${qs}`);
    all = all.concat(rows);
    if (rows.length < PAGE_SIZE) return all;
    offset += PAGE_SIZE;
  }
}

const quoteList = arr => arr.map(s => `'${s.replace(/'/g, "''")}'`).join(',');

// ---- Haversine distance ----
function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000, dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ---- Data ----
async function fetchAllProjects(dateStart, dateEnd) {
  const where = [
    `issued_date >= '${dateStart}'`, `issued_date <= '${dateEnd}'`,
    `(expired_date > '${dateEnd}' OR expired_date IS NULL)`,
    `permit_status = 'Permit Issued'`,
    `latitude between ${NYC_BOUNDS.minLat} and ${NYC_BOUNDS.maxLat}`,
    `longitude between ${NYC_BOUNDS.minLng} and ${NYC_BOUNDS.maxLng}`,
    `work_type in (${quoteList(WORK_TYPES)})`,
  ].join(' AND ');
  return fetchAllRows(PERMITS_URL, {
    '$select': 'latitude,longitude,work_type,issued_date,filing_reason,job_filing_number',
    '$where': where,
  });
}

// job_filing_numbers of New Building jobs (Structural permits count only for these)
async function getNewBuildingJobs() {
  if (nbJobsCache.jobs && Date.now() - nbJobsCache.at < NB_CACHE_MS) return nbJobsCache.jobs;
  const rows = await fetchAllRows(JOBS_URL, {
    '$select': 'job_filing_number',
    '$where': `job_type in (${quoteList(NB_JOB_TYPES)})`,
  });
  nbJobsCache = { at: Date.now(), jobs: new Set(rows.map(r => r.job_filing_number)) };
  console.log(`New Building jobs loaded: ${nbJobsCache.jobs.size}`);
  return nbJobsCache.jobs;
}

// ---- Land mask (grid point → borocode) ----
function ringContains(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

async function getLandMask() {
  if (landMask) return landMask;
  console.log('Loading borough boundaries for land mask…');
  const geojson = await fetchJSON(BORO_URL, 30000);

  // One entry per polygon part, with its own bounding box
  const parts = [];
  for (const f of geojson.features) {
    const geom = f.geometry;
    const polys = geom.type === 'MultiPolygon' ? geom.coordinates : [geom.coordinates];
    for (const poly of polys) {
      let minLat=90,maxLat=-90,minLng=180,maxLng=-180;
      for (const [lng, lat] of poly[0]) {
        if (lat<minLat)minLat=lat; if (lat>maxLat)maxLat=lat;
        if (lng<minLng)minLng=lng; if (lng>maxLng)maxLng=lng;
      }
      parts.push({ boro: f.properties.borocode, poly, minLat, maxLat, minLng, maxLng });
    }
  }

  const mask = new Map();
  for (let lat = NYC_BOUNDS.minLat; lat <= NYC_BOUNDS.maxLat; lat += GRID_SPACING) {
    for (let lng = NYC_BOUNDS.minLng; lng <= NYC_BOUNDS.maxLng; lng += GRID_SPACING) {
      for (const p of parts) {
        if (lat < p.minLat || lat > p.maxLat || lng < p.minLng || lng > p.maxLng) continue;
        if (ringContains(lng, lat, p.poly[0]) && !p.poly.slice(1).some(r => ringContains(lng, lat, r))) {
          mask.set(`${lat.toFixed(6)},${lng.toFixed(6)}`, p.boro);
          break;
        }
      }
    }
  }
  landMask = mask;
  console.log(`Land mask built: ${mask.size} points on land`);
  return landMask;
}

// ---- Grid ----
async function computeGrid(dateStart, dateEnd) {
  const t0 = Date.now();
  const refDate = dateEnd && !isNaN(new Date(dateEnd)) ? new Date(dateEnd) : new Date();
  const [mask, projects, nbJobs] = await Promise.all([getLandMask(), fetchAllProjects(dateStart, dateEnd), getNewBuildingJobs()]);
  const tFetched = Date.now();

  // One source per site: the loudest activity-adjusted permit at the same coordinates
  const sites = new Map();
  const counted = {};
  for (const p of projects) {
    const lat = parseFloat(p.latitude), lng = parseFloat(p.longitude);
    if (isNaN(lat) || isNaN(lng)) continue;
    const level = sourceLevel(p, refDate, nbJobs);
    if (level === null) continue;
    counted[p.work_type] = (counted[p.work_type] || 0) + 1;
    const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
    const site = sites.get(key);
    if (!site) {
      sites.set(key, { lat, lng, level, work_type: p.work_type, newest: p.issued_date || '' });
    } else {
      if (level > site.level) { site.level = level; site.work_type = p.work_type; }
      if (p.issued_date && p.issued_date > site.newest) site.newest = p.issued_date;
    }
  }
  console.log(`Grid: ${projects.length} permits loaded, counted ${JSON.stringify(counted)}, ${sites.size} sites`);

  // Spatial index: bucket sites into ~500m cells
  const CELL = 0.005;
  const spatial = new Map();
  for (const s of sites.values()) {
    const key = `${Math.floor(s.lat / CELL)},${Math.floor(s.lng / CELL)}`;
    if (!spatial.has(key)) spatial.set(key, []);
    spatial.get(key).push(s);
  }

  const points = [];
  for (let lat = NYC_BOUNDS.minLat; lat <= NYC_BOUNDS.maxLat; lat += GRID_SPACING) {
    for (let lng = NYC_BOUNDS.minLng; lng <= NYC_BOUNDS.maxLng; lng += GRID_SPACING) {
      const boro = mask.get(`${lat.toFixed(6)},${lng.toFixed(6)}`);
      if (!boro) continue;
      const coverage = BUILDING_COVERAGE[boro];

      let energy = 0, count = 0, newest = '';
      const types = new Map(); // dominant work_type → site count
      const cx = Math.floor(lat / CELL), cy = Math.floor(lng / CELL);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const cell = spatial.get(`${cx + dx},${cy + dy}`);
          if (!cell) continue;
          for (const s of cell) {
            if (Math.abs(lat - s.lat) > 0.002 || Math.abs(lng - s.lng) > 0.0025) continue;
            const dist = haversineM(lat, lng, s.lat, s.lng);
            if (dist > MAX_RADIUS_M) continue;
            energy += dbToEnergy(levelAtDistance(s.level, dist, coverage));
            count++;
            types.set(s.work_type, (types.get(s.work_type) || 0) + 1);
            if (s.newest > newest) newest = s.newest;
          }
        }
      }
      if (count > 0) {
        points.push({
          lat: Math.round(lat*1e6)/1e6, lng: Math.round(lng*1e6)/1e6,
          dba: Math.round(energyToDb(energy) * 10) / 10,
          count,
          types: [...types.entries()].map(([t, c]) => `${t}×${c}`).join(', '),
          newest: newest.substring(0, 10),
        });
      }
    }
  }
  console.log(`Grid: ${points.length} points generated (fetch ${tFetched - t0} ms, compute ${Date.now() - tFetched} ms)`);
  return points;
}

module.exports = { computeGrid };
