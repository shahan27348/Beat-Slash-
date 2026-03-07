/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import React, { useRef, useState, useMemo, useEffect } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import { Environment, Grid, PerspectiveCamera, Stars } from '@react-three/drei';
import * as THREE from 'three';
import { GameStatus, NoteData, HandPositions, COLORS, CutDirection, HandType } from '../types';
import { PLAYER_Z, SPAWN_Z, MISS_Z, NOTE_SPEED, DIRECTION_VECTORS, NOTE_SIZE, LANE_X_POSITIONS, LAYER_Y_POSITIONS, SONG_BPM } from '../constants';
import Note from './Note';
import Saber from './Saber';
import HitParticles from './HitParticles';

interface GameSceneProps {
  gameStatus: GameStatus;
  audioRef: React.RefObject<HTMLAudioElement>;
  handPositionsRef: React.MutableRefObject<any>;
  chart: NoteData[];
  onNoteHit: (note: NoteData, goodCut: boolean) => void;
  onNoteMiss: (note: NoteData) => void;
  onSongEnd: () => void;
}

const BEAT_TIME = 60 / SONG_BPM;

// Lane guide lines component
const LaneGuides: React.FC = () => {
  return (
    <group>
      {LANE_X_POSITIONS.map((x, i) => (
        <mesh key={`lane-${i}`} position={[x, 0.01, -15]} rotation={[-Math.PI / 2, 0, 0]}>
          <planeGeometry args={[0.04, 40]} />
          <meshBasicMaterial
            color={i < 2 ? COLORS.left : COLORS.right}
            transparent
            opacity={0.15}
          />
        </mesh>
      ))}
      {/* Target zone indicator */}
      <mesh position={[0, 0.02, PLAYER_Z]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[4, 0.1]} />
        <meshBasicMaterial color="#ffffff" transparent opacity={0.2} />
      </mesh>
    </group>
  );
};

// Floating ambient particles
const AmbientParticles: React.FC = () => {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = 100;
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const data = useMemo(() => {
    return Array.from({ length: count }, () => ({
      x: (Math.random() - 0.5) * 12,
      y: Math.random() * 5,
      z: (Math.random() - 0.5) * 40 - 10,
      speed: 0.2 + Math.random() * 0.5,
      offset: Math.random() * Math.PI * 2,
    }));
  }, []);

  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.elapsedTime;
    data.forEach((p, i) => {
      dummy.position.set(
        p.x + Math.sin(t * p.speed + p.offset) * 0.5,
        p.y + Math.sin(t * p.speed * 0.7 + p.offset) * 0.3,
        p.z
      );
      dummy.scale.setScalar(0.02 + Math.sin(t * 2 + p.offset) * 0.01);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <sphereGeometry args={[0.1, 6, 6]} />
      <meshBasicMaterial color="#4488ff" transparent opacity={0.4} />
    </instancedMesh>
  );
};

const GameScene: React.FC<GameSceneProps> = ({ 
    gameStatus, 
    audioRef, 
    handPositionsRef, 
    chart,
    onNoteHit,
    onNoteMiss,
    onSongEnd
}) => {
  const [notesState, setNotesState] = useState<NoteData[]>(chart);
  const [currentTime, setCurrentTime] = useState(0);

  const activeNotesRef = useRef<NoteData[]>([]);
  const nextNoteIndexRef = useRef(0);
  const shakeIntensity = useRef(0);
  const cameraRef = useRef<THREE.PerspectiveCamera>(null);
  const ambientLightRef = useRef<THREE.AmbientLight>(null);
  const spotLightRef = useRef<THREE.SpotLight>(null);
  const floorRef = useRef<THREE.Mesh>(null);
  
  const particleQueueRef = useRef<Array<{ position: THREE.Vector3; type: HandType; goodCut: boolean }>>([]);

  const vecA = useMemo(() => new THREE.Vector3(), []);
  const vecB = useMemo(() => new THREE.Vector3(), []);

  // Reset notes when chart changes (difficulty change)
  useEffect(() => {
    setNotesState(chart);
    activeNotesRef.current = [];
    nextNoteIndexRef.current = 0;
  }, [chart]);

  const handleHit = (note: NoteData, goodCut: boolean, position: THREE.Vector3) => {
      shakeIntensity.current = goodCut ? 0.3 : 0.15;
      
      particleQueueRef.current.push({
        position: position.clone(),
        type: note.type,
        goodCut
      });
      
      onNoteHit(note, goodCut);
  }

  useFrame((state, delta) => {
    // Beat pulsing
    if (audioRef.current && gameStatus === GameStatus.PLAYING) {
        const time = audioRef.current.currentTime;
        const beatPhase = (time % BEAT_TIME) / BEAT_TIME;
        const pulse = Math.pow(1 - beatPhase, 4); 
        
        if (ambientLightRef.current) {
            ambientLightRef.current.intensity = 0.1 + (pulse * 0.4);
        }
        if (spotLightRef.current) {
            spotLightRef.current.intensity = 0.5 + (pulse * 2.0);
        }
        // Beat-reactive floor color
        if (floorRef.current) {
            const mat = floorRef.current.material as THREE.MeshStandardMaterial;
            const c = 0.06 + pulse * 0.08;
            mat.color.setRGB(c * 0.5, c * 0.7, c);
        }
    }

    // Camera shake
    if (shakeIntensity.current > 0 && cameraRef.current) {
        const shake = shakeIntensity.current;
        cameraRef.current.position.x = (Math.random() - 0.5) * shake;
        cameraRef.current.position.y = 1.8 + (Math.random() - 0.5) * shake;
        cameraRef.current.position.z = 4 + (Math.random() - 0.5) * shake;
        
        shakeIntensity.current = THREE.MathUtils.lerp(shakeIntensity.current, 0, 10 * delta);
        if (shakeIntensity.current < 0.01) {
             shakeIntensity.current = 0;
             cameraRef.current.position.set(0, 1.8, 4);
        }
    }

    if (gameStatus !== GameStatus.PLAYING || !audioRef.current) return;

    const time = audioRef.current.currentTime;
    setCurrentTime(time);

    if (audioRef.current.ended) {
        onSongEnd();
        return;
    }

    // Spawn Notes
    const spawnAheadTime = Math.abs(SPAWN_Z - PLAYER_Z) / NOTE_SPEED;
    
    while (nextNoteIndexRef.current < notesState.length) {
      const nextNote = notesState[nextNoteIndexRef.current];
      if (nextNote.time - spawnAheadTime <= time) {
        activeNotesRef.current.push(nextNote);
        nextNoteIndexRef.current++;
      } else {
        break;
      }
    }

    // Update & Collide Notes
    const hands = handPositionsRef.current as HandPositions;

    for (let i = activeNotesRef.current.length - 1; i >= 0; i--) {
        const note = activeNotesRef.current[i];
        if (note.hit || note.missed) continue;

        const timeDiff = note.time - time; 
        const currentZ = PLAYER_Z - (timeDiff * NOTE_SPEED);

        if (currentZ > MISS_Z) {
            note.missed = true;
            onNoteMiss(note);
            activeNotesRef.current.splice(i, 1);
            continue;
        }

        if (currentZ > PLAYER_Z - 1.8 && currentZ < PLAYER_Z + 1.2) {
            const handPos = note.type === 'left' ? hands.left : hands.right;
            const handVel = note.type === 'left' ? hands.leftVelocity : hands.rightVelocity;

            if (handPos) {
                 const notePos = vecA.set(
                     LANE_X_POSITIONS[note.lineIndex],
                     LAYER_Y_POSITIONS[note.lineLayer],
                     currentZ
                 );

                 if (handPos.distanceTo(notePos) < 0.9) {
                     let goodCut = true;
                     const speed = handVel.length();

                     if (note.cutDirection !== CutDirection.ANY) {
                         const requiredDir = DIRECTION_VECTORS[note.cutDirection];
                         vecB.copy(handVel).normalize();
                         const dot = vecB.dot(requiredDir);
                         
                         if (dot < 0.25 || speed < 1.2) { 
                             goodCut = false;
                         }
                     } else {
                         if (speed < 1.2) goodCut = false; 
                     }

                     note.hit = true;
                     note.hitTime = time;
                     handleHit(note, goodCut, notePos);
                     activeNotesRef.current.splice(i, 1);
                 }
            }
        }
    }
  });

  const visibleNotes = useMemo(() => {
     return notesState.filter(n => 
         !n.missed && 
         (!n.hit || (currentTime - (n.hitTime || 0) < 0.5)) &&
         (n.time - currentTime) < 5 && 
         (n.time - currentTime) > -2 
     );
  }, [notesState, currentTime]);

  const leftHandPosRef = useRef<THREE.Vector3 | null>(null);
  const rightHandPosRef = useRef<THREE.Vector3 | null>(null);
  const leftHandVelRef = useRef<THREE.Vector3 | null>(null);
  const rightHandVelRef = useRef<THREE.Vector3 | null>(null);

  useFrame(() => {
     leftHandPosRef.current = handPositionsRef.current.left;
     rightHandPosRef.current = handPositionsRef.current.right;
     leftHandVelRef.current = handPositionsRef.current.leftVelocity;
     rightHandVelRef.current = handPositionsRef.current.rightVelocity;
  });

  return (
    <>
      <PerspectiveCamera ref={cameraRef} makeDefault position={[0, 1.8, 4]} fov={60} />
      <color attach="background" args={['#030308']} />
      <fog attach="fog" args={['#030308', 8, 45]} />
      
      <ambientLight ref={ambientLightRef} intensity={0.2} />
      <spotLight ref={spotLightRef} position={[0, 10, 5]} angle={0.5} penumbra={1} intensity={1} castShadow />
      <pointLight position={[0, 2, PLAYER_Z]} color="#3b82f6" intensity={0.5} distance={8} />
      
      <Environment preset="night" />

      {/* Lane Guides */}
      <LaneGuides />

      {/* Floor / Track visuals */}
      <Grid position={[0, 0, 0]} args={[6, 100]} cellThickness={0.1} cellColor="#222" sectionSize={5} sectionThickness={1.5} sectionColor={COLORS.right} fadeDistance={60} infiniteGrid />
      <mesh ref={floorRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
          <planeGeometry args={[4, 100]} />
          <meshStandardMaterial color="#0a0a14" roughness={0.8} metalness={0.5} />
      </mesh>
      
      <Stars radius={50} depth={50} count={3000} factor={4} saturation={0.2} fade speed={0.8} />
      <AmbientParticles />

      <Saber type="left" positionRef={leftHandPosRef} velocityRef={leftHandVelRef} />
      <Saber type="right" positionRef={rightHandPosRef} velocityRef={rightHandVelRef} />
      
      <HitParticles particlesRef={particleQueueRef} />

      {visibleNotes.map(note => (
          <Note 
            key={note.id} 
            data={note} 
            zPos={PLAYER_Z - ((note.time - currentTime) * NOTE_SPEED)} 
            currentTime={currentTime}
          />
      ))}
    </>
  );
};

export default GameScene;
