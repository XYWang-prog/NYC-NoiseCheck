# 03 — Design Specification

> Project: NYC NoiseCheck
> Version: v1.0
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

### Noise Score Grid (6 levels)

| Level | Hex | Meaning |
|-------|-----|---------|
| 1 | `#a8d65e` | Very quiet (0–0.5) |
| 2 | `#f1c40f` | Quiet (0.5–1.0) |
| 3 | `#e67e22` | Moderate (1.0–1.5) |
| 4 | `#e74c3c` | Loud (1.5–2.5) |
| 5 | `#c0392b` | Very loud (2.5–5.0) |
| 6 | `#7b241c` | Extreme (5+) |

### Work Type Marker Colors

| Type | Hex |
|------|-----|
| Full Demolition | `#e31a1c` |
| Structural | `#fd8d3c` |
| Foundation | `#a65628` |
| Earth Work | `#238b45` |

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
- Text: `📅 2025/08/02 — 2026/08/02`
- Style: light gray background, rounded 6px, hover darkens
- Click opens popup panel below

### Date Popup Panel
- White background, rounded 10px, shadow
- Contains: start date input + end date input + preset buttons
- Presets: `3 Months | 6 Months | 1 Year` (1 Year default)
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
| Hover grid point | Tooltip (score, project count) |
| Click project marker | Popup with details |
| Click date button | Popup panel appears |
| Select date range | Panel closes → data refreshes |
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
