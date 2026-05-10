export type MerchantType = "Bat Manufacturer" | "Pitching Guru" | "Shady Trainer";

export type ItemTarget = "Batting" | "Pitching" | "Any";

export interface ItemDefinition {
  id: string;
  name: string;
  merchant: MerchantType;
  target: ItemTarget;
  cost: number;
  description: string;
  
  // Modifiers
  valueModifier?: number;
  hitScaleModifier?: number;
  
  // Shady Trainer specific
  suspendsPlayerNextGame?: boolean;
}

export const ITEMS: Record<string, ItemDefinition> = {
  // --- Bat Manufacturer ---
  "bat-maple": {
    id: "bat-maple",
    name: "Maple Bat",
    merchant: "Bat Manufacturer",
    target: "Batting",
    cost: 50,
    description: "+1 Value.",
    valueModifier: 1,
  },
  "bat-corked": {
    id: "bat-corked",
    name: "Corked Bat",
    merchant: "Bat Manufacturer",
    target: "Batting",
    cost: 150,
    description: "+3 Value.",
    valueModifier: 3,
  },
  "gloves-grip": {
    id: "gloves-grip",
    name: "Sticky Gloves",
    merchant: "Bat Manufacturer",
    target: "Batting",
    cost: 80,
    description: "+1 Hit Scale.",
    hitScaleModifier: 1,
  },

  // --- Pitching Guru ---
  "rosin-bag": {
    id: "rosin-bag",
    name: "Fresh Rosin",
    merchant: "Pitching Guru",
    target: "Pitching",
    cost: 50,
    description: "+1 Value.",
    valueModifier: 1,
  },
  "pine-tar": {
    id: "pine-tar",
    name: "Hidden Pine Tar",
    merchant: "Pitching Guru",
    target: "Pitching",
    cost: 150,
    description: "+3 Value.",
    valueModifier: 3,
  },
  "grip-trainer": {
    id: "grip-trainer",
    name: "Grip Trainer",
    merchant: "Pitching Guru",
    target: "Pitching",
    cost: 80,
    description: "Pitcher wins ties this at-bat.",
  },

  // --- Shady Trainer ---
  "juice": {
    id: "juice",
    name: "Performance Enhancer",
    merchant: "Shady Trainer",
    target: "Any",
    cost: 200,
    description: "+5 Value, but player is suspended for the next game.",
    valueModifier: 5,
    suspendsPlayerNextGame: true,
  },
  "mysterious-vial": {
    id: "mysterious-vial",
    name: "Mysterious Vial",
    merchant: "Shady Trainer",
    target: "Any",
    cost: 100,
    description: "+8 Hit Scale, but player is suspended for the next game.",
    hitScaleModifier: 8,
    suspendsPlayerNextGame: true,
  }
};
