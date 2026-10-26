# 07 — Noise Model (dBA)

> Created: 2026-10-25
> Status: ✅ Implemented. FTA thresholds checked against the original manual (§10.1). Indoor feeling tiers for the address card (§10.3). One open check: the unit of B in ISO 9613-2 (§7.2)
> Step-by-step walkthrough with a real worked example (Chinese): [08-calculation-walkthrough.md](08-calculation-walkthrough.md)

---

## 1. What the map shows

Each grid point shows a **modeled construction noise level in dBA (Leq)** at that point, **as of a chosen date** (default: today).

- Outdoor level, weekday daytime work hours (NYC construction hours are 7 AM–6 PM on weekdays)
- Construction noise only (traffic and other background noise not included)
- A model estimate — not a measurement and not an official determination
- Grid points are samples every ~200 m × 152 m; a building right next to a site can be 10+ dB louder than the nearest dot

---

## 2. Formula chain

```
Equipment:     Leq_i(50 ft)  = Lmax_i + 10·log10(UF_i / 100)                       [§3]
Stage:         L50           = 10·log10 Σ_i 10^(Leq_i / 10)                         [§4]
Activity:      ΔL            = 10·log10(a)    a = curve(work type, initial/renewal, months since issued)   [§5]
Site:          L_site        = max over the site's permits of (L50 + ΔL)            [§6]
Propagation:   L(d)          = L_site − 20·log10(max(d, 7.62) / 15.24) − min(10, 0.1·B·d)               [§7]
Grid point:    dBA           = 10·log10 Σ_sites within 150 m 10^(L(d) / 10)         [§8]
```

d is in meters; 15.24 m = 50 ft (reference distance); 7.62 m = 25 ft (minimum distance).

---

## 3. Equipment noise levels

Source: **CEQR Technical Manual (Dec 2025), Chapter 22, Table 22-1** — "Noise Emission Reference Levels". Values come from Local Law 113 and DEP's Citywide Construction Noise Mitigation rules (15 RCNY §28-109, Appendix) and are based on the FHWA RCNM equipment library. CEQR: *"Absent information about specific equipment noise characteristics, the maximum values shown in Table 22-1 should be assumed."*

| Equipment (Table 22-1 name) | Usage factor | Lmax @ 50 ft (dBA) | Leq @ 50 ft (dBA) |
|---|---|---|---|
| Mounted Impact Hammer (Hoe Ram) | 20% | 90 | 83.0 |
| Excavator | 40% | 85 | 81.0 |
| Jackhammer | 20% | 85 | 78.0 |
| Compressor (air, greater than 350 cfm) | 40% | 80 | 76.0 |
| Generator | 50% | 82 | 79.0 |
| Drill Rig Truck | 20% | 84 | 77.0 |
| Auger Drill Rig | 20% | 85 | 78.0 |
| Crane | 16% | 85 | 77.0 |
| Welder / Torch | 40% | 73 | 69.0 |
| Bar Bender | 20% | 80 | 73.0 |
| Concrete Mixer Truck | 40% | 85 | 81.0 |
| Concrete Pump Truck | 20% | 82 | 75.0 |

These are **maximum allowable** levels, so the model is conservative. FHWA's measured averages (RCNM "Actual" column) are 0–2.7 dB lower for the stage rosters below.

---

## 4. Work type → construction stage → equipment

NYC environmental reviews analyze construction in stages: demolition, excavation & foundation, superstructure, interiors. Each DOB work type is mapped to a stage. The equipment **types** in each stage come from NYC Final Environmental Impact Statements (FEIS), with **one unit of each type**.

| DOB work_type | Stage | Equipment | Source of equipment types | L50 (dBA @ 50 ft) |
|---|---|---|---|---|
| Full Demolition | Demolition | Hoe Ram, Excavator, Jackhammer, Compressor, Generator | NYBC FEIS Ch. 16 ("excavators with hoe ram attachments … jackhammers, compressors, and generators") | 87.1 |
| Earth Work, Foundation, Support of Excavation | Excavation & Foundation | Excavator, Drill Rig Truck (tie-back), Auger Drill Rig (piles), Crane, Welder/Torch, Bar Bender, Compressor, Generator | GO Broome FEIS Table 15-9 + NYBC FEIS Ch. 16 | 86.4 |
| Structural — only for New Building jobs | Superstructure | Crane, Concrete Mixer Truck, Concrete Pump Truck, Compressor, Generator, Bar Bender | GO Broome FEIS Table 15-9 + NYBC FEIS Ch. 16 | 85.4 |

Notes:

- **Structural permits count only when their job is a New Building.** "New Building" here means job type `New Building` or `ALT-CO - New Building with Existing Elements to Remain` in DOB NOW: Build – Job Application Filings (w9ak-ipjd), joined on `job_filing_number` (99% of active Structural permits join).
  - Structural permits on Alteration jobs are excluded. They are mostly interior beam and reinforcement work, not a superstructure stage.
  - This replaces the old keyword filter. That filter kept only 31 of 2,121 active Structural permits on New Building jobs, while keeping 845 on Alteration jobs.
- **Piles are drilled, not driven.** GO Broome assumed a 95 dBA pile driver/caisson rig; this model uses an Auger Drill Rig instead.
  - NYBC FEIS: "Piles would be installed with the use of drill rigs."
  - In 4,855 Foundation permit descriptions, "DRIVEN" and "IMPACT" appear 0 times; "PILE" mostly refers to pile caps, mini piles and secant walls.
- **Dump trucks and pickups are excluded from on-site sources.** GO Broome excludes them because of NYC's 3-minute idling limit (Admin Code §24-163).
- Equipment that is not in Table 22-1 (concrete vibrators, trowels, hoists, forklifts) is omitted. It is quiet and has no usage factor in Table 22-1.
- **Large projects are underestimated.** With GO Broome's actual equipment counts (e.g., 3 excavators, 4 concrete mixer trucks), its stages would be 89.6 (E&F, drilled piles) and 89.8 dBA (superstructure), 3–5 dB above the one-unit rosters.

### 4.1 Cross-check against EPA (1971) measured site levels

EPA / Bolt Beranek & Newman, *Noise from Construction Equipment and Operations…* (NTID300.1), **Table I-a**, energy-average dB(A). In the EPA setup the noisiest machine is at 50 ft and the rest are at 200 ft. Columns: I = all pertinent equipment present, II = minimum required equipment.

| EPA phase | Domestic housing (I / II) | Office, hotel, hospital, school (I / II) | This model |
|---|---|---|---|
| Ground clearing (incl. demolition) | 83 / 83 | 84 / 84 | 87.1 (Demolition) |
| Excavation | 88 / 75 | 89 / 79 | 86.4 (E&F) |
| Foundations | 81 / 81 | 78 / 78 | 86.4 (E&F) |
| Erection | 81 / 65 | 87 / 75 | 85.4 (Superstructure) |

The model is within EPA's ranges for excavation and erection. It is about 3 dB above EPA for demolition, because the model places all equipment at the same distance.

---

## 5. Activity curves (when is a site actually noisy?)

A permit's issue date does not say when work starts or how long the noisy part lasts. The model therefore uses an **activity factor a** (0–1) and adds `ΔL = 10·log10(a)` (energy share). The factor depends on:

- work type
- whether the permit is an initial permit or a renewal (`filing_reason` contains "Renewal")
- months between `issued_date` and the as-of date

Permits issued **18 or more months** before the as-of date are excluded.

### 5.1 Data

- **311 complaints:** NYC 311 Service Requests (erm2-nwe9), `complaint_type = 'Noise'` with descriptor in:
  - `Noise: Construction Before/After Hours (NM1)`
  - `Noise: Construction Equipment (NC1)`
  - `Noise: Jack Hammering (NC2)`
  - `Construction`
  - `Construction Equipment` (311 uses both the old and the new naming)

  2023-01-01 to 2026-09-30: **117,824 complaints**.
- **Permits:** DOB NOW permits issued 2023-07-01 to 2024-12-31. Only the earliest permit per location and work type is kept.

### 5.2 Method (event study)

1. For each site, count complaints within **50 m**, by month relative to the issue date (−6 … +18).
2. Average per site, then subtract the background level (mean of months −6 to −4).
3. Group months into 3-month bins (0–2, 3–5, …, 15–17), divide by the largest bin, and make the curve non-increasing after its peak.
4. Renewal permits use the background and peak of the same work type's initial permits, capped at 1.
5. **Full Demolition** uses a different method. Complaints after a demolition mostly come from the new building that follows on the same lot, so complaint counts cannot isolate the demolition itself. The model uses the **time until the next-stage permit** instead.
   - A next-stage permit is an initial Earth Work, Foundation, Support of Excavation or New Building Structural permit within 50 m.
   - One was found for 662 of 1,002 demolition sites (66%).
   - Time from demolition permit to next-stage permit: median **4.5 months** (p25 1.9, p75 9.7).
   - The curve is the share of these sites that have not yet received the next-stage permit.
6. Support of Excavation gets its own curve because it has at least 500 sites; below that it would fall back to the Earth Work curve.

### 5.3 Results

Output of `node scripts/activity-curves.js`, run 2026-10-25.

| Months since issued | 0–2 | 3–5 | 6–8 | 9–11 | 12–14 | 15–17 | n (sites) |
|---|---|---|---|---|---|---|---|
| Earth Work — initial | 1 | 0.94 | 0.61 | 0.18 | 0 | 0 | 1,820 |
| Foundation — initial | 1 | 0.89 | 0.68 | 0.43 | 0.20 | 0.20 | 3,444 |
| Support of Excavation — initial | 0.93 | 1 | 0.77 | 0.54 | 0.34 | 0.24 | 1,172 |
| Structural (New Building jobs) — initial | 1 | 0.97 | 0.25 | 0 | 0 | 0 | 1,691 |
| Earth Work — renewal | 1 | 1 | 0.92 | 0.43 | 0.28 | 0.19 | 1,004 |
| Foundation — renewal | 1 | 1 | 1 | 0.78 | 0.78 | 0.62 | 1,756 |
| Support of Excavation — renewal | 1 | 1 | 0.97 | 0.52 | 0.50 | 0.48 | 663 |
| Structural (New Building jobs) — renewal | 1 | 0.57 | 0.12 | 0 | 0 | 0 | 877 |
| Full Demolition (both) | 0.82 | 0.50 | 0.34 | 0.23 | 0.16 | 0.10 | 662 |

Findings:

- **Start delay is negligible.** In the month of issue, complaints near the site are already about 1.8–2.2× the background level:

  | Work type | Background (per site-month) | Month of issue |
  |---|---|---|
  | Earth Work | 0.078 | 0.143 |
  | Foundation | 0.082 | 0.178 |
  | Structural | 0.150 | 0.297 |
  | Support of Excavation | 0.152 | 0.340 |

  Activity peaks in months 1–3. That ramp-up is absorbed into the first bin.
- **Activity fades.** Excavation and foundation activity declines after about 6 months and is near background after about 12 months.
- **Renewals are still busy.** About 35% of active permits are renewals. Excavation and foundation sites stay near peak activity for about 9 months after the renewal, which reflects long, large projects.
- **New Building Structural permits mark the start of the whole job.** In all 2,681 New Building jobs that have both kinds of initial permit in the window, the Structural permit was issued on the same day as the earliest Foundation or Earth Work permit. So its curve describes complaint activity from the start of the job:
  - high for about 6 months;
  - back to the area's normal level after about 9 months.

  The later superstructure work produces far fewer complaints. Because a site keeps its loudest permit (§6), a New Building site is represented later by its Foundation permit, which is still active at 9–17 months. Complaints may under-represent superstructure noise (concrete pours and crane work are less impulsive than excavation), so this is listed as a limitation in §12.
- **Citywide complaint volume is stable**, so it does not bias the curves. Monthly averages were 2,637 (2023), 2,699 (2024), 2,536 (2025) and 2,597 (Jan–Sep 2026).

---

## 6. Site merging

Permits at the same coordinates (rounded to 5 decimals, ≈ 1 m) are treated as **one construction site**. After applying the activity factor, the site keeps the loudest permit (`L50 + ΔL`), i.e., its current loudest stage. Nothing is deleted from the data. This prevents double counting:

- 968 exact duplicate permit rows exist in one year of data.
- 42% of locations have more than one work type.
- CEQR analyzes stages separately.

Permits of the same job share coordinates (only 1 of 8,650 jobs had two different coordinates).

---

## 7. Propagation

### 7.1 Geometric spreading

CEQR Ch. 22: *"these values may be adjusted for distance assuming a 6 dB(A) attenuation per doubling of distance. At distances of less than 25 feet, specific equipment noise data should be used."* This is the same 20·log10 spreading that RCNM uses.

FHWA's RCNM page (checked 2026-10-25) gives the same chain, with D in feet:

```
(1) LmaxCalc = selected_Lmax − 20·log(D/50) − shielding
(2) Leq      = LmaxCalc + 10·log(U.F.% / 100)
(3) L10      = Leq + 3 dBA      (default adjustment, empirically derived from Central Artery/Tunnel construction noise data)
```

The model applies `20·log10(max(d, 7.62) / 15.24)` to the source level. It uses hard ground (no ground term) and no barrier ("shielding") term. Shielding is only represented by the building attenuation below.

### 7.2 Building attenuation (ISO 9613-2, Annex A.3)

`A_hous = 0.1 · B · d_B` dB, capped at 10 dB. B is the building coverage ratio. d_B is the sound path length through the built-up area; the model uses d_B = d.

B for each borough is computed from NYC open data:

```
B = Σ footprint area (feature_code 2100, 5100, 5110) / borough land area
```

| Borough | B |
|---|---|
| Manhattan | 0.328 |
| Brooklyn | 0.271 |
| Queens | 0.195 |
| Bronx | 0.194 |
| Staten Island | 0.117 |

**Unit correction.** In the Socrata Building Footprints dataset (5zhs-2jue), `shape_area` is in **Web Mercator square meters**. True area = `shape_area × cos²(latitude)`; multiply by 10.7639 for square feet. Two buildings confirm the correction:

- Empire State Building (BIN 1015862): 13,854 → ≈ 85,600 sq ft (lot ≈ 83,500 sq ft)
- A Manhattan brownstone (BIN 1030041): 190.3 → ≈ 1,175 sq ft

Borough land areas are the `shape_area` values of the Borough Boundaries dataset (gthc-hcne), in square feet. The grid point's borough is taken from the land mask.

**Unverified: unit of B.** ISO 9613-2 is a paid standard and was not available. The formula was taken from CadnaA's documentation of Annex A.3, which describes B as "area coverage in %". The model uses B as a **ratio between 0 and 1**:

- The factor 0.1 and the 10 dB cap only make sense for a ratio. With a percentage, the cap would be reached within a few meters even in low-density boroughs.
- To be confirmed against the text of Annex A.3 (A.4 in the 2024 edition).

---

## 8. Grid aggregation

- Grid: NYC bounds, 0.0018° spacing (≈ 200 m N–S × 152 m E–W), land points only.
- Sites within **150 m** of a point are summed as energy: `dBA = 10·log10 Σ 10^(L(d)/10)`.
- Points with no site within 150 m get no dot.
- `dba` is rounded to 1 decimal.

Response: `{ lat, lng, dba, count (sites), types, newest }`.

---

## 9. As-of date

The map is computed for an **as-of date** (default today). It includes permits that meet all of these:

- issued in the 12 months before the as-of date
- still valid on it (`expired_date > as-of` or no expiry date)
- `permit_status = 'Permit Issued'`

A longer look-back (18 months) changes almost nothing: permits are valid for one year, and active work is renewed with a new issue date.

**Limitation:** `permit_status` is the *current* status. For a past as-of date, permits that were signed off after that date are missing.

---

## 10. Color scale

Bands are anchored to published thresholds. CEQR's thresholds are in L10, which RCNM approximates as Leq + 3 dB (§7.1, Eq. 3), so the CEQR values are converted to Leq by subtracting 3 dB. Bands include their upper bound (e.g., 62 < Leq ≤ 67).

| Leq (dBA) | Color | Label | Source |
|---|---|---|---|
| > 90 | `#9e0142` dark magenta | 10+ dB above FTA 8-hr guideline | Derived: FTA 8-hr guideline 80 + 10 (not an FTA value, see below) |
| 80–90 | `#d7191c` red | Above FTA 8-hr guideline | FTA Table 7-3, residential, day: Leq(equip)(8hr) 80 |
| 77–80 | `#f46d43` orange-red | Clearly unacceptable | CEQR Table 19-2, residence 7 AM–10 PM: L10 > 80 |
| 67–77 | `#fdae61` light orange | Marginally unacceptable | CEQR: 70 < L10 ≤ 80 |
| 62–67 | `#66c2a5` teal | Marginally acceptable | CEQR: 65 < L10 ≤ 70 |
| ≤ 62 | `#3288bd` blue | Acceptable | CEQR: L10 ≤ 65 |

### 10.1 FTA thresholds (checked against FTA Report No. 0123, Sept 2018, Section 7.1, p. 172–179)

| FTA table | Land use | Metric | Day | Night |
|---|---|---|---|---|
| 7-2 General assessment | Residential | Leq(1hr) of the **two noisiest machines**, usage factor 1 | 90 | 80 |
| 7-2 General assessment | Commercial / Industrial | same | 100 / 100 | 100 / 100 |
| 7-3 Detailed analysis | Residential | Leq(equip)(8hr), **all equipment** of the phase, with usage factors | 80 | 70 |
| 7-3 Detailed analysis | Residential | 30-day average Ldn(equip) | 75 | |
| 7-3 Detailed analysis | Commercial / Industrial | Leq(equip)(8hr) | 85 / 90 | 85 / 90 |

What this model uses:

- **The 8-hour residential day value (80 dBA) is on the same basis as the map.** Both are the combined Leq of all equipment of a stage, using usage factors, at the receiver. The map is daytime only.
- **The 90 dBA value is not used as a threshold.**
  - FTA's general assessment compares the 1-hour Leq of the two noisiest machines running at full power. The map shows a time-averaged level of the whole site, which is a different quantity.
  - For the demolition roster, the two noisiest machines (hoe ram 90 and excavator 85 dBA at 50 ft) add up to about 91 dBA at 50 ft and fall below 90 dBA beyond roughly 17 m, before building attenuation. The map's 90+ points are much rarer and mean something else, such as overlapping sites very close together.
  - The top band is therefore simply 10 dB above the 8-hour guideline.
- **FTA calls these guidelines, not standards.** FTA: *"No standardized criteria have been developed for assessing construction noise impact"*, and the figures are "reasonable criteria for assessment. If these criteria are exceeded, there may be adverse community reaction." The legend uses the word "guideline" for the same reason.
- **Ground term.** FTA's Eq. 7-1 has the same structure as RCNM (§7.1) plus a ground-effect constant G. The general assessment sets G = 0 (free field, no ground effects), as this model does.
- **Equipment levels cross-check.** FTA Table 7-1 typical levels at 50 ft agree within 3 dB with Table 22-1 where both tables list the equipment:

  | Equipment | FTA Table 7-1 | CEQR Table 22-1 |
  |---|---|---|
  | Compressor | 80 | 80 |
  | Generator | 82 | 82 |
  | Concrete mixer | 85 | 85 |
  | Concrete pump | 82 | 82 |
  | Jackhammer | 88 | 85 |
  | Crane | 83 mobile / 88 derrick | 85 |

### 10.2 Dot colors (changed 2026-10-25)

**Scale.** ColorBrewer "Spectral" (Cynthia Brewer, Penn State, the standard cartographic palette set, https://colorbrewer2.org), a blue-to-red diverging scale. Hex values are the published ones: blue `#3288bd` and teal `#66c2a5` (11-class steps 10 and 9), light orange `#fdae61` and orange-red `#f46d43` (steps 4 and 3), red `#d7191c` (5-class version) and dark magenta `#9e0142` (step 1). The pale middle of the scale (pale yellow, pale green) is skipped, because those colors disappear on a light basemap.

**Why a diverging scale.** The break between "Marginally acceptable" (62–67) and "Marginally unacceptable" (67–77) is the CEQR acceptability line (L10 70 dBA, about Leq 67). The color switches from cool (blue, teal = acceptable side) to warm (orange, orange-red, red, dark magenta = unacceptable side) exactly there.

- These two classes hold about 84% of all dots, so the pair most often drawn next to each other is also the most different pair (ΔE 19.7).
- A rainbow-type scale (blue → green → yellow → red) would have put the biggest class, "Marginally unacceptable", on green, which reads as "fine".

**Checks** (colour distance ΔE in OKLab ×100, colour-vision simulation Machado 2009; adjacent classes, quietest → loudest):

| Measure | First palette (green, yellow, orange, red, dark red, crimson) | Current |
|---|---|---|
| ΔE between neighbours, normal vision | 10.1 / 17.4 / 10.8 / 9.0 / 15.6 | 19.3 / 19.7 / 14.5 / 14.3 / 13.7 |
| Worst neighbour, normal vision | 9.0 (red vs dark red) | 13.7 (red vs dark magenta) |
| Worst neighbour, protan / deutan (target 8) | 3.7 (green vs yellow) | 8.6 (teal vs light orange) |
| Worst neighbour, tritan | 9.1 | 9.5 |
| Worst of all 15 pairs, normal / protan-deutan | 9.0 / 3.7 | 13.7 / 8.6 |

Blue against orange is the safest hue pair for color-blind readers, so the two most common classes stay apart under every simulation.

**Dot radius is a second cue.** It grows with severity: 1.5 / 2.2 / 3.2 / 4.3 / 5.4 / 6.4 px at zoom 13 (capped at 9 px). Each of the three common classes is about 1.4 times the size of the one below it (62–67 is 0.69 of 67–77; ≤ 62 is 0.68 of 62–67). The earlier steps of 0.6 px looked identical on the map.

Alternatives considered:

- **ColorBrewer RdYlBu** (pure blue → red: `#4575b4`, `#74add1`, `#fdae61`, `#f46d43`, `#d73027`, `#a50026`). Slightly better for color-blind readers (worst neighbour 11.5), but its warm end is less varied (neighbours 12.3–14.5). Swap it in by replacing the six colors in `NOISE_BANDS`.
- **A green → yellow → orange → red → purple scale** (the traffic-light order of air-quality and noise-map legends): neighbours were 18 or more apart, but yellow, orange and red read as one warm family. It was replaced at the owner's request for a standard scale with more obvious color changes.
- **A one-hue ramp** (orange → maroon): neighbours only 11.4 apart and muddy brown.
- **A ring around the dots** (white or dark): no clear gain on the map.

Known deviations (accepted):

- **The warm-end neighbours (orange-red, red, dark magenta) are 13.7–14.5 apart**, below the 15 that the validator wants for unrelated categories. These are the rare classes (about 12% of all dots together), they grow in size with severity, and their lightness falls steadily.
- **Light orange (1.79:1 against the basemap) and teal (2.08:1) are low-contrast marks** (the 3:1 guideline is not met). The relief is that every class is named in the always-visible legend and in each dot's tooltip. For comparison, the first palette's yellow was at 1.62:1.
- **The categorical lightness-band and chroma-floor checks flag** the light orange and the teal (chroma 0.099, floor 0.10). Those checks are meant for unrelated series, not for an ordered scale, so this is expected.

Simulated distribution (as of 2026-10-25, 4,053 sites, 5,893 land points): 3.9 / 34.2 / 50.2 / 5.3 / 5.7 / 0.7% from quietest to loudest; median 68.7 dBA.

For context:

- **Background noise.** Measured daytime street levels in Midtown Manhattan are Leq(1) 67–76 dBA (15 Penn Plaza FEIS, Appendix G.3).
- **Indoor levels.** CEQR Table 19-3 requires 28–35 dB(A) of window-wall attenuation, with windows closed, for new homes exposed to 70–80 dBA L10.

### 10.3 Indoor feeling tiers (summary card, added 2026-10-26)

The map always shows the outdoor model (§10). The address search card additionally shows the indoor estimate — the outdoor dBA shifted by a typical facade loss (windows closed: −20 dB typical building / −28 dB new construction 2010+; −10 dB window open; `SUMMARY_CONFIG.facade`) — and rates it with four indoor feeling tiers anchored to published indoor criteria that are already in Leq/Ldn form, so no L10 conversion is needed. A separate indoor scale is needed because indoor 50 dBA is already intrusive while outdoor 50 dBA is quiet. The tiers are calibrated to a renter's everyday perception: an earlier version used CEQR's interior L10 thresholds converted with the −3 dB traffic-noise rule, which flagged about a third of the city as "Very loud" — defensible as a regulatory reading, but harsher than how construction noise is actually experienced (see the bullet below).

| Leq (dBA) | Color | Label | Source |
|---|---|---|---|
| > 55 | `#f46d43` orange-red | Very loud | Derived: adequacy line + 10 (perception tier) |
| 45–55 | `#fdae61` light orange | Loud | EPA Levels Document (1974): indoor Ldn 45 adequacy line |
| 35–45 | `#66c2a5` teal | Moderate | Meets EPA indoor adequacy (≤ 45 Ldn); above the WHO day guideline |
| ≤ 35 | `#3288bd` blue | Quiet | WHO Guidelines for Community Noise (1999): indoor daytime guideline 35 dB LAeq |

- **The 45 dBA boundary is the EPA indoor adequacy line.** The EPA Levels Document identifies indoor Ldn 45 as requisite for residential adequacy. Since construction noise is daytime-only, Ldn ≈ Leq(day) − 2 dB, so Ldn 45 ≈ daytime Leq 47 — the 2 dB is inside model uncertainty, and 45 is used as the rounded anchor.
- **The 35 dBA boundary is the WHO indoor daytime guideline** (35 dB LAeq, the onset of moderate annoyance); the night bedroom guideline (30 dB) sits below it.
- **Why not the CEQR interior thresholds?** CEQR Table 19-2's interior L10 45/35 are significance thresholds expressed in L10. Converting with the traffic-noise −3 dB rule gives Leq 42/32, but construction noise is intermittent — its L10−Leq is really 5–10 dB, so a faithful conversion sits *lower* still. A renter-facing label anchored that way marks about a third of the city "Very loud", which matches the regulatory lens but not everyday experience. The 35/45/55 scale keeps published anchors while reading like a renter would describe the noise.
- **Facade loss (open −10 dB; closed −20 dB typical / −28 dB new construction).** The card shows both closed-window values. 20 dB is the FTA's standard exterior-to-interior building reduction with windows closed (Transit Noise and Vibration Impact Assessment) — a typical-building figure. 28 dB is the minimum window-wall attenuation NYC Building Code (BC 1207) / CEQR Table 19-3 require for new residential construction in high-noise areas — the right figure for post-2010 buildings, which is what most searches target. 10 dB is the commonly used loss with windows open. Actual losses vary with window type (old single-glazing ≈ 15–20 dB, double glazing ≈ 25 dB, PTAC through-wall units are weak points); the card's footnote marks the values as typical.
- A three-mode map toggle (outdoor / window open / windows closed, with a separate six-band indoor color scale) was built and then removed at the owner's request on 2026-10-26 — the map is outdoor-only; indoor numbers remain on the card.

---

## 11. Reproducing and updating

```
node scripts/activity-curves.js
```

The script fetches 311 complaints, DOB permits and job types from NYC Open Data, recomputes §5.3, and prints JSON. Copy the result into `ACTIVITY_CURVES` in `lib/noise-model.js`. Re-run about once a year, and check that 311 descriptor names have not changed.

---

## 12. Known limitations

- **Conservative inputs.** Table 22-1 values are maximum allowable levels; measured averages are 0–2.7 dB lower.
- **One unit per equipment type.** Large projects are underestimated by 3–5 dB.
- **Building attenuation is a borough average.** Points with a direct line of sight along the same street are underestimated, by up to about 5 dB at 150 m in Manhattan.
- **Complaints are a proxy for activity.** Complaint volume depends on population density, so only the shape over time is used.
  - Renewal curves borrow the background of initial permits and may be slightly high.
  - The demolition curve uses the time to the next-stage permit, which is an upper bound on demolition duration.
  - Late superstructure work generates few complaints. It is therefore treated as low-activity, which may understate it.
- **Grid points are samples.** Values at a specific address can differ from the nearest dot by 10+ dB.
- **Construction only.** The model covers weekday daytime and outdoor levels only. Night and after-hours work is not modeled, although after-hours construction (NM1) is the most common 311 construction complaint: 33k vs 12k for equipment (NC1) since 2025.
- **Past as-of dates are incomplete** (see §9).

---

## 13. Sources

- CEQR Technical Manual 2025 — Ch. 22 Construction: https://www.nyc.gov/assets/oec/technical-manual/22_Construction_2025.pdf · Ch. 19 Noise: https://www.nyc.gov/assets/oec/technical-manual/19_Noise_2025.pdf
- NYBC (New York Blood Center) FEIS Ch. 16: https://www.nyc.gov/assets/planning/download/pdf/applicants/env-review/ny-blood-center-east/16-feis.pdf
- GO Broome Street FEIS Ch. 15: https://www.nyc.gov/assets/planning/download/pdf/applicants/env-review/go-broome/15-feis.pdf
- Greater East Midtown FEIS Ch. 18: https://www.nyc.gov/assets/planning/download/pdf/applicants/env-review/gem/18_feis.pdf
- 15 Penn Plaza FEIS Appendix G: https://www.nyc.gov/assets/planning/download/pdf/applicants/env-review/15_penn/appendixg_feis.pdf
- FHWA Construction Noise Handbook Ch. 9 (RCNM Table 9.1): https://www.fhwa.dot.gov/environment/noise/construction_noise/handbook/handbook09.cfm · RCNM: https://www.fhwa.dot.gov/ENVIRonment/noise/construction_noise/rcnm/rcnm09.cfm
- EPA / BBN (1971) NTID300.1: https://www.resolutionmineeis.us/sites/default/files/references/bbn-technologies-1971.pdf
- ISO 9613-2 Annex A (as documented by CadnaA): https://doku.datakustik.com/CadnaA/en/BebaungBewuchs.html
- FTA Transit Noise and Vibration Impact Assessment Manual (2018), FTA Report No. 0123: https://www.transit.dot.gov/research-innovation/transit-noise-and-vibration-impact-assessment-manual-report-0123
- NYC Open Data: permits https://data.cityofnewyork.us/resource/rbx6-tga4.json · job filings https://data.cityofnewyork.us/resource/w9ak-ipjd.json · 311 https://data.cityofnewyork.us/resource/erm2-nwe9.json · building footprints https://data.cityofnewyork.us/resource/5zhs-2jue.json · borough boundaries https://data.cityofnewyork.us/resource/gthc-hcne.geojson
