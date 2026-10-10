/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import * as THREE from 'three';

export enum GameStatus {
  LOADING = 'LOADING',
  IDLE = 'IDLE',
  COUNTDOWN = 'COUNTDOWN',
  PLAYING = 'PLAYING',
  PAUSED = 'PAUSED',
  GAME_OVER = 'GAME_OVER',
  VICTORY = 'VICTORY'
}

export type HandType = 'left' | 'right';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type Judgement = 'perfect' | 'great' | 'good';

// 0: Up, 1: Down, 2: Left, 3: Right, 4: Any (Dot)
export enum CutDirection {
  UP = 0,
  DOWN = 1,
  LEFT = 2,
  RIGHT = 3,
  ANY = 4
}

export interface NoteData {
  id: string;
  time: number;
  lineIndex: number;
  lineLayer: number;
  type: HandType;
  cutDirection: CutDirection;
  hit?: boolean;
  missed?: boolean;
  hitTime?: number;
  missTime?: number;
  /** Normalized swing direction at the moment of the cut (used to split the debris). */
  cutDir?: THREE.Vector2;
}

export interface HandPositions {
  left: THREE.Vector3 | null;
  right: THREE.Vector3 | null;
  leftVelocity: THREE.Vector3;
  rightVelocity: THREE.Vector3;
  leftPinching: boolean;
  rightPinching: boolean;
  leftCursorPos: { x: number; y: number } | null;
  rightCursorPos: { x: number; y: number } | null;
}

export interface HitInfo {
  judgement: Judgement;
  /** Screen position of the hit, in 0..1 viewport coordinates. */
  screenX: number;
  screenY: number;
}

export interface GameStats {
  perfects: number;
  greats: number;
  goods: number;
  misses: number;
  maxCombo: number;
}

export const COLORS = {
  left: '#ff2d55',
  right: '#2d8cff',
  track: '#111111',
  hittable: '#ffffff'
};
