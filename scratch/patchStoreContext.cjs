const fs = require('fs');
let code = fs.readFileSync('src/lib/gameStore.ts', 'utf-8');

// There are several places where ScoringContext is created.
// Usually they look like:
// const ctx: ScoringContext = {
//   side: "Batting",
//   inning: s.inning,
//   ...
// };
// We'll replace `inning: s.inning,` with `inning: s.inning, equippedItems: s.equippedItems,`

code = code.replace(/inning: s\.inning,/g, "inning: s.inning,\n      equippedItems: s.equippedItems,");

fs.writeFileSync('src/lib/gameStore.ts', code);
console.log("gameStore updated");
