/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/


import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { HandType, COLORS } from '../types';

interface SaberProps {
  type: HandType;
  positionRef: React.MutableRefObject<THREE.Vector3 | null>;
  velocityRef: React.MutableRefObject<THREE.Vector3 | null>;
}

const Saber: React.FC<SaberProps> = ({ type, positionRef, velocityRef }) => {
  const meshRef = useRef<THREE.Group>(null);
  const trailRef = useRef<THREE.Mesh>(null);
  const bladeGlowRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const saberLength = 1.0; 
  
  const trailPositions = useRef<THREE.Vector3[]>([]);
  const maxTrailLength = 20;

  const targetRotation = useRef(new THREE.Euler());

  useFrame((state, delta) => {
    if (!meshRef.current) return;
    
    const targetPos = positionRef.current;
    const velocity = velocityRef.current;

    if (targetPos) {
      meshRef.current.visible = true;
      meshRef.current.position.lerp(targetPos, 0.6);
      
      const restingX = -Math.PI / 3.5;
      const restingY = 0;
      const restingZ = type === 'left' ? 0.2 : -0.2; 

      let swayX = 0;
      let swayY = 0;
      let swayZ = 0;

      let speed = 0;
      if (velocity) {
          swayX = velocity.y * 0.05; 
          swayZ = -velocity.x * 0.05;
          swayX += velocity.z * 0.02;
          speed = velocity.length();
      }

      targetRotation.current.set(
          restingX + swayX,
          restingY + swayY,
          restingZ + swayZ
      );

      meshRef.current.rotation.x = THREE.MathUtils.lerp(meshRef.current.rotation.x, targetRotation.current.x, 0.3);
      meshRef.current.rotation.y = THREE.MathUtils.lerp(meshRef.current.rotation.y, targetRotation.current.y, 0.3);
      meshRef.current.rotation.z = THREE.MathUtils.lerp(meshRef.current.rotation.z, targetRotation.current.z, 0.3);

      // Speed-based glow intensity
      const glowIntensity = 3 + Math.min(speed * 0.5, 6);
      if (bladeGlowRef.current) {
        const mat = bladeGlowRef.current.material as THREE.MeshStandardMaterial;
        mat.emissiveIntensity = glowIntensity;
      }
      if (lightRef.current) {
        lightRef.current.intensity = 2 + Math.min(speed * 0.3, 4);
      }

      // Idle breathing effect
      if (speed < 0.5) {
        const breathe = Math.sin(state.clock.elapsedTime * 3) * 0.02;
        meshRef.current.position.y += breathe;
      }
      
      const tipWorldPos = meshRef.current.localToWorld(new THREE.Vector3(0, saberLength / 2, 0));
      trailPositions.current.push(tipWorldPos);
      if (trailPositions.current.length > maxTrailLength) {
        trailPositions.current.shift();
      }
      
      if (trailRef.current && trailPositions.current.length > 1) {
        const geometry = trailRef.current.geometry as THREE.BufferGeometry;
        const positions = new Float32Array(trailPositions.current.length * 3);
        trailPositions.current.forEach((pos, i) => {
          positions[i * 3] = pos.x;
          positions[i * 3 + 1] = pos.y;
          positions[i * 3 + 2] = pos.z;
        });
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.computeBoundingSphere();
        // Only show trail when moving fast enough
        trailRef.current.visible = speed > 0.8;
      }

    } else {
      meshRef.current.visible = false;
      trailPositions.current = [];
      if (trailRef.current) trailRef.current.visible = false;
    }
  });

  const color = type === 'left' ? COLORS.left : COLORS.right;

  return (
    <>
    <group ref={meshRef}>
      {/* --- HANDLE ASSEMBLY --- */}
      {/* Main Grip (Dark Grey/Black) */}
      <mesh position={[0, -0.06, 0]}>
        <cylinderGeometry args={[0.02, 0.02, 0.12, 16]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.6} metalness={0.8} />
      </mesh>
      
      {/* Pommel (Bottom Cap) */}
      <mesh position={[0, -0.13, 0]}>
        <cylinderGeometry args={[0.025, 0.025, 0.02, 16]} />
        <meshStandardMaterial color="#888" roughness={0.3} metalness={1} />
      </mesh>

      {/* Grip Accents (Metallic Rings) */}
      <mesh position={[0, -0.08, 0]}>
         <torusGeometry args={[0.021, 0.002, 8, 24]} />
         <meshStandardMaterial color="#aaa" roughness={0.2} metalness={1} />
      </mesh>
       <mesh position={[0, -0.04, 0]}>
         <torusGeometry args={[0.021, 0.002, 8, 24]} />
         <meshStandardMaterial color="#aaa" roughness={0.2} metalness={1} />
      </mesh>

      {/* Emitter Guard (Top metallic part where blade comes out) */}
      <mesh position={[0, 0.01, 0]}>
        <cylinderGeometry args={[0.035, 0.025, 0.05, 16]} />
        <meshStandardMaterial color="#C0C0C0" roughness={0.2} metalness={1} />
      </mesh>

      {/* Emitter Glow Ring */}
      <mesh position={[0, 0.036, 0]} rotation={[Math.PI/2, 0, 0]}>
        <ringGeometry args={[0.015, 0.03, 32]} />
        <meshBasicMaterial color={color} toneMapped={false} side={THREE.DoubleSide} />
      </mesh>


      {/* --- BLADE ASSEMBLY --- */}
      {/* Inner Core (Bright White) */}
      <mesh position={[0, 0.05 + saberLength / 2, 0]}>
        <cylinderGeometry args={[0.008, 0.008, saberLength, 12]} />
        <meshBasicMaterial color="white" toneMapped={false} />
      </mesh>

      {/* Outer Glow (Colored) */}
      <mesh ref={bladeGlowRef} position={[0, 0.05 + saberLength / 2, 0]}>
        <capsuleGeometry args={[0.02, saberLength, 16, 32]} />
        <meshStandardMaterial 
          color={color} 
          emissive={color} 
          emissiveIntensity={4}
          toneMapped={false}
          transparent
          opacity={0.6}
          roughness={0.1}
          metalness={0}
        />
      </mesh>
      
      {/* Interactive Light */}
      <pointLight ref={lightRef} color={color} intensity={2} distance={3} decay={2} position={[0, 0.5, 0]} />
    </group>
    
    {/* Motion Trail */}
    {/* @ts-ignore - R3F line element conflicts with SVG line type */}
    <line ref={trailRef}>
      <bufferGeometry />
      <lineBasicMaterial
        color={color}
        transparent
        opacity={0.4}
        linewidth={3}
      />
    </line>
    </>
  );
};

export default Saber;
