/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Canvas } from '@react-three/fiber';
import { useProgress } from '@react-three/drei';
import { GameStatus, NoteData, Difficulty, GameStats } from './types';
import { generateChart, DIFFICULTY_CONFIG, setNoteSpeed, SONG_URL } from './constants';
import { useMediaPipe } from './hooks/useMediaPipe';
import GameScene from './components/GameScene';
import WebcamPreview from './components/WebcamPreview';
import { Play, RefreshCw, VideoOff, Hand, Sparkles, Trophy, Pause, Zap, Flame, Target } from 'lucide-react';
import { soundManager } from './utils/soundManager';
import { saveHighScore, getHighScore } from './utils/storage';

// Hook for gesture-based button interaction
function useGestureButton(
  ref: React.RefObject<HTMLElement | null>,
  handPositionsRef: React.MutableRefObject<any>,
  onActivate: () => void,
  enabled: boolean
) {
  const [hovered, setHovered] = useState(false);
  const activatedRef = useRef(false);

  useEffect(() => {
    if (!enabled) { setHovered(false); return; }
    activatedRef.current = false;

    const check = () => {
      const el = ref.current;
      const hands = handPositionsRef.current;
      if (!el) return;

      const rect = el.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const radius = Math.max(rect.width, rect.height) / 2;

      let isOver = false;
      const testHand = (cursor: {x: number; y: number} | null, pinching: boolean) => {
        if (!cursor) return;
        const sx = cursor.x * window.innerWidth;
        const sy = cursor.y * window.innerHeight;
        const d = Math.sqrt((sx - cx) ** 2 + (sy - cy) ** 2);
        if (d < radius + 50) {
          isOver = true;
          if (pinching && !activatedRef.current) {
            activatedRef.current = true;
            onActivate();
          }
        }
      };
      testHand(hands.leftCursorPos, hands.leftPinching);
      testHand(hands.rightCursorPos, hands.rightPinching);

      // Reset once pinch is released
      if (!hands.leftPinching && !hands.rightPinching) activatedRef.current = false;
      setHovered(isOver);
    };

    const id = setInterval(check, 100);
    return () => clearInterval(id);
  }, [enabled, ref, handPositionsRef, onActivate]);

  return hovered;
}

const DIFF_ICONS: Record<Difficulty, React.ReactNode> = {
  easy: <Target className="w-5 h-5" />,
  normal: <Zap className="w-5 h-5" />,
  hard: <Flame className="w-5 h-5" />,
};

const DIFF_COLORS: Record<Difficulty, string> = {
  easy: 'border-green-500 text-green-400',
  normal: 'border-blue-500 text-blue-400',
  hard: 'border-red-500 text-red-400',
};

const App: React.FC = () => {
  const [gameStatus, setGameStatus] = useState<GameStatus>(GameStatus.LOADING);
  const [score, setScore] = useState(0);
  const [combo, setCombo] = useState(0);
  const [multiplier, setMultiplier] = useState(1);
  const [health, setHealth] = useState(100);
  const [highScore, setHighScore] = useState(getHighScore());
  const [isNewHighScore, setIsNewHighScore] = useState(false);
  const [difficulty, setDifficulty] = useState<Difficulty>('normal');
  const [chart, setChart] = useState<NoteData[]>(() => generateChart('normal'));
  const [countdown, setCountdown] = useState(3);
  const [floatingScores, setFloatingScores] = useState<{id: number; value: number; x: number; y: number}[]>([]);
  const [stats, setStats] = useState<GameStats>({ perfects: 0, goods: 0, misses: 0, maxCombo: 0 });

  const audioRef = useRef<HTMLAudioElement>(new Audio(SONG_URL));
  const videoRef = useRef<HTMLVideoElement>(null);
  const startBtnRef = useRef<HTMLButtonElement>(null);
  const easyBtnRef = useRef<HTMLButtonElement>(null);
  const normalBtnRef = useRef<HTMLButtonElement>(null);
  const hardBtnRef = useRef<HTMLButtonElement>(null);
  const resumeBtnRef = useRef<HTMLButtonElement>(null);
  const quitBtnRef = useRef<HTMLButtonElement>(null);
  const retryBtnRef = useRef<HTMLButtonElement>(null);
  const floatIdRef = useRef(0);
  const scoreRef = useRef(0);

  const { isCameraReady, handPositionsRef, lastResultsRef, error: cameraError } = useMediaPipe(videoRef);
  const { progress } = useProgress();

  // Keep scoreRef in sync
  useEffect(() => { scoreRef.current = score; }, [score]);

  // Track max combo in stats
  useEffect(() => {
    setStats(s => ({ ...s, maxCombo: Math.max(s.maxCombo, combo) }));
  }, [combo]);

  const addFloatingScore = useCallback((value: number) => {
    const id = floatIdRef.current++;
    const x = 45 + Math.random() * 10;
    const y = 35 + Math.random() * 10;
    setFloatingScores(prev => [...prev, { id, value, x, y }]);
    setTimeout(() => setFloatingScores(prev => prev.filter(f => f.id !== id)), 1000);
  }, []);

  const handleNoteHit = useCallback((note: NoteData, goodCut: boolean) => {
    let points = 100;
    if (goodCut) {
      points += 50;
      setStats(s => ({ ...s, perfects: s.perfects + 1 }));
    } else {
      setStats(s => ({ ...s, goods: s.goods + 1 }));
    }

    soundManager.playSlice();
    soundManager.playHit(goodCut);
    if (navigator.vibrate) navigator.vibrate(goodCut ? 40 : 20);

    setCombo(c => {
      const nc = c + 1;
      if (nc === 10 || nc === 20 || nc === 30) soundManager.playCombo(nc / 10);
      if (nc > 30) setMultiplier(8);
      else if (nc > 20) setMultiplier(4);
      else if (nc > 10) setMultiplier(2);
      else setMultiplier(1);
      return nc;
    });

    const finalPoints = points * multiplier;
    setScore(s => s + finalPoints);
    addFloatingScore(finalPoints);
    const cfg = DIFFICULTY_CONFIG[difficulty];
    setHealth(h => Math.min(100, h + cfg.healthGain));
  }, [multiplier, difficulty, addFloatingScore]);

  const handleNoteMiss = useCallback((note: NoteData) => {
    soundManager.playMiss();
    setCombo(0);
    setMultiplier(1);
    setStats(s => ({ ...s, misses: s.misses + 1 }));
    const cfg = DIFFICULTY_CONFIG[difficulty];
    setHealth(h => {
      const nh = h - cfg.healthDrain;
      if (nh <= 0) { setTimeout(() => endGame(false), 0); return 0; }
      return nh;
    });
  }, [difficulty]);

  const selectDifficulty = useCallback((d: Difficulty) => {
    setDifficulty(d);
    const cfg = DIFFICULTY_CONFIG[d];
    setNoteSpeed(cfg.noteSpeed);
    const newChart = generateChart(d);
    setChart(newChart);
  }, []);

  const startGame = useCallback(async () => {
    if (!isCameraReady) return;
    setScore(0); setCombo(0); setMultiplier(1); setHealth(100);
    setIsNewHighScore(false);
    setStats({ perfects: 0, goods: 0, misses: 0, maxCombo: 0 });

    // Reset chart
    const newChart = generateChart(difficulty);
    setChart(newChart);

    // Countdown
    setGameStatus(GameStatus.COUNTDOWN);
    for (let i = 3; i >= 1; i--) {
      setCountdown(i);
      soundManager.playCountdownBeep(i === 1 ? 880 : 440);
      await new Promise(r => setTimeout(r, 1000));
    }
    setCountdown(0);
    soundManager.playGo();
    await new Promise(r => setTimeout(r, 400));

    try {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        await audioRef.current.play();
        setGameStatus(GameStatus.PLAYING);
      }
    } catch (e) {
      console.error("Audio play failed", e);
    }
  }, [isCameraReady, difficulty]);

  const endGame = useCallback((victory: boolean) => {
    setGameStatus(victory ? GameStatus.VICTORY : GameStatus.GAME_OVER);
    if (audioRef.current) audioRef.current.pause();
    if (victory) soundManager.playVictory(); else soundManager.playDefeat();
    if (saveHighScore(scoreRef.current)) {
      setIsNewHighScore(true);
      setHighScore(scoreRef.current);
    }
  }, []);

  const togglePause = useCallback(() => {
    if (gameStatus === GameStatus.PLAYING) {
      setGameStatus(GameStatus.PAUSED);
      if (audioRef.current) audioRef.current.pause();
    } else if (gameStatus === GameStatus.PAUSED) {
      setGameStatus(GameStatus.PLAYING);
      if (audioRef.current) audioRef.current.play();
    }
  }, [gameStatus]);

  // Camera ready -> IDLE
  useEffect(() => {
    if (gameStatus === GameStatus.LOADING && isCameraReady) setGameStatus(GameStatus.IDLE);
  }, [isCameraReady, gameStatus]);

  // Keyboard controls
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'p' || e.key === 'P' || e.key === 'Escape') togglePause();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [togglePause]);

  // Gesture buttons
  const startHovered = useGestureButton(startBtnRef, handPositionsRef, startGame, gameStatus === GameStatus.IDLE && isCameraReady);
  useGestureButton(easyBtnRef, handPositionsRef, () => selectDifficulty('easy'), gameStatus === GameStatus.IDLE);
  useGestureButton(normalBtnRef, handPositionsRef, () => selectDifficulty('normal'), gameStatus === GameStatus.IDLE);
  useGestureButton(hardBtnRef, handPositionsRef, () => selectDifficulty('hard'), gameStatus === GameStatus.IDLE);
  useGestureButton(resumeBtnRef, handPositionsRef, togglePause, gameStatus === GameStatus.PAUSED);
  useGestureButton(quitBtnRef, handPositionsRef, () => { if (audioRef.current) audioRef.current.pause(); setGameStatus(GameStatus.IDLE); }, gameStatus === GameStatus.PAUSED);
  useGestureButton(retryBtnRef, handPositionsRef, () => setGameStatus(GameStatus.IDLE), gameStatus === GameStatus.GAME_OVER || gameStatus === GameStatus.VICTORY);

  const totalNotes = stats.perfects + stats.goods + stats.misses;
  const accuracy = totalNotes > 0 ? Math.round(((stats.perfects + stats.goods) / totalNotes) * 100) : 0;

  return (
    <div className="relative w-full h-screen bg-black overflow-hidden font-game">
      <video ref={videoRef} className="absolute opacity-0 pointer-events-none" playsInline muted autoPlay style={{ width: '640px', height: '480px' }} />

      <Canvas shadows dpr={[1, 2]}>
        {gameStatus !== GameStatus.LOADING && (
          <GameScene
            gameStatus={gameStatus}
            audioRef={audioRef}
            handPositionsRef={handPositionsRef}
            chart={chart}
            onNoteHit={handleNoteHit}
            onNoteMiss={handleNoteMiss}
            onSongEnd={() => endGame(true)}
          />
        )}
      </Canvas>

      <WebcamPreview videoRef={videoRef} resultsRef={lastResultsRef} isCameraReady={isCameraReady} />

      {/* Floating score popups */}
      {floatingScores.map(fs => (
        <div key={fs.id} className="fixed pointer-events-none z-40 text-2xl font-bold text-yellow-300 animate-[floatUp_1s_ease-out_forwards]"
          style={{ left: `${fs.x}%`, top: `${fs.y}%` }}>
          +{fs.value}
        </div>
      ))}

      <div className="absolute inset-0 pointer-events-none flex flex-col justify-between p-6 z-10">

        {/* HUD */}
        {(gameStatus === GameStatus.PLAYING || gameStatus === GameStatus.PAUSED) && (
        <div className="flex justify-between items-start text-white w-full">
          <div className="w-1/3 max-w-xs">
            <div className="h-4 bg-gray-900/80 rounded-full overflow-hidden border border-gray-700">
              <div className="h-full transition-all duration-300 ease-out relative"
                style={{ width: `${health}%`, background: health > 50 ? 'linear-gradient(90deg, #22c55e, #86efac)' : health > 20 ? 'linear-gradient(90deg, #eab308, #fde047)' : 'linear-gradient(90deg, #dc2626, #f87171)' }}>
                <div className="absolute inset-0 animate-[shimmer_2s_linear_infinite]" style={{ background: 'linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.3) 50%, transparent 100%)', backgroundSize: '200% 100%' }} />
              </div>
            </div>
            <p className="text-xs mt-1 opacity-50 tracking-widest uppercase">System Integrity</p>
          </div>

          <div className="text-center">
            <h1 className="text-5xl font-black tracking-wider animate-[neonPulse_2s_ease-in-out_infinite]" style={{ textShadow: '0 0 20px rgba(59,130,246,0.8), 0 0 40px rgba(59,130,246,0.4)' }}>
              {score.toLocaleString()}
            </h1>
            <div className="text-xs text-blue-300/60 flex items-center justify-center gap-1 mt-1">
              <Trophy className="w-3 h-3" /> Best: {highScore.toLocaleString()}
            </div>
            <div className="mt-2 flex flex-col items-center">
              <p className={`text-2xl font-bold transition-all ${combo > 10 ? 'text-blue-400 scale-110' : 'text-gray-400'}`}>
                {combo}x COMBO
              </p>
              {multiplier > 1 && (
                <span className="text-sm px-3 py-1 bg-blue-900/50 rounded-full mt-1 animate-pulse border border-blue-500/30">
                  {multiplier}x Multiplier
                </span>
              )}
            </div>
          </div>

          <div className="w-1/3 flex justify-end">
            <button onClick={togglePause} className="pointer-events-auto opacity-50 hover:opacity-100 transition-opacity p-2 rounded-lg bg-white/5">
              <Pause className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>
        )}

        {/* Menus */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-auto">

          {/* LOADING */}
          {gameStatus === GameStatus.LOADING && (
            <div className="bg-black/80 p-10 rounded-2xl flex flex-col items-center border border-blue-900/50 backdrop-blur-md">
              <div className="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-blue-500 mb-6"></div>
              <h2 className="text-2xl text-white font-bold mb-2">Initializing System</h2>
              <p className="text-blue-300">{!isCameraReady ? "Waiting for camera..." : "Loading assets..."}</p>
              {cameraError && <p className="text-red-500 mt-4 max-w-xs text-center">{cameraError}</p>}
            </div>
          )}

          {/* COUNTDOWN */}
          {gameStatus === GameStatus.COUNTDOWN && (
            <div className="flex items-center justify-center">
              <span key={countdown} className="text-9xl font-black text-white animate-[countdownPop_0.8s_ease-out_forwards]"
                style={{ textShadow: '0 0 40px rgba(59,130,246,1), 0 0 80px rgba(59,130,246,0.5)' }}>
                {countdown === 0 ? 'GO!' : countdown}
              </span>
            </div>
          )}

          {/* IDLE */}
          {gameStatus === GameStatus.IDLE && (
            <div className="bg-black/80 p-12 rounded-3xl text-center border-2 border-blue-500/30 backdrop-blur-xl max-w-lg">
              <div className="mb-6 flex justify-center">
                <Sparkles className="w-16 h-16 text-blue-400 animate-[breathe_3s_ease-in-out_infinite]" />
              </div>
              <h1 className="text-7xl font-black text-white mb-6 tracking-tighter italic" style={{ textShadow: '0 0 30px rgba(59,130,246,0.6)' }}>
                BEAT <span className="text-blue-500">SLASH</span>
              </h1>

              {/* Difficulty selector */}
              <div className="flex gap-3 justify-center mb-8">
                {(['easy', 'normal', 'hard'] as Difficulty[]).map(d => (
                  <button key={d} ref={d === 'easy' ? easyBtnRef : d === 'normal' ? normalBtnRef : hardBtnRef}
                    onClick={() => selectDifficulty(d)}
                    className={`px-4 py-2 rounded-lg border-2 font-bold uppercase text-sm transition-all flex items-center gap-2 ${
                      difficulty === d ? `${DIFF_COLORS[d]} bg-white/10 scale-105` : 'border-gray-700 text-gray-500 hover:border-gray-500'}`}>
                    {DIFF_ICONS[d]} {d}
                  </button>
                ))}
              </div>

              <div className="space-y-3 text-gray-300 mb-8 text-sm">
                <p className="flex items-center justify-center gap-2">
                  <Hand className="w-5 h-5 text-blue-400" /> Stand back so your hands are visible.
                </p>
                <p>Use your <span className="text-red-500 font-bold">LEFT</span> and <span className="text-blue-500 font-bold">RIGHT</span> hands.</p>
                <p>Slash the <span className="text-white font-bold">Sparks</span> to the beat!</p>
              </div>

              {!isCameraReady ? (
                <div className="flex items-center justify-center text-red-400 gap-2 bg-red-900/20 p-4 rounded-lg">
                  <VideoOff /> Camera not ready yet.
                </div>
              ) : (
                <>
                  <button ref={startBtnRef} onClick={startGame}
                    className={`bg-blue-600 text-white text-xl font-bold py-4 px-12 rounded-full transition-all transform flex items-center justify-center mx-auto gap-3 ${
                      startHovered ? 'scale-110 shadow-[0_0_40px_rgba(59,130,246,0.8)] bg-blue-500' : 'hover:scale-105 hover:shadow-[0_0_30px_rgba(59,130,246,0.6)] hover:bg-blue-500'}`}>
                    <Play fill="currentColor" /> START GAME
                  </button>
                  <p className="text-blue-300 text-sm mt-4 opacity-60">Pinch with hand or click to start</p>
                </>
              )}

              <div className="text-white/20 text-xs text-center mt-8">
                Created by <a href="https://x.com/shahan2748" target="_blank" rel="noopener noreferrer" className="hover:text-blue-400 transition-colors underline decoration-blue-400/30">@shahan2748</a>
              </div>
            </div>
          )}

          {/* PAUSED */}
          {gameStatus === GameStatus.PAUSED && (
            <div className="bg-black/90 p-10 rounded-3xl text-center border-2 border-yellow-500/30 backdrop-blur-xl max-w-md">
              <Pause className="w-12 h-12 text-yellow-400 mx-auto mb-4" />
              <h2 className="text-4xl font-bold text-white mb-6">PAUSED</h2>
              <div className="flex flex-col gap-4">
                <button ref={resumeBtnRef} onClick={togglePause}
                  className="bg-blue-600 hover:bg-blue-500 text-white text-lg font-bold py-3 px-8 rounded-full transition-all flex items-center justify-center mx-auto gap-2">
                  <Play fill="currentColor" className="w-5 h-5" /> Resume
                </button>
                <button ref={quitBtnRef}
                  onClick={() => { if (audioRef.current) audioRef.current.pause(); setGameStatus(GameStatus.IDLE); }}
                  className="bg-white/10 hover:bg-white/20 text-white py-3 px-8 rounded-full transition-all flex items-center justify-center mx-auto gap-2">
                  Quit to Menu
                </button>
              </div>
              <p className="text-gray-500 text-sm mt-4">Press P or Esc to resume</p>
            </div>
          )}

          {/* GAME OVER / VICTORY */}
          {(gameStatus === GameStatus.GAME_OVER || gameStatus === GameStatus.VICTORY) && (
            <div className="bg-black/90 p-12 rounded-3xl text-center border-2 border-white/10 backdrop-blur-xl max-w-lg animate-[slideUp_0.5s_ease-out]">
              <h2 className={`text-5xl font-bold mb-4 ${gameStatus === GameStatus.VICTORY ? 'text-green-400' : 'text-red-500'}`}>
                {gameStatus === GameStatus.VICTORY ? "SEQUENCE COMPLETE" : "SYSTEM FAILURE"}
              </h2>
              {isNewHighScore && (
                <div className="bg-yellow-500/20 border-2 border-yellow-500 rounded-lg p-4 mb-4 animate-pulse">
                  <div className="flex items-center justify-center gap-2 text-yellow-400 font-bold text-2xl">
                    <Trophy className="w-8 h-8" /> NEW HIGH SCORE!
                  </div>
                </div>
              )}
              <p className="text-white text-3xl mb-2">{score.toLocaleString()}</p>
              <p className="text-blue-300 text-sm mb-6">High Score: {highScore.toLocaleString()}</p>

              {/* Stats grid */}
              <div className="grid grid-cols-2 gap-3 mb-8 text-sm">
                <div className="bg-white/5 rounded-lg p-3">
                  <p className="text-green-400 font-bold text-lg">{stats.perfects}</p>
                  <p className="text-gray-400">Perfects</p>
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <p className="text-blue-400 font-bold text-lg">{stats.goods}</p>
                  <p className="text-gray-400">Goods</p>
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <p className="text-red-400 font-bold text-lg">{stats.misses}</p>
                  <p className="text-gray-400">Misses</p>
                </div>
                <div className="bg-white/5 rounded-lg p-3">
                  <p className="text-yellow-400 font-bold text-lg">{stats.maxCombo}x</p>
                  <p className="text-gray-400">Max Combo</p>
                </div>
              </div>
              <p className="text-gray-300 mb-6">Accuracy: <span className="text-white font-bold">{accuracy}%</span></p>

              <button ref={retryBtnRef} onClick={() => setGameStatus(GameStatus.IDLE)}
                className="bg-white/10 hover:bg-white/20 text-white text-xl py-3 px-8 rounded-full flex items-center justify-center mx-auto gap-2 transition-colors">
                <RefreshCw /> Play Again
              </button>
            </div>
          )}
        </div>

        {/* Hand cursors - visible on ALL non-playing screens */}
        {gameStatus !== GameStatus.PLAYING && gameStatus !== GameStatus.LOADING && isCameraReady && (
          <>
            {handPositionsRef.current.leftCursorPos && (
              <div className="fixed pointer-events-none z-50 transition-all duration-75"
                style={{ left: `${handPositionsRef.current.leftCursorPos.x * 100}%`, top: `${handPositionsRef.current.leftCursorPos.y * 100}%`, transform: 'translate(-50%, -50%)' }}>
                <div className={`w-12 h-12 rounded-full border-4 transition-all duration-150 animate-[cursorPulse_2s_ease-in-out_infinite] ${
                  handPositionsRef.current.leftPinching ? 'border-red-500 bg-red-500/30 scale-75' : 'border-red-500/50 bg-red-500/10'}`}>
                  <div className="absolute inset-0 flex items-center justify-center text-2xl">
                    {handPositionsRef.current.leftPinching ? '🤏' : '✋'}
                  </div>
                </div>
              </div>
            )}
            {handPositionsRef.current.rightCursorPos && (
              <div className="fixed pointer-events-none z-50 transition-all duration-75"
                style={{ left: `${handPositionsRef.current.rightCursorPos.x * 100}%`, top: `${handPositionsRef.current.rightCursorPos.y * 100}%`, transform: 'translate(-50%, -50%)' }}>
                <div className={`w-12 h-12 rounded-full border-4 transition-all duration-150 animate-[cursorPulse_2s_ease-in-out_infinite] ${
                  handPositionsRef.current.rightPinching ? 'border-blue-500 bg-blue-500/30 scale-75' : 'border-blue-500/50 bg-blue-500/10'}`}>
                  <div className="absolute inset-0 flex items-center justify-center text-2xl">
                    {handPositionsRef.current.rightPinching ? '🤏' : '✋'}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default App;
