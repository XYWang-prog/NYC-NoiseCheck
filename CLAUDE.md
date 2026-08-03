# CLAUDE.md — NYC NoiseCheck

## Overview

Single-page website providing construction noise insights for NYC apartment renters. Displays construction permit data on a Leaflet map to help users evaluate noise impact at different addresses.

- **Tech stack**: Vanilla HTML + CSS + JavaScript + Node.js backend
- **Entry point**: `index.html` (references `style.css` and `app.js`)
- **Backend**: `server.js` (Express + OpenAI API for AI analysis + grid computation)
- **Deployment**: `node server.js`, then open `http://localhost:3000`
- **Users**: General public — all interactions must be simple and intuitive

---

## Docs Index

| Document | Path | Content |
|----------|------|---------|
| Requirements | [docs/01-requirements.md](docs/01-requirements.md) | Features, user scenarios, filter rules |
| Technical Design | [docs/02-technical-design.md](docs/02-technical-design.md) | Tech choices, API analysis, data flow, algorithms |
| Design Spec | [docs/03-design-spec.md](docs/03-design-spec.md) | UI layout, colors, component specs, interactions |
| Implementation Plan | [docs/04-implementation-plan.md](docs/04-implementation-plan.md) | Phased development steps and verification |
| API Reference | [docs/05-api-reference.md](docs/05-api-reference.md) | Endpoints, fields, query examples |
| Noise Grid Plan | [docs/06-noise-grid-plan.md](docs/06-noise-grid-plan.md) | Noise grid implementation plan |
| Dev Logs | [devlog/](devlog/) | Daily development records |
| Main Styles | [style.css](style.css) | All CSS styles |
| Main Script | [app.js](app.js) | All frontend JavaScript logic |
| Server | [server.js](server.js) | Backend API + grid computation |

---

## Work Rules

1. **Small steps**: One task per phase. Complete and verify before continuing. Don't write all the code at once.
2. **Read docs first**: Before writing code, read the relevant docs to understand inputs and outputs.
3. **Write logs**: After each dev session, create or update `devlog/YYYY-MM-DD.md` with what was done and what's next.
4. **Don't guess**: When unsure about requirements, design, or data, use AskUserQuestion. Never assume.
5. **Keep it simple**: No frameworks or build tools. Vanilla HTML/CSS/JS.
6. **Error-friendly**: All external requests (API, GeoJSON, Nominatim) must have timeout handling and user-visible error messages.
7. **Stay in phase**: Don't cross phases. Phase 1 is map + boundaries only — don't write search ahead of time.

---

## Dev Log Format

After each dev session, update `devlog/YYYY-MM-DD.md`:

```markdown
# Dev Log — YYYY-MM-DD

## Completed
- [x] Specific items completed

## Current Phase
Phase X — Name

## TODO
- [ ] Next steps

## Issues
- Problem + solution

## Notes
Other notes
```

---

## Branch Strategy

No git branching needed. The project structure is flat; backup after each phase if desired.
