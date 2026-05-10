const fs = require('fs');
let code = fs.readFileSync('src/components/CardGameOverlay.tsx', 'utf-8');

// We need to inject the items import
if (!code.includes("import { ITEMS } from '../lib/items';")) {
  code = code.replace(
    "import { useGameStore",
    "import { ITEMS } from '../lib/items';\nimport { useGameStore"
  );
}

// 1. Add hook inside CardItem
if (!code.includes("const equippedItemIds = useGameStore(")) {
  code = code.replace(
    /const CardItem = \(\{[\s\S]*?\}\) => \{/,
    match => match + "\n  const equippedItemIds = useGameStore((s) => s.equippedItems[card.id] || []);"
  );
}

// 2. Add render block
if (!code.includes("equippedItemIds.map(")) {
  const renderBlock = `
      {equippedItemIds.length > 0 && (
        <div className="absolute bottom-1 left-1 right-1 flex flex-wrap gap-0.5 justify-center z-40">
          {equippedItemIds.map((itemId, i) => {
            const item = ITEMS[itemId];
            if (!item) return null;
            return (
              <div key={i} className="bg-emerald-900/90 border border-emerald-500 rounded px-1 py-0.5 text-[6px] text-emerald-200 font-bold uppercase truncate max-w-full">
                {item.name}
              </div>
            );
          })}
        </div>
      )}
`;

  code = code.replace(
    /<\/div>\n      \{\/\* The value text used to be keyed by `displayValue`/,
    `</div>${renderBlock}      {/* The value text used to be keyed by \`displayValue\``
  );
}

fs.writeFileSync('src/components/CardGameOverlay.tsx', code);
console.log("CardItem updated with equipped items display");
