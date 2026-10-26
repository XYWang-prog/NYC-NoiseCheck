/* ================================================================
   NYC NoiseCheck — Main Script
   ================================================================ */

// ---- Config ----
const CONFIG = {
  nycCenter:      [40.7128, -73.9660],
  defaultZoom:    12.5,
  searchZoom:     16,
  permitsApiBase: 'https://data.cityofnewyork.us/resource/rbx6-tga4.json',
  nominatimUrl:   'https://nominatim.openstreetmap.org/search',
  dateStart:       null,   // as-of date minus lookbackMonths
  dateEnd:         null,   // end of the as-of date
  lookbackMonths:  12,     // permits issued this long before the as-of date (docs/07 §9)
  workTypes:       ['Full Demolition','Foundation','Earth Work','Structural','Support of Excavation'],
  searchRadiusM:   150,
  gridSpacingM:    200,
};

// ---- Noise Bands (docs/07-noise-model.md §10) ----
// Leq dBA, upper bound inclusive: CEQR Table 19-2 residential L10 limits − 3 dB; FTA Table 7-3 residential day 8-hr Leq 80
// (FTA's 90 dBA is a 1-hr limit for the two noisiest machines — a different quantity — so the 90 edge is simply 80 + 10)
// Colors: ColorBrewer "Spectral" (Brewer, Penn State), diverging at the CEQR acceptability line (Leq 67 ≈ L10 70):
// blue / teal = acceptable side, orange → red → magenta = unacceptable side (docs/07 §10.2).
// Radius grows with severity in clear steps (~1.4× on the common classes) so size reads as a second cue.
const NOISE_BANDS = [
  { min: 90,        color: '#9e0142', radius: 6.4, range: '90+',   label: '10+ dB above FTA 8-hr guideline' },
  { min: 80,        color: '#d7191c', radius: 5.4, range: '80–90', label: 'Above FTA 8-hr guideline' },
  { min: 77,        color: '#f46d43', radius: 4.3, range: '77–80', label: 'Clearly unacceptable' },
  { min: 67,        color: '#fdae61', radius: 3.2, range: '67–77', label: 'Marginally unacceptable' },
  { min: 62,        color: '#66c2a5', radius: 2.2, range: '62–67', label: 'Marginally acceptable' },
  { min: -Infinity, color: '#3288bd', radius: 1.5, range: '≤ 62',  label: 'Acceptable' },
];

// ---- Work Type Colors ----
const WORK_TYPE_COLORS = {
  'Full Demolition':       '#e31a1c',
  'Foundation':            '#a65628',
  'Earth Work':            '#238b45',
  'Structural':            '#fd8d3c',
  'Support of Excavation': '#6a51a3',
};
const WORK_TYPE_LABELS = {
  'Full Demolition': 'Demolition', 'Foundation': 'Foundation', 'Earth Work': 'Earth Work',
  'Structural': 'Structural', 'Support of Excavation': 'Excavation Support',
};

// ---- Summary Card Config (address search panel) ----
// 体感等级 4 档：62/67/77 dBA 分界，与 NOISE_BANDS 的 CEQR 切点一致（docs/07 §10）
const SUMMARY_CONFIG = {
  feelingBands: [
    { min: 77,        color: '#f46d43', label: 'Very loud', sublabel: 'Clearly unacceptable' },
    { min: 67,        color: '#fdae61', label: 'Loud',      sublabel: 'Marginally unacceptable' },
    { min: 62,        color: '#66c2a5', label: 'Moderate',  sublabel: 'Marginally acceptable' },
    { min: -Infinity, color: '#3288bd', label: 'Quiet',     sublabel: 'Acceptable' },
  ],
  // 室内 4 档：锚点 32/42/52（CEQR 室内昼间 L10 45≈Leq 42、夜间 L10 35≈Leq 32，docs/07 §10.3），仅用于卡片
  feelingBandsIndoor: [
    { min: 52,        color: '#f46d43', label: 'Very loud', sublabel: 'Intrusive indoor' },
    { min: 42,        color: '#fdae61', label: 'Loud',      sublabel: 'Above interior day criterion' },
    { min: 32,        color: '#66c2a5', label: 'Moderate',  sublabel: 'Meets interior day criterion' },
    { min: -Infinity, color: '#3288bd', label: 'Quiet',     sublabel: 'Meets interior night criterion' },
  ],
  facade: {
    // 典型墙体隔声（建筑插入损耗）：开窗 −8 dB、关窗 −18 dB（用户确认）
    openDb: 8,
    closedDb: 18,
  },
  complaints: {
    radiusM: 400,   // 311 complaints counted within this radius of the address
    months: 3,      // …and within this many months back from the real today (not the as-of date)
    apiBase: 'https://data.cityofnewyork.us/resource/erm2-nwe9.json',
    // 与 scripts/activity-curves.js 的 DESCRIPTORS 保持同步
    descriptors: ['Noise: Construction Before/After Hours (NM1)', 'Noise: Construction Equipment (NC1)', 'Noise: Jack Hammering (NC2)', 'Construction', 'Construction Equipment'],
  },
};

// ---- State ----
let isSearchActive = false;
let gridLayer = null;

// Search-related layers
let searchMarkersGroup = L.layerGroup();
let searchCircle150 = null;
let searchCircle100 = null;
let searchCircle50  = null;
let searchPin       = null;
let nominatimLastCall = 0;
let currentAddress = '';   // display string of the searched address (sent to the AI analysis)
let searchSeq = 0;         // guards against stale async results when a newer search starts
let cardWindowMode = 'closed'; // 'open' | 'closed' — which facade value the summary card shows (map is always outdoor)
let lastSummaryState = null;       // cached so the card toggle can re-render without refetching

// Facade attenuation for the card: −8 open window, −18 closed (SUMMARY_CONFIG.facade, user-confirmed)
function facadeDbForMode(mode) {
  return mode === 'open' ? SUMMARY_CONFIG.facade.openDb : SUMMARY_CONFIG.facade.closedDb;
}
// Shift the outdoor model down by the facade loss; only applied to the summary card display, grid data stays outdoor
function applyFacade(dba, mode) { return Math.max(0, dba - facadeDbForMode(mode)); }

// ---- DOM ----
const loadingOverlay    = document.getElementById('loading-overlay');
const loadingText       = document.getElementById('loading-text');
const refreshIndicator  = document.getElementById('refresh-indicator');
const dateBtn           = document.getElementById('date-btn');
const dateLabel         = document.getElementById('date-label');
const datePopup         = document.getElementById('date-popup');
const inputAsOf         = document.getElementById('input-asof');
const pastDateNote      = document.getElementById('past-date-note');
const presetBtns        = datePopup.querySelectorAll('.presets button');
const searchInput       = document.getElementById('search-input');
const searchClearBtn    = document.getElementById('search-clear');
const searchCount       = document.getElementById('search-count');
const searchCountText   = document.getElementById('search-count-text');
const resultsPanel      = document.getElementById('results-panel');
const panelStats        = document.getElementById('panel-stats');
const panelList         = document.getElementById('panel-list');
const panelCloseBtn     = document.getElementById('panel-close');
const aiAnalysis        = document.getElementById('ai-analysis');
const statusBar         = document.getElementById('status-bar');
const legendNoise       = document.getElementById('legend-noise');
const legendWorkTypes   = document.getElementById('legend-worktypes');

// ---- Initialize Map ----
const map = L.map('map', {
  center: CONFIG.nycCenter,
  zoom:   CONFIG.defaultZoom,
  zoomControl: true,
  attributionControl: true,
  preferCanvas: true,
});

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png?key=cb1_3huw_1_8d8836dd4b0a898af9b813ee', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
  subdomains: 'abcd',
  maxZoom: 20,
}).addTo(map);

searchMarkersGroup.addTo(map);

// ---- Date Utilities ----
function toDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
function toDisplayStr(dateStr) { return dateStr.replace(/-/g, '/'); }

// Noise is shown "as of" one date: permits issued in the lookback window that are still active on it
function setAsOf(dateStr) {
  const start = new Date(dateStr + 'T00:00:00');
  start.setMonth(start.getMonth() - CONFIG.lookbackMonths);
  CONFIG.dateStart = toDateStr(start) + 'T00:00:00';
  CONFIG.dateEnd   = dateStr + 'T23:59:59';
  inputAsOf.value  = dateStr;
  dateLabel.textContent = `As of ${toDisplayStr(dateStr)}`;
  pastDateNote.classList.toggle('show', isPastAsOf());
}

function initAsOf(monthsAgo) {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  setAsOf(toDateStr(d));
}

function isPastAsOf() { return CONFIG.dateEnd.slice(0, 10) < toDateStr(new Date()); }

// ---- Date Button ----
dateBtn.addEventListener('click', () => datePopup.classList.toggle('show'));
document.addEventListener('click', (e) => {
  if (!datePopup.contains(e.target) && e.target !== dateBtn && !dateBtn.contains(e.target)) {
    datePopup.classList.remove('show');
  }
});

function applyCustomDate() {
  const d = inputAsOf.value;
  if (!d) return;
  setAsOf(d > toDateStr(new Date()) ? toDateStr(new Date()) : d);
  presetBtns.forEach(b => b.classList.remove('active'));
  datePopup.classList.remove('show');
  refreshAll();
}
inputAsOf.addEventListener('change', applyCustomDate);

presetBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const months = parseInt(btn.dataset.months);
    initAsOf(months);
    presetBtns.forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    datePopup.classList.remove('show');
    refreshAll();
  });
});

// ---- Grid Dim / Restore ----
function dimGrid() {
  if (gridLayer) gridLayer.setStyle({ fillOpacity: 0.1, opacity: 0.1 });
}
function restoreGrid() {
  if (gridLayer) gridLayer.setStyle({ fillOpacity: 0.85, opacity: 0.85 });
}

// ---- Haversine Distance (meters) ----
function haversineDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

function getWorkTypeColor(workType) { return WORK_TYPE_COLORS[workType] || '#999'; }

// ---- Geocoding ----
async function geocodeAddress(query) {
  const now = Date.now();
  const wait = 1000 - (now - nominatimLastCall);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  nominatimLastCall = Date.now();
  const url = `${CONFIG.nominatimUrl}?q=${encodeURIComponent(query)}&format=json&limit=1`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!resp.ok) throw new Error('Geocoding failed');
  const data = await resp.json();
  if (!data.length) return null;
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), display: data[0].display_name };
}

// ---- Fetch Nearby Permits ----
async function fetchNearbyPermits(minLat, maxLat, minLng, maxLng) {
  const where = [
    `latitude between ${minLat} and ${maxLat}`,
    `longitude between ${minLng} and ${maxLng}`,
    `issued_date >= '${CONFIG.dateStart}'`, `issued_date <= '${CONFIG.dateEnd}'`,
    `(expired_date > '${CONFIG.dateEnd}' OR expired_date IS NULL)`,
    `permit_status = 'Permit Issued'`,
    `latitude between 40.4 and 40.9`, `longitude between -74.3 and -73.7`,
    `work_type in ('${CONFIG.workTypes.join("','")}')`,
  ].join(' AND ');
  const params = new URLSearchParams({
    '$select': 'latitude,longitude,work_type,job_description,house_no,street_name,borough,issued_date,owner_name,job_filing_number,work_permit,filing_reason',
    '$where': where, '$limit': '1000',
  });
  const url = `${CONFIG.permitsApiBase}?${params.toString()}`;
  const resp = await fetch(url, { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) throw new Error(`API HTTP ${resp.status}`);
  return await resp.json();
}

// ---- Perform Search ----
async function performSearch(lat, lng) {
  const seq = ++searchSeq;
  clearSearchMarkers();
  isSearchActive = true;
  map.flyTo([lat, lng], CONFIG.searchZoom, { duration: 0.8 });

  searchPin = L.marker([lat, lng], {
    icon: L.divIcon({ className: '', html: '<div style="width:16px;height:16px;background:#2b7ce6;border:3px solid #fff;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,0.3);"></div>', iconSize: [16,16], iconAnchor: [8,8] }),
  }).addTo(map);

  searchCircle150 = L.circle([lat, lng], { radius: 150, color: '#2b7ce6', weight: 2, opacity: 0.6, fillColor: '#2b7ce6', fillOpacity: 0.05, dashArray: '6 4' }).addTo(map);
  searchCircle100 = L.circle([lat, lng], { radius: 100, color: '#2b7ce6', weight: 2, opacity: 0.45, fillColor: '#2b7ce6', fillOpacity: 0.07 }).addTo(map);
  searchCircle50  = L.circle([lat, lng], { radius: 50,  color: '#2b7ce6', weight: 1.5, opacity: 0.35, fillColor: '#2b7ce6', fillOpacity: 0.1 }).addTo(map);

  dimGrid();

  // Start the summary fetches in parallel with the permit fetch (different SODA datasets)
  const summaryPromise = Promise.allSettled([
    fetchPointNoise(lat, lng),
    fetchComplaints(lat, lng),
  ]);

  const latPad = (CONFIG.searchRadiusM / 111320) * 1.2;
  const lngPad = (CONFIG.searchRadiusM / (111320 * Math.cos(lat * Math.PI / 180))) * 1.2;
  const rows = await fetchNearbyPermits(lat-latPad, lat+latPad, lng-lngPad, lng+lngPad);

  const nearby = [], seen = new Set();
  for (const row of rows) {
    const rLat = parseFloat(row.latitude), rLng = parseFloat(row.longitude);
    if (isNaN(rLat) || isNaN(rLng)) continue;
    const dkey = [row.job_filing_number, row.work_permit, row.street_name, row.job_description, row.census_tract].map(v => v || '').join('|');
    if (seen.has(dkey)) continue;
    seen.add(dkey);
    const dist = haversineDistance(lat, lng, rLat, rLng);
    if (dist <= CONFIG.searchRadiusM) nearby.push({ ...row, distance: Math.round(dist) });
  }

  const usedCoords = new Map();
  for (const item of nearby) {
    const color = getWorkTypeColor(item.work_type);
    const [mLat, mLng] = offsetCoord(parseFloat(item.latitude), parseFloat(item.longitude), usedCoords);
    const marker = L.circleMarker([mLat, mLng], { radius: 7, color: '#fff', weight: 2, fillColor: color, fillOpacity: 0.9 });
    const addr = [item.house_no, item.street_name].filter(Boolean).join(' ');
    const typeLabel = WORK_TYPE_LABELS[item.work_type] || item.work_type;
    const date = item.issued_date ? item.issued_date.substring(0, 10) : '';
    marker.bindPopup(`<div style="font-size:13px;line-height:1.5;max-width:240px;"><strong>${typeLabel}</strong><br>${item.job_description||''}<br>${addr?'📍 '+addr+'<br>':''}${date?'📅 '+date:''}</div>`);
    searchMarkersGroup.addLayer(marker);
  }

  showResultsPanel(nearby);
  searchCountText.textContent = `${nearby.length} projects within 150m`;
  searchCount.classList.remove('hidden');
  legendNoise.style.display = 'none';
  legendWorkTypes.style.display = 'block';

  const [pointRes, complaintsRes] = await summaryPromise;
  if (seq !== searchSeq || !isSearchActive) return; // superseded search or panel closed — drop stale results

  const point      = pointRes.status === 'fulfilled' ? pointRes.value : null;
  const pointError = pointRes.status === 'rejected';
  const complaints = complaintsRes.status === 'fulfilled' ? complaintsRes.value : null;
  renderSummaryCard({ point, pointError, complaints, complaintsPending: false });

  if (nearby.length > 0) fetchAIAnalysis(nearby, { point, complaints }, seq);
}

// ---- Clear Search ----
function clearSearchMarkers() {
  searchMarkersGroup.clearLayers();
  if (searchCircle150) { map.removeLayer(searchCircle150); searchCircle150 = null; }
  if (searchCircle100) { map.removeLayer(searchCircle100); searchCircle100 = null; }
  if (searchCircle50)  { map.removeLayer(searchCircle50);  searchCircle50  = null; }
  if (searchPin)       { map.removeLayer(searchPin);       searchPin       = null; }
}

function clearSearch() {
  clearSearchMarkers();
  isSearchActive = false;
  restoreGrid();
  searchCount.classList.add('hidden');
  hideResultsPanel();
  legendNoise.style.display = 'block';
  legendWorkTypes.style.display = 'none';
}

// ---- Coordinate Offset ----
function offsetCoord(lat, lng, used) {
  const key = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  const n = used.get(key) || 0;
  used.set(key, n + 1);
  if (n === 0) return [lat, lng];
  const angle = (n * 137.5) * Math.PI / 180;
  const dist  = 0.00003 * Math.ceil(n / 8);
  return [lat + dist * Math.cos(angle), lng + dist * Math.sin(angle)];
}

// ---- Summary Card (address search panel) ----
function feelingForDba(dba, mode = 'outdoor') {
  if (dba === null || dba === undefined) return null;
  const bands = mode === 'outdoor' ? SUMMARY_CONFIG.feelingBands : SUMMARY_CONFIG.feelingBandsIndoor;
  return bands.find(b => dba > b.min);
}

async function fetchPointNoise(lat, lng) {
  const resp = await fetch('/api/point', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat, lng, dateStart: CONFIG.dateStart, dateEnd: CONFIG.dateEnd }),
    signal: AbortSignal.timeout(90000), // longer than the 60s serverless cap (cold start + retries)
  });
  if (!resp.ok) throw new Error(`Point HTTP ${resp.status}`);
  return resp.json();
}

async function fetchComplaints(lat, lng) {
  const c = SUMMARY_CONFIG.complaints;
  // Window is anchored to the real today — deliberately NOT the as-of date
  const end = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - c.months);
  const from = toDateStr(start) + 'T00:00:00';
  const to = toDateStr(end) + 'T23:59:59';

  const latPad = (c.radiusM / 111320) * 1.2;
  const lngPad = (c.radiusM / (111320 * Math.cos(lat * Math.PI / 180))) * 1.2;
  const where = [
    `complaint_type = 'Noise'`,
    `descriptor in ('${c.descriptors.join("','")}')`,
    `created_date >= '${from}'`,
    `created_date <= '${to}'`,
    `latitude between ${lat - latPad} and ${lat + latPad}`,
    `longitude between ${lng - lngPad} and ${lng + lngPad}`,
    `latitude IS NOT NULL`,
  ].join(' AND ');
  const params = new URLSearchParams({ '$select': 'latitude,longitude', '$where': where, '$limit': '5000' });
  const resp = await fetch(`${c.apiBase}?${params}`, { signal: AbortSignal.timeout(30000) });
  if (!resp.ok) throw new Error(`311 HTTP ${resp.status}`);

  const rows = await resp.json();
  if (rows.length >= 5000) return '5000+'; // truncated by $limit — flag instead of silently undercounting
  let count = 0;
  for (const r of rows) {
    const rLat = parseFloat(r.latitude), rLng = parseFloat(r.longitude);
    if (isNaN(rLat) || isNaN(rLng)) continue;
    if (haversineDistance(lat, lng, rLat, rLng) <= c.radiusM) count++;
  }
  return count;
}

// state: { point (object|null), pointError (bool), complaints (number|string|null), complaintsPending (bool) }
function renderSummaryCard(state) {
  lastSummaryState = state;
  let main = '';
  if (state.pointError) {
    main = '<div class="summary-error">Noise estimate unavailable — please try again</div>';
  } else if (!state.point) {
    main = '<div class="summary-loading">Calculating noise…</div>';
  } else if (state.point.dba === null) {
    main = '<div class="summary-dba-none">No major construction within 150m</div>';
  } else {
    // Indoor estimate = outdoor model − facade loss, per the card's window toggle
    const dba = applyFacade(state.point.dba, cardWindowMode);
    const feeling = feelingForDba(dba, cardWindowMode);
    const pill = feeling
      ? `<span class="summary-feeling" style="--feeling-color:${feeling.color}"><span class="summary-feeling-bar"></span>${feeling.label} · ${feeling.sublabel}</span>`
      : '';
    main = `<div class="summary-main"><span class="summary-dba-value">${dba.toFixed(1)}</span><span class="summary-dba-unit">dBA</span>${pill}</div>`;
    const open = cardWindowMode === 'open';
    main += `<button class="summary-toggle">${open ? '🪟 Window open · tap to see windows closed' : '🔒 Windows closed · tap to see window open'}</button>`;
  }

  let items = '';
  if (state.point && state.point.count > 0) {
    items += `<div class="summary-item">${state.point.count} construction ${state.point.count === 1 ? 'site' : 'sites'} within 150m</div>`;
  }
  const c = SUMMARY_CONFIG.complaints;
  const complaintsText = state.complaintsPending ? '…'
    : (state.complaints === null ? '<span class="unavailable">unavailable</span>' : state.complaints);
  items += `<div class="summary-item">311 complaints (${c.months} mo · ${c.radiusM}m): ${complaintsText}</div>`;

  const asOf = CONFIG.dateEnd ? ` · as of ${toDisplayStr(CONFIG.dateEnd.slice(0, 10))}` : '';
  const modeDesc = cardWindowMode === 'open' ? 'window open' : 'windows closed';
  const facadeNote = state.point && state.point.dba !== null
    ? ` · ${facadeDbForMode(cardWindowMode)} dB ${modeDesc} facade is a typical value — actual varies by building`
    : '';
  const estimateDesc = `indoor (${modeDesc}, −${facadeDbForMode(cardWindowMode)} dB)`;
  panelStats.innerHTML = `<div class="summary-card">${main}<div class="summary-items">${items}</div><div class="summary-note">Modeled weekday-daytime ${estimateDesc} estimate · same model as the map${asOf}${facadeNote}</div></div>`;
}

// Card's own window toggle (open/closed) — the map itself always shows the outdoor model
panelStats.addEventListener('click', (e) => {
  if (!e.target.closest('.summary-toggle')) return;
  cardWindowMode = cardWindowMode === 'open' ? 'closed' : 'open';
  if (lastSummaryState) renderSummaryCard(lastSummaryState);
});

// ---- AI Analysis ----
function buildAISummary(summary) {
  const dba = summary.point && summary.point.dba !== null ? summary.point.dba : null;
  const feeling = dba !== null ? feelingForDba(dba) : null;
  const f = SUMMARY_CONFIG.facade;
  const round1 = x => Math.round(x * 10) / 10;
  return {
    dba,
    feeling: feeling ? feeling.label : null,
    feelingDetail: feeling ? feeling.sublabel : null,
    indoorClosed: dba !== null ? round1(Math.max(0, dba - f.closedDb)) : null,
    indoorOpen: dba !== null ? round1(Math.max(0, dba - f.openDb)) : null,
    facadeClosedDb: f.closedDb,
    facadeOpenDb: f.openDb,
    complaints311: summary.complaints ?? null,
    address: currentAddress || null,
    asOf: CONFIG.dateEnd ? CONFIG.dateEnd.slice(0, 10) : null,
  };
}

async function fetchAIAnalysis(projects, summary, seq) {
  aiAnalysis.classList.add('show');
  aiAnalysis.innerHTML = '<div class="ai-title">🤖 AI Noise Analysis</div><div class="ai-loading">Analyzing construction noise impact…</div>';
  try {
    const resp = await fetch('/api/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        projects: projects.map(p => ({ work_type: p.work_type, job_description: p.job_description||'', issued_date: p.issued_date?p.issued_date.substring(0,10):null, distance: p.distance })),
        ...(summary ? { summary: buildAISummary(summary) } : {}),
      }),
    });
    const data = await resp.json();
    if (seq !== searchSeq) return; // superseded by a newer search
    aiAnalysis.innerHTML = data.analysis ? `<div class="ai-title">🤖 AI Noise Analysis</div><div class="ai-text">${data.analysis}</div>` : '<div class="ai-title">🤖 AI Noise Analysis</div><div class="ai-error">Analysis temporarily unavailable.</div>';
  } catch (error) {
    if (seq !== searchSeq) return;
    aiAnalysis.innerHTML = '<div class="ai-title">🤖 AI Noise Analysis</div><div class="ai-error">Analysis temporarily unavailable.</div>';
  }
}

// ---- Results Panel ----
function showResultsPanel(nearby) {
  renderSummaryCard({ point: null, pointError: false, complaints: null, complaintsPending: true });
  const total = nearby.length;
  if (total === 0) {
    panelList.innerHTML = '<div class="panel-empty"><div class="empty-icon">🏗️</div><div class="empty-text">No construction projects nearby</div><div class="empty-hint">Try a different address or expand the date range</div></div>';
    resultsPanel.classList.add('open');
    return;
  }

  let listHTML = '<div class="panel-section-label">Projects</div>';
  for (let i=0; i<nearby.length; i++) {
    const item = nearby[i], color = getWorkTypeColor(item.work_type);
    const typeLabel = WORK_TYPE_LABELS[item.work_type]||item.work_type;
    const addr = [item.house_no, item.street_name].filter(Boolean).join(' ');
    const desc = item.job_description||'', date = item.issued_date?item.issued_date.substring(0,10):'';
    listHTML += `<div class="panel-card" data-index="${i}" style="cursor:pointer"><div class="card-bar" style="background:${color}"></div><div class="card-info"><div class="card-type">${typeLabel}</div>${desc?`<div class="card-desc">${desc}</div>`:''}<div class="card-meta">${[addr,date].filter(Boolean).join(' · ')}</div></div><div class="card-dist">${item.distance}m</div></div>`;
  }
  panelList.innerHTML = listHTML;
  panelList.querySelectorAll('.panel-card').forEach(card => {
    card.addEventListener('click', () => { const item = nearby[parseInt(card.dataset.index)]; map.flyTo([parseFloat(item.latitude), parseFloat(item.longitude)], 17, { duration: 0.6 }); });
  });
  resultsPanel.classList.add('open');
}

function hideResultsPanel() {
  resultsPanel.classList.remove('open');
  aiAnalysis.classList.remove('show');
}

panelCloseBtn.addEventListener('click', () => {
  searchInput.value = '';
  searchClearBtn.classList.remove('visible');
  clearSearch();
  hideResultsPanel();
});

// ---- Esc 关闭 ----
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (resultsPanel.classList.contains('open')) {
    searchInput.value = '';
    searchClearBtn.classList.remove('visible');
    clearSearch();
    hideResultsPanel();
  }
});

// ---- Search Box ----
let searchDebounceTimer = null;
function showSearchClearBtn() { searchClearBtn.classList.add('visible'); }

async function doAddressSearch() {
  const val = searchInput.value.trim();
  if (!val) return;
  showSearchClearBtn();
  searchCountText.textContent = 'Searching…';
  searchCount.classList.remove('hidden');
  try {
    const result = await geocodeAddress(val);
    if (!result) { searchCountText.textContent = '⚠️ Address not found.'; clearSearchMarkers(); return; }
    currentAddress = result.display || val;
    await performSearch(result.lat, result.lng);
  } catch (error) { searchCountText.textContent = '⚠️ Search failed.'; }
}

searchInput.addEventListener('input', () => {
  const val = searchInput.value.trim();
  if (!val) { searchClearBtn.classList.remove('visible'); clearSearch(); return; }
  showSearchClearBtn();
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => doAddressSearch(), 500);
});
searchInput.addEventListener('keydown', (e) => { if (e.key==='Enter') { clearTimeout(searchDebounceTimer); doAddressSearch(); } });
searchClearBtn.addEventListener('click', () => { searchInput.value=''; searchClearBtn.classList.remove('visible'); clearSearch(); searchInput.focus(); });

// ---- Grid Loading ----
let gridPoints = [];
let gridError = false;

function getNoiseBand(dba) { return NOISE_BANDS.find(b => dba > b.min); }

function getGridRadius(dba, zoom) {
  const scale = Math.pow(2, (zoom - 13) / 5);
  return Math.max(1, Math.min(getNoiseBand(dba).radius * scale, 9));
}

function getGridColor(dba) { return getNoiseBand(dba).color; }

function renderNoiseLegend() {
  legendNoise.innerHTML = '<div class="title">Construction Noise (dBA)</div>'
    + NOISE_BANDS.map(b => `<div class="row"><span class="swatch" style="background:${b.color}"></span><span class="legend-range">${b.range}</span>${b.label}</div>`).join('')
    + '<div class="row"><span class="swatch swatch-empty"></span>No dot: no major construction within 150m</div>'
    + '<div class="legend-note">Model estimate (weekday daytime, outdoor) — not a measurement or official determination. Ratings follow NYC CEQR and FTA guidelines.</div>';
}

function renderGrid() {
  if (gridLayer) map.removeLayer(gridLayer);
  const zoom = map.getZoom();
  gridLayer = L.geoJSON(null, {
    pointToLayer: function (feature, latlng) {
      const props = feature.properties;
      const marker = L.circleMarker(latlng, {
        radius: getGridRadius(props.dba, zoom),
        color: 'transparent', weight: 0,
        fillColor: getGridColor(props.dba), fillOpacity: 0.85,
      });
      if (props.count) {
        marker.bindTooltip(`<b>≈ ${Math.round(props.dba)} dBA</b> · ${getNoiseBand(props.dba).label}<br>Estimate at this grid point · Sites within 150m: ${props.count}`, { direction: 'top', offset: [0, -4] });
      }
      return marker;
    },
  });
  const geojson = { type: 'FeatureCollection', features: gridPoints.map(p => ({ type: 'Feature', properties: p, geometry: { type: 'Point', coordinates: [p.lng, p.lat] } })) };
  gridLayer.addData(geojson);
  gridLayer.addTo(map);
}

function updateGridRadii() {
  if (!gridLayer || !gridPoints.length) return;
  const zoom = map.getZoom();
  gridLayer.eachLayer(function (marker) {
    const dba = marker.feature ? marker.feature.properties.dba : 0;
    marker.setRadius(getGridRadius(dba, zoom));
  });
}

map.on('zoomend', updateGridRadii);

async function loadGrid() {
  loadingText.textContent = 'Generating noise grid…';
  try {
    const resp = await fetch('/api/grid', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dateStart: CONFIG.dateStart, dateEnd: CONFIG.dateEnd }),
      signal: AbortSignal.timeout(60000),
    });
    if (!resp.ok) throw new Error(`Grid HTTP ${resp.status}`);
    gridPoints = await resp.json();
    gridError = false;
    renderGrid();
    console.log(`Grid loaded: ${gridPoints.length} points`);
  } catch (error) {
    console.error('Grid failed:', error);
    gridError = true;
    gridPoints = [];   // never leave a grid for a different date on screen
    if (gridLayer) { map.removeLayer(gridLayer); gridLayer = null; }
  }
}

// ---- Status Bar ----
function updateStatusBar() {
  statusBar.classList.toggle('error', gridError);
  if (gridError) { statusBar.textContent = '⚠️ Noise data unavailable — please refresh'; return; }
  const now = new Date();
  const past = isPastAsOf() ? ` · As of ${toDisplayStr(CONFIG.dateEnd.slice(0, 10))} — permits signed off since then are not included` : '';
  statusBar.textContent = `Data: NYC DOB NOW: Build · Updated ${now.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}${past}`;
}

// ---- Refresh All ----
async function refreshAll() {
  refreshIndicator.classList.add('show');
  try {
    await loadGrid();
    if (isSearchActive && searchPin) {
      const latlng = searchPin.getLatLng();
      clearSearchMarkers();
      await performSearch(latlng.lat, latlng.lng);
    }
    updateStatusBar();
  } catch (error) { console.error('Refresh failed:', error); }
  finally { setTimeout(() => refreshIndicator.classList.remove('show'), 600); }
}

// ---- Init ----
async function init() {
  inputAsOf.max = toDateStr(new Date());
  initAsOf(0);
  renderNoiseLegend();
  try {
    loadingText.textContent = 'Loading construction data…';
    await loadGrid();
    loadingText.textContent = 'Rendering map…';
    loadingOverlay.classList.add('hidden');
    updateStatusBar();
  } catch (error) {
    console.error('Init failed:', error);
    loadingText.textContent = 'Failed to load. Please check your network and refresh.';
    loadingText.style.color = '#c00';
    setTimeout(() => {
      loadingOverlay.style.cursor = 'pointer';
      loadingOverlay.title = 'Click to close';
      loadingOverlay.addEventListener('click', () => loadingOverlay.classList.add('hidden'));
    }, 3000);
  }
}

if (document.readyState==='loading') { document.addEventListener('DOMContentLoaded', init); }
else { init(); }
