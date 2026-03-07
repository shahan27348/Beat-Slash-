/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { HandType, COLORS } from '../types';

interface ParticleData {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
}

interface HitParticlesProps {
  particlesRef: React.MutableRefObject<Array<{
    position: THREE.Vector3;
    type: HandType;
    goodCut: boolean;
  }>>;
}

const HitParticles: React.FC<HitParticlesProps> = ({ particlesRef }) => {
  const leftParticlesRef = useRef<ParticleData[]>([]);
  const rightParticlesRef = useRef<ParticleData[]>([]);
  
  const leftMeshRef = useRef<THREE.InstancedMesh>(null);
  const rightMeshRef = useRef<THREE.InstancedMesh>(null);
  
  const maxParticles = 600;
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useFrame((state, delta) => {
    // Spawn new particles from queue
    while (particlesRef.current.length > 0) {
      const { position, type, goodCut } = particlesRef.current.shift()!;
      const particleCount = goodCut ? 40 : 20;
      
      const targetArray = type === 'left' ? leftParticlesRef.current : rightParticlesRef.current;
      
      for (let i = 0; i < particleCount; i++) {
        const angle = (Math.PI * 2 * i) / particleCount;
        const speed = goodCut ? 7 : 4;
        const spread = goodCut ? 2 : 1.2;
        
        targetArray.push({
          position: position.clone(),
          velocity: new THREE.Vector3(
            Math.cos(angle) * speed * (0.5 + Math.random() * 0.5),
            Math.sin(angle) * speed * (0.5 + Math.random() * 0.5) + 2,
            (Math.random() - 0.5) * spread
          ),
          life: 0,
          maxLife: 0.5 + Math.random() * 0.3
        });
      }
    }

    // Update and render left particles
    updateParticles(leftParticlesRef.current, leftMeshRef.current, delta, dummy, COLORS.left);
    
    // Update and render right particles
    updateParticles(rightParticlesRef.current, rightMeshRef.current, delta, dummy, COLORS.right);
  });

  const updateParticles = (
    particles: ParticleData[],
    mesh: THREE.InstancedMesh | null,
    delta: number,
    dummy: THREE.Object3D,
    color: string
  ) => {
    if (!mesh) return;
    
    let activeCount = 0;
    
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      
      // Update physics
      p.velocity.y -= 9.8 * delta; // Gravity
      p.position.addScaledVector(p.velocity, delta);
      p.life += delta;
      
      if (p.life >= p.maxLife) {
        particles.splice(i, 1);
        continue;
      }
      
      // Render
      if (activeCount < maxParticles) {
        const scale = (1 - p.life / p.maxLife) * 0.15;
        dummy.position.copy(p.position);
        dummy.scale.setScalar(scale);
        dummy.updateMatrix();
        mesh.setMatrixAt(activeCount, dummy.matrix);
        activeCount++;
      }
    }
    
    mesh.count = activeCount;
    mesh.instanceMatrix.needsUpdate = true;
  };

  return (
    <>
      {/* Left hand particles */}
      <instancedMesh ref={leftMeshRef} args={[undefined, undefined, maxParticles]}>
        <sphereGeometry args={[0.1, 8, 8]} />
        <meshStandardMaterial color={COLORS.left} emissive={COLORS.left} emissiveIntensity={2} toneMapped={false} transparent opacity={0.9} />
      </instancedMesh>
      
      {/* Right hand particles */}
      <instancedMesh ref={rightMeshRef} args={[undefined, undefined, maxParticles]}>
        <sphereGeometry args={[0.1, 8, 8]} />
        <meshStandardMaterial color={COLORS.right} emissive={COLORS.right} emissiveIntensity={2} toneMapped={false} transparent opacity={0.9} />
      </instancedMesh>
    </>
  );
};

export default HitParticles;
