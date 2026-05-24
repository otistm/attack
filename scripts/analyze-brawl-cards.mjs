import fs from 'fs';

const src = fs.readFileSync('src/lib/cards.ts', 'utf8');
const cards = [...src.matchAll(/"id": "([^"]+)"[\s\S]*?"description": "([^"]+)"/g)].map((m) => ({
  id: m[1],
  desc: m[2],
}));

const buckets = {
  brawlSimple: [],
  combineRule: [],
  selfConditional: [],
  opponentConditional: [],
  modalOrReveal: [],
  transformOrKill: [],
  brawlIrrelevant: [],
};

for (const c of cards) {
  const d = c.desc;
  const dl = d.toLowerCase();
  if (
    /flip a coin|choose one|name a shape|discard this|reveal the|must reveal|must discard|break the batter|draw 1 extra|destroys one|change the shape|reverses (your|the batter)|nullifies|ignores all|cannot use any general|pitcher cannot|batter must|automatic single|counts as 2 outs|runner on 3rd|next batter|hit scale|hit is capped|shrinks the batter|between two combined|wins all ties|pitcher wins the tie|exactly equal|capped at 6/.test(
      dl,
    )
  ) {
    if (/reveal the|must reveal/.test(dl)) buckets.modalOrReveal.push(c);
    else if (/choose one|name a shape|flip a coin|discard this|must discard|change the shape|reverses|destroys|break the|draw 1|nullifies|ignores all|cannot use any general|pitcher cannot|batter must/.test(dl))
      buckets.transformOrKill.push(c);
    else buckets.brawlIrrelevant.push(c);
  } else if (/cannot be combined|can only combine|left side acts|both sides are wildcards|flat edges|cannot be combined on the left|right side/.test(dl)) {
    buckets.combineRule.push(c);
  } else if (/pitcher's|batter's|highest|uncombined|on the board|every card|other .* card|in your hand|for every|if they are|if the pitcher uses|if the batter/.test(dl)) {
    buckets.opponentConditional.push(c);
  } else if (/if combined|if uncombined|if you win|if you lose|\+[0-9] value if|\+[0-9] if/.test(dl)) {
    buckets.selfConditional.push(c);
  } else {
    buckets.brawlSimple.push(c);
  }
}

console.log('Total cards:', cards.length);
for (const [k, v] of Object.entries(buckets)) {
  console.log(`${k}: ${v.length}`);
}

const seen = [
  'b-109', 'b-110', 'b-111', 'b-79', 'b-25', 'b-26', 'b-27', 'b-71', 'b-112', 'b-113', 'b-114',
  'b-1', 'b-87', 'b-95', 'b-81', 'b-88', 'p-57', 'p-86',
];
console.log('\n--- Playtest cards ---');
for (const id of seen) {
  const c = cards.find((x) => x.id === id);
  if (c) console.log(`${id}: ${c.desc}`);
}
