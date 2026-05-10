const fs = require('fs');
let code = fs.readFileSync('src/components/CardGameOverlay.tsx', 'utf-8');

code = code.replace(
  "const equippedItemIds = useGameStore((s) => s.equippedItems[card.id] || []);",
  "const equippedItemIdsRaw = useGameStore((s) => s.equippedItems[card.id]);\n  const equippedItemIds = equippedItemIdsRaw || [];"
);

fs.writeFileSync('src/components/CardGameOverlay.tsx', code);
console.log("Fixed infinite loop in CardGameOverlay");
