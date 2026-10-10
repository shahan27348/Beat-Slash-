/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useEffect, useRef } from 'react';
import { HandPositions, HandType } from '../types';
import { soundManager } from '../utils/soundManager';

interface HandCursorsProps {
  handPositionsRef: React.MutableRefObject<HandPositions>;
  enabled: boolean;
}

const HOVER_PADDING = 28;
const HOVER_CLASS = 'gesture-hover';

/**
 * Hand-driven pointer for menus. Any element with `data-gesture` can be hovered by a hand cursor
 * and is clicked on the *start* of a pinch, so holding a pinch across screens can't double-trigger.
 * Runs on its own animation frame and writes to the DOM directly, so the cursor stays smooth
 * without re-rendering React.
 */
const HandCursors: React.FC<HandCursorsProps> = ({ handPositionsRef, enabled }) => {
  const leftRef = useRef<HTMLDivElement>(null);
  const rightRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!enabled) return;
    let raf = 0;
    const wasPinching: Record<HandType, boolean> = { left: true, right: true }; // require a fresh pinch after enabling
    let hovered = new Set<Element>();

    const loop = () => {
      const hands = handPositionsRef.current;
      const targets = Array.from(document.querySelectorAll<HTMLElement>('[data-gesture]:not([disabled])'));
      const nextHovered = new Set<Element>();

      (['left', 'right'] as HandType[]).forEach(hand => {
        const el = hand === 'left' ? leftRef.current : rightRef.current;
        const cursor = hand === 'left' ? hands.leftCursorPos : hands.rightCursorPos;
        const pinching = hand === 'left' ? hands.leftPinching : hands.rightPinching;
        if (!el) return;

        if (!cursor) {
          el.style.opacity = '0';
          wasPinching[hand] = pinching;
          return;
        }

        const sx = cursor.x * window.innerWidth;
        const sy = cursor.y * window.innerHeight;
        el.style.opacity = '1';
        el.style.transform = `translate3d(${sx}px, ${sy}px, 0) translate(-50%, -50%)`;
        el.dataset.pinching = pinching ? 'true' : 'false';

        // Closest gesture target within reach.
        let best: HTMLElement | null = null;
        let bestDist = Infinity;
        for (const t of targets) {
          const r = t.getBoundingClientRect();
          if (r.width === 0) continue;
          const dx = Math.max(r.left - sx, 0, sx - r.right);
          const dy = Math.max(r.top - sy, 0, sy - r.bottom);
          const d = Math.hypot(dx, dy);
          if (d < HOVER_PADDING && d < bestDist) { best = t; bestDist = d; }
        }
        el.dataset.hovering = best ? 'true' : 'false';
        if (best) nextHovered.add(best);

        if (pinching && !wasPinching[hand] && best) {
          soundManager.playUi();
          best.click();
        }
        wasPinching[hand] = pinching;
      });

      hovered.forEach(el => { if (!nextHovered.has(el)) el.classList.remove(HOVER_CLASS); });
      nextHovered.forEach(el => el.classList.add(HOVER_CLASS));
      hovered = nextHovered;

      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      hovered.forEach(el => el.classList.remove(HOVER_CLASS));
    };
  }, [enabled, handPositionsRef]);

  if (!enabled) return null;

  return (
    <>
      <div ref={leftRef} className="hand-cursor hand-cursor-left" style={{ opacity: 0 }}><span /></div>
      <div ref={rightRef} className="hand-cursor hand-cursor-right" style={{ opacity: 0 }}><span /></div>
    </>
  );
};

export default HandCursors;
