require('dotenv').config();
const express = require('express');
const OpenAI = require('openai');

const app = express();
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

app.post('/api/analyze', async (req, res) => {
  try {
    const { projects } = req.body;
    if (!projects || !projects.length) {
      return res.json({ analysis: 'No construction projects found in this area.' });
    }

    const projectList = projects.map(p =>
      `- ${p.work_type}: ${p.job_description || 'No description'} | Issued: ${p.issued_date || 'N/A'} | Distance: ${p.distance}m`
    ).join('\n');

    const prompt = `You are helping a NYC apartment resident understand the construction noise they would experience if they lived at a specific address.

Below are construction projects within 150m of that address. Distance (m) tells you how close each project is. If distance is very small (~0-30m), the project is likely IN the same building the person lives in.

Analyze the noise impact from the perspective of someone living INSIDE their apartment in this building. Key rules:

1. SAME-BUILDING vs NEARBY: 0-30m = likely same building (noise through walls/floors), 30-150m = nearby (street noise through windows only).

2. READ THE JOB DESCRIPTION TO JUDGE REAL NOISE:
   - WHAT is being demolished? A concrete building = very loud for weeks. Drywall/partitions = minor, short-term. A shed or fence = negligible.
   - WHAT is being built? Steel-frame high-rise = constant heavy noise. Wood-frame house = moderate, intermittent. Interior finishing = quiet.
   - WHAT materials and methods? Concrete cutting, jackhammer, pile driving, steel welding = very loud. Painting, tiling, cabinet install, drywall = barely audible.

3. LOW NOISE (do NOT warn about these): interior renovation, bathroom/kitchen remodel, painting, tiling, cabinet/trim, fixture replacement, drywall, partitions, cosmetic work. If "INTERIOR" or "RENOVATION" appears without mentioning demolition or structural work, it is quiet.

4. HIGH NOISE (warn about these): full demolition of structures, foundation excavation, earth work involving heavy machinery, structural steel erection, concrete cutting/drilling, pile driving, major pipe replacement, jackhammer work.

5. BE SPECIFIC: Instead of generic "construction noise", say "concrete cutting will produce sustained high-pitched noise" or "interior finishing will only cause light occasional tapping". Distinguish truly disruptive projects from minor ones. If ALL projects are quiet, reassure the resident clearly. Write your analysis entirely in English, with no Chinese characters.

Projects:
${projectList}

Write a 2-4 sentence analysis in English. Be honest: if projects are likely in the same building, warn clearly about expected indoor disruption. If only distant projects exist, reassure the resident. Mention specific distances and work types that matter most.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7,
      max_tokens: 300,
    });

    const analysis = completion.choices[0].message.content;
    res.json({ analysis });

  } catch (error) {
    console.error('OpenAI API error:', error.message);
    res.status(500).json({ analysis: null, error: 'AI analysis unavailable. Please try again later.' });
  }
});

// ---- Noise Grid ----
const NYC_BOUNDS = { minLat: 40.49, maxLat: 40.92, minLng: -74.26, maxLng: -73.70 };
const GRID_SPACING = 0.0018; // ~200m in degrees

const NOISE_WEIGHTS = { 'Full Demolition': 1.00, 'Foundation': 0.90, 'Earth Work': 0.80, 'Structural': 0.65 };
const STRUCTURAL_KW = ['steel erection','structural steel','concrete frame','columns','beams','deck','shoring','underpinning','reinforcement','major structural alteration'];

function haversineM(lat1, lng1, lat2, lng2) {
  const R = 6371000, dLat = (lat2-lat1)*Math.PI/180, dLng = (lng2-lng1)*Math.PI/180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R*2*Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

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

// ---- Land/Water Filter (precomputed land mask, cached) ----
const BORO_URL = 'https://data.cityofnewyork.us/resource/gthc-hcne.geojson';
let landMask = null;

async function getLandMask() {
  if (landMask) return landMask;
  console.log('Loading borough boundaries for land mask…');
  const resp = await fetch(BORO_URL);
  const geojson = await resp.json();
  const polys = geojson.features.map(f => f.geometry);

  // Compute bounding boxes
  const bboxes = polys.map(geom => {
    let minLat=90,maxLat=-90,minLng=180,maxLng=-180;
    const coords = geom.type==='MultiPolygon' ? geom.coordinates.flat() : geom.coordinates;
    for (const ring of coords) for (const [lng, lat] of ring) {
      if (lat<minLat)minLat=lat; if (lat>maxLat)maxLat=lat;
      if (lng<minLng)minLng=lng; if (lng>maxLng)maxLng=lng;
    }
    return {minLat,maxLat,minLng,maxLng};
  });

  // Precompute land status for all grid points
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

function ringContains(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if ((yi > lat) !== (yj > lat) && lng < (xj - xi) * (lat - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

app.post('/api/grid', async (req, res) => {
  try {
    const mask = await getLandMask();
    const { dateStart, dateEnd } = req.body;
    const now = new Date();
    const projects = await fetchAllProjects(dateStart, dateEnd);
    console.log(`Grid: ${projects.length} projects loaded`);

    // Score project noise (one pass)
    const scored = [];
    for (const p of projects) {
      const lat = parseFloat(p.latitude), lng = parseFloat(p.longitude);
      if (isNaN(lat) || isNaN(lng)) continue;
      const pn = computeProjectNoise(p, now);
      if (pn === 0) continue;
      scored.push({ lat, lng, noise: pn, work_type: p.work_type, issued_date: p.issued_date });
    }
    console.log(`Grid: ${scored.length} projects scored for noise`);

    // Spatial index: bucket projects into ~500m cells
    const CELL = 0.005; // ~500m
    const spatial = new Map();
    for (const p of scored) {
      const cx = Math.floor(p.lat / CELL), cy = Math.floor(p.lng / CELL);
      const key = `${cx},${cy}`;
      if (!spatial.has(key)) spatial.set(key, []);
      spatial.get(key).push(p);
    }

    // Generate grid (only check adjacent cells)
    const points = [];
    for (let lat = NYC_BOUNDS.minLat; lat <= NYC_BOUNDS.maxLat; lat += GRID_SPACING) {
      for (let lng = NYC_BOUNDS.minLng; lng <= NYC_BOUNDS.maxLng; lng += GRID_SPACING) {
        // Land check (precomputed mask, O(1))
        if (!mask.has(`${lat.toFixed(6)},${lng.toFixed(6)}`)) continue;

        let score = 0;
        const contributing = new Map(); // work_type → count
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
});

app.use(express.static(__dirname));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
