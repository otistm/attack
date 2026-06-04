# Card voice & copy standard

Mechanical one-liners for the 67-card arena deck. No separate flavor field — names and diction carry lore.

## Core fantasy

Each card is **half an element** at its seam. When two compatible cards **snap** together, that element **activates** (becomes whole). The **left** card attacks using **both** printed values; the **right** card waits and does not fire separately.

**Never use “bond”** in player-facing copy. Use **activated** instead.

## Line grammar

```text
[Trigger]. [Effect]. [Numbers explicit].
```

### Triggers (pick one)

| Trigger | When to use |
|---------|-------------|
| `Fire activated:` / `Freeze activated:` / … | Left card fires that element on a snap |
| `Snapped:` | Chain value enabler (Ember/Cinder/Rime/Spark/Venin) |
| `Snapped left end:` / `Snapped right end:` | Flint, Tailwind |
| `Solo:` / `Solo finisher:` | Unsnapped attack |
| `Left seam:` / `Right seam:` | Wildcard bridge cards (include `seam power -1` when applicable) |
| `Your fire hits:` | Passive modifiers (Oil Flask) |

### Banned in descriptions

- `bond`
- `DoT` → “burning or poisoned”
- `clean hit`
- Vague `slow` → “chill stacks”

### Numbers

Always digits: `2`, `5`, `6`. State pierce amounts: `ignores 2 shield`.

## Per-mage voice (mechanical diction only)

| Mage | Tone | Favor |
|------|------|-------|
| **Ignis** (fire) | Aggressive, impatient | burn, pierce, solo fire finishers |
| **Ren** (freeze) | Cold, patient | chill, chip, shield+chill (Bitter) |
| **Lumi** (poison) | Clinical, alchemical | poison stacks, shred shield, solo finisher |
| **Volta** (volt) | Sharp, immediate | shock, chip, pierce, volt barrier, Cascade on chipped foes |

Shared support (**Mend**, **Aegis**) stays **neutral** — no mage names on the line.

## Pool design (activation puzzle)

Class pools live in [`src/lib/elementClassPools.ts`](../src/lib/elementClassPools.ts). Goals: activation stays fun, but **which seams to affirm and card order** should matter more than “snap everything.”

| Class | Pool size | Wildcard bridge | Support |
|-------|-----------|-----------------|---------|
| Fire (Ignis) | 13 | Tinderbox (`el-51`) only | Mend |
| Freeze (Ren) | 12 | Snowglobe (`el-53`) only | Aegis |
| Poison (Lumi) | 11 | — | Mend |
| Volt (Volta) | 11 | — | — (Mend removed) |

**Dealing:** [`elementDeal.ts`](../src/lib/elementDeal.ts) uses per-card weights (bridges **0.22**), **no duplicate catalog IDs** in one hand, and **at most one wildcard bridge** per hand.

**Wildcard downside:** seams touching a bridge card lose **1 seam power** (see `WILDCARD_BRIDGE_BOND_PENALTY` in [`elementAbilities.ts`](../src/lib/elementAbilities.ts)). Copy: `seam power -1` (never “bond”).

**Shape mix:** fewer `square→square` / `circle→circle` / `star→star` lines in pools; more mixed seams; picky edges on Wildfire (`hexagon` right) and Rot (`diamond` right).

**Regression:** `npm run test:pool-audit` — optimal seam counts per class (500 deals). After the balance pass, fire/freeze median optimal seams ≈ **1** (was ~2–3).

### Tuning pass (combat balance)

| Mage | Change |
|------|--------|
| **Ignis** | Mend removed from fire pool; burn ticks **2** HP/s (poison stays 1) |
| **Ren** | Icicle/Shiver solo chip 3; Avalanche +3 chip; Permafrost +2 chip; **+1 chip** on freeze hits vs already-chilled foes |
| **Lumi** | Bane solo 5; poison stack **80%** on bonds; Miasma extra stack **75%**; Nightshade/Grind caps **3** |
| **Volta** | Mend out of pool; Jolt/Faraday solo **3** shock; barrier grants **+chip** on activate; retaliate **3**; Cascade **+3**; Chain Lightning **+3**/chain card |

**Human-style sim:** `npm run test:human-playtest` — shuffled order, partial seams vs optimal opponent.

### Dual-damage cards (Lumi / Ren / Volta)

Cards that **chip on solo** and still apply their element when **activated** (poison stack, chill, or volt barrier):

| ID | Mage | Pattern |
|----|------|---------|
| `el-64`–`el-65` | Lumi | Solo chip (+ poison on Viper Fang); activated adds poison stacks |
| `el-66`–`el-67` | Ren | Solo chip + light chill; activated adds chill (Frost Mite +2) |
| `el-68`–`el-69` | Volta | Solo shock chip; activated grants **volt barrier** (no foe chip) |

**Volt barrier:** stacks on your seat; when a **card hit** reduces your HP or shield, you lose 1 stack and the attacker takes **2** retaliate chip. DoT and sandstorm do not trigger it.

## Glossary sync

Terms in copy should match [`src/lib/brawlGlossary.ts`](../src/lib/brawlGlossary.ts). After any copy change, run `npm run test:copy`.

## Sources

- Catalog: [`src/lib/elementCards.ts`](../src/lib/elementCards.ts)
- Mechanics: [`src/lib/elementAbilities.ts`](../src/lib/elementAbilities.ts)
- Audit log: [`docs/CARD_COPY_AUDIT.md`](CARD_COPY_AUDIT.md)
