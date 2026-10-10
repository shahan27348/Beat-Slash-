/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import { CutDirection, NoteData, Difficulty } from "./types";
import * as THREE from 'three';

// Game World Config
export const TRACK_LENGTH = 50;
export const SPAWN_Z = -30;
export const PLAYER_Z = 0;
export const MISS_Z = 3;

// Hit detection
export const HIT_RADIUS = 0.75;          // how close the saber tip has to pass to a note
export const HIT_WINDOW_FRONT = 2.2;     // notes become hittable this far (in world units) before the player
export const HIT_WINDOW_BACK = 1.4;      // ...and stay hittable this far behind the player
export const SWING_SPEED_PERFECT = 3.2;  // world units / second
export const SWING_SPEED_GREAT = 1.6;

export const LANE_WIDTH = 0.8;
export const LAYER_HEIGHT = 0.8;
export const NOTE_SIZE = 0.5;

export const LANE_X_POSITIONS = [-1.5 * LANE_WIDTH, -0.5 * LANE_WIDTH, 0.5 * LANE_WIDTH, 1.5 * LANE_WIDTH];
export const LAYER_Y_POSITIONS = [0.8, 1.6, 2.4];

export const SONG_URL = 'https://commondatastorage.googleapis.com/codeskulptor-demos/riceracer_assets/music/race2.ogg';
export const SONG_BPM = 140;
const BEAT_TIME = 60 / SONG_BPM;

// Difficulty configs
export const DIFFICULTY_CONFIG: Record<Difficulty, { noteSpeed: number; beatStep: number; maxBeats: number; healthDrain: number; healthGain: number }> = {
  easy:   { noteSpeed: 9,  beatStep: 4, maxBeats: 120, healthDrain: 7,  healthGain: 4 },
  normal: { noteSpeed: 12, beatStep: 2, maxBeats: 180, healthDrain: 10, healthGain: 3 },
  hard:   { noteSpeed: 16, beatStep: 1, maxBeats: 220, healthDrain: 14, healthGain: 2 },
};

export const BASE_POINTS: Record<'perfect' | 'great' | 'good', number> = {
  perfect: 150,
  great: 110,
  good: 70,
};

export const getMultiplier = (combo: number) => (combo >= 30 ? 8 : combo >= 20 ? 4 : combo >= 10 ? 2 : 1);

export const generateChart = (difficulty: Difficulty): NoteData[] => {
  const cfg = DIFFICULTY_CONFIG[difficulty];
  const notes: NoteData[] = [];
  let idCount = 0;

  const step = cfg.beatStep;
  const max = cfg.maxBeats;

  for (let i = 4; i < max; i += step) {
    const time = i * BEAT_TIME;
    const pattern = Math.floor(i / 12) % 6;

    if (pattern === 0) {
      const lane = i % 2 === 0 ? 1 : 2;
      notes.push({
        id: `note-${idCount++}`, time,
        lineIndex: lane, lineLayer: Math.floor((i / 8) % 3),
        type: i % 4 === 0 ? 'left' : 'right', cutDirection: CutDirection.ANY
      });
    } else if (pattern === 1) {
      if (i % 4 === 0) {
        notes.push(
          { id: `note-${idCount++}`, time, lineIndex: 0, lineLayer: 1, type: 'left', cutDirection: CutDirection.ANY },
          { id: `note-${idCount++}`, time, lineIndex: 3, lineLayer: 1, type: 'right', cutDirection: CutDirection.ANY }
        );
      }
    } else if (pattern === 2) {
      notes.push(
        { id: `note-${idCount++}`, time, lineIndex: 1, lineLayer: 0, type: 'left', cutDirection: CutDirection.ANY },
        { id: `note-${idCount++}`, time: time + BEAT_TIME / 2, lineIndex: 2, lineLayer: 0, type: 'right', cutDirection: CutDirection.ANY }
      );
    } else if (pattern === 3) {
      const layer = i % 2 === 0 ? 0 : 2;
      notes.push({
        id: `note-${idCount++}`, time,
        lineIndex: i % 4, lineLayer: layer,
        type: (i % 4 < 2) ? 'left' : 'right', cutDirection: CutDirection.ANY
      });
    } else if (pattern === 4) {
      if (i % 4 === 0) {
        notes.push(
          { id: `note-${idCount++}`, time, lineIndex: 2, lineLayer: 1, type: 'left', cutDirection: CutDirection.ANY },
          { id: `note-${idCount++}`, time: time + BEAT_TIME, lineIndex: 1, lineLayer: 1, type: 'right', cutDirection: CutDirection.ANY }
        );
      }
    } else {
      notes.push({
        id: `note-${idCount++}`, time,
        lineIndex: i % 2 === 0 ? 1 : 2,
        lineLayer: i % 3 === 0 ? 2 : 0,
        type: i % 2 === 0 ? 'left' : 'right', cutDirection: CutDirection.ANY
      });
    }
  }

  return notes.sort((a, b) => a.time - b.time);
};

// Vectors for direction checking
export const DIRECTION_VECTORS: Record<CutDirection, THREE.Vector3> = {
  [CutDirection.UP]: new THREE.Vector3(0, 1, 0),
  [CutDirection.DOWN]: new THREE.Vector3(0, -1, 0),
  [CutDirection.LEFT]: new THREE.Vector3(-1, 0, 0),
  [CutDirection.RIGHT]: new THREE.Vector3(1, 0, 0),
  [CutDirection.ANY]: new THREE.Vector3(0, 0, 0)
};
