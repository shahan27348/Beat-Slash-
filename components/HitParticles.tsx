/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useRef, useMemo, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { HandType, COLORS, Judgement } from '../types';

interface ParticleData {
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  life: number;
  maxLife: number;
  size: number;
}

interface HitParticlesProps {
  particlesRef: React.MutableRefObject<Array<{
    position: THREE.Vector3;
    type: HandType;
    judgement: Judgement;
  }>>;
}

const MAX_PARTICLES = 500;
const PARTICLES_PER_HIT: Record<Judgement, number> = { perfect: 42, great: 30, good: 18 };

const HitParticles: React.FC<HitParticlesProps> = ({ particlesRef }) => {
  const pools = useRef<Record<HandType, ParticleData[]>>({ left: [], right: [] });
  // Recycled particle objects so bursts don't churn the garbage collector.
  const freeList = useRef<ParticleData[]>([]);
  const leftMeshRef = useRef<THREE.InstancedMesh>(null);
  const rightMeshRef = useRef<THREE.InstancedMesh>(null);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  const materials = useMemo(() => ({
    left: new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.left).multiplyScalar(2.5), toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
    right: new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS.right).multiplyScalar(2.5), toneMapped: false, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }),
  }), []);
  const geometry = useMemo(() => new THREE.OctahedronGeometry(0.1, 0), []);
  useEffect(() => () => { materials.left.dispose(); materials.right.dispose(); geometry.dispose(); }, [materials, geometry]);

  const update = (particles: ParticleData[], mesh: THREE.InstancedMesh | null, delta: number) => {
    if (!mesh) return;
    let count = 0;
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.velocity.y -= 9.8 * delta;
      p.velocity.multiplyScalar(Math.exp(-delta * 1.5)); // air drag
      p.position.addScaledVector(p.velocity, delta);
      p.life += delta;

      if (p.life >= p.maxLife) {
        particles[i] = particles[particles.length - 1];
        particles.pop();
        freeList.current.push(p);
        continue;
      }

      if (count < MAX_PARTICLES) {
        const k = 1 - p.life / p.maxLife;
        dummy.position.copy(p.position);
        // Stretch along velocity for a spark look.
        dummy.scale.set(p.size * k, p.size * k * (1 + p.velocity.length() * 0.12), p.size * k);
        dummy.rotation.set(0, 0, Math.atan2(p.velocity.y, p.velocity.x) - Math.PI / 2);
        dummy.updateMatrix();
        mesh.setMatrixAt(count++, dummy.matrix);
      }
    }
    mesh.count = count;
    mesh.instanceMatrix.needsUpdate = true;
  };

  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);

    while (particlesRef.current.length > 0) {
      const { position, type, judgement } = particlesRef.current.shift()!;
      const n = PARTICLES_PER_HIT[judgement];
      const speed = judgement === 'perfect' ? 7.5 : judgement === 'great' ? 6 : 4;
      const target = pools.current[type];

      for (let i = 0; i < n && target.length < MAX_PARTICLES; i++) {
        const angle = (Math.PI * 2 * i) / n + Math.random() * 0.3;
        const v = speed * (0.4 + Math.random() * 0.6);
        const p = freeList.current.pop() ?? { position: new THREE.Vector3(), velocity: new THREE.Vector3(), life: 0, maxLife: 0, size: 1 };
        p.position.copy(position);
        p.velocity.set(Math.cos(angle) * v, Math.sin(angle) * v + 2, (Math.random() - 0.5) * 3);
        p.life = 0;
        p.maxLife = 0.4 + Math.random() * 0.4;
        p.size = 0.6 + Math.random() * 0.8;
        target.push(p);
      }
    }

    update(pools.current.left, leftMeshRef.current, delta);
    update(pools.current.right, rightMeshRef.current, delta);
  });

  return (
    <>
      <instancedMesh ref={leftMeshRef} args={[geometry, materials.left, MAX_PARTICLES]} frustumCulled={false} />
      <instancedMesh ref={rightMeshRef} args={[geometry, materials.right, MAX_PARTICLES]} frustumCulled={false} />
    </>
  );
};

export default HitParticles;
