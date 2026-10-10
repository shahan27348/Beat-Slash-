/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import { Difficulty } from '../types';

const LEGACY_HIGH_SCORE_KEY = 'tempo-strike-high-score';
const highScoreKey = (difficulty: Difficulty) => `tempo-strike-high-score-${difficulty}`;

export const getHighScore = (difficulty: Difficulty): number => {
  try {
    let stored = localStorage.getItem(highScoreKey(difficulty));
    // Scores saved before per-difficulty tracking count as "normal".
    if (stored === null && difficulty === 'normal') stored = localStorage.getItem(LEGACY_HIGH_SCORE_KEY);
    const value = stored ? parseInt(stored, 10) : 0;
    return Number.isFinite(value) ? value : 0;
  } catch (e) {
    return 0;
  }
};

export const saveHighScore = (difficulty: Difficulty, score: number): boolean => {
  try {
    if (score > getHighScore(difficulty)) {
      localStorage.setItem(highScoreKey(difficulty), score.toString());
      return true;
    }
    return false;
  } catch (e) {
    console.error('Failed to save high score:', e);
    return false;
  }
};

export const getSetting = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(`tempo-strike-${key}`);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
};

export const saveSetting = <T,>(key: string, value: T) => {
  try {
    localStorage.setItem(`tempo-strike-${key}`, JSON.stringify(value));
  } catch { /* storage unavailable, setting just won't persist */ }
};
