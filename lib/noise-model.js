/* ================================================================
   NYC NoiseCheck — Construction noise model
   Method, sources and limitations: docs/07-noise-model.md
   ================================================================ */

// ---- Equipment: CEQR Technical Manual (2025) Table 22-1 ----
// Lmax @ 50 ft (dBA) and usage factor (%), from Local Law 113 / 15 RCNY §28-109 Appendix (FHWA RCNM library)
const EQUIPMENT = {
  'Mounted Impact Hammer (Hoe Ram)': { lmax: 90, uf: 20 },
  'Excavator':                       { lmax: 85, uf: 40 },
  'Jackhammer':                      { lmax: 85, uf: 20 },
  'Compressor (air, > 350 cfm)':     { lmax: 80, uf: 40 },
  'Generator':                       { lmax: 82, uf: 50 },
  'Drill Rig Truck':                 { lmax: 84, uf: 20 },
  'Auger Drill Rig':                 { lmax: 85, uf: 20 },
  'Crane':                           { lmax: 85, uf: 16 },
  'Welder / Torch':                  { lmax: 73, uf: 40 },
  'Bar Bender':                      { lmax: 80, uf: 20 },
  'Concrete Mixer Truck':            { lmax: 85, uf: 40 },
  'Concrete Pump Truck':             { lmax: 82, uf: 20 },
};

// ---- Construction stages: equipment types from NYC FEIS documents, one unit each ----
const STAGE_EQUIPMENT = {
  // NYBC FEIS Ch. 16: "excavators with hoe ram attachments … jackhammers, compressors, and generators"
  demolition: ['Mounted Impact Hammer (Hoe Ram)', 'Excavator', 'Jackhammer', 'Compressor (air, > 350 cfm)', 'Generator'],
  // GO Broome FEIS Table 15-9 + NYBC FEIS Ch. 16 (piles installed with drill rigs, not pile drivers)
  excavationFoundation: ['Excavator', 'Drill Rig Truck', 'Auger Drill Rig', 'Crane', 'Welder / Torch', 'Bar Bender', 'Compressor (air, > 350 cfm)', 'Generator'],
  // GO Broome FEIS Table 15-9 + NYBC FEIS Ch. 16
  superstructure: ['Crane', 'Concrete Mixer Truck', 'Concrete Pump Truck', 'Compressor (air, > 350 cfm)', 'Generator', 'Bar Bender'],
};

const WORK_TYPE_STAGE = {
  'Full Demolition':       'demolition',
  'Earth Work':            'excavationFoundation',
  'Foundation':            'excavationFoundation',
  'Support of Excavation': 'excavationFoundation',
  'Structural':            'superstructure',   // New Building jobs only
};
const WORK_TYPES = Object.keys(WORK_TYPE_STAGE);

// DOB NOW Job Application Filings job_type values treated as new construction
const NB_JOB_TYPES = ['New Building', 'ALT-CO - New Building with Existing Elements to Remain'];

// ---- Activity curves: scripts/activity-curves.js (run 2026-10-25) ----
// Share of peak activity by months since issued: 0–2, 3–5, 6–8, 9–11, 12–14, 15–17 (18+ excluded)
const ACTIVITY_CURVES = {
  'Earth Work':            { initial: [1, 0.94, 0.61, 0.18, 0, 0],         renewal: [1, 1, 0.92, 0.43, 0.28, 0.19] },
  'Foundation':            { initial: [1, 0.89, 0.68, 0.43, 0.2, 0.2],     renewal: [1, 1, 1, 0.78, 0.78, 0.62] },
  'Support of Excavation': { initial: [0.93, 1, 0.77, 0.54, 0.34, 0.24],   renewal: [1, 1, 0.97, 0.52, 0.5, 0.48] },
  'Structural':            { initial: [1, 0.97, 0.25, 0, 0, 0],            renewal: [1, 0.57, 0.12, 0, 0, 0] },
  'Full Demolition':       { initial: [0.82, 0.5, 0.34, 0.23, 0.16, 0.1],  renewal: [0.82, 0.5, 0.34, 0.23, 0.16, 0.1] },
};
const DAYS_PER_MONTH = 30.44;

// ---- Building coverage B per borocode (ISO 9613-2 Annex A.3) ----
// NYC Building Footprints (feature codes 2100/5100/5110) ÷ borough land area — docs/07 §7.2
const BUILDING_COVERAGE = { '1': 0.328, '2': 0.194, '3': 0.271, '4': 0.195, '5': 0.117 };

// ---- Propagation ----
const REF_DIST_M     = 15.24;  // 50 ft reference distance
const MIN_DIST_M     = 7.62;   // 25 ft — CEQR: 6 dB/doubling applies down to 25 ft
const MAX_RADIUS_M   = 150;
const HOUSING_MAX_DB = 10;     // ISO 9613-2 cap on housing attenuation

const dbToEnergy = db => 10 ** (db / 10);
const energyToDb = e => 10 * Math.log10(e);
const energySum  = levels => energyToDb(levels.reduce((sum, db) => sum + dbToEnergy(db), 0));

const STAGE_LEQ_50FT = Object.fromEntries(Object.entries(STAGE_EQUIPMENT).map(([stage, names]) =>
  [stage, energySum(names.map(n => EQUIPMENT[n].lmax + 10 * Math.log10(EQUIPMENT[n].uf / 100)))]));

// Fraction of peak activity at refDate (0 = excluded)
function activityFactor(workType, filingReason, issuedDateStr, refDate) {
  const curves = ACTIVITY_CURVES[workType];
  if (!curves) return 0;
  const months = issuedDateStr ? (refDate - new Date(issuedDateStr)) / (86400000 * DAYS_PER_MONTH) : 0;
  if (months < 0) return 0;
  const bin = Math.floor(months / 3);
  if (bin >= 6) return 0;
  return ((filingReason || '').includes('Renewal') ? curves.renewal : curves.initial)[bin];
}

// Source level (dBA Leq @ 50 ft, activity-adjusted) for one permit, or null if it does not count
function sourceLevel(project, refDate, newBuildingJobs) {
  const stage = WORK_TYPE_STAGE[project.work_type];
  if (!stage) return null;
  if (project.work_type === 'Structural' && !newBuildingJobs.has(project.job_filing_number)) return null;
  const a = activityFactor(project.work_type, project.filing_reason, project.issued_date, refDate);
  if (a <= 0) return null;
  return STAGE_LEQ_50FT[stage] + 10 * Math.log10(a);
}

// Level at distance: CEQR 6 dB/doubling + ISO 9613-2 housing attenuation (0.1·B·d, max 10 dB)
function levelAtDistance(sourceDb, distM, coverage) {
  const spreading = 20 * Math.log10(Math.max(distM, MIN_DIST_M) / REF_DIST_M);
  const housing = Math.min(HOUSING_MAX_DB, 0.1 * (coverage || 0) * distM);
  return sourceDb - spreading - housing;
}

module.exports = {
  EQUIPMENT, STAGE_EQUIPMENT, WORK_TYPE_STAGE, WORK_TYPES, NB_JOB_TYPES, ACTIVITY_CURVES, BUILDING_COVERAGE,
  STAGE_LEQ_50FT, REF_DIST_M, MIN_DIST_M, MAX_RADIUS_M,
  dbToEnergy, energyToDb, energySum, activityFactor, sourceLevel, levelAtDistance,
};
