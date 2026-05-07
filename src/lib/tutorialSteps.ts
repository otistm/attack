/**
 * Declarative steps for the "Learn to Play" tutorial.
 *
 * Each step describes a single modal beat in the walkthrough. The runtime
 * (`TutorialOverlay`) reads this list, looks up `anchor` via
 * `document.querySelector(anchor)`, draws a spotlight cutout around the
 * resulting bounding rect, and positions the modal nearby.
 *
 * Anchors map to `data-tutorial="..."` attributes that are sprinkled across
 * the in-game UI (scoreboard, matchup pills, hand strips, lock-in button,
 * etc.). When `anchor` is null the modal renders centered on screen with
 * a solid backdrop -- used for narrative beats (welcome, goal, lifecycle
 * recap) where there is no specific UI to point at.
 *
 * The very last step is `interactive: true`: the modal hides its Next
 * button and instructs the player to press the real Lock In button on
 * the field. The store's `lockIn` action recognizes this and clears the
 * tutorial flag as part of resolving the at-bat, so the walkthrough
 * dissolves naturally into normal play.
 */

export type TutorialPlacement =
  | 'auto'
  | 'top'
  | 'bottom'
  | 'left'
  | 'right'
  | 'center';

export interface TutorialStep {
  id: string;
  title: string;
  body: string;
  /**
   * `document.querySelector` selector pointing at the UI element to
   * highlight, or `null` for a centered narrative modal.
   */
  anchor: string | null;
  placement?: TutorialPlacement;
  /** Extra padding (in px) around the anchor's bounding rect. */
  highlightPadding?: number;
  /**
   * `true` on the final step only -- the modal hides its Next button and
   * lets clicks through to the highlighted element. The store's `lockIn`
   * advances out of the tutorial when invoked from the final step.
   */
  interactive?: boolean;
}

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Dugout',
    body:
      "Dugout is a card-based baseball game. We'll spend a couple minutes walking through the field, your hand, and the basics of combining cards. Click Next to continue, or Exit to skip.",
    anchor: null,
    placement: 'center',
  },
  {
    id: 'goal',
    title: 'How to Win',
    body:
      'Each game is 9 innings. In every at-bat, your hand is scored against the opposing pitcher\'s hand. Win the matchup and you put the ball in play -- single, double, triple, or home run depending on by how much you won. Score more runs than your opponent across all 9 innings to take the game.',
    anchor: null,
    placement: 'center',
  },
  {
    id: 'scoreboard',
    title: 'The Scoreboard',
    body:
      'Top center shows the inning, which half (top or bottom), each team\'s runs, and the current outs. Three outs end a half-inning, six outs end the inning. The mini diamond on the right tells you which bases are occupied right now.',
    anchor: '[data-tutorial="scoreboard"]',
    placement: 'bottom',
  },
  {
    id: 'game-mode',
    title: 'Game Mode',
    body:
      "On the left you'll see which lane you're playing -- Quick Match (random rosters, jump straight in) or Victory Mode (auction draft to build your team). The current at-bat batter and pitcher are shown on the left rail next to their player cards.",
    anchor: '[data-tutorial="game-mode"]',
    placement: 'bottom',
  },
  {
    id: 'quests',
    title: 'Arcade Quests',
    body:
      "Each game gives you three quests on the left rail (common, rare, and legendary). The bar fills as you make progress—finish one for a big celebration and the reward printed on the card. Build your strategy around the goals that match how you want to play this game.",
    anchor: '[data-tutorial="quests"]',
    placement: 'right',
  },
  {
    id: 'field',
    title: 'The Field',
    body:
      'Behind everything is the 3D field. When you put the ball in play, runners advance around the bases in real time -- watch it whenever an at-bat resolves to see what just happened.',
    // The field wrapper is the entire viewport, which would produce a
    // spotlight equal to the viewport (i.e. no dim at all) and a modal
    // pinned off-screen. Center the modal instead -- the field is
    // already visible behind the dim, so a spotlight isn't needed.
    anchor: null,
    placement: 'center',
  },
  {
    id: 'user-hand',
    title: 'Your Hand',
    body:
      "This bottom strip is your 5-card hand for the at-bat. Three of them are signature cards belonging to the player at the plate; the other two are general-purpose draws from your team's pool. You can drag cards to reorder them at any time before locking in.",
    anchor: '[data-tutorial="user-hand"]',
    placement: 'top',
  },
  {
    id: 'card-value',
    title: 'Card Value',
    body:
      "Every card has a base value -- shown on the card face. The total of your hand's values is the foundation of your score. Modifiers from abilities tint the number when they buff or debuff a card, so you can see at a glance which cards are pulling weight.",
    anchor: '[data-tutorial="card-value"]',
    placement: 'top',
  },
  {
    id: 'card-shapes',
    title: 'Card Shapes',
    body:
      'Each card has a half-shape on its left edge and another on its right edge. Two adjacent cards "combine" when their touching halves complete a full shape -- the same shape on both sides. Combined cards score together as a group, which usually pays a lot more than scoring solo.',
    anchor: '[data-tutorial="card-shapes"]',
    placement: 'top',
  },
  {
    id: 'card-ability',
    title: 'Reading Abilities',
    body:
      "Once the tutorial ends, hover any card (or tap and hold on touch) to see its name and full ability text. Abilities range from \"+2 Value if combined\" all the way to \"force a homerun on a win\" -- the more you experiment, the more you'll spot synergies between your cards.",
    // Anchor on the same outer card as the shapes step. The hover panel
    // itself is `opacity: 0` until hover, so spotlighting it directly
    // produced a confusing empty rectangle above the card. Pointing at
    // the card matches the user's mental model ("this is the card whose
    // ability I'd read") and lets the body text describe the hover
    // gesture without trying to demonstrate it live.
    anchor: '[data-tutorial="card-shapes"]',
    placement: 'top',
  },
  {
    id: 'seams',
    title: 'Combining Cards',
    body:
      'Drag a card next to a card with the matching shape on the touching seam. When the seam glows, the two cards are affirmed as a combined group. Chain three or four cards in a row with matching shapes for the strongest groups -- those score the highest base totals AND tend to unlock combo abilities.',
    anchor: '[data-tutorial="user-hand"]',
    placement: 'top',
  },
  {
    id: 'ability-lifecycle',
    title: 'When Abilities Trigger',
    body:
      'Abilities fire at three different times. "Deal-time" effects run when the cards are first dealt and may transform your hand or your opponent\'s. "Score-time" effects run when you Lock In and adjust the matchup score. "Resolve-time" effects fire on a hit -- like adding a bonus base. Watch the reveal animation after each at-bat to see who triggered what.',
    anchor: null,
    placement: 'center',
  },
  {
    id: 'opponent-hand',
    title: "The Opponent's Hand",
    body:
      'The top strip is the opposing pitcher\'s hand. Their cards are face-down by default, so you don\'t know exactly what you\'re hitting against. Some of YOUR cards reveal one or more of their cards, peek at their layout, or even let you guess a shape for a payoff -- read your hand carefully.',
    anchor: '[data-tutorial="opponent-hand"]',
    placement: 'bottom',
  },
  {
    id: 'phase-indicator',
    title: 'Game Phases',
    body:
      "Top right shows what phase the game is in: Card Selection (your turn to arrange and lock in), Resolving (the engine compares scores), Revealing (animations play), and Result. You only act during Card Selection -- the rest is the engine playing out the consequences.",
    anchor: '[data-tutorial="phase"]',
    placement: 'bottom',
  },
  {
    id: 'outs-innings',
    title: 'Outs, Innings, and the Win',
    body:
      'When the pitcher beats the batter, that\'s an out. Three outs flip the half-inning -- you swap from batting to pitching (or vice versa). After 9 full innings, whoever has more runs wins. Tied games go to extras until somebody breaks the tie.',
    anchor: '[data-tutorial="scoreboard"]',
    placement: 'bottom',
  },
  {
    id: 'lock-in',
    title: "You're Up - Press Lock In",
    body:
      "That's the rundown. When you're ready to swing, press the Lock In button. The engine will compare your hand to the pitcher's, animate the result, and (if you connected) advance any runners. Good luck out there!",
    anchor: '[data-tutorial="lock-in"]',
    placement: 'top',
    interactive: true,
  },
];
