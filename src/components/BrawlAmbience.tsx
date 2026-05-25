import { useEffect } from "react";
import { useGameStore } from "../lib/gameStore";
import { startStadiumAmbience, stopStadiumAmbience } from "../lib/gameAudio";

/** Keeps `public/sounds/stadium.wav` looping for the whole brawl session. */
export function BrawlAmbience() {
  const gameMode = useGameStore((s) => s.gameMode);

  useEffect(() => {
    if (gameMode === "brawl") {
      startStadiumAmbience();
      return;
    }
    stopStadiumAmbience();
  }, [gameMode]);

  useEffect(() => () => stopStadiumAmbience(), []);

  return null;
}
