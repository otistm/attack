<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Dugout

A 3D baseball-card matchup game built with React, Three.js (R3F), Tailwind, and Zustand.

## Run Locally

**Prerequisites:** Node.js

1. Install dependencies:
   `npm install`
2. Run the app:
   `npm run dev`

The dev server runs on `http://localhost:3000`.

## Design & Development

Game design, balance, and engineering standards live in **[docs/ARCHMAGE_ARCHITECT.md](docs/ARCHMAGE_ARCHITECT.md)** (the Archmage Architect guide). Consult it when adding cards, mechanics, class pools, combat tuning, or VFX. Cursor agents load a summary via `.cursor/rules/archmage-architect.mdc`.

## Notes

- The repo currently has no remote-AI integration. The draft AI is a deterministic
  heuristic auction engine in [`src/lib/draft.ts`](src/lib/draft.ts) and does not
  call any external API. If you wire one in later, route the call through a
  server-side process -- never inline an API key into the client bundle via
  Vite's `define` (see comment in [`vite.config.ts`](vite.config.ts)).
- Test scripts: `npm run test:connect`, `npm run test:effects`, `npm run test:copy`,
  or `npm test` to run all three.
