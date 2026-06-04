<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# When Things Attack

A mage-themed elemental card autobattler built with React, Three.js (R3F), Tailwind, and Zustand. Choose your archmage, weave elemental bonds in the arena, then watch the duel resolve in real time.

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

- The repo currently has no remote-AI integration. Opponent hands use deterministic optimization in [`src/lib/brawlElements.ts`](src/lib/brawlElements.ts) and do not call external APIs.
- Test scripts: `npm run test:connect`, `npm run test:effects`, `npm run test:cooldown`, or `npm test` for all three.
- Class playtests: `npx tsx src/lib/__ignis_playtest.ts`, `npx tsx src/lib/__ren_playtest.ts`, `npx tsx src/lib/__lumi_playtest.ts`, `npx tsx src/lib/__volta_playtest.ts`
