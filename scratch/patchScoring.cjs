const fs = require('fs');
let code = fs.readFileSync('src/lib/scoring.ts', 'utf-8');

// 1. Add import
if (!code.includes("import { ITEMS }")) {
  code = code.replace(
    /import \{ CardDefinition, TagLiteral \} from "\.\/cards";/,
    "import { CardDefinition, TagLiteral } from \"./cards\";\nimport { ITEMS } from \"./items\";"
  );
}

// 2. Add to ScoringContext
if (!code.includes("equippedItems?: Record<string, string[]>;")) {
  code = code.replace(
    /  questHitScaleBonus\?\: number;\n\}/,
    "  questHitScaleBonus?: number;\n  equippedItems?: Record<string, string[]>;\n}"
  );
}

// 3. Apply inside scoreGroup
if (!code.includes("itemValueBonus")) {
  const replaceTarget = "const finalValue = chainTooShort ? 0 : card.baseValue + effect.selfValueDelta;";
  const replaceWith = `
    let itemValueBonus = 0;
    if (ctx.equippedItems?.[card.id]) {
      for (const itemId of ctx.equippedItems[card.id]) {
        const item = ITEMS[itemId];
        if (item?.valueModifier) itemValueBonus += item.valueModifier;
        if (item?.hitScaleModifier) hitScaleBonus += item.hitScaleModifier;
      }
    }
    const finalValue = chainTooShort ? 0 : card.baseValue + effect.selfValueDelta + itemValueBonus;
`;
  code = code.replace(replaceTarget, replaceWith);
}

fs.writeFileSync('src/lib/scoring.ts', code);
console.log("scoring.ts updated");
