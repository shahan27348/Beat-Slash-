/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { GameStatus, NoteData, Difficulty, GameStats, HitInfo, Judgement, COLORS } from './types';
import { generateChart, DIFFICULTY_CONFIG, SONG_URL, BASE_POINTS, getMultiplier } from './constants';
import { useMediaPipe } from './hooks/useMediaPipe';
import { useMouseControls } from './hooks/useMouseControls';
import GameScene from './components/GameScene';
import Effects from './components/Effects';
import WebcamPreview from './components/WebcamPreview';
import HandCursors from './components/HandCursors';
import { Play, RefreshCw, VideoOff, Hand, Trophy, Pause, Zap, Flame, Target, Home, Sparkles, Gauge, Music2, RotateCcw, MousePointer2 } from 'lucide-react';
import { soundManager } from './utils/soundManager';
import { saveHighScore, getHighScore, getSetting, saveSetting } from './utils/storage';

type Quality = 'high' | 'low';

interface Popup { id: number; text: string; sub?: string; color: string; x: number; y: number; }

const DIFFICULTIES: Difficulty[] = ['easy', 'normal', 'hard'];

const DIFF_META: Record<Difficulty, { icon: React.ReactNode; label: string; accent: string; desc: string }> = {
  easy: { icon: <Target className="w-5 h-5" />, label: 'Easy', accent: '#22c55e', desc: 'Relaxed pace' },
  normal: { icon: <Zap className="w-5 h-5" />, label: 'Normal', accent: '#3b82f6', desc: 'The real deal' },
  hard: { icon: <Flame className="w-5 h-5" />, label: 'Hard', accent: '#ef4444', desc: 'Every beat' },
};

const JUDGE_STYLE: Record<Judgement, { text: string; color: string }> = {
  perfect: { text: 'PERFECT', color: '#fde047' },
  great: { text: 'GREAT', color: '#67e8f9' },
  good: { text: 'GOOD', color: '#c4b5fd' },
};

const EMPTY_STATS: GameStats = { perfects: 0, greats: 0, goods: 0, misses: 0, maxCombo: 0 };

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const computeAccuracy = (s: GameStats) => {
  const total = s.perfects + s.greats + s.goods + s.misses;
  if (total === 0) return 0;
  return (s.perfects + s.greats * 0.8 + s.goods * 0.5) / total;
};

const computeGrade = (accuracy: number, cleared: boolean) => {
  if (!cleared) return { grade: 'F', color: '#ef4444' };
  if (accuracy >= 0.95) return { grade: 'S', color: '#fde047' };
  if (accuracy >= 0.85) return { grade: 'A', color: '#4ade80' };
  if (accuracy >= 0.7) return { grade: 'B', color: '#60a5fa' };
  if (accuracy >= 0.5) return { grade: 'C', color: '#c084fc' };
  return { grade: 'D', color: '#f87171' };
};

/** Number that eases toward its target instead of jumping. */
const AnimatedNumber: React.FC<{ value: number; className?: string; style?: React.CSSProperties }> = ({ value, className, style }) => {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const diff = value - shown.current;
      shown.current = Math.abs(diff) < 1 ? value : shown.current + diff * 0.2;
      if (ref.current) ref.current.textContent = Math.round(shown.current).toLocaleString();
      if (shown.current !== value) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <span ref={ref} className={className} style={style}>{Math.round(shown.current).toLocaleString()}</span>;
};

/** Thin song progress line along the top edge. */
const SongProgress: React.FC<{ audioRef: React.MutableRefObject<HTMLAudioElement>; length: number }> = ({ audioRef, length }) => {
  const barRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const a = audioRef.current;
      const total = Math.min(length, Number.isFinite(a.duration) && a.duration > 0 ? a.duration : length);
      if (barRef.current) barRef.current.style.transform = `scaleX(${Math.min(1, a.currentTime / total)})`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [audioRef, length]);
  return (
    <div className="fixed top-0 left-0 right-0 h-1 bg-white/5 z-20">
      <div ref={barRef} className="h-full origin-left bg-gradient-to-r from-[#ff2d55] via-fuchsia-400 to-[#2d8cff]" style={{ transform: 'scaleX(0)' }} />
    </div>
  );
};

const App: React.FC = () => {
  const [gameStatus, setGameStatus] = useState<GameStatus>(GameStatus.LOADING);
  const [difficulty, setDifficulty] = useState<Difficulty>(() => getSetting<Difficulty>('difficulty', 'normal'));
  const [quality, setQuality] = useState<Quality>(() => getSetting<Quality>('quality', 'high'));
  const [chart, setChart] = useState<NoteData[]>(() => generateChart(getSetting<Difficulty>('difficulty', 'normal')));
  const [countdown, setCountdown] = useState<number>(3);
  const [hud, setHud] = useState({ score: 0, combo: 0, multiplier: 1, health: 100 });
  const [results, setResults] = useState<{ stats: GameStats; score: number; newBest: boolean; cleared: boolean }>({ stats: EMPTY_STATS, score: 0, newBest: false, cleared: false });
  const [popups, setPopups] = useState<Popup[]>([]);
  const [banner, setBanner] = useState<{ id: number; text: string } | null>(null);
  const [missFlash, setMissFlash] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const [mouseMode, setMouseMode] = useState(false);
  const [bestScores, setBestScores] = useState<Record<Difficulty, number>>(() => ({
    easy: getHighScore('easy'), normal: getHighScore('normal'), hard: getHighScore('hard'),
  }));

  const audio = useMemo(() => {
    const a = new Audio();
    a.preload = 'auto';
    a.src = SONG_URL;
    return a;
  }, []);
  const audioRef = useRef<HTMLAudioElement>(audio);
  const videoRef = useRef<HTMLVideoElement>(null);
  const statusRef = useRef(gameStatus);
  statusRef.current = gameStatus;
  // Read through a function so TypeScript doesn't narrow the value across awaits.
  const currentStatus = () => statusRef.current;
  const difficultyRef = useRef(difficulty);
  difficultyRef.current = difficulty;
  const countdownToken = useRef(0);
  const popupId = useRef(0);
  const energyRef = useRef(0);
  const fadeTimer = useRef<number | null>(null);
  const run = useRef({ score: 0, combo: 0, multiplier: 1, health: 100, stats: { ...EMPTY_STATS }, ended: false });

  const { isCameraReady, handPositionsRef, lastResultsRef, error: cameraError } = useMediaPipe(videoRef);
  useMouseControls(handPositionsRef, mouseMode);
  // Dev-only handle used by the promo capture script to drive the sabers.
  if ((import.meta as any).env?.DEV) (window as any).__saberHands = handPositionsRef;
  // Real hand tracking wins once the camera comes up.
  useEffect(() => { if (isCameraReady) setMouseMode(false); }, [isCameraReady]);
  const inputReady = isCameraReady || mouseMode;

  const cfg = DIFFICULTY_CONFIG[difficulty];
  const songLength = chart.length ? chart[chart.length - 1].time + 2 : 60;

  // ---------------------------------------------------------------- helpers
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(t => (t === msg ? null : t)), 3500);
  }, []);

  const addPopup = useCallback((p: Omit<Popup, 'id'>) => {
    const id = popupId.current++;
    setPopups(prev => [...prev.slice(-8), { ...p, id }]);
    window.setTimeout(() => setPopups(prev => prev.filter(x => x.id !== id)), 750);
  }, []);

  const syncHud = useCallback(() => {
    const r = run.current;
    setHud({ score: r.score, combo: r.combo, multiplier: r.multiplier, health: r.health });
    energyRef.current = Math.log2(r.multiplier) / 3;
  }, []);

  const stopFade = () => {
    if (fadeTimer.current !== null) { clearInterval(fadeTimer.current); fadeTimer.current = null; }
  };

  /** 3-2-1 countdown. Resolves false if it was cancelled (e.g. quit to menu). */
  const runCountdown = useCallback(async (withGo: boolean) => {
    const token = ++countdownToken.current;
    for (let i = 3; i >= 1; i--) {
      if (token !== countdownToken.current) return false;
      setCountdown(i);
      soundManager.playCountdownBeep(i === 1 ? 660 : 440);
      await sleep(700);
    }
    if (token !== countdownToken.current) return false;
    if (withGo) {
      setCountdown(0);
      soundManager.playGo();
      await sleep(350);
    }
    return token === countdownToken.current;
  }, []);

  // ---------------------------------------------------------------- game flow
  const endGame = useCallback((victory: boolean) => {
    const r = run.current;
    if (r.ended) return;
    r.ended = true;
    countdownToken.current++;

    const d = difficultyRef.current;
    const newBest = saveHighScore(d, r.score);
    if (newBest) setBestScores(b => ({ ...b, [d]: r.score }));
    setResults({ stats: { ...r.stats }, score: r.score, newBest, cleared: victory });
    setGameStatus(victory ? GameStatus.VICTORY : GameStatus.GAME_OVER);
    energyRef.current = 0;

    if (victory) {
      soundManager.playVictory();
      // Fade the music out instead of cutting it.
      stopFade();
      const a = audioRef.current;
      fadeTimer.current = window.setInterval(() => {
        a.volume = Math.max(0, a.volume - 0.05);
        if (a.volume <= 0) { a.pause(); stopFade(); }
      }, 60);
    } else {
      soundManager.playDefeat();
      audioRef.current.pause();
    }
  }, []);

  const startGame = useCallback(async () => {
    const status = statusRef.current;
    if (!inputReady) return;
    if (status !== GameStatus.IDLE && status !== GameStatus.GAME_OVER && status !== GameStatus.VICTORY) return;

    soundManager.unlock();
    stopFade();
    const a = audioRef.current;
    a.pause();
    a.currentTime = 0;
    a.volume = 1;

    run.current = { score: 0, combo: 0, multiplier: 1, health: 100, stats: { ...EMPTY_STATS }, ended: false };
    syncHud();
    setPopups([]);
    setChart(generateChart(difficultyRef.current));
    setGameStatus(GameStatus.COUNTDOWN);

    if (!(await runCountdown(true))) return;

    try {
      await a.play();
      if (currentStatus() === GameStatus.COUNTDOWN) setGameStatus(GameStatus.PLAYING);
    } catch (e) {
      console.error('Audio play failed', e);
      setGameStatus(GameStatus.IDLE);
      showToast('Music could not start. Check your connection, then click Start again.');
    }
  }, [inputReady, runCountdown, syncHud, showToast]);

  const pauseGame = useCallback(() => {
    if (statusRef.current !== GameStatus.PLAYING) return;
    audioRef.current.pause();
    setGameStatus(GameStatus.PAUSED);
  }, []);

  // Rendering froze while the song played on: rewind to where the player last saw the notes.
  const handleStall = useCallback((seconds: number) => {
    if (statusRef.current !== GameStatus.PLAYING) return;
    const a = audioRef.current;
    a.pause();
    a.currentTime = Math.max(0, a.currentTime - seconds - 0.2);
    setGameStatus(GameStatus.PAUSED);
  }, []);

  const resumeGame = useCallback(async () => {
    if (statusRef.current !== GameStatus.PAUSED) return;
    soundManager.unlock();
    setGameStatus(GameStatus.COUNTDOWN);
    if (!(await runCountdown(false))) return;
    try {
      await audioRef.current.play();
      if (currentStatus() === GameStatus.COUNTDOWN) setGameStatus(GameStatus.PLAYING);
    } catch {
      setGameStatus(GameStatus.PAUSED);
    }
  }, [runCountdown]);

  const goToMenu = useCallback(() => {
    countdownToken.current++;
    stopFade();
    audioRef.current.pause();
    run.current.ended = true;
    energyRef.current = 0;
    setChart(generateChart(difficultyRef.current)); // clears notes left on the track
    setPopups([]);
    setGameStatus(GameStatus.IDLE);
  }, []);

  const restartGame = useCallback(() => {
    countdownToken.current++;
    audioRef.current.pause();
    run.current.ended = true;
    statusRef.current = GameStatus.IDLE;
    startGame();
  }, [startGame]);

  const selectDifficulty = useCallback((d: Difficulty) => {
    if (statusRef.current !== GameStatus.IDLE) return;
    setDifficulty(d);
    saveSetting('difficulty', d);
    setChart(generateChart(d));
  }, []);

  const toggleQuality = useCallback(() => {
    setQuality(q => {
      const next = q === 'high' ? 'low' : 'high';
      saveSetting('quality', next);
      return next;
    });
  }, []);

  // ---------------------------------------------------------------- scoring
  const handleNoteHit = useCallback((note: NoteData, info: HitInfo) => {
    const r = run.current;
    if (r.ended) return;
    const { judgement } = info;

    r.combo++;
    const prevMult = r.multiplier;
    r.multiplier = getMultiplier(r.combo);
    if (r.multiplier > prevMult) {
      soundManager.playCombo(Math.log2(r.multiplier));
      setBanner({ id: popupId.current++, text: `${r.multiplier}x MULTIPLIER` });
    }

    const points = BASE_POINTS[judgement] * r.multiplier;
    r.score += points;
    if (judgement === 'perfect') r.stats.perfects++;
    else if (judgement === 'great') r.stats.greats++;
    else r.stats.goods++;
    r.stats.maxCombo = Math.max(r.stats.maxCombo, r.combo);

    const gain = DIFFICULTY_CONFIG[difficultyRef.current].healthGain;
    r.health = Math.min(100, r.health + (judgement === 'perfect' ? gain * 1.5 : gain));

    soundManager.playHit(judgement);
    if (navigator.vibrate) navigator.vibrate(judgement === 'perfect' ? 35 : 18);

    const style = JUDGE_STYLE[judgement];
    addPopup({ text: style.text, sub: `+${points}`, color: style.color, x: info.screenX, y: info.screenY });
    syncHud();
  }, [addPopup, syncHud]);

  const handleNoteMiss = useCallback((note: NoteData) => {
    const r = run.current;
    if (r.ended) return;
    soundManager.playMiss();
    const hadCombo = r.combo >= 10;
    r.combo = 0;
    r.multiplier = 1;
    r.stats.misses++;
    r.health = Math.max(0, r.health - DIFFICULTY_CONFIG[difficultyRef.current].healthDrain);
    setMissFlash(k => k + 1);
    addPopup({
      text: hadCombo ? 'COMBO BREAK' : 'MISS',
      color: '#f87171',
      x: note.lineIndex < 2 ? 0.38 : 0.62,
      y: 0.62,
    });
    syncHud();
    if (r.health <= 0) endGame(false);
  }, [addPopup, syncHud, endGame]);

  const handleSongEnd = useCallback(() => endGame(true), [endGame]);

  // ---------------------------------------------------------------- effects
  useEffect(() => {
    if (gameStatus === GameStatus.LOADING && inputReady) setGameStatus(GameStatus.IDLE);
  }, [inputReady, gameStatus]);

  useEffect(() => {
    const onError = () => showToast('Music failed to load. Check your internet connection.');
    audio.addEventListener('error', onError);
    return () => { audio.removeEventListener('error', onError); audio.pause(); };
  }, [audio, showToast]);

  // Auto-pause when the tab loses focus.
  useEffect(() => {
    const onHide = () => { if (document.hidden) pauseGame(); };
    const onBlur = () => pauseGame();
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('blur', onBlur);
    };
  }, [pauseGame]);

  // Keyboard controls
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const s = statusRef.current;
      const key = e.key.toLowerCase();
      if (key === 'escape' || key === 'p') {
        if (s === GameStatus.PLAYING) pauseGame();
        else if (s === GameStatus.PAUSED) resumeGame();
      } else if (key === 'enter' || key === ' ') {
        if (s === GameStatus.IDLE || s === GameStatus.GAME_OVER || s === GameStatus.VICTORY) { e.preventDefault(); startGame(); }
        else if (s === GameStatus.PAUSED) { e.preventDefault(); resumeGame(); }
      } else if (s === GameStatus.IDLE && (key === '1' || key === '2' || key === '3')) {
        selectDifficulty(DIFFICULTIES[Number(key) - 1]);
      } else if (key === 'm' && (s === GameStatus.PAUSED || s === GameStatus.GAME_OVER || s === GameStatus.VICTORY)) {
        goToMenu();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [pauseGame, resumeGame, startGame, selectDifficulty, goToMenu]);

  useEffect(() => {
    if (!banner) return;
    const t = window.setTimeout(() => setBanner(null), 1200);
    return () => clearTimeout(t);
  }, [banner]);

  // ---------------------------------------------------------------- render
  const inRun = gameStatus === GameStatus.PLAYING || gameStatus === GameStatus.PAUSED || gameStatus === GameStatus.COUNTDOWN;
  const showMenus = gameStatus !== GameStatus.PLAYING && gameStatus !== GameStatus.COUNTDOWN;
  const { combo, multiplier, health } = hud;
  const nextThreshold = multiplier >= 8 ? 1 : (combo % 10) / 10;
  const accuracy = computeAccuracy(results.stats);
  const grade = computeGrade(accuracy, results.cleared);

  return (
    <div className={`relative w-full h-screen bg-black overflow-hidden font-game select-none ${mouseMode && gameStatus === GameStatus.PLAYING ? 'cursor-none' : ''}`}>
      <video ref={videoRef} className="absolute opacity-0 pointer-events-none" playsInline muted autoPlay style={{ width: 1, height: 1 }} />

      <Canvas dpr={quality === 'high' ? [1, 1.75] : 1} gl={{ antialias: quality === 'high', powerPreference: 'high-performance' }}>
        <GameScene
          gameStatus={gameStatus}
          audioRef={audioRef}
          handPositionsRef={handPositionsRef}
          chart={chart}
          noteSpeed={cfg.noteSpeed}
          energyRef={energyRef}
          onNoteHit={handleNoteHit}
          onNoteMiss={handleNoteMiss}
          onSongEnd={handleSongEnd}
          onStall={handleStall}
        />
        {quality === 'high' && <Effects />}
      </Canvas>

      {/* Screen-space feedback */}
      <div key={`miss-${missFlash}`} className={missFlash ? 'miss-vignette' : ''} />
      {inRun && health <= 30 && <div className="danger-vignette" />}

      {popups.map(p => (
        <div key={p.id} className="judge-popup" style={{ left: `${p.x * 100}%`, top: `${p.y * 100}%`, color: p.color }}>
          <div className="text-2xl md:text-3xl font-black tracking-wider">{p.text}</div>
          {p.sub && <div className="text-sm font-bold text-white/80">{p.sub}</div>}
        </div>
      ))}

      {banner && gameStatus === GameStatus.PLAYING && (
        <div key={banner.id} className="multiplier-banner">{banner.text}</div>
      )}

      <WebcamPreview videoRef={videoRef} resultsRef={lastResultsRef} isCameraReady={isCameraReady} />

      {/* HUD */}
      {inRun && (
        <>
          <SongProgress audioRef={audioRef} length={songLength} />
          <div className="absolute top-0 left-0 right-0 p-4 md:p-6 flex justify-between items-start text-white pointer-events-none z-10">
            <div className="w-1/3 max-w-[260px]">
              <div className="flex justify-between text-[10px] tracking-[0.25em] uppercase text-white/50 mb-1.5">
                <span>Energy</span><span>{Math.round(health)}%</span>
              </div>
              <div className="h-2.5 bg-white/5 rounded-full overflow-hidden border border-white/10">
                <div className="h-full transition-[width] duration-300 ease-out rounded-full"
                  style={{
                    width: `${health}%`,
                    background: health > 50 ? 'linear-gradient(90deg,#22c55e,#86efac)' : health > 25 ? 'linear-gradient(90deg,#eab308,#fde047)' : 'linear-gradient(90deg,#dc2626,#f87171)',
                    boxShadow: `0 0 12px ${health > 50 ? '#22c55e' : health > 25 ? '#eab308' : '#dc2626'}`,
                  }} />
              </div>
            </div>

            <div className="text-center">
              <AnimatedNumber value={hud.score} className="block text-4xl md:text-5xl font-black tracking-wider tabular-nums"
                style={{ textShadow: '0 0 24px rgba(45,140,255,0.7)' }} />
              <div className="text-[11px] text-white/40 flex items-center justify-center gap-1 mt-1 tracking-widest uppercase">
                <Trophy className="w-3 h-3" /> {bestScores[difficulty].toLocaleString()} · {DIFF_META[difficulty].label}
              </div>
            </div>

            <div className="w-1/3 flex justify-end">
              <button onClick={pauseGame} aria-label="Pause"
                className="pointer-events-auto p-3 rounded-xl bg-white/5 border border-white/10 text-white/60 hover:text-white hover:bg-white/10 transition">
                <Pause className="w-5 h-5" />
              </button>
            </div>
          </div>

          {/* Combo / multiplier */}
          <div className="absolute left-4 md:left-10 top-1/2 -translate-y-1/2 text-white pointer-events-none z-10 flex flex-col items-center">
            <div className="multiplier-ring" style={{ ['--p' as any]: nextThreshold, ['--c' as any]: multiplier >= 8 ? '#fde047' : multiplier >= 4 ? '#e879f9' : multiplier >= 2 ? '#67e8f9' : '#ffffff55' }}>
              <span className="text-xl font-black">x{multiplier}</span>
            </div>
            <div key={combo} className={`mt-3 text-5xl font-black tabular-nums ${combo > 0 ? 'combo-bump' : 'opacity-30'}`}
              style={{ textShadow: combo >= 10 ? '0 0 20px rgba(232,121,249,0.8)' : undefined }}>
              {combo}
            </div>
            <div className="text-[10px] tracking-[0.35em] text-white/50 uppercase">Combo</div>
          </div>
        </>
      )}

      {/* COUNTDOWN */}
      {gameStatus === GameStatus.COUNTDOWN && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
          <span key={countdown} className="text-[9rem] leading-none font-black text-white animate-[countdownPop_0.7s_ease-out_forwards]"
            style={{ textShadow: '0 0 40px rgba(45,140,255,1), 0 0 90px rgba(255,45,85,0.5)' }}>
            {countdown === 0 ? 'GO!' : countdown}
          </span>
        </div>
      )}

      {/* Menus */}
      {showMenus && (
        <div className="absolute inset-0 flex items-center justify-center z-20 p-4 bg-[radial-gradient(ellipse_at_center,rgba(0,0,0,0.35),rgba(0,0,0,0.85))] animate-[fadeIn_0.3s_ease-out]">

          {/* LOADING */}
          {gameStatus === GameStatus.LOADING && (
            <div className="panel p-10 flex flex-col items-center max-w-sm text-center">
              {cameraError ? (
                <>
                  <VideoOff className="w-12 h-12 text-red-400 mb-4" />
                  <h2 className="text-xl text-white font-bold mb-2">Camera unavailable</h2>
                  <p className="text-red-300/80 text-sm mb-6 font-sans">{cameraError}</p>
                  <div className="flex flex-col gap-3 w-full">
                    <button onClick={() => window.location.reload()} className="btn-primary w-full"><RefreshCw className="w-5 h-5" /> Try again</button>
                    <button onClick={() => { soundManager.unlock(); setMouseMode(true); }} className="btn-secondary w-full"><MousePointer2 className="w-5 h-5" /> Play with mouse</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="loader mb-6" />
                  <h2 className="text-xl text-white font-bold mb-2 tracking-wider">INITIALIZING</h2>
                  <p className="text-blue-300/70 text-sm font-sans">Loading hand tracking and waiting for camera access…</p>
                  <button onClick={() => { soundManager.unlock(); setMouseMode(true); }}
                    className="mt-6 text-xs text-white/40 hover:text-white/80 transition flex items-center gap-1.5 font-sans">
                    <MousePointer2 className="w-3.5 h-3.5" /> No camera? Play with mouse
                  </button>
                </>
              )}
            </div>
          )}

          {/* IDLE */}
          {gameStatus === GameStatus.IDLE && (
            <div className="panel p-8 md:p-10 text-center w-full max-w-xl animate-[slideUp_0.4s_ease-out]">
              <div className="text-[10px] tracking-[0.5em] text-white/40 mb-2">MOTION RHYTHM</div>
              <h1 className="text-6xl md:text-7xl font-black text-white mb-8 tracking-tight italic leading-none">
                <span style={{ color: COLORS.left, textShadow: `0 0 30px ${COLORS.left}` }}>SABER</span>{' '}
                <span style={{ color: COLORS.right, textShadow: `0 0 30px ${COLORS.right}` }}>BLAST</span>
              </h1>

              <div className="grid grid-cols-3 gap-3 mb-8">
                {DIFFICULTIES.map((d, i) => {
                  const meta = DIFF_META[d];
                  const active = difficulty === d;
                  return (
                    <button key={d} data-gesture onClick={() => { soundManager.unlock(); selectDifficulty(d); }}
                      className={`diff-card ${active ? 'diff-card-active' : ''}`} style={{ ['--accent' as any]: meta.accent }}>
                      <div className="flex items-center justify-center gap-2 font-bold uppercase text-sm" style={{ color: active ? meta.accent : undefined }}>
                        {meta.icon} {meta.label}
                      </div>
                      <div className="text-[10px] text-white/40 mt-1 font-sans">{meta.desc}</div>
                      <div className="text-[10px] text-white/50 mt-2 flex items-center justify-center gap-1 tabular-nums">
                        <Trophy className="w-3 h-3" /> {bestScores[d].toLocaleString()}
                      </div>
                      <span className="absolute top-1.5 right-2 text-[9px] text-white/20">{i + 1}</span>
                    </button>
                  );
                })}
              </div>

              <div className="grid grid-cols-3 gap-3 text-[11px] text-white/60 mb-8 font-sans">
                <div className="flex flex-col items-center gap-1.5"><Hand className="w-5 h-5 text-white/70" />Stand back, both hands in view</div>
                <div className="flex flex-col items-center gap-1.5">
                  <div className="flex gap-1"><span className="w-3 h-3 rounded-full" style={{ background: COLORS.left }} /><span className="w-3 h-3 rounded-full" style={{ background: COLORS.right }} /></div>
                  Left hand red, right hand blue
                </div>
                <div className="flex flex-col items-center gap-1.5"><Sparkles className="w-5 h-5 text-yellow-300" />Swing fast for PERFECT</div>
              </div>

              {!inputReady ? (
                <div className="flex items-center justify-center text-red-400 gap-2 bg-red-900/20 p-4 rounded-xl">
                  <VideoOff /> Camera not ready yet.
                </div>
              ) : (
                <>
                  <button data-gesture onClick={startGame} className="btn-primary btn-xl mx-auto">
                    <Play fill="currentColor" className="w-6 h-6" /> START
                  </button>
                  <p className="text-white/40 text-xs mt-4 font-sans">
                    {mouseMode ? 'Mouse mode: move the cursor through the notes · press Enter to start' : 'Pinch on a button with your hand, click, or press Enter'}
                  </p>
                </>
              )}

              <div className="flex items-center justify-between mt-8 text-[11px] text-white/30">
                <button data-gesture onClick={toggleQuality} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-white/10 hover:text-white/70 hover:border-white/30 transition">
                  <Gauge className="w-3.5 h-3.5" /> Graphics: {quality === 'high' ? 'High' : 'Performance'}
                </button>
                <span>
                  Created by <a href="https://x.com/shahan2748" target="_blank" rel="noopener noreferrer" className="hover:text-blue-400 transition-colors underline decoration-blue-400/30">@shahan2748</a>
                </span>
              </div>
            </div>
          )}

          {/* PAUSED */}
          {gameStatus === GameStatus.PAUSED && (
            <div className="panel p-10 text-center w-full max-w-sm animate-[slideUp_0.25s_ease-out]">
              <Pause className="w-10 h-10 text-white/70 mx-auto mb-3" />
              <h2 className="text-4xl font-black text-white mb-8 tracking-widest">PAUSED</h2>
              <div className="flex flex-col gap-3">
                <button data-gesture onClick={resumeGame} className="btn-primary w-full"><Play fill="currentColor" className="w-5 h-5" /> Resume</button>
                <button data-gesture onClick={restartGame} className="btn-secondary w-full"><RotateCcw className="w-5 h-5" /> Restart</button>
                <button data-gesture onClick={goToMenu} className="btn-secondary w-full"><Home className="w-5 h-5" /> Main Menu</button>
              </div>
              <p className="text-white/30 text-xs mt-6 font-sans">Esc / P to resume · M for menu</p>
            </div>
          )}

          {/* GAME OVER / VICTORY */}
          {(gameStatus === GameStatus.GAME_OVER || gameStatus === GameStatus.VICTORY) && (
            <div className="panel p-8 md:p-10 text-center w-full max-w-lg animate-[slideUp_0.5s_ease-out]">
              <div className="text-[10px] tracking-[0.5em] text-white/40 mb-1">{DIFF_META[difficulty].label.toUpperCase()}</div>
              <h2 className={`text-3xl md:text-4xl font-black mb-6 tracking-wider ${results.cleared ? 'text-green-400' : 'text-red-500'}`}>
                {results.cleared ? 'TRACK CLEARED' : 'SYSTEM FAILURE'}
              </h2>

              <div className="flex items-center justify-center gap-8 mb-6">
                <div className="grade-badge" style={{ color: grade.color, textShadow: `0 0 40px ${grade.color}` }}>{grade.grade}</div>
                <div className="text-left">
                  <AnimatedNumber value={results.score} className="block text-4xl font-black text-white tabular-nums" />
                  <div className="text-white/50 text-sm mt-1">Accuracy <span className="text-white font-bold">{Math.round(accuracy * 100)}%</span></div>
                  <div className="text-white/40 text-xs mt-1 flex items-center gap-1"><Trophy className="w-3 h-3" /> Best {bestScores[difficulty].toLocaleString()}</div>
                </div>
              </div>

              {results.newBest && (
                <div className="bg-yellow-500/15 border border-yellow-500/60 rounded-xl py-2.5 mb-6 text-yellow-300 font-bold flex items-center justify-center gap-2 animate-pulse">
                  <Trophy className="w-5 h-5" /> NEW HIGH SCORE!
                </div>
              )}

              <div className="grid grid-cols-5 gap-2 mb-8 text-xs">
                {[
                  { v: results.stats.perfects, l: 'Perfect', c: JUDGE_STYLE.perfect.color },
                  { v: results.stats.greats, l: 'Great', c: JUDGE_STYLE.great.color },
                  { v: results.stats.goods, l: 'Good', c: JUDGE_STYLE.good.color },
                  { v: results.stats.misses, l: 'Miss', c: '#f87171' },
                  { v: `${results.stats.maxCombo}`, l: 'Max Combo', c: '#ffffff' },
                ].map(s => (
                  <div key={s.l} className="bg-white/5 border border-white/5 rounded-xl py-3">
                    <p className="font-black text-xl tabular-nums" style={{ color: s.c }}>{s.v}</p>
                    <p className="text-white/40 text-[9px] uppercase tracking-wider mt-0.5">{s.l}</p>
                  </div>
                ))}
              </div>

              <div className="flex gap-3 justify-center">
                <button data-gesture onClick={startGame} className="btn-primary"><RefreshCw className="w-5 h-5" /> Play Again</button>
                <button data-gesture onClick={goToMenu} className="btn-secondary"><Home className="w-5 h-5" /> Menu</button>
              </div>
            </div>
          )}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-5 py-3 rounded-xl bg-red-950/90 border border-red-500/40 text-red-100 text-sm font-sans flex items-center gap-2 animate-[slideUp_0.3s_ease-out]">
          <Music2 className="w-4 h-4" /> {toast}
        </div>
      )}

      <HandCursors handPositionsRef={handPositionsRef} enabled={isCameraReady && showMenus && gameStatus !== GameStatus.LOADING} />
    </div>
  );
};

export default App;
