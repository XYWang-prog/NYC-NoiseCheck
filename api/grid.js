// ---- Constants ----
const NYC_BOUNDS = { minLat: 40.49, maxLat: 40.92, minLng: -74.26, maxLng: -73.70 };
const GRID_SPACING = 0.0018; // ~200m in degrees

const NOISE_WEIGHTS = { 'Full Demolition': 1.00, 'Foundation': 0.90, 'Earth Work': 0.80, 'Structural': 0.65 };
const STRUCTURAL_KW = ['steel erection','structural steel','concrete frame','columns','beams','deck','shoring','underpinning','reinforcement','major structural alteration'];

// ---- Cached land mask ----
const BORO_URL = 'https://data.cityofnewyork.us/resource/gthc-hcne.geojson';
let landMask = null;

// ---- Haversine distance ----
function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000, dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ---- Weights ----
function timeWeight(issuedDateStr, now) {
  if (!issuedDateStr) return 1.0;
  const issued = new Date(issuedDateStr);
  const months = (now - issued) / (1000*60*60*24*30.44);
  if (months <= 3) return 1.0;
  if (months <= 6) return 0.8;
  if (months <= 12) return 0.5;
  return 0;
}

function distanceWeight(distM) {
  if (distM <= 50) return 1.0;
  if (distM <= 100) return 0.65;
  if (distM <= 150) return 0.35;
  return 0;
}

function computeProjectNoise(project, now) {
  const wt = NOISE_WEIGHTS[project.work_type] || 0;
  if (project.work_type === 'Structural' && wt > 0) {
    const desc = (project.job_description || '').toLowerCase();
    const hasKeyword = STRUCTURAL_KW.some(kw => desc.includes(kw.toLowerCase()));
    if (!hasKeyword) return 0;
  }
  const wa = timeWeight(project.issued_date, now);
  return wt * wa;
}

// ---- Fetch all projects ----
async function fetchAllProjects(dateStart, dateEnd) {
  const where = [
    `issued_date >= '${dateStart}'`, `issued_date <= '${dateEnd}'`,
    `(expired_date > '${dateEnd}' OR expired_date IS NULL)`,
    `permit_status = 'Permit Issued'`,
    `latitude between ${NYC_BOUNDS.minLat} and ${NYC_BOUNDS.maxLat}`,
    `longitude between ${NYC_BOUNDS.minLng} and ${NYC_BOUNDS.maxLng}`,
    `work_type in ('Full Demolition','Foundation','Earth Work','Structural')`,
  ].join(' AND ');

  const BASE = 'https://data.cityofnewyork.us/resource/rbx6-tga4.json';
  let all = [], offset = 0;
  while (true) {
    const params = new URLSearchParams({ '$select': 'latitude,longitude,work_type,job_description,issued_date', '$where': where, '$limit': '5000', '$offset': String(offset) });
    const resp = await fetch(`${BASE}?${params}`);
    if (!resp.ok) break;
    const rows = await resp.json();
    if (!rows.length) break;
    all = all.concat(rows);
    if (rows.length < 5000) break;
    offset += 5000;
  }
  return all;
}

// ---- Land mask ----
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
  const resp = await fetch(BORO_URL);
  const geojson = await resp.json();
  const polys = geojson.features.map(f => f.geometry);

  const bboxes = polys.map(geom => {
    let minLat=90,maxLat=-90,minLng=180,maxLng=-180;
    const coords = geom.type==='MultiPolygon' ? geom.coordinates.flat() : geom.coordinates;
    for (const ring of coords) for (const [lng, lat] of ring) {
      if (lat<minLat)minLat=lat; if (lat>maxLat)maxLat=lat;
      if (lng<minLng)minLng=lng; if (lng>maxLng)maxLng=lng;
    }
    return {minLat,maxLat,minLng,maxLng};
  });

  landMask = new Set();
  let n=0;
  for (let lat = NYC_BOUNDS.minLat; lat <= NYC_BOUNDS.maxLat; lat += GRID_SPACING) {
    for (let lng = NYC_BOUNDS.minLng; lng <= NYC_BOUNDS.maxLng; lng += GRID_SPACING) {
      let onLand = false;
      for (const b of bboxes) {
        if (lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng) { onLand = true; break; }
      }
      if (!onLand) continue;
      for (const geom of polys) {
        const coords = geom.type==='MultiPolygon' ? geom.coordinates : [geom.coordinates];
        for (const poly of coords) {
          if (ringContains(lng, lat, poly[0]) && !poly.slice(1).some(r => ringContains(lng, lat, r))) { onLand = true; break; }
        }
        if (onLand) break;
      }
      if (!onLand) continue;
      landMask.add(`${lat.toFixed(6)},${lng.toFixed(6)}`);
      n++;
    }
  }
  console.log(`Land mask built: ${n} points on land`);
  return landMask;
}

// ---- Handler ----
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const mask = await getLandMask();
    const { dateStart, dateEnd } = req.body;
    const now = new Date();
    const projects = await fetchAllProjects(dateStart, dateEnd);
    console.log(`Grid: ${projects.length} projects loaded`);

    const scored = [];
    for (const p of projects) {
      const lat = parseFloat(p.latitude), lng = parseFloat(p.longitude);
      if (isNaN(lat) || isNaN(lng)) continue;
      const pn = computeProjectNoise(p, now);
      if (pn === 0) continue;
      scored.push({ lat, lng, noise: pn, work_type: p.work_type, issued_date: p.issued_date });
    }
    console.log(`Grid: ${scored.length} projects scored for noise`);

    const CELL = 0.005;
    const spatial = new Map();
    for (const p of scored) {
      const cx = Math.floor(p.lat / CELL), cy = Math.floor(p.lng / CELL);
      const key = `${cx},${cy}`;
      if (!spatial.has(key)) spatial.set(key, []);
      spatial.get(key).push(p);
    }

    const points = [];
    for (let lat = NYC_BOUNDS.minLat; lat <= NYC_BOUNDS.maxLat; lat += GRID_SPACING) {
      for (let lng = NYC_BOUNDS.minLng; lng <= NYC_BOUNDS.maxLng; lng += GRID_SPACING) {
        if (!mask.has(`${lat.toFixed(6)},${lng.toFixed(6)}`)) continue;

        let score = 0;
        const contributing = new Map();
        let newestDate = '';
        const cx = Math.floor(lat / CELL), cy = Math.floor(lng / CELL);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const cell = spatial.get(`${cx + dx},${cy + dy}`);
            if (!cell) continue;
            for (const p of cell) {
              const dLat = Math.abs(lat - p.lat), dLng = Math.abs(lng - p.lng);
              if (dLat > 0.002 || dLng > 0.0025) continue;
              const dist = haversineM(lat, lng, p.lat, p.lng);
              if (dist > 150) continue;
              const dw = distanceWeight(dist);
              if (dw === 0) continue;
              score += p.noise * dw;
              contributing.set(p.work_type, (contributing.get(p.work_type) || 0) + 1);
              if (p.issued_date && (!newestDate || p.issued_date > newestDate)) newestDate = p.issued_date;
            }
          }
        }
        if (score > 0.001) {
          const types = [...contributing.entries()].map(([t, c]) => `${t}×${c}`).join(', ');
          points.push({ lat: Math.round(lat*1e6)/1e6, lng: Math.round(lng*1e6)/1e6, score: Math.round(score*100)/100, count: [...contributing.values()].reduce((a,b)=>a+b,0), types, newest: newestDate ? newestDate.substring(0,10) : '' });
        }
      }
    }
    console.log(`Grid: ${points.length} points generated`);
    res.json(points);
  } catch (error) {
    console.error('Grid error:', error.message);
    res.status(500).json({ error: 'Grid generation failed' });
  }
};
