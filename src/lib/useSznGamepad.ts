/**
 * useSznGamepad — shared Sony-style gamepad input hook for the whole
 * SZN experience.
 *
 * Why a module-scoped singleton (and not a per-component RAF loop):
 *   - A separate `requestAnimationFrame` per modal/screen + the footer
 *     would spawn N parallel polls every frame, each scanning the same
 *     pads array, with no way for higher-priority surfaces (modals) to
 *     "consume" a Cross press before lower-priority surfaces (footer)
 *     also act on it. Result: opening a modal would silently fire the
 *     footer's Lock In on the same Cross.
 *   - The singleton owns one RAF, one cached previous-button snapshot,
 *     and a priority-sorted handler stack. On each rising edge we pick
 *     the topmost enabled handler and dispatch ONLY to it. Cross in a
 *     modal stays in the modal.
 *
 * Hook contract:
 *   const enabled = isOpen && !isCovered;
 *   useSznGamepad({
 *     id: 'merchant-view',         // stable string ID; only one binding per ID
 *     priority: 100,               // higher = wins
 *     enabled,                     // re-evaluated each render
 *     handler: (btn) => { ... },   // called on rising-edge button presses
 *   });
 *
 * The handler is invoked synchronously inside the RAF tick. Keep it
 * cheap: navigate local state, call a store action, return. Do NOT do
 * heavy computation or async I/O here.
 *
 * Button mapping uses Sony "standard mapping" indices; the same shape
 * Xbox standard mapping reports for the equivalent face button (A=0,
 * B=1, X=2, Y=3) so a 360 / Xbox One pad works without any mapping
 * tweak.
 */

import { useEffect, useRef, useState } from 'react';

export const BTN = {
  CROSS: 0,
  CIRCLE: 1,
  SQUARE: 2,
  TRIANGLE: 3,
  L1: 4,
  R1: 5,
  L2: 6,
  R2: 7,
  SELECT: 8,
  START: 9,
  L3: 10,
  R3: 11,
  DPAD_UP: 12,
  DPAD_DOWN: 13,
  DPAD_LEFT: 14,
  DPAD_RIGHT: 15,
} as const;

export type GamepadButton =
  | 'CROSS'
  | 'CIRCLE'
  | 'SQUARE'
  | 'TRIANGLE'
  | 'L1'
  | 'R1'
  | 'L2'
  | 'R2'
  | 'SELECT'
  | 'START'
  | 'L3'
  | 'R3'
  | 'DPAD_UP'
  | 'DPAD_DOWN'
  | 'DPAD_LEFT'
  | 'DPAD_RIGHT';

const INDEX_TO_NAME: Record<number, GamepadButton> = Object.entries(BTN).reduce(
  (acc, [name, idx]) => {
    acc[idx as number] = name as GamepadButton;
    return acc;
  },
  {} as Record<number, GamepadButton>,
);

export interface GamepadHandlerOpts {
  /**
   * Stable per-mount identity. Pairs of `(component, surface)` should
   * always pick the same string (e.g. `merchant-view`). If two hooks
   * register with the same id, the later registration replaces the
   * earlier one — a useful guard against stale hot-reload duplicates.
   */
  id: string;
  /**
   * Priority controls who wins when multiple surfaces are mounted at
   * once. The convention used across SZN:
   *   - 0   : footer base (always-on bench / bag deck)
   *   - 10  : non-modal screen (StartGame / EndRun / SeriesIntro etc.)
   *   - 20  : focus-stealing screen with priority over the footer
   *           (PackRip, FrontOffice tile grid, Combat post-at-bat CTAs)
   *   - 50  : footer focus router (above screens, below modals) — sits
   *           in the slot screen-handlers used to occupy so it can
   *           grab `DPAD_DOWN` for the screen↔footer transition
   *           without stomping a modal's CROSS / DPAD on top
   *   - 100 : modal stacked over a screen (Merchant / Event / Slot /
   *           PlayerMarket)
   *   - 200 : confirm / nested modal stacked over a 100-modal
   */
  priority: number;
  /**
   * When false the handler is left registered but skipped. This is the
   * intended way to gate a binding on visibility — re-rendering with a
   * new `enabled` value is cheaper than unregister/register churn each
   * time the surface mounts.
   */
  enabled: boolean;
  /**
   * Rising-edge button callback. Called once per press, with the
   * topmost enabled handler getting first crack. Return `false` to
   * explicitly pass the input through to the next-highest-priority
   * handler (used by the SZN footer's focus router to intercept only
   * `DPAD_DOWN` while leaving screen navigation intact). Returning
   * `true`, `undefined`, or nothing at all marks the input as
   * consumed — this matches the historical "topmost wins everything"
   * behavior so existing handlers don't need to change.
   */
  handler: (btn: GamepadButton) => boolean | void;
}

interface InternalEntry {
  id: string;
  priority: number;
  enabled: boolean;
  handler: (btn: GamepadButton) => boolean | void;
  /** Monotonic sequence number for stable sort tie-breaking. */
  seq: number;
}

const handlers = new Map<string, InternalEntry>();
let prevButtons: boolean[] = [];
let raf = 0;
let seqCounter = 0;

function tick() {
  raf = 0;
  if (handlers.size === 0) return;
  const pads =
    typeof navigator !== 'undefined' && navigator.getGamepads
      ? navigator.getGamepads()
      : [];
  // Prefer the first connected pad. Mirrors how the browser surfaces
  // pad reconnects after sleep — pad 0 might transiently be null
  // while pad 1 is the one actually plugged in.
  let gp: Gamepad | null = null;
  for (let i = 0; i < pads.length; i += 1) {
    const p = pads[i];
    if (p && p.connected) {
      gp = p;
      break;
    }
  }
  if (gp) {
    const cur = gp.buttons.map((b) => b.pressed);
    // Build a priority-DESC list of enabled handlers (ties broken by
    // latest registration via `seq`, so a freshly-mounted modal beats
    // an older sibling at the same priority level).
    //
    // Per-button dispatch then walks this list, calling each handler
    // until one CONSUMES the press. A handler returning `false`
    // explicitly passes the press through to the next entry — this is
    // how the SZN footer's focus router (priority 50) hijacks only
    // `DPAD_DOWN` while leaving screen handlers (priority 10-20) free
    // to act on every other button. Handlers returning `undefined` /
    // `void` keep the historical "topmost wins everything" semantics.
    const ordered: InternalEntry[] = [];
    for (const entry of handlers.values()) {
      if (!entry.enabled) continue;
      ordered.push(entry);
    }
    ordered.sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      return b.seq - a.seq;
    });
    for (let i = 0; i < cur.length; i += 1) {
      if (!cur[i] || prevButtons[i]) continue;
      const name = INDEX_TO_NAME[i];
      if (!name) continue;
      for (let h = 0; h < ordered.length; h += 1) {
        let consumed: boolean | void = true;
        try {
          consumed = ordered[h].handler(name);
        } catch (err) {
          // Don't let a handler exception poison subsequent ticks
          // (or block fall-through). Treat throws as "consumed" so
          // we don't redispatch a press the lower handler probably
          // didn't expect.
          // eslint-disable-next-line no-console
          console.error('[useSznGamepad] handler threw', err);
          consumed = true;
        }
        // `false` means "I declined this press, give the next one
        // a turn". Anything else (true / void / undefined) is
        // treated as consumed.
        if (consumed === false) continue;
        break;
      }
    }
    prevButtons = cur;
  } else {
    // No pad → clear so a reconnect doesn't replay queued rising edges.
    prevButtons = [];
  }
  raf = requestAnimationFrame(tick);
}

function ensureLoop() {
  if (raf !== 0) return;
  if (typeof window === 'undefined') return;
  raf = requestAnimationFrame(tick);
}

function stopLoopIfIdle() {
  if (handlers.size > 0) return;
  if (raf !== 0) {
    cancelAnimationFrame(raf);
    raf = 0;
  }
  prevButtons = [];
}

/**
 * Register a gamepad handler for the current component. Handler is
 * replaced (not stacked) when `id` matches an existing registration,
 * so re-renders are cheap.
 *
 * The handler ref is updated on every render, so closing over local
 * state in the handler is safe — the registered entry always uses the
 * latest closure.
 */
export function useSznGamepad(opts: GamepadHandlerOpts) {
  const handlerRef = useRef(opts.handler);
  handlerRef.current = opts.handler;

  useEffect(() => {
    const entry: InternalEntry = {
      id: opts.id,
      priority: opts.priority,
      enabled: opts.enabled,
      seq: (seqCounter += 1),
      handler: (btn) => handlerRef.current(btn),
    };
    handlers.set(opts.id, entry);
    ensureLoop();
    return () => {
      const cur = handlers.get(opts.id);
      // Only delete if WE are still the registered entry — guards
      // against a fast-mounting sibling racing the cleanup.
      if (cur === entry) {
        handlers.delete(opts.id);
        stopLoopIfIdle();
      }
    };
    // We deliberately register once per `id` and update mutable fields
    // (enabled, priority) via the effect below — avoids tearing down
    // the entry on every `enabled` flip.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.id]);

  useEffect(() => {
    const entry = handlers.get(opts.id);
    if (entry) {
      entry.enabled = opts.enabled;
      entry.priority = opts.priority;
    }
  }, [opts.id, opts.enabled, opts.priority]);
}

/**
 * Tiny helper for "focus ring + DPad navigation" surfaces. Returns
 * `[index, setIndex, helpers]` for keyboard-like cursor navigation:
 *
 *   const [focus, setFocus, helpers] = useFocusIndex(items.length);
 *   useSznGamepad({
 *     ...,
 *     handler: (btn) => {
 *       if (btn === 'DPAD_DOWN') helpers.next();
 *       if (btn === 'DPAD_UP')   helpers.prev();
 *       if (btn === 'CROSS')     onActivate(focus);
 *     },
 *   });
 *
 * `length` changes clamp the index in-bounds on the NEXT render, so
 * the focus ring never points at a removed slot.
 */
export function useFocusIndex(length: number, initial = 0) {
  const [index, setIndex] = useState(() =>
    Math.min(Math.max(initial, 0), Math.max(0, length - 1)),
  );

  useEffect(() => {
    if (length === 0) {
      if (index !== 0) setIndex(0);
      return;
    }
    if (index >= length) setIndex(length - 1);
    else if (index < 0) setIndex(0);
  }, [length, index]);

  const safeSet = (n: number) => {
    if (length === 0) return;
    const next = Math.min(Math.max(n, 0), length - 1);
    setIndex(next);
  };

  const helpers = {
    next: () => safeSet(index + 1),
    prev: () => safeSet(index - 1),
    first: () => safeSet(0),
    last: () => safeSet(length - 1),
  };

  return [index, safeSet, helpers] as const;
}
