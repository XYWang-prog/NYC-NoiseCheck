/* ================================================================
   NYC NoiseCheck — Activity curve derivation (offline, run ~yearly)
   Re-derives ACTIVITY_CURVES in lib/noise-model.js from NYC 311
   construction-noise complaints around DOB NOW permits.
   Method: docs/07-noise-model.md §5.   Usage: node scripts/activity-curves.js
   ================================================================ */

const SODA = 'https://data.cityofnewyork.us/resource';
const PERMITS_URL = `${SODA}/rbx6-tga4.json`;
const JOBS_URL    = `${SODA}/w9ak-ipjd.json`;
const NOISE_URL   = `${SODA}/erm2-nwe9.json`;

const NB_JOB_TYPES = ['New Building', 'ALT-CO - New Building with Existing Elements to Remain'];
const WORK_TYPES   = ['Earth Work', 'Foundation', 'Structural', 'Support of Excavation', 'Full Demolition'];
// 311 renamed its descriptors; both spellings are kept
const DESCRIPTORS  = ['Noise: Construction Before/After Hours (NM1)', 'Noise: Construction Equipment (NC1)',
                      'Noise: Jack Hammering (NC2)', 'Construction', 'Construction Equipment'];

const RADIUS_M  = 50;      // complaints counted within this distance of a site
const M_FROM    = -6;      // months before issue (background = months -6..-4)
const M_TO      = 18;      // months after issue
const DAYS_PER_MONTH = 30.44;
const MIN_SITES_OWN_CURVE = 500;   // SOE keeps the Earth Work curve below this sample size

// ---- Windows (defaults follow the run date; docs/07 §5.1) ----
function monthStartUTC(d) { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); }
function addMonths(d, n)  { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1)); }
const END   = monthStartUTC(new Date());     // complaints up to (exclusive)
const W1    = addMonths(END, -21);           // permits issued before (leaves 18 months of follow-up)
const W0    = addMonths(W1, -18);            // permits issued from
const START = addMonths(W0, -6);             // complaints from (6 months of background)
const iso   = d => d.toISOString().slice(0, 10);

// ---- Fetch helpers ----
async function fetchJSON(url, timeoutMs = 120000) {
  const resp = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url.slice(0, 120)}`);
  return resp.json();
}

async function fetchAll(base, params, page = 50000) {
  let all = [], offset = 0;
  while (true) {
    const qs = new URLSearchParams({ ...params, '$limit': String(page), '$offset': String(offset) });
    const rows = await fetchJSON(`${base}?${qs}`);
    all = all.concat(rows);
    if (rows.length < page) return all;
    offset += page;
  }
}

const quoteList = arr => arr.map(s => `'${s.replace(/'/g, "''")}'`).join(',');
const parseUTC  = s => Date.parse(s.slice(0, 19) + 'Z');   // Socrata floating timestamps

// ---- Spatial helpers ----
const CELL = 0.001;
const cellKey = (lat, lng) => `${Math.floor(lat / CELL)},${Math.floor(lng / CELL)}`;

function buildIndex(items) {
  const index = new Map();
  for (const it of items) {
    const k = cellKey(it.lat, it.lng);
    if (!index.has(k)) index.set(k, []);
    index.get(k).push(it);
  }
  return index;
}

function* near(index, lat, lng, radiusM) {
  const ci = Math.floor(lat / CELL), cj = Math.floor(lng / CELL);
  const kx = 111320 * Math.cos(lat * Math.PI / 180);
  for (let di = -1; di <= 1; di++) {
    for (let dj = -1; dj <= 1; dj++) {
      const cell = index.get(`${ci + di},${cj + dj}`);
      if (!cell) continue;
      for (const it of cell) {
        if (Math.hypot((it.lat - lat) * 111320, (it.lng - lng) * kx) <= radiusM) yield it;
      }
    }
  }
}

// ---- Curve math ----
const round2 = x => Math.round(x * 100) / 100;

function monthlyRates(sites, complaintIndex) {
  const counts = new Array(M_TO - M_FROM + 1).fill(0);
  for (const s of sites) {
    for (const c of near(complaintIndex, s.lat, s.lng, RADIUS_M)) {
      const m = Math.floor(Math.floor((c.t - s.t) / 86400000) / DAYS_PER_MONTH);
      if (m >= M_FROM && m <= M_TO) counts[m - M_FROM]++;
    }
  }
  return counts.map(n => n / sites.length);
}

// 3-month bins (0-2 … 15-17) of the excess over background
function excessBins(rates, base) {
  const bins = [];
  for (let b = 0; b < 6; b++) {
    const i = -M_FROM + 3 * b;
    bins.push(Math.max(0, (rates[i] + rates[i + 1] + rates[i + 2]) / 3 - base));
  }
  return bins;
}

// non-increasing after the peak
function monotone(curve) {
  const peak = curve.indexOf(Math.max(...curve));
  const out = curve.slice();
  for (let i = peak + 1; i < out.length; i++) out[i] = Math.min(out[i], out[i - 1]);
  return out.map(round2);
}

// earliest permit per location for one work type and kind, issued in [W0, W1)
function firstPermitSites(permits, workType, kind) {
  const first = new Map();
  for (const p of permits) {
    if (p.workType !== workType || p.kind !== kind || p.t < W0.getTime() || p.t >= W1.getTime()) continue;
    const k = `${p.lat.toFixed(5)},${p.lng.toFixed(5)}`;
    if (!first.has(k) || p.t < first.get(k).t) first.set(k, p);
  }
  return [...first.values()];
}

// ---- Main ----
async function main() {
  console.error(`Windows: complaints ${iso(START)} → ${iso(END)}, permits issued ${iso(W0)} → ${iso(W1)}`);

  const [complaintRows, permitRows, jobRows] = await Promise.all([
    fetchAll(NOISE_URL, {
      '$select': 'created_date,latitude,longitude', '$order': 'created_date',
      '$where': `complaint_type = 'Noise' AND descriptor in (${quoteList(DESCRIPTORS)}) AND created_date >= '${iso(START)}' AND created_date < '${iso(END)}' AND latitude IS NOT NULL`,
    }),
    fetchAll(PERMITS_URL, {
      '$select': 'job_filing_number,work_type,issued_date,latitude,longitude,filing_reason', '$order': 'issued_date',
      '$where': `work_type in (${quoteList(WORK_TYPES)}) AND issued_date >= '${iso(START)}' AND issued_date < '${iso(END)}' AND latitude between 40.49 and 40.92 AND longitude between -74.26 and -73.70`,
    }),
    fetchAll(JOBS_URL, { '$select': 'job_filing_number', '$where': `job_type in (${quoteList(NB_JOB_TYPES)})` }),
  ]);
  console.error(`Fetched ${complaintRows.length} complaints, ${permitRows.length} permits, ${jobRows.length} New Building jobs`);

  const nbJobs = new Set(jobRows.map(j => j.job_filing_number));
  const complaints = complaintRows
    .map(c => ({ lat: parseFloat(c.latitude), lng: parseFloat(c.longitude), t: parseUTC(c.created_date) }))
    .filter(c => !isNaN(c.lat) && !isNaN(c.lng));
  const permits = permitRows
    .map(p => ({
      lat: parseFloat(p.latitude), lng: parseFloat(p.longitude), t: parseUTC(p.issued_date), workType: p.work_type,
      job: p.job_filing_number,
      kind: (p.filing_reason || '').includes('Renewal') ? 'R' : p.filing_reason === 'Initial Permit' ? 'I' : 'X',
    }))
    .filter(p => !isNaN(p.lat) && !isNaN(p.lng) && (p.workType !== 'Structural' || nbJobs.has(p.job)));
  const complaintIndex = buildIndex(complaints);

  const curves = {}, sampleSizes = {}, startRamp = {};

  // Event-study curves
  for (const wt of ['Earth Work', 'Foundation', 'Structural', 'Support of Excavation']) {
    const initial = firstPermitSites(permits, wt, 'I');
    const rates = monthlyRates(initial, complaintIndex);
    const base = (rates[0] + rates[1] + rates[2]) / 3;
    const bins = excessBins(rates, base);
    const peak = Math.max(...bins) || 1;
    curves[`${wt}|I`] = monotone(bins.map(x => Math.min(1, x / peak)));
    sampleSizes[`${wt}|I`] = initial.length;
    // complaints per site-month: background vs. month of issue
    startRamp[wt] = { background: Math.round(base * 1000) / 1000, month0: Math.round(rates[-M_FROM] * 1000) / 1000 };

    const renewal = firstPermitSites(permits, wt, 'R');
    curves[`${wt}|R`] = monotone(excessBins(monthlyRates(renewal, complaintIndex), base).map(x => Math.min(1, x / peak)));
    sampleSizes[`${wt}|R`] = renewal.length;
  }

  // SOE: own curve only with enough sites
  if (sampleSizes['Support of Excavation|I'] < MIN_SITES_OWN_CURVE) {
    curves['Support of Excavation|I'] = curves['Earth Work|I'];
    curves['Support of Excavation|R'] = curves['Earth Work|R'];
    sampleSizes.note = `SOE has ${sampleSizes['Support of Excavation|I']} sites (< ${MIN_SITES_OWN_CURVE}); using Earth Work curves`;
  }

  // Demolition: time until the next-stage permit nearby (docs/07 §5.2)
  const permitIndex = buildIndex(permits.filter(p => p.kind === 'I' && p.workType !== 'Full Demolition'));
  const gaps = [];
  const demoSites = firstPermitSites(permits, 'Full Demolition', 'I');
  for (const d of demoSites) {
    let next = Infinity;
    for (const p of near(permitIndex, d.lat, d.lng, RADIUS_M)) if (p.t > d.t && p.t < next) next = p.t;
    if (next < Infinity) gaps.push((next - d.t) / 86400000 / DAYS_PER_MONTH);
  }
  gaps.sort((a, b) => a - b);
  const survival = [];
  for (let m = 0; m < 18; m++) survival.push(gaps.filter(g => g > m + 0.5).length / gaps.length);
  const demo = [];
  for (let b = 0; b < 6; b++) demo.push(round2((survival[3 * b] + survival[3 * b + 1] + survival[3 * b + 2]) / 3));
  curves['Full Demolition|I'] = demo;
  curves['Full Demolition|R'] = demo;
  const q = p => round2(gaps[Math.floor(p * (gaps.length - 1))]);
  sampleSizes['Full Demolition'] = { sites: demoSites.length, withNextStage: gaps.length, monthsToNextStage: { p25: q(0.25), median: q(0.5), p75: q(0.75) } };

  console.log(JSON.stringify({
    generated: iso(new Date()),
    windows: { complaints: [iso(START), iso(END)], permitsIssued: [iso(W0), iso(W1)] },
    complaints: complaints.length,
    sampleSizes, startRamp, curves,
  }, null, 2));
}

main().catch(err => { console.error('Failed:', err.message); process.exit(1); });
