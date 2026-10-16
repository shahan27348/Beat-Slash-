/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useEffect } from 'react';
import * as THREE from 'three';
import { HandPositions } from '../types';

// Must match the game camera (position [0, 1.8, 4], fov 60) so the saber sits under the pointer.
const CAMERA_Y = 1.8;
const CAMERA_DIST = 4;
const HALF_HEIGHT = CAMERA_DIST * Math.tan(THREE.MathUtils.degToRad(30));

/**
 * Fallback controls for players without a camera: the mouse / finger drives the saber.
 * Left half of the screen = red saber, right half = blue saber.
 */
export const useMouseControls = (handPositionsRef: React.MutableRefObject<HandPositions>, enabled: boolean) => {
  useEffect(() => {
    if (!enabled) return;
    let pointer: { x: number; y: number } | null = null;
    let raf = 0;
    let last = performance.now();
    const prev = new THREE.Vector3();
    let hasPrev = false;
    let side: 'left' | 'right' = 'right';

    const onMove = (e: PointerEvent) => { pointer = { x: e.clientX / window.innerWidth, y: e.clientY / window.innerHeight }; };
    const onLeave = () => { pointer = null; };

    const loop = () => {
      const now = performance.now();
      const dt = Math.max(0.001, (now - last) / 1000);
      last = now;
      const s = handPositionsRef.current;

      if (pointer) {
        const aspect = window.innerWidth / window.innerHeight;
        const x = (pointer.x * 2 - 1) * HALF_HEIGHT * aspect;
        const y = Math.max(0.1, CAMERA_Y - (pointer.y * 2 - 1) * HALF_HEIGHT);
        const newSide = pointer.x < 0.5 ? 'left' : 'right';
        if (newSide !== side) { hasPrev = false; side = newSide; }

        const pos = (side === 'left' ? s.left : s.right) ?? new THREE.Vector3();
        pos.set(x, y, 0);
        const vel = side === 'left' ? s.leftVelocity : s.rightVelocity;
        if (hasPrev) {
          vel.x += ((pos.x - prev.x) / dt - vel.x) * 0.5;
          vel.y += ((pos.y - prev.y) / dt - vel.y) * 0.5;
        } else {
          vel.set(0, 0, 0);
        }
        prev.copy(pos);
        hasPrev = true;

        if (side === 'left') { s.left = pos; s.right = null; s.rightVelocity.set(0, 0, 0); }
        else { s.right = pos; s.left = null; s.leftVelocity.set(0, 0, 0); }
      } else if (hasPrev) {
        // Clear once when the pointer leaves, then leave the hands alone.
        s.left = null; s.right = null;
        hasPrev = false;
      }
      raf = requestAnimationFrame(loop);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onMove);
    document.addEventListener('pointerleave', onLeave);
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onMove);
      document.removeEventListener('pointerleave', onLeave);
      const s = handPositionsRef.current;
      s.left = null; s.right = null;
    };
  }, [enabled, handPositionsRef]);
};
