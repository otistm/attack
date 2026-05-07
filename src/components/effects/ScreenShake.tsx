import { useEffect, useRef, type ReactNode } from "react";
import { motion, useAnimationControls } from "motion/react";

export function ScreenShake({
  requestId,
  children,
  magnitude = 10,
  duration = 0.35,
  className = "",
}: {
  /** Increment to fire a new shake */
  requestId: number;
  children: ReactNode;
  magnitude?: number;
  duration?: number;
  className?: string;
}) {
  const ctrl = useAnimationControls();
  const lastId = useRef(0);

  useEffect(() => {
    if (requestId === 0 || requestId === lastId.current) return;
    lastId.current = requestId;
    const dir = requestId % 2 === 0 ? 1 : -1;
    void ctrl.start({
      x: [0, dir * magnitude, -dir * magnitude * 0.6, dir * magnitude * 0.25, 0],
      y: [0, -magnitude * 0.4, magnitude * 0.35, -magnitude * 0.12, 0],
      transition: { duration, ease: "easeOut" },
    });
  }, [requestId, ctrl, magnitude, duration]);

  return (
    <motion.div
      className={`relative w-full h-full ${className}`.trim()}
      animate={ctrl}
      initial={false}
    >
      {children}
    </motion.div>
  );
}
