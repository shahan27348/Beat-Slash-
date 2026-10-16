/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useRef, useState, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import { Grid, PerspectiveCamera, Stars } from '@react-three/drei';
import * as THREE from 'three';
import { GameStatus, NoteData, HandPositions, COLORS, HandType, HitInfo, Judgement } from '../types';
import {
  PLAYER_Z, SPAWN_Z, MISS_Z, LANE_X_POSITIONS, LAYER_Y_POSITIONS, SONG_BPM,
  HIT_RADIUS, HIT_WINDOW_FRONT, HIT_WINDOW_BACK, SWING_SPEED_PERFECT, SWING_SPEED_GREAT,
} from '../constants';
import Note from './Note';
import Saber from './Saber';
import HitParticles from './HitParticles';

interface GameSceneProps {
  gameStatus: GameStatus;
  audioRef: React.RefObject<HTMLAudioElement>;
  handPositionsRef: React.MutableRefObject<HandPositions>;
  chart: NoteData[];
  noteSpeed: number;
  /** 0..1, how "hot" the run is (driven by the multiplier). Makes the scene more intense. */
  energyRef: React.MutableRefObject<number>;
  onNoteHit: (note: NoteData, info: HitInfo) => void;
  onNoteMiss: (note: NoteData) => void;
  onSongEnd: () => void;
  /** Called when rendering stalled for a long time while the music kept playing. */
  onStall: (stalledSeconds: number) => void;
}

const BEAT_TIME = 60 / SONG_BPM;
const CAMERA_POS = new THREE.Vector3(0, 1.8, 4);
// How long hit debris / missed notes stay on screen before being removed.
const HIT_LINGER = 0.6;
const MISS_LINGER = 0.4;

/**
 * Smooth song clock. `audio.currentTime` only updates every few ms (and in coarse steps in some
 * browsers), which made notes stutter. We extrapolate with performance.now() and gently correct drift.
 */
class SongClock {
  private base = 0;
  private perf = 0;
  private lastAudio = -1;
  private last = 0;

  now(audio: HTMLAudioElement): number {
    const t = performance.now();
    const a = audio.currentTime;
    if (audio.paused) {
      this.base = a; this.perf = t; this.lastAudio = a; this.last = a;
      return a;
    }
    const predicted = this.base + (t - this.perf) / 1000;
    if (a !== this.lastAudio) {
      this.lastAudio = a;
      const drift = a - predicted;
      if (Math.abs(drift) > 0.08) {
        this.base = a; this.perf = t;
        this.last = a;
        return a;
      }
      this.base += drift * 0.08;
    }
    // Never go backwards on small corrections.
    this.last = Math.max(this.last, this.base + (t - this.perf) / 1000);
    return this.last;
  }
}

// Segment (a -> b) to point distance in the XY plane.
const segmentPointDistance2D = (ax: number, ay: number, bx: number, by: number, px: number, py: number) => {
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  let t = lenSq > 1e-6 ? ((px - ax) * dx + (py - ay) * dy) / lenSq : 0;
  t = Math.max(0, Math.min(1, t));
  const cx = ax + t * dx - px, cy = ay + t * dy - py;
  return Math.sqrt(cx * cx + cy * cy);
};

// Neon rails along the track edges plus lane guides.
const Track: React.FC<{ beatRef: React.MutableRefObject<number>; energyRef: React.MutableRefObject<number>; hitFlashRef: React.MutableRefObject<number> }> = ({ beatRef, energyRef, hitFlashRef }) => {
  const leftRail = useRef<THREE.MeshBasicMaterial>(null);
  const rightRail = useRef<THREE.MeshBasicMaterial>(null);
  const targetMat = useRef<THREE.MeshBasicMaterial>(null);

  useFrame((_, delta) => {
    const pulse = beatRef.current;
    const energy = energyRef.current;
    const k = 0.6 + pulse * (0.8 + energy * 1.2) + energy * 0.6;
    leftRail.current?.color.set(COLORS.left).multiplyScalar(k);
    rightRail.current?.color.set(COLORS.right).multiplyScalar(k);
    hitFlashRef.current = Math.max(0, hitFlashRef.current - delta * 4);
    if (targetMat.current) targetMat.current.opacity = 0.18 + pulse * 0.15 + hitFlashRef.current * 0.6;
  });

  return (
    <group>
      {LANE_X_POSITIONS.map((x, i) => (
        <mesh key={`lane-${i}`} position={[x, 0.01, -15]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.03, 40]} />
          <meshBasicMaterial color={i < 2 ? COLORS.left : COLORS.right} transparent opacity={0.12} depthWrite={false} />
        </mesh>
      ))}
      <mesh position={[-1.75, 0.02, -20]}>
        <boxGeometry args={[0.05, 0.03, 60]} />
        <meshBasicMaterial ref={leftRail} color={COLORS.left} toneMapped={false} />
      </mesh>
      <mesh position={[1.75, 0.02, -20]}>
        <boxGeometry args={[0.05, 0.03, 60]} />
        <meshBasicMaterial ref={rightRail} color={COLORS.right} toneMapped={false} />
      </mesh>
      {/* Target zone indicator */}
      <mesh position={[0, 0.02, PLAYER_Z]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[3.5, 0.08]} />
        <meshBasicMaterial ref={targetMat} color="#ffffff" transparent opacity={0.2} toneMapped={false} depthWrite={false} />
      </mesh>
    </group>
  );
};

// Square neon frames that fly toward the player in time with the music.
const RING_COUNT = 9;
const RING_SPACING = 7;
const BeatRings: React.FC<{ beatRef: React.MutableRefObject<number>; energyRef: React.MutableRefObject<number>; speedRef: React.MutableRefObject<number> }> = ({ beatRef, energyRef, speedRef }) => {
  const groupRef = useRef<THREE.Group>(null);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), []);
  useEffect(() => () => material.dispose(), [material]);
  const offset = useRef(0);
  const color = useMemo(() => new THREE.Color(), []);
  const left = useMemo(() => new THREE.Color(COLORS.left), []);
  const right = useMemo(() => new THREE.Color(COLORS.right), []);

  useFrame((state, delta) => {
    if (!groupRef.current) return;
    offset.current = (offset.current + delta * speedRef.current * 0.5) % RING_SPACING;
    groupRef.current.children.forEach((ring, i) => {
      ring.position.z = -8 - i * RING_SPACING + offset.current;
      ring.rotation.z = Math.PI / 4 + Math.sin(state.clock.elapsedTime * 0.3 + i * 0.4) * 0.15 * energyRef.current;
    });
    color.copy(left).lerp(right, 0.5 + Math.sin(state.clock.elapsedTime * 0.5) * 0.5);
    material.color.copy(color).multiplyScalar(0.25 + beatRef.current * (0.6 + energyRef.current));
  });

  return (
    <group ref={groupRef}>
      {Array.from({ length: RING_COUNT }, (_, i) => (
        <mesh key={i} position={[0, 1.6, -8 - i * RING_SPACING]} rotation={[0, 0, Math.PI / 4]} material={material}>
          <torusGeometry args={[4.2, 0.035, 4, 4]} />
        </mesh>
      ))}
    </group>
  );
};

// Floating ambient particles
const AmbientParticles: React.FC = () => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = 120;
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const data = useMemo(() => Array.from({ length: count }, () => ({
    x: (Math.random() - 0.5) * 14,
    y: Math.random() * 6,
    z: 1 - Math.random() * 40, // stay in front of the camera, close ones looked like grey blobs
    speed: 0.2 + Math.random() * 0.5,
    offset: Math.random() * Math.PI * 2,
  })), []);

  useFrame((state) => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const t = state.clock.elapsedTime;
    for (let i = 0; i < count; i++) {
      const p = data[i];
      dummy.position.set(
        p.x + Math.sin(t * p.speed + p.offset) * 0.5,
        p.y + Math.sin(t * p.speed * 0.7 + p.offset) * 0.3,
        p.z,
      );
      dummy.scale.setScalar(0.02 + Math.sin(t * 2 + p.offset) * 0.01);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]} frustumCulled={false}>
      <sphereGeometry args={[0.1, 6, 6]} />
      <meshBasicMaterial color="#6aa8ff" transparent opacity={0.5} depthWrite={false} />
    </instancedMesh>
  );
};

const GameScene: React.FC<GameSceneProps> = ({
  gameStatus,
  audioRef,
  handPositionsRef,
  chart,
  noteSpeed,
  energyRef,
  onNoteHit,
  onNoteMiss,
  onSongEnd,
  onStall,
}) => {
  // Only the list of notes currently on screen lives in React state. It changes a few times a second,
  // everything that moves per-frame is driven through refs.
  const [spawned, setSpawned] = useState<NoteData[]>([]);

  const songTimeRef = useRef(0);
  const clock = useMemo(() => new SongClock(), []);
  const activeNotesRef = useRef<NoteData[]>([]);
  const nextNoteIndexRef = useRef(0);
  const endedRef = useRef(false);
  const shakeRef = useRef(0);
  const beatRef = useRef(0);
  const hitFlashRef = useRef(0);
  const speedRef = useRef(noteSpeed);
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);
  const ambientLightRef = useRef<THREE.AmbientLight>(null);
  const spotLightRef = useRef<THREE.SpotLight>(null);
  const floorRef = useRef<THREE.MeshStandardMaterial>(null);

  const particleQueueRef = useRef<Array<{ position: THREE.Vector3; type: HandType; judgement: Judgement }>>([]);
  const prevHand = useRef<{ left: THREE.Vector3 | null; right: THREE.Vector3 | null }>({ left: null, right: null });

  const notePos = useMemo(() => new THREE.Vector3(), []);
  const projected = useMemo(() => new THREE.Vector3(), []);

  // Keep the latest callbacks without re-subscribing the frame loop.
  const callbacks = useRef({ onNoteHit, onNoteMiss, onSongEnd, onStall });
  callbacks.current = { onNoteHit, onNoteMiss, onSongEnd, onStall };
  const lastFrameAt = useRef(performance.now());

  useEffect(() => { speedRef.current = noteSpeed; }, [noteSpeed]);

  // Reset when a new chart is loaded (new run or difficulty change)
  useEffect(() => {
    activeNotesRef.current = [];
    nextNoteIndexRef.current = 0;
    endedRef.current = false;
    songTimeRef.current = 0;
    setSpawned([]);
  }, [chart]);

  useFrame((state, delta) => {
    const audio = audioRef.current;
    const playing = gameStatus === GameStatus.PLAYING && !!audio;

    // Frames stopped (hidden window, system hitch) but the song kept going: pause instead of
    // dumping a burst of misses on the player when rendering resumes.
    const nowMs = performance.now();
    const gapMs = nowMs - lastFrameAt.current;
    lastFrameAt.current = nowMs;
    if (playing && gapMs > 400) {
      callbacks.current.onStall(gapMs / 1000);
      return;
    }

    if (audio && (playing || gameStatus === GameStatus.PAUSED)) {
      songTimeRef.current = clock.now(audio);
    }
    const time = songTimeRef.current;

    // Beat pulse (keeps a gentle idle pulse on menus)
    const beatClock = playing ? time : state.clock.elapsedTime * 0.5;
    const beatPhase = (beatClock % BEAT_TIME) / BEAT_TIME;
    beatRef.current = Math.pow(1 - beatPhase, 3) * (playing ? 1 : 0.35);
    const pulse = beatRef.current;

    if (ambientLightRef.current) ambientLightRef.current.intensity = 0.25 + pulse * 0.35;
    if (spotLightRef.current) spotLightRef.current.intensity = 0.8 + pulse * 2.2;
    if (floorRef.current) {
      const c = 0.05 + pulse * 0.06 + energyRef.current * 0.03;
      floorRef.current.color.setRGB(c * 0.5, c * 0.7, c);
    }

    // Camera shake, decays smoothly and settles exactly back at rest.
    const cam = cameraRef.current;
    if (cam) {
      const s = shakeRef.current;
      const t = state.clock.elapsedTime;
      cam.position.set(
        CAMERA_POS.x + Math.sin(t * 61) * s * 0.5,
        CAMERA_POS.y + Math.sin(t * 47 + 1.3) * s * 0.5,
        CAMERA_POS.z,
      );
      shakeRef.current = s * Math.exp(-delta * 12);
      if (shakeRef.current < 0.001) shakeRef.current = 0;
    }

    if (!playing || !audio) return;

    let listChanged = false;

    // Spawn notes
    const spawnAheadTime = Math.abs(SPAWN_Z - PLAYER_Z) / noteSpeed;
    while (nextNoteIndexRef.current < chart.length) {
      const nextNote = chart[nextNoteIndexRef.current];
      if (nextNote.time - spawnAheadTime > time) break;
      activeNotesRef.current.push(nextNote);
      nextNoteIndexRef.current++;
      listChanged = true;
    }

    // Collide / judge notes
    const hands = handPositionsRef.current;

    for (let i = activeNotesRef.current.length - 1; i >= 0; i--) {
      const note = activeNotesRef.current[i];
      const z = PLAYER_Z - (note.time - time) * noteSpeed;

      if (note.hit) {
        if (time - (note.hitTime ?? 0) > HIT_LINGER) { activeNotesRef.current.splice(i, 1); listChanged = true; }
        continue;
      }
      if (note.missed) {
        if (time - (note.missTime ?? 0) > MISS_LINGER || z > MISS_Z + 4) { activeNotesRef.current.splice(i, 1); listChanged = true; }
        continue;
      }

      if (z > PLAYER_Z + HIT_WINDOW_BACK) {
        note.missed = true;
        note.missTime = time;
        callbacks.current.onNoteMiss(note);
        continue;
      }

      if (z < PLAYER_Z - HIT_WINDOW_FRONT) continue;

      const handPos = note.type === 'left' ? hands.left : hands.right;
      if (!handPos) continue;
      const prev = prevHand.current[note.type] ?? handPos;

      const nx = LANE_X_POSITIONS[note.lineIndex];
      const ny = LAYER_Y_POSITIONS[note.lineLayer];

      // Swept test: catches fast swings that jump past the note between two camera frames.
      const dist = segmentPointDistance2D(prev.x, prev.y, handPos.x, handPos.y, nx, ny);
      if (dist > HIT_RADIUS) continue;

      const vel = note.type === 'left' ? hands.leftVelocity : hands.rightVelocity;
      const speed = Math.hypot(vel.x, vel.y);
      let judgement: Judgement = speed >= SWING_SPEED_PERFECT ? 'perfect' : speed >= SWING_SPEED_GREAT ? 'great' : 'good';
      // Hitting very early is downgraded one step.
      if (z < PLAYER_Z - 1.4) judgement = judgement === 'perfect' ? 'great' : 'good';

      note.hit = true;
      note.hitTime = time;
      note.cutDir = speed > 0.3 ? new THREE.Vector2(vel.x, vel.y).normalize() : new THREE.Vector2(1, 0);

      notePos.set(nx, ny, z);
      projected.copy(notePos).project(state.camera);

      shakeRef.current = judgement === 'perfect' ? 0.12 : judgement === 'great' ? 0.08 : 0.05;
      hitFlashRef.current = 1;
      particleQueueRef.current.push({ position: notePos.clone(), type: note.type, judgement });

      callbacks.current.onNoteHit(note, {
        judgement,
        screenX: (projected.x + 1) / 2,
        screenY: (1 - projected.y) / 2,
      });
    }

    prevHand.current.left = hands.left ? (prevHand.current.left ?? new THREE.Vector3()).copy(hands.left) : null;
    prevHand.current.right = hands.right ? (prevHand.current.right ?? new THREE.Vector3()).copy(hands.right) : null;

    if (listChanged) setSpawned(activeNotesRef.current.slice());

    // Song complete: audio finished, or every note has been resolved and a short outro has passed.
    const lastNote = chart[chart.length - 1];
    const allDone = nextNoteIndexRef.current >= chart.length && activeNotesRef.current.length === 0;
    if (!endedRef.current && (audio.ended || (allDone && lastNote && time > lastNote.time + 2))) {
      endedRef.current = true;
      callbacks.current.onSongEnd();
    }
  });

  return (
    <>
      <PerspectiveCamera ref={cameraRef} makeDefault position={CAMERA_POS.toArray()} fov={60} />
      <color attach="background" args={['#030308']} />
      <fog attach="fog" args={['#030308', 10, 42]} />

      <ambientLight ref={ambientLightRef} intensity={0.3} />
      <hemisphereLight args={['#4060ff', '#200010', 0.4]} />
      <spotLight ref={spotLightRef} position={[0, 10, 5]} angle={0.5} penumbra={1} intensity={1} />
      <pointLight position={[0, 2, PLAYER_Z]} color="#3b82f6" intensity={0.6} distance={8} />

      <Track beatRef={beatRef} energyRef={energyRef} hitFlashRef={hitFlashRef} />
      <BeatRings beatRef={beatRef} energyRef={energyRef} speedRef={speedRef} />

      <Grid position={[0, 0, 0]} args={[6, 100]} cellThickness={0.1} cellColor="#1a1a2a" sectionSize={5} sectionThickness={1.2} sectionColor={COLORS.right} fadeDistance={55} infiniteGrid />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, -20]}>
        <planeGeometry args={[3.5, 100]} />
        <meshStandardMaterial ref={floorRef} color="#0a0a14" roughness={0.6} metalness={0.6} />
      </mesh>

      <Stars radius={50} depth={50} count={2500} factor={4} saturation={0.2} fade speed={0.8} />
      <AmbientParticles />

      <Saber type="left" handPositionsRef={handPositionsRef} />
      <Saber type="right" handPositionsRef={handPositionsRef} />

      <HitParticles particlesRef={particleQueueRef} />

      {spawned.map(note => (
        <Note key={note.id} data={note} noteSpeed={noteSpeed} timeRef={songTimeRef} />
      ))}
    </>
  );
};

export default GameScene;
