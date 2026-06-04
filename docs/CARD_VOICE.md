# Card voice & copy standard

Mechanical one-liners for the 61-card arena deck. No separate flavor field — names and diction carry lore.

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
| `Left seam:` / `Right seam:` | Wildcard bridge cards |
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
| **Volta** (volt) | Sharp, immediate | shock, chip, pierce, Cascade on chipped foes |

Shared support (**Mend**, **Aegis**) stays **neutral** — no mage names on the line.

## Glossary sync

Terms in copy should match [`src/lib/brawlGlossary.ts`](../src/lib/brawlGlossary.ts). After any copy change, run `npm run test:copy`.

## Sources

- Catalog: [`src/lib/elementCards.ts`](../src/lib/elementCards.ts)
- Mechanics: [`src/lib/elementAbilities.ts`](../src/lib/elementAbilities.ts)
- Audit log: [`docs/CARD_COPY_AUDIT.md`](CARD_COPY_AUDIT.md)
