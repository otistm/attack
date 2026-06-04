/**
 * Mage class decks — offensive identity + per-class support staples.
 */
import type { Element } from "./brawlElements";

export type BrawlClass = Extract<Element, "fire" | "freeze" | "poison" | "volt">;

/** Shared minimal support — Mend + Aegis only (no Bastion/Purge duplication). */
export const CLASS_SUPPORT_CARD_IDS = ["el-06", "el-09"] as const;

const FIRE_SUPPORT_CARD_IDS = CLASS_SUPPORT_CARD_IDS;
const POISON_SUPPORT_CARD_IDS = CLASS_SUPPORT_CARD_IDS;
const VOLT_SUPPORT_CARD_IDS = ["el-06"] as const;

const FIRE_ELEMENT_IDS = [
  "el-02",
  "el-05",
  "el-12",
  "el-16",
  "el-19",
  "el-26",
  "el-31",
  "el-32",
  "el-33",
  "el-34",
  "el-35",
  "el-51",
  "el-52",
  "el-57",
  "el-58",
] as const;

const FREEZE_ELEMENT_IDS = [
  "el-07",
  "el-11",
  "el-18",
  "el-36",
  "el-37",
  "el-38",
  "el-39",
  "el-40",
  "el-53",
  "el-54",
  "el-55",
  "el-56",
  "el-59",
  "el-60",
  "el-61",
] as const;

/** Ren pool — Mend + Aegis only (trimmed from full class support). */
const FREEZE_SUPPORT_CARD_IDS = ["el-06", "el-09"] as const;

const POISON_ELEMENT_IDS = [
  "el-03",
  "el-10",
  "el-13",
  "el-17",
  "el-25",
  "el-46",
  "el-47",
  "el-48",
  "el-49",
  "el-50",
] as const;

const VOLT_ELEMENT_IDS = [
  "el-21",
  "el-22",
  "el-24",
  "el-28",
  "el-29",
  "el-41",
  "el-42",
  "el-43",
  "el-45",
  "el-62",
  "el-63",
] as const;

export const BRAWL_CLASS_POOLS: Record<BrawlClass, readonly string[]> = {
  fire: [...FIRE_ELEMENT_IDS, ...FIRE_SUPPORT_CARD_IDS],
  freeze: [...FREEZE_ELEMENT_IDS, ...FREEZE_SUPPORT_CARD_IDS],
  poison: [...POISON_ELEMENT_IDS, ...POISON_SUPPORT_CARD_IDS],
  volt: [...VOLT_ELEMENT_IDS, ...VOLT_SUPPORT_CARD_IDS],
};

export const BRAWL_CLASSES: BrawlClass[] = ["fire", "freeze", "poison", "volt"];

export interface BrawlClassOption {
  id: BrawlClass;
  mageName: string;
  title: string;
  bio: string;
  imageSrc: string;
  accent: string;
  accentBorder: string;
  accentGlow: string;
  ring: string;
  glow: string;
}

export const BRAWL_CLASS_OPTIONS: BrawlClassOption[] = [
  {
    id: "fire",
    mageName: "Ignis",
    title: "The Reckless Pyromancer",
    bio: "Ignis trades patience for pressure — every bond fans the flames higher until something breaks.",
    imageSrc: "/images/ignis_the_reckless_pyromancer.png",
    accent: "text-orange-300",
    accentBorder: "border-orange-500",
    accentGlow: "shadow-[0_0_60px_20px_rgba(249,115,22,0.25)]",
    ring: "ring-orange-400/70",
    glow: "shadow-[0_0_40px_8px_rgba(251,146,60,0.35)]",
  },
  {
    id: "freeze",
    mageName: "Ren",
    title: "The Tundric Lord",
    bio: "Ren slows the fight to a crawl, locking opponents in place while chip damage quietly adds up.",
    imageSrc: "/images/ren_the_tundric_lord.png",
    accent: "text-sky-300",
    accentBorder: "border-sky-400",
    accentGlow: "shadow-[0_0_60px_20px_rgba(56,189,248,0.22)]",
    ring: "ring-sky-400/70",
    glow: "shadow-[0_0_40px_8px_rgba(56,189,248,0.35)]",
  },
  {
    id: "poison",
    mageName: "Lumi",
    title: "The Gilded Alchemist",
    bio: "Lumi stacks venom and wears foes down — patient, precise, and impossible to outlast.",
    imageSrc: "/images/lumi_the_gilded_alchemist.png",
    accent: "text-violet-300",
    accentBorder: "border-violet-400",
    accentGlow: "shadow-[0_0_60px_20px_rgba(167,139,250,0.22)]",
    ring: "ring-violet-400/70",
    glow: "shadow-[0_0_40px_8px_rgba(167,139,250,0.35)]",
  },
  {
    id: "volt",
    mageName: "Volta",
    title: "Storm Conductor",
    bio: "Volta hits first and hits hard — instant shock damage that punishes slow setups and soft shields.",
    imageSrc: "/images/volta_storm_conductor.png",
    accent: "text-amber-300",
    accentBorder: "border-amber-400",
    accentGlow: "shadow-[0_0_60px_20px_rgba(251,191,36,0.2)]",
    ring: "ring-amber-400/70",
    glow: "shadow-[0_0_40px_8px_rgba(251,191,36,0.35)]",
  },
];

export function classPoolIds(brawlClass: BrawlClass): readonly string[] {
  return BRAWL_CLASS_POOLS[brawlClass];
}

export function randomOpponentClass(exclude?: BrawlClass): BrawlClass {
  const pool = exclude
    ? BRAWL_CLASSES.filter((c) => c !== exclude)
    : BRAWL_CLASSES;
  return pool[Math.floor(Math.random() * pool.length)] ?? "fire";
}

export function classOptionFor(brawlClass: BrawlClass): BrawlClassOption {
  const opt = BRAWL_CLASS_OPTIONS.find((o) => o.id === brawlClass);
  if (!opt) throw new Error(`Unknown brawl class: ${brawlClass}`);
  return opt;
}
