/**
 * File-based SFX + looping stadium ambience from `public/sounds/`.
 * One-shots clone a fresh `HTMLAudioElement` per play so they layer over
 * the ambient loop without stopping it.
 */

const SOUND_URLS = {
  batSuccess: "/sounds/bat-success.wav",
  buttonSelect: "/sounds/button-select.mp3",
  cardBoost: "/sounds/card-boost.wav",
  cardPick: "/sounds/card-pick.wav",
  cardPickup: "/sounds/card-pickup.wav",
  cardSnap: "/sounds/card-snap.wav",
  cardSwap: "/sounds/card-swap.wav",
  hit: "/sounds/hit.wav",
  out: "/sounds/out.mp3",
  stadium: "/sounds/stadium.wav",
  cardsDeal: "/sounds/cards-deal.wav",
} as const;

export type GameSoundId = keyof typeof SOUND_URLS;

const ONE_SHOT_VOLUME: Partial<Record<GameSoundId, number>> = {
  batSuccess: 0.85,
  buttonSelect: 0.7,
  cardBoost: 0.75,
  cardPick: 0.8,
  cardPickup: 0.65,
  cardSnap: 0.75,
  cardSwap: 0.55,
  hit: 0.7,
  out: 0.85,
  cardsDeal: 0.15,
};

const STADIUM_VOLUME = 0.32;

let stadiumAudio: HTMLAudioElement | null = null;
let stadiumPlayBlocked = false;

function canPlay(): boolean {
  return typeof window !== "undefined";
}

function tryPlayStadium(): void {
  if (!stadiumAudio) return;
  void stadiumAudio.play().then(() => {
    stadiumPlayBlocked = false;
  }).catch(() => {
    stadiumPlayBlocked = true;
  });
}

/** Retry the loop after a user gesture if autoplay blocked the first start. */
export function resumeStadiumAmbienceIfBlocked(): void {
  if (!stadiumPlayBlocked || !stadiumAudio?.paused) return;
  tryPlayStadium();
}

/** Short UI / gameplay cue — does not affect the stadium loop. */
export function playGameSound(id: GameSoundId): void {
  if (!canPlay()) return;
  resumeStadiumAmbienceIfBlocked();
  try {
    const audio = new Audio(SOUND_URLS[id]);
    audio.volume = ONE_SHOT_VOLUME[id] ?? 0.75;
    void audio.play().catch(() => {});
  } catch {
    /* ignore */
  }
}

export function playButtonSelect(): void {
  playGameSound("buttonSelect");
}

export function playCardPick(): void {
  playGameSound("cardPick");
}

export function playCardPickup(): void {
  playGameSound("cardPickup");
}

export function playCardSnap(): void {
  playGameSound("cardSnap");
}

export function playCardSwap(): void {
  playGameSound("cardSwap");
}

export function playCardBoost(): void {
  playGameSound("cardBoost");
}

export function playHit(): void {
  playGameSound("hit");
}

export function playBatSuccess(): void {
  playGameSound("batSuccess");
}

export function playOut(): void {
  playGameSound("out");
}

/** One card flying in during a hand deal-in stagger. */
export function playCardsDeal(): void {
  playGameSound("cardsDeal");
}

/**
 * Fire `cards-deal` when a card's entry animation starts (`delaySec` matches
 * the Framer stagger on `HandCard` / `PitcherCard`). Returns a cleanup that
 * cancels the timer if the card unmounts before the sound fires.
 */
export function scheduleCardsDealSound(delaySec: number): () => void {
  if (!canPlay() || delaySec < 0) return () => {};
  const t = window.setTimeout(() => playCardsDeal(), delaySec * 1000);
  return () => window.clearTimeout(t);
}

/** Loop stadium ambience for the duration of a brawl run. */
export function startStadiumAmbience(): void {
  if (!canPlay()) return;
  if (stadiumAudio) {
    if (stadiumAudio.paused) {
      tryPlayStadium();
    }
    return;
  }
  try {
    const audio = new Audio(SOUND_URLS.stadium);
    audio.loop = true;
    audio.volume = STADIUM_VOLUME;
    stadiumAudio = audio;
    tryPlayStadium();
  } catch {
    stadiumAudio = null;
  }
}

export function stopStadiumAmbience(): void {
  if (!stadiumAudio) return;
  stadiumAudio.pause();
  stadiumAudio.currentTime = 0;
  stadiumAudio = null;
  stadiumPlayBlocked = false;
}
