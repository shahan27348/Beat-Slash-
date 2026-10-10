/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useEffect, useRef, useState } from 'react';
import { HandLandmarker, FilesetResolver, HandLandmarkerResult, NormalizedLandmark } from '@mediapipe/tasks-vision';
import * as THREE from 'three';
import { HandPositions } from '../types';

// Keep the wasm runtime in lock-step with the installed npm package, a mismatch breaks initialisation.
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.21/wasm';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

// How long a hand is kept alive after tracking drops out, avoids sabers flickering on a single bad frame.
const LOST_GRACE_MS = 160;

// Mapping 2D normalized coordinates (raw, un-mirrored camera image) to the 3D game world.
const GAME_X_RANGE = 5;
const GAME_Y_RANGE = 3.5;
const Y_OFFSET = 0.8;

const mapHandToWorld = (x: number, y: number, out: THREE.Vector3): THREE.Vector3 => {
  // The camera image is not mirrored, so the user's right hand appears on the left of the frame.
  const worldX = (0.5 - x) * GAME_X_RANGE;
  const worldY = (1.0 - y) * GAME_Y_RANGE - (GAME_Y_RANGE / 2) + Y_OFFSET;
  const worldZ = -Math.max(0, worldY * 0.2);
  return out.set(worldX, Math.max(0.1, worldY), worldZ);
};

/**
 * One Euro filter: heavy smoothing when the hand is still (no jitter),
 * light smoothing when it moves fast (no lag on swings).
 */
class OneEuroFilter {
  private x: number | null = null;
  private dx = 0;
  constructor(private minCutoff: number, private beta: number, private dCutoff = 1.0) {}

  private static alpha(cutoff: number, dt: number) {
    const tau = 1 / (2 * Math.PI * cutoff);
    return 1 / (1 + tau / dt);
  }

  reset() { this.x = null; this.dx = 0; }

  filter(value: number, dt: number): number {
    if (this.x === null || dt <= 0) {
      this.x = value;
      return value;
    }
    const rawDx = (value - this.x) / dt;
    const aD = OneEuroFilter.alpha(this.dCutoff, dt);
    this.dx = this.dx + aD * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    const a = OneEuroFilter.alpha(cutoff, dt);
    this.x = this.x + a * (value - this.x);
    return this.x;
  }
}

class HandTracker {
  private fx = new OneEuroFilter(1.6, 1.2);
  private fy = new OneEuroFilter(1.6, 1.2);
  private fz = new OneEuroFilter(1.6, 1.2);
  private cx = new OneEuroFilter(1.2, 3.0);
  private cy = new OneEuroFilter(1.2, 3.0);
  private raw = new THREE.Vector3();
  private lastPos: THREE.Vector3 | null = null;
  private lastSeen = 0;

  position: THREE.Vector3 | null = null;
  velocity = new THREE.Vector3();
  cursor: { x: number; y: number } | null = null;
  pinching = false;

  update(landmarks: NormalizedLandmark[] | null, now: number, dt: number) {
    if (!landmarks) {
      if (this.position && now - this.lastSeen > LOST_GRACE_MS) this.lose();
      else this.velocity.multiplyScalar(0.6);
      return;
    }
    this.lastSeen = now;

    const tip = landmarks[8];
    mapHandToWorld(tip.x, tip.y, this.raw);

    const pos = this.position ?? new THREE.Vector3();
    pos.set(
      this.fx.filter(this.raw.x, dt),
      this.fy.filter(this.raw.y, dt),
      this.fz.filter(this.raw.z, dt),
    );

    if (this.lastPos && dt > 0.001) {
      // Exponentially smoothed velocity so a single noisy frame does not spike it.
      const vx = (pos.x - this.lastPos.x) / dt;
      const vy = (pos.y - this.lastPos.y) / dt;
      const vz = (pos.z - this.lastPos.z) / dt;
      this.velocity.x += (vx - this.velocity.x) * 0.55;
      this.velocity.y += (vy - this.velocity.y) * 0.55;
      this.velocity.z += (vz - this.velocity.z) * 0.55;
    }
    this.lastPos = (this.lastPos ?? new THREE.Vector3()).copy(pos);
    this.position = pos;

    // Pinch detection relative to hand size, with hysteresis so it doesn't flicker.
    const thumb = landmarks[4];
    const index = landmarks[8];
    const handSize = Math.hypot(landmarks[0].x - landmarks[9].x, landmarks[0].y - landmarks[9].y) || 0.1;
    const pinchRatio = Math.hypot(thumb.x - index.x, thumb.y - index.y) / handSize;
    if (this.pinching) this.pinching = pinchRatio < 0.42;
    else this.pinching = pinchRatio < 0.25;

    // Cursor follows the pinch point (between thumb and index), mirrored to match what the user sees.
    // Slightly expanded so the screen edges are reachable without stretching.
    const px = 1 - (thumb.x + index.x) / 2;
    const py = (thumb.y + index.y) / 2;
    const ex = THREE.MathUtils.clamp((px - 0.5) * 1.35 + 0.5, 0, 1);
    const ey = THREE.MathUtils.clamp((py - 0.5) * 1.35 + 0.5, 0, 1);
    this.cursor = { x: this.cx.filter(ex, dt), y: this.cy.filter(ey, dt) };
  }

  private lose() {
    this.position = null;
    this.lastPos = null;
    this.cursor = null;
    this.pinching = false;
    this.velocity.set(0, 0, 0);
    this.fx.reset(); this.fy.reset(); this.fz.reset();
    this.cx.reset(); this.cy.reset();
  }
}

export const useMediaPipe = (videoRef: React.RefObject<HTMLVideoElement | null>) => {
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handPositionsRef = useRef<HandPositions>({
    left: null,
    right: null,
    leftVelocity: new THREE.Vector3(),
    rightVelocity: new THREE.Vector3(),
    leftPinching: false,
    rightPinching: false,
    leftCursorPos: null,
    rightCursorPos: null,
  });

  // To expose raw results for UI preview
  const lastResultsRef = useRef<HandLandmarkerResult | null>(null);

  useEffect(() => {
    let isActive = true;
    let landmarker: HandLandmarker | null = null;
    let rafId = 0;
    let stream: MediaStream | null = null;
    let lastVideoTime = -1;
    let lastProcess = performance.now();

    const trackers = { left: new HandTracker(), right: new HandTracker() };

    const setupMediaPipe = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(WASM_URL);
        if (!isActive) return;

        const options = (delegate: 'GPU' | 'CPU') => ({
          baseOptions: { modelAssetPath: MODEL_URL, delegate },
          runningMode: 'VIDEO' as const,
          numHands: 2,
          minHandDetectionConfidence: 0.5,
          minHandPresenceConfidence: 0.5,
          minTrackingConfidence: 0.5,
        });

        try {
          landmarker = await HandLandmarker.createFromOptions(vision, options('GPU'));
        } catch (gpuErr) {
          console.warn('GPU delegate unavailable, falling back to CPU', gpuErr);
          landmarker = await HandLandmarker.createFromOptions(vision, options('CPU'));
        }

        if (!isActive) {
          landmarker.close();
          return;
        }
        await startCamera();
      } catch (err: any) {
        console.error('Error initializing MediaPipe:', err);
        if (isActive) setError(`Failed to load hand tracking: ${err?.message ?? err}`);
      }
    };

    const startCamera = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 60 } },
        });
        if (!isActive) {
          stream.getTracks().forEach(t => t.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = stream;
        video.onloadeddata = () => {
          if (!isActive) return;
          video.play().catch(() => { /* muted autoplay, safe to ignore */ });
          setIsCameraReady(true);
          predictWebcam();
        };
      } catch (err: any) {
        console.error('Camera Error:', err);
        if (!isActive) return;
        setError(err?.name === 'NotAllowedError'
          ? 'Camera permission denied. Allow camera access and reload the page.'
          : 'Could not access camera. Make sure no other app is using it.');
      }
    };

    const predictWebcam = () => {
      if (!isActive) return;
      const video = videoRef.current;

      // Only run detection when the camera produced a new frame. Running it on the same frame twice
      // used to produce a zero velocity followed by a doubled one, which made hit grading random.
      if (video && landmarker && video.videoWidth > 0 && video.currentTime !== lastVideoTime) {
        lastVideoTime = video.currentTime;
        const now = performance.now();
        try {
          const results = landmarker.detectForVideo(video, now);
          lastResultsRef.current = results;
          processResults(results, now);
        } catch (e) {
          console.warn('Detection failed this frame', e);
        }
      }

      rafId = requestAnimationFrame(predictWebcam);
    };

    const processResults = (results: HandLandmarkerResult, now: number) => {
      const dt = Math.min(0.1, (now - lastProcess) / 1000);
      lastProcess = now;

      let leftLm: NormalizedLandmark[] | null = null;
      let rightLm: NormalizedLandmark[] | null = null;

      const hands = (results.landmarks ?? []).map((lm, i) => ({
        lm,
        label: results.handedness?.[i]?.[0]?.categoryName,
      }));

      if (hands.length === 2 && hands[0].label === hands[1].label) {
        // Both hands got the same label: fall back to screen position.
        // Raw image x is un-mirrored, so the larger x is the user's left hand.
        const [a, b] = hands;
        const aIsLeft = a.lm[0].x > b.lm[0].x;
        leftLm = aIsLeft ? a.lm : b.lm;
        rightLm = aIsLeft ? b.lm : a.lm;
      } else {
        for (const h of hands) {
          if (h.label === 'Right') rightLm = h.lm;
          else leftLm = h.lm;
        }
      }

      trackers.left.update(leftLm, now, dt);
      trackers.right.update(rightLm, now, dt);

      const s = handPositionsRef.current;
      s.left = trackers.left.position;
      s.right = trackers.right.position;
      s.leftVelocity.copy(trackers.left.velocity);
      s.rightVelocity.copy(trackers.right.velocity);
      s.leftPinching = trackers.left.pinching;
      s.rightPinching = trackers.right.pinching;
      s.leftCursorPos = trackers.left.cursor;
      s.rightCursorPos = trackers.right.cursor;
    };

    setupMediaPipe();

    return () => {
      isActive = false;
      cancelAnimationFrame(rafId);
      landmarker?.close();
      stream?.getTracks().forEach(t => t.stop());
    };
  }, [videoRef]);

  return { isCameraReady, handPositionsRef, lastResultsRef, error };
};
