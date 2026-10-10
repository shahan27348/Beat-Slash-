/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { HandType, HandPositions, COLORS } from '../types';

interface SaberProps {
  type: HandType;
  handPositionsRef: React.MutableRefObject<HandPositions>;
}

const SABER_LENGTH = 1.0;
const TRAIL_SAMPLES = 16;
const BLADE_BASE = new THREE.Vector3(0, 0.15, 0);
const BLADE_TIP = new THREE.Vector3(0, 0.05 + SABER_LENGTH, 0);

/** Fading ribbon swept by the blade, rebuilt from preallocated buffers every frame. */
const useTrail = (color: string) => {
  return useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(TRAIL_SAMPLES * 2 * 3);
    const colors = new Float32Array(TRAIL_SAMPLES * 2 * 3);
    const indices: number[] = [];
    for (let i = 0; i < TRAIL_SAMPLES - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      indices.push(a, b, c, b, d, c);
    }
    geometry.setIndex(indices);
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setDrawRange(0, 0);

    const material = new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });

    const samples = Array.from({ length: TRAIL_SAMPLES }, () => ({ base: new THREE.Vector3(), tip: new THREE.Vector3() }));
    return { geometry, material, positions, colors, samples, count: 0, base: new THREE.Color(color) };
  }, [color]);
};

const Saber: React.FC<SaberProps> = ({ type, handPositionsRef }) => {
  const meshRef = useRef<THREE.Group>(null);
  const bladeGlowRef = useRef<THREE.MeshStandardMaterial>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  const trailMeshRef = useRef<THREE.Mesh>(null);
  const targetRotation = useRef(new THREE.Euler());
  const color = type === 'left' ? COLORS.left : COLORS.right;
  const trail = useTrail(color);

  useEffect(() => () => { trail.geometry.dispose(); trail.material.dispose(); }, [trail]);

  useFrame((state, delta) => {
    const group = meshRef.current;
    if (!group) return;

    const hands = handPositionsRef.current;
    const targetPos = type === 'left' ? hands.left : hands.right;
    const velocity = type === 'left' ? hands.leftVelocity : hands.rightVelocity;

    if (!targetPos) {
      group.visible = false;
      // Lights stay in the scene with zero intensity: adding/removing lights forces shader recompiles (stutter).
      if (lightRef.current) lightRef.current.intensity = 0;
      trail.count = 0;
      trail.geometry.setDrawRange(0, 0);
      return;
    }

    if (!group.visible) {
      // Snap on (re)acquire instead of flying in from the old position.
      group.position.copy(targetPos);
      group.visible = true;
      trail.count = 0;
    } else {
      // Frame-rate independent smoothing between the 30fps camera samples.
      group.position.lerp(targetPos, 1 - Math.exp(-28 * delta));
    }

    const speed = Math.hypot(velocity.x, velocity.y);

    targetRotation.current.set(
      -Math.PI / 3.5 + THREE.MathUtils.clamp(velocity.y * 0.05 + velocity.z * 0.02, -0.6, 0.6),
      0,
      (type === 'left' ? 0.2 : -0.2) + THREE.MathUtils.clamp(-velocity.x * 0.05, -0.6, 0.6),
    );
    const r = 1 - Math.exp(-18 * delta);
    group.rotation.x += (targetRotation.current.x - group.rotation.x) * r;
    group.rotation.y += (targetRotation.current.y - group.rotation.y) * r;
    group.rotation.z += (targetRotation.current.z - group.rotation.z) * r;

    // Speed-based glow
    if (bladeGlowRef.current) bladeGlowRef.current.emissiveIntensity = 3 + Math.min(speed * 0.6, 6);
    if (lightRef.current) {
      lightRef.current.intensity = 1.5 + Math.min(speed * 0.4, 4);
      lightRef.current.position.copy(group.position);
      lightRef.current.position.y += 0.5;
    }

    // Trail: shift samples, newest at index 0.
    group.updateMatrixWorld();
    const s = trail.samples;
    const last = s[TRAIL_SAMPLES - 1];
    for (let i = TRAIL_SAMPLES - 1; i > 0; i--) s[i] = s[i - 1];
    s[0] = last;
    s[0].base.copy(BLADE_BASE).applyMatrix4(group.matrixWorld);
    s[0].tip.copy(BLADE_TIP).applyMatrix4(group.matrixWorld);
    trail.count = Math.min(trail.count + 1, TRAIL_SAMPLES);

    const visibility = THREE.MathUtils.clamp((speed - 0.5) / 2.5, 0, 1);
    const n = trail.count;
    for (let i = 0; i < n; i++) {
      const fade = (1 - i / (n - 1 || 1)) * visibility;
      const o = i * 6;
      trail.positions[o] = s[i].base.x; trail.positions[o + 1] = s[i].base.y; trail.positions[o + 2] = s[i].base.z;
      trail.positions[o + 3] = s[i].tip.x; trail.positions[o + 4] = s[i].tip.y; trail.positions[o + 5] = s[i].tip.z;
      // Additive blending: darker = more transparent. Base fades faster than the tip.
      trail.colors[o] = trail.base.r * fade * 0.15; trail.colors[o + 1] = trail.base.g * fade * 0.15; trail.colors[o + 2] = trail.base.b * fade * 0.15;
      trail.colors[o + 3] = trail.base.r * fade * 0.9; trail.colors[o + 4] = trail.base.g * fade * 0.9; trail.colors[o + 5] = trail.base.b * fade * 0.9;
    }
    trail.geometry.attributes.position.needsUpdate = true;
    trail.geometry.attributes.color.needsUpdate = true;
    trail.geometry.setDrawRange(0, Math.max(0, n - 1) * 6);
    trail.geometry.computeBoundingSphere();
  });

  return (
    <>
      <group ref={meshRef} visible={false}>
        {/* --- HANDLE ASSEMBLY --- */}
        <mesh position={[0, -0.06, 0]}>
          <cylinderGeometry args={[0.02, 0.02, 0.12, 16]} />
          <meshStandardMaterial color="#1a1a1a" roughness={0.6} metalness={0.8} />
        </mesh>
        <mesh position={[0, -0.13, 0]}>
          <cylinderGeometry args={[0.025, 0.025, 0.02, 16]} />
          <meshStandardMaterial color="#888" roughness={0.3} metalness={1} />
        </mesh>
        <mesh position={[0, -0.08, 0]}>
          <torusGeometry args={[0.021, 0.002, 8, 24]} />
          <meshStandardMaterial color="#aaa" roughness={0.2} metalness={1} />
        </mesh>
        <mesh position={[0, -0.04, 0]}>
          <torusGeometry args={[0.021, 0.002, 8, 24]} />
          <meshStandardMaterial color="#aaa" roughness={0.2} metalness={1} />
        </mesh>
        <mesh position={[0, 0.01, 0]}>
          <cylinderGeometry args={[0.035, 0.025, 0.05, 16]} />
          <meshStandardMaterial color="#C0C0C0" roughness={0.2} metalness={1} />
        </mesh>
        <mesh position={[0, 0.036, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <ringGeometry args={[0.015, 0.03, 32]} />
          <meshBasicMaterial color={color} toneMapped={false} side={THREE.DoubleSide} />
        </mesh>

        {/* --- BLADE ASSEMBLY --- */}
        <mesh position={[0, 0.05 + SABER_LENGTH / 2, 0]}>
          <cylinderGeometry args={[0.009, 0.009, SABER_LENGTH, 12]} />
          <meshBasicMaterial color="white" toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.05 + SABER_LENGTH / 2, 0]}>
          <capsuleGeometry args={[0.024, SABER_LENGTH, 8, 16]} />
          <meshStandardMaterial
            ref={bladeGlowRef}
            color={color}
            emissive={color}
            emissiveIntensity={4}
            toneMapped={false}
            transparent
            opacity={0.65}
            roughness={0.1}
            metalness={0}
            depthWrite={false}
          />
        </mesh>
      </group>

      <pointLight ref={lightRef} color={color} intensity={0} distance={3} decay={2} />

      {/* Motion trail lives in world space */}
      <mesh ref={trailMeshRef} geometry={trail.geometry} material={trail.material} frustumCulled={false} />
    </>
  );
};

export default Saber;
