/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

const HIGH_SCORE_KEY = 'tempo-strike-high-score';

export const saveHighScore = (score: number): boolean => {
  try {
    const currentHigh = getHighScore();
    if (score > currentHigh) {
      localStorage.setItem(HIGH_SCORE_KEY, score.toString());
      return true; // New high score!
    }
    return false;
  } catch (e) {
    console.error('Failed to save high score:', e);
    return false;
  }
};

export const getHighScore = (): number => {
  try {
    const stored = localStorage.getItem(HIGH_SCORE_KEY);
    return stored ? parseInt(stored, 10) : 0;
  } catch (e) {
    console.error('Failed to get high score:', e);
    return 0;
  }
};
