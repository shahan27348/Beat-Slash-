/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import React, { useMemo, useRef } from 'react';
import { Extrude, Octahedron } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { NoteData, COLORS } from '../types';
import { LANE_X_POSITIONS, LAYER_Y_POSITIONS, NOTE_SIZE, PLAYER_Z } from '../constants';

interface NoteProps {
  data: NoteData;
  zPos: number;
  currentTime: number;
}

const createSparkShape = (size: number) => {
  const shape = new THREE.Shape();
  const s = size / 1.8;
  shape.moveTo(0, s);
  shape.quadraticCurveTo(0, 0, s, 0);
  shape.quadraticCurveTo(0, 0, 0, -s);
  shape.quadraticCurveTo(0, 0, -s, 0);
  shape.quadraticCurveTo(0, 0, 0, s);
  return shape;
};

const SPARK_SHAPE = createSparkShape(NOTE_SIZE);
const EXTRUDE_SETTINGS = { depth: NOTE_SIZE * 0.4, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 3 };

const Debris: React.FC<{ data: NoteData, timeSinceHit: number, color: string }> = ({ data, timeSinceHit, color }) => {
    const groupRef = useRef<THREE.Group>(null);
    const flashRef = useRef<THREE.Mesh>(null);

    const flySpeed = 6.0;
    const rotationSpeed = 10.0;
    const distance = flySpeed * timeSinceHit;

    useFrame(() => {
        if (groupRef.current) {
             groupRef.current.scale.setScalar(Math.max(0.01, 1 - timeSinceHit * 1.5));
        }
        if (flashRef.current) {
            const flashDuration = 0.15;
            if (timeSinceHit < flashDuration) {
                const t = timeSinceHit / flashDuration;
                flashRef.current.visible = true;
                flashRef.current.scale.setScalar(1 + t * 5);
                (flashRef.current.material as THREE.MeshBasicMaterial).opacity = 1 - t;
            } else {
                flashRef.current.visible = false;
            }
        }
    });
    
    const Shard = ({ offsetDir, moveDir, scale = 1 }: { offsetDir: number[], moveDir: number[], scale?: number }) => {
        const meshRef = useRef<THREE.Mesh>(null);

        useFrame(() => {
             if (meshRef.current) {
                 meshRef.current.position.x = offsetDir[0] + moveDir[0] * distance;
                 meshRef.current.position.y = offsetDir[1] + moveDir[1] * distance;
                 meshRef.current.position.z = offsetDir[2] + moveDir[2] * distance;

                 meshRef.current.rotation.x += moveDir[1] * 0.1 * rotationSpeed;
                 meshRef.current.rotation.y += moveDir[0] * 0.1 * rotationSpeed;
             }
        });

        return (
            <Octahedron ref={meshRef} args={[NOTE_SIZE * 0.3 * scale]} position={[offsetDir[0], offsetDir[1], offsetDir[2]]}>
                 <meshStandardMaterial color={color} roughness={0.1} metalness={0.9} emissive={color} emissiveIntensity={0.8} />
            </Octahedron>
        )
    }

    return (
        <group ref={groupRef}>
            <mesh ref={flashRef}>
                <sphereGeometry args={[NOTE_SIZE * 1.5, 16, 16]} />
                <meshBasicMaterial color="white" transparent toneMapped={false} />
            </mesh>

            <Shard offsetDir={[0, 0.2, 0]} moveDir={[0, 1.5, -0.5]} scale={0.8} />
            <Shard offsetDir={[0.2, 0, 0]} moveDir={[1.5, 0, -0.5]} scale={0.8} />
            <Shard offsetDir={[0, -0.2, 0]} moveDir={[0, -1.5, -0.5]} scale={0.8} />
            <Shard offsetDir={[-0.2, 0, 0]} moveDir={[-1.5, 0, -0.5]} scale={0.8} />
            
            <Shard offsetDir={[0.1, 0.1, 0.1]} moveDir={[1, 1, 1]} scale={0.5} />
            <Shard offsetDir={[-0.1, -0.1, -0.1]} moveDir={[-1, -1, 1]} scale={0.5} />
        </group>
    );
};

const Note: React.FC<NoteProps> = ({ data, zPos, currentTime }) => {
  const color = data.type === 'left' ? COLORS.left : COLORS.right;
  const groupRef = useRef<THREE.Group>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  
  const position: [number, number, number] = useMemo(() => {
     return [
         LANE_X_POSITIONS[data.lineIndex],
         LAYER_Y_POSITIONS[data.lineLayer],
         zPos
     ];
  }, [data.lineIndex, data.lineLayer, zPos]);

  // Proximity factor: 0 far away, 1 at player
  const proximity = Math.max(0, Math.min(1, 1 - Math.abs(zPos - PLAYER_Z) / 15));

  useFrame((state) => {
    if (groupRef.current && !data.hit && !data.missed) {
      // Gentle spin as notes approach
      groupRef.current.rotation.z = state.clock.elapsedTime * (1 + proximity * 2);
      // Pulse scale based on proximity
      const pulse = 1 + proximity * 0.15 * Math.sin(state.clock.elapsedTime * 6);
      groupRef.current.scale.setScalar(pulse);
    }
    // Increase glow as note approaches
    if (glowRef.current && !data.hit) {
      const mat = glowRef.current.material as THREE.MeshPhysicalMaterial;
      mat.emissiveIntensity = 0.5 + proximity * 1.5;
    }
  });

  if (data.missed) return null;

  if (data.hit && data.hitTime) {
      return (
          <group position={position}>
              <Debris data={data} timeSinceHit={currentTime - data.hitTime} color={color} />
          </group>
      );
  }

  return (
    <group position={position}>
      <group ref={groupRef}>
        <group position={[0, 0, -NOTE_SIZE * 0.2]}>
            <Extrude ref={glowRef} args={[SPARK_SHAPE, EXTRUDE_SETTINGS]} castShadow receiveShadow>
                <meshPhysicalMaterial 
                    color={color} 
                    roughness={0.2} 
                    metalness={0.1}
                    transmission={0.1}
                    thickness={0.5}
                    emissive={color}
                    emissiveIntensity={0.8}
                />
            </Extrude>
        </group>
      </group>
      
      {/* Inner Core Glow */}
      <mesh position={[0, 0, NOTE_SIZE * 0.1]}>
         <octahedronGeometry args={[NOTE_SIZE * 0.2, 0]} />
         <meshBasicMaterial color="white" toneMapped={false} transparent opacity={0.8} />
      </mesh>

      {/* Outer Wireframe Glow */}
      <group position={[0, 0, -NOTE_SIZE * 0.2]}>
          <mesh>
             <extrudeGeometry args={[SPARK_SHAPE, { ...EXTRUDE_SETTINGS, depth: EXTRUDE_SETTINGS.depth * 1.1 }]} />
             <meshBasicMaterial color={color} wireframe transparent opacity={0.2 + proximity * 0.3} />
          </mesh>
      </group>

      {/* Proximity point light */}
      {proximity > 0.5 && (
        <pointLight color={color} intensity={proximity * 2} distance={2} decay={2} />
      )}
    </group>
  );
};

export default React.memo(Note, (prev, next) => {
    if (next.data.hit) return false;
    return prev.zPos === next.zPos && prev.data.hit === next.data.hit && prev.data.missed === next.data.missed;
});
