import fs from 'fs';

const src = fs.readFileSync('src/lib/cards.ts', 'utf8');
const cards = [
  ...src.matchAll(
    /"id": "([^"]+)"[\s\S]*?"name": "([^"]+)"[\s\S]*?"type": "([^"]+)"[\s\S]*?"abilityType": "([^"]+)"[\s\S]*?"baseValue": (\d+)[\s\S]*?"description": "([^"]+)"/g,
  ),
].map((m) => ({
  id: m[1],
  name: m[2],
  type: m[3],
  abilityType: m[4],
  base: Number(m[5]),
  desc: m[6],
}));

const stats = {
  total: cards.length,
  batSig: cards.filter((x) => x.type === 'Batting' && x.abilityType !== 'General Draw').length,
  batGen: cards.filter((x) => x.type === 'Batting' && x.abilityType === 'General Draw').length,
  pitSig: cards.filter((x) => x.type === 'Pitching' && x.abilityType !== 'General Draw').length,
  pitGen: cards.filter((x) => x.type === 'Pitching' && x.abilityType === 'General Draw').length,
};

fs.writeFileSync('scripts/cards-export.json', JSON.stringify({ stats, cards }, null, 2));
console.log(stats);
