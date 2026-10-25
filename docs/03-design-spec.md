# 03 — Design Specification

> Project: NYC NoiseCheck
> Version: v1.1 (2026-10-25: dBA bands, as-of date, Support of Excavation)
> Updated: 2026-07-16

---

## Design Principles

- **Clean**: Moderate information density, no clutter
- **Intuitive**: Usable without a tutorial
- **Map-first**: The map is the hero, other elements stay out of the way

---

## Layout

```
┌──────────────────────────────────────────────┐
│  Top Bar (56px, semi-transparent white)       │
│  🏗️ Title                        📅 Date     │
├──────────────────────────────────────────────┤
│         🔍 Floating Search                   │
├──────────────────────┬───────────────────────┤
│                      │   Results Panel       │
│    Map Area          │   (hidden by default, │
│   - Noise grid       │    slides in from     │
│   - Search pin       │    right on search)   │
│   - Radius circles   │   ┌───────────────┐   │
│   - Project markers  │   │ Stats         │   │
│                      │   │ AI Analysis   │   │
│                      │   │ Project list  │   │
│                      │   └───────────────┘   │
├──────────────────────┴───────────────────────┤
│  Legend · Status bar (bottom)                │
└──────────────────────────────────────────────┘
```

---

## Color Scheme

### Primary Colors

| Usage | Color | Hex |
|-------|-------|-----|
| Page background | White | `#ffffff` |
| Top bar background | Semi-transparent white | `rgba(255,255,255,0.92)` |
| Body text | Dark gray | `#333333` |
| Secondary text | Medium gray | `#666666` |
| Accent | Blue | `#2b7ce6` |

### Construction Noise Grid (6 dBA bands)

| Leq dBA | Hex | Label | Source |
|---------|-----|-------|--------|
| ≤ 62 | `#3288bd` blue | Acceptable | CEQR L10 ≤ 65 (−3 dB) |
| 62–67 | `#66c2a5` teal | Marginally acceptable | CEQR 65–70 |
| 67–77 | `#fdae61` light orange | Marginally unacceptable | CEQR 70–80 |
| 77–80 | `#f46d43` orange-red | Clearly unacceptable | CEQR > 80 |
| 80–90 | `#d7191c` red | Above FTA 8-hr guideline | FTA Table 7-3, residential day 80 |
| > 90 | `#9e0142` dark magenta | 10+ dB above FTA 8-hr guideline | 80 + 10 (derived, not an FTA value) |

The colors are ColorBrewer "Spectral" steps, blue to red, with the break from cool to warm at the CEQR acceptability line. Why and how they were checked: [07-noise-model.md §10.2](07-noise-model.md). Dot radius grows with severity (at zoom 13: 1.5 / 2.2 / 3.2 / 4.3 / 5.4 / 6.4 px, capped at 9 px).

The legend is generated from `NOISE_BANDS` in `app.js`. Under the bands it shows a dashed empty swatch ("No dot: no major construction within 150m") and a small grey disclaimer: "Model estimate (weekday daytime, outdoor) — not a measurement or official determination. Ratings follow NYC CEQR and FTA guidelines."

### Work Type Marker Colors

| Type | Hex |
|------|-----|
| Full Demolition | `#e31a1c` |
| Structural | `#fd8d3c` |
| Foundation | `#a65628` |
| Earth Work | `#238b45` |
| Support of Excavation | `#6a51a3` |

---

## Component Specs

### Floating Search Box
- Width: 440px, centered horizontally, 80px from top
- Border-radius: 30px
- Shadow: `0 6px 24px rgba(0,0,0,0.18)`
- Search icon on left, clear button on right
- Placeholder: "Enter an address to check noise…"
- Focus: blue glow

### Date Button
- Text: `📅 As of 2026/10/25` (default today)
- Style: light gray background, rounded 6px, hover darkens
- Click opens popup panel below

### Date Popup Panel
- White background, rounded 10px, shadow
- Contains:
  - one "Noise as of" date input (max = today)
  - preset buttons
  - a grey note: "Includes permits issued in the 12 months before this date that are still active on it."
- Presets: `Today | 3 Months Ago | 6 Months Ago` (Today default)
- Past dates show an orange note ("Past date: permits signed off since then are not included."). The status bar repeats it.
- Click outside to close

### Results Panel
- Width: 360px, slides in from right
- White background, left shadow
- Header: title + close button ✕
- Body: stats + AI analysis + project list (cards with left color bar)

### Map Markers
- Circle markers, colored by work type
- White border 2px
- Click opens popup (project details)

### 150m Radius Circles
- Three concentric circles (150m/100m/50m)
- Fill: very light blue
- Stroke: `#2b7ce6`, dashed

---

## Interaction Rules

| Trigger | Behavior |
|---------|----------|
| Page load | Show loading → map + noise grid |
| Input address | Grid dims (0.3s transition) → fly to location → circles + markers → panel slides in |
| Click ✕ clear | Panel slides out → remove circles/markers → grid restores |
| Hover grid point | Tooltip ("≈ NN dBA · rating", "Estimate at this grid point · Sites within 150m: N") |
| Click project marker | Popup with details |
| Click date button | Popup panel appears |
| Select as-of date / preset | Panel closes → data refreshes |
| Grid request fails | Grid removed; status bar turns red: "⚠️ Noise data unavailable — please refresh" |
| Click outside panel | Panel closes |

---

## Typography

- System font stack: `-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif`
- Title: 22px bold
- Body: 14px
- Small: 12px
- Code/data: monospace

---

## Responsive (Mobile)

- Breakpoint: screen width < 768px
- Search box full-width (calc(100vw - 32px))
- Results panel slides up from bottom (50vh height)
- Legend moves up when panel is open
- Map fills remaining space
