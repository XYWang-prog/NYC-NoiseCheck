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
  dateStart:       null,
  dateEnd:         null,
  workTypes:       ['Full Demolition','Foundation','Earth Work','Structural'],
  searchRadiusM:   150,
  gridSpacingM:    200,
};

// ---- Noise Weights ----
const NOISE_WEIGHTS = {
  'Full Demolition': 1.00,
  'Foundation':      0.90,
  'Earth Work':      0.80,
  'Structural':      0.65,
};

const STRUCTURAL_KEYWORDS = [
  'steel erection', 'structural steel', 'concrete frame',
  'columns', 'beams', 'deck', 'shoring', 'underpinning',
  'reinforcement', 'major structural alteration',
];

// ---- Work Type Colors ----
const WORK_TYPE_COLORS = {
  'Full Demolition': '#e31a1c',
  'Foundation':      '#a65628',
  'Earth Work':      '#238b45',
  'Structural':      '#fd8d3c',
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

// ---- DOM ----
const loadingOverlay    = document.getElementById('loading-overlay');
const loadingText       = document.getElementById('loading-text');
const refreshIndicator  = document.getElementById('refresh-indicator');
const dateBtn           = document.getElementById('date-btn');
const dateLabel         = document.getElementById('date-label');
const datePopup         = document.getElementById('date-popup');
const inputStart        = document.getElementById('input-start');
const inputEnd          = document.getElementById('input-end');
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

L.tileLayer('https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a>',
  maxZoom: 19,
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

function initDateRange(monthsAgo) {
  const end   = new Date();
  const start = new Date();
  start.setMonth(start.getMonth() - monthsAgo);
  CONFIG.dateStart = toDateStr(start) + 'T00:00:00';
  CONFIG.dateEnd   = toDateStr(end)   + 'T23:59:59';
  inputStart.value = toDateStr(start);
  inputEnd.value   = toDateStr(end);
  dateLabel.textContent = `${toDisplayStr(toDateStr(start))} — ${toDisplayStr(toDateStr(end))}`;
}

// ---- Date Button ----
dateBtn.addEventListener('click', () => datePopup.classList.toggle('show'));
document.addEventListener('click', (e) => {
  if (!datePopup.contains(e.target) && e.target !== dateBtn && !dateBtn.contains(e.target)) {
    datePopup.classList.remove('show');
  }
});

function applyCustomDate() {
  const s = inputStart.value, e = inputEnd.value;
  if (!s || !e) return;
  CONFIG.dateStart = s + 'T00:00:00';
  CONFIG.dateEnd   = e + 'T23:59:59';
  dateLabel.textContent = `${toDisplayStr(s)} — ${toDisplayStr(e)}`;
  presetBtns.forEach(b => b.classList.remove('active'));
  datePopup.classList.remove('show');
  refreshAll();
}
inputStart.addEventListener('change', applyCustomDate);
inputEnd.addEventListener('change', applyCustomDate);

presetBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const months = parseInt(btn.dataset.months);
    initDateRange(months);
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

  const typeLabels = { 'Full Demolition': 'Demolition', 'Foundation': 'Foundation', 'Earth Work': 'Earth Work', 'Structural': 'Structural' };
  const usedCoords = new Map();
  for (const item of nearby) {
    const color = getWorkTypeColor(item.work_type);
    const [mLat, mLng] = offsetCoord(parseFloat(item.latitude), parseFloat(item.longitude), usedCoords);
    const marker = L.circleMarker([mLat, mLng], { radius: 7, color: '#fff', weight: 2, fillColor: color, fillOpacity: 0.9 });
    const addr = [item.house_no, item.street_name].filter(Boolean).join(' ');
    const typeLabel = typeLabels[item.work_type] || item.work_type;
    const date = item.issued_date ? item.issued_date.substring(0, 10) : '';
    marker.bindPopup(`<div style="font-size:13px;line-height:1.5;max-width:240px;"><strong>${typeLabel}</strong><br>${item.job_description||''}<br>${addr?'📍 '+addr+'<br>':''}${date?'📅 '+date:''}</div>`);
    searchMarkersGroup.addLayer(marker);
  }

  showResultsPanel(nearby);
  searchCountText.textContent = `${nearby.length} projects within 150m`;
  searchCount.classList.remove('hidden');
  legendNoise.style.display = 'none';
  legendWorkTypes.style.display = 'block';
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

// ---- AI Analysis ----
async function fetchAIAnalysis(projects) {
  aiAnalysis.classList.add('show');
  aiAnalysis.innerHTML = '<div class="ai-title">🤖 AI Noise Analysis</div><div class="ai-loading">Analyzing construction noise impact…</div>';
  try {
    const resp = await fetch('/api/analyze', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projects: projects.map(p => ({ work_type: p.work_type, job_description: p.job_description||'', issued_date: p.issued_date?p.issued_date.substring(0,10):null, distance: p.distance })) }),
    });
    const data = await resp.json();
    aiAnalysis.innerHTML = data.analysis ? `<div class="ai-title">🤖 AI Noise Analysis</div><div class="ai-text">${data.analysis}</div>` : '<div class="ai-title">🤖 AI Noise Analysis</div><div class="ai-error">Analysis temporarily unavailable.</div>';
  } catch (error) {
    aiAnalysis.innerHTML = '<div class="ai-title">🤖 AI Noise Analysis</div><div class="ai-error">Analysis temporarily unavailable.</div>';
  }
}

// ---- Results Panel ----
function showResultsPanel(nearby) {
  const total = nearby.length;
  if (total === 0) {
    panelStats.innerHTML = '<div class="stat-total">No projects found</div><div class="stat-sub">within 150m radius</div>';
    panelList.innerHTML = '<div class="panel-empty"><div class="empty-icon">🏗️</div><div class="empty-text">No construction projects nearby</div><div class="empty-hint">Try a different address or expand the date range</div></div>';
    resultsPanel.classList.add('open');
    return;
  }
  const typeCounts = {};
  for (const item of nearby) { const t = item.work_type||'Unknown'; typeCounts[t]=(typeCounts[t]||0)+1; }
  const typeLabels = { 'Full Demolition': 'Demolition', 'Foundation': 'Foundation', 'Earth Work': 'Earth Work', 'Structural': 'Structural' };
  let statsHTML = `<div class="stat-total">${total} projects</div><div class="stat-sub">within 150m radius</div><div class="stat-types">`;
  for (const [type, count] of Object.entries(typeCounts)) {
    const label = typeLabels[type]||type;
    statsHTML += `<div class="stat-type-item"><span class="stat-type-dot" style="background:${getWorkTypeColor(type)}"></span>${label}: ${count}</div>`;
  }
  statsHTML += '</div>';
  panelStats.innerHTML = statsHTML;

  let listHTML = '<div class="panel-section-label">Projects</div>';
  for (let i=0; i<nearby.length; i++) {
    const item = nearby[i], color = getWorkTypeColor(item.work_type);
    const typeLabel = typeLabels[item.work_type]||item.work_type;
    const addr = [item.house_no, item.street_name].filter(Boolean).join(' ');
    const desc = item.job_description||'', date = item.issued_date?item.issued_date.substring(0,10):'';
    listHTML += `<div class="panel-card" data-index="${i}" style="cursor:pointer"><div class="card-bar" style="background:${color}"></div><div class="card-info"><div class="card-type">${typeLabel}</div>${desc?`<div class="card-desc">${desc}</div>`:''}<div class="card-meta">${[addr,date].filter(Boolean).join(' · ')}</div></div><div class="card-dist">${item.distance}m</div></div>`;
  }
  panelList.innerHTML = listHTML;
  panelList.querySelectorAll('.panel-card').forEach(card => {
    card.addEventListener('click', () => { const item = nearby[parseInt(card.dataset.index)]; map.flyTo([parseFloat(item.latitude), parseFloat(item.longitude)], 17, { duration: 0.6 }); });
  });
  resultsPanel.classList.add('open');
  fetchAIAnalysis(nearby);
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

function getGridRadius(score, zoom) {
  const base = score < 0.5 ? 2.0 : score < 1.0 ? 2.6 : score < 1.5 ? 3.2 : score < 2.5 ? 3.8 : score < 5.0 ? 4.4 : 5.0;
  const scale = Math.pow(2, (zoom - 13) / 5);
  return Math.max(1, Math.min(base * scale, 5.5));
}

function getGridColor(score) {
  if (score < 0.5) return '#a8d65e';       // light green
  if (score < 1.0) return '#f1c40f';       // yellow
  if (score < 1.5) return '#e67e22';       // orange
  if (score < 2.5) return '#e74c3c';       // red
  if (score < 5.0) return '#c0392b';       // deep red
  return '#7b241c';                         // dark crimson
}

function renderGrid() {
  if (gridLayer) map.removeLayer(gridLayer);
  const zoom = map.getZoom();
  gridLayer = L.geoJSON(null, {
    pointToLayer: function (feature, latlng) {
      const props = feature.properties;
      const marker = L.circleMarker(latlng, {
        radius: getGridRadius(props.score, zoom),
        color: 'transparent', weight: 0,
        fillColor: getGridColor(props.score), fillOpacity: 0.85,
      });
      if (props.count) {
        marker.bindTooltip(`<b>Score:</b> ${props.score}<br><b>Projects:</b> ${props.count}`, { direction: 'top', offset: [0, -4] });
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
    const score = marker.feature ? marker.feature.properties.score : 0;
    marker.setRadius(getGridRadius(score, zoom));
  });
}

map.on('zoomend', updateGridRadii);

async function loadGrid() {
  loadingText.textContent = 'Generating noise grid…';
  try {
    const resp = await fetch('/api/grid', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dateStart: CONFIG.dateStart, dateEnd: CONFIG.dateEnd }),
    });
    if (!resp.ok) throw new Error(`Grid HTTP ${resp.status}`);
    gridPoints = await resp.json();
    renderGrid();
    console.log(`Grid loaded: ${gridPoints.length} points`);
  } catch (error) {
    console.error('Grid failed:', error);
  }
}

// ---- Status Bar ----
function updateStatusTime() {
  const now = new Date();
  statusBar.textContent = `Data: NYC DOB NOW: Build · Updated ${now.toLocaleTimeString('en-US',{hour:'2-digit',minute:'2-digit'})}`;
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
    updateStatusTime();
  } catch (error) { console.error('Refresh failed:', error); }
  finally { setTimeout(() => refreshIndicator.classList.remove('show'), 600); }
}

// ---- Init ----
async function init() {
  initDateRange(12);
  try {
    loadingText.textContent = 'Loading construction data…';
    await loadGrid();
    loadingText.textContent = 'Rendering map…';
    loadingOverlay.classList.add('hidden');
    updateStatusTime();
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
