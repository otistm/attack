export type ShapeType = 'diamond' | 'circle' | 'square' | 'star' | 'wildcard' | 'none';

export const SHAPE_COLORS: Record<ShapeType, string> = {
  diamond: '#eab308', // yellow-500
  circle: '#3b82f6', // blue-500
  square: '#ef4444', // red-500
  star: '#a855f7', // purple-500
  wildcard: '#10b981', // emerald-500
  none: 'transparent',
};

export const SHAPE_DEFAULTS: Record<ShapeType, { rotate: number; baseScale: number; borderRadius: string; clipPath?: string }> = {
  circle: { rotate: 0, baseScale: 1, borderRadius: '50%' },
  diamond: { rotate: 45, baseScale: 0.8, borderRadius: '4px' },
  square: { rotate: 0, baseScale: 0.85, borderRadius: '4px' },
  star: { rotate: 0, baseScale: 1.1, borderRadius: '0', clipPath: 'polygon(50% 0%, 61% 35%, 98% 35%, 68% 57%, 79% 91%, 50% 70%, 21% 91%, 32% 57%, 2% 35%, 39% 35%)' },
  wildcard: { rotate: 0, baseScale: 1, borderRadius: '25%', clipPath: 'polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)' },
  none: { rotate: 0, baseScale: 1, borderRadius: '0' },
};

/**
 * Visual mode for a card edge:
 *  - 'normal'   : render the literal `shape` and connect by shape match.
 *  - 'wildcard' : the side is logically a wildcard regardless of `shape`;
 *                 render the emerald wildcard hexagon so the player can see it.
 *  - 'blocked'  : the side cannot be combined; render a darkened/X-overlay
 *                 indicator instead of the shape so the player can see why.
 *  - 'picky'    : the side combines but only with a restricted set of shapes
 *                 (driven by `combineConstraint.allowedShapes`); render the
 *                 normal shape with a "constrained" outline ring.
 */
export type ShapeMode = 'normal' | 'wildcard' | 'blocked' | 'picky';

/**
 * Live drag-time hint applied to an edge while the user is dragging a card:
 *  - 'allow' : connection is currently legal at this seam (green pulse).
 *  - 'block' : connection is currently illegal at this seam (red pulse).
 *  - undefined: no drag in progress at this seam.
 */
export type ConnectHint = 'allow' | 'block' | undefined;

export interface ShapeHalfProps {
  shape: ShapeType;
  side: 'left' | 'right';
  isConnected: boolean;
  compact?: boolean;
  mode?: ShapeMode;
  hint?: ConnectHint;
}
