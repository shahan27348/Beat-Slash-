/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { NoteData, COLORS, HandType } from '../types';
import { LANE_X_POSITIONS, LAYER_Y_POSITIONS, NOTE_SIZE, PLAYER_Z, SPAWN_Z } from '../constants';

interface NoteProps {
  data: NoteData;
  noteSpeed: number;
  timeRef: React.MutableRefObject<number>;
}

const HIT_DURATION = 0.6;
const MISS_DURATION = 0.4;
const SHARD_COUNT = 10;

// ---------------------------------------------------------------------------
// Shared GPU resources. Creating geometry per note caused hitches every time a note spawned.
// ---------------------------------------------------------------------------
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
const BODY_GEOMETRY = new THREE.ExtrudeGeometry(SPARK_SHAPE, EXTRUDE_SETTINGS).center();
const WIRE_GEOMETRY = new THREE.ExtrudeGeometry(SPARK_SHAPE, { ...EXTRUDE_SETTINGS, depth: EXTRUDE_SETTINGS.depth * 1.1, bevelSegments: 1 }).center();
const CORE_GEOMETRY = new THREE.OctahedronGeometry(NOTE_SIZE * 0.2, 0);
const SHARD_GEOMETRY = new THREE.OctahedronGeometry(NOTE_SIZE * 0.16, 0);
const FLASH_GEOMETRY = new THREE.SphereGeometry(NOTE_SIZE * 0.9, 16, 12);
const RING_GEOMETRY = new THREE.RingGeometry(NOTE_SIZE * 0.8, NOTE_SIZE * 0.95, 40);

const CORE_MATERIAL = new THREE.MeshBasicMaterial({ color: 'white', toneMapped: false, transparent: true, opacity: 0.9 });
const MISS_COLOR = new THREE.Color('#3a3a44');

const makeColorMaterials = (hex: string) => ({
  wire: new THREE.MeshBasicMaterial({ color: hex, wireframe: true, transparent: true, opacity: 0.35, depthWrite: false }),
  shard: new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(2.2), toneMapped: false }),
});
const SHARED: Record<HandType, ReturnType<typeof makeColorMaterials>> = {
  left: makeColorMaterials(COLORS.left),
  right: makeColorMaterials(COLORS.right),
};

const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

const Note: React.FC<NoteProps> = ({ data, noteSpeed, timeRef }) => {
  const color = data.type === 'left' ? COLORS.left : COLORS.right;
  const shared = SHARED[data.type];

  const rootRef = useRef<THREE.Group>(null);
  const bodyRef = useRef<THREE.Group>(null);
  const shardsRef = useRef<THREE.Group>(null);
  const flashRef = useRef<THREE.Mesh>(null);
  const ringRef = useRef<THREE.Mesh>(null);
  const missStyled = useRef(false);

  // Per-note materials only for things that animate independently (cheap: they share one shader program).
  const materials = useMemo(() => ({
    body: new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.8, roughness: 0.25, metalness: 0.2, transparent: true }),
    flash: new THREE.MeshBasicMaterial({ color: 'white', transparent: true, toneMapped: false, depthWrite: false }),
    ring: new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(2), transparent: true, toneMapped: false, side: THREE.DoubleSide, depthWrite: false }),
  }), [color]);
  useEffect(() => () => { materials.body.dispose(); materials.flash.dispose(); materials.ring.dispose(); }, [materials]);

  // Random outward directions for the debris, biased perpendicular to the cut.
  const shardDirs = useMemo(() => Array.from({ length: SHARD_COUNT }, () => new THREE.Vector3(
    Math.random() - 0.5, Math.random() - 0.5, (Math.random() - 0.5) * 0.6,
  ).normalize()), []);

  const baseX = LANE_X_POSITIONS[data.lineIndex];
  const baseY = LAYER_Y_POSITIONS[data.lineLayer];

  useFrame((state) => {
    const root = rootRef.current;
    const body = bodyRef.current;
    if (!root || !body) return;
    const t = timeRef.current;

    if (data.hit && data.hitTime !== undefined) {
      const dt = t - data.hitTime;
      const zHit = PLAYER_Z - (data.time - data.hitTime) * noteSpeed;
      root.position.set(baseX, baseY, zHit + dt * noteSpeed * 0.25);
      body.visible = false;

      const shards = shardsRef.current;
      if (shards) {
        shards.visible = true;
        const life = Math.max(0, 1 - dt / HIT_DURATION);
        const cut = data.cutDir;
        // Pieces fly apart perpendicular to the swing and drift along it.
        const px = cut ? -cut.y : 0, py = cut ? cut.x : 1;
        shards.children.forEach((shard, i) => {
          const d = shardDirs[i];
          const side = (d.x * px + d.y * py) >= 0 ? 1 : -1;
          const spread = dt * 4.5;
          shard.position.set(
            d.x * spread + px * side * spread * 0.8 + (cut?.x ?? 0) * dt * 2,
            d.y * spread + py * side * spread * 0.8 + (cut?.y ?? 0) * dt * 2 - dt * dt * 6,
            d.z * spread,
          );
          shard.rotation.set(dt * 14 + i, dt * 10 + i * 2, 0);
          shard.scale.setScalar(life);
        });
      }

      if (flashRef.current) {
        const f = Math.min(1, dt / 0.18);
        flashRef.current.visible = f < 1;
        flashRef.current.scale.setScalar(0.6 + f * 2.2);
        materials.flash.opacity = (1 - f) * 0.9;
      }
      if (ringRef.current) {
        const f = Math.min(1, dt / 0.35);
        ringRef.current.visible = f < 1;
        ringRef.current.scale.setScalar(1 + f * 3.5);
        materials.ring.opacity = 1 - f;
      }
      return;
    }

    const z = PLAYER_Z - (data.time - t) * noteSpeed;
    root.position.set(baseX, baseY, z);

    if (data.missed && data.missTime !== undefined) {
      const dt = t - data.missTime;
      if (!missStyled.current) {
        missStyled.current = true;
        materials.body.color.copy(MISS_COLOR);
        materials.body.emissive.copy(MISS_COLOR);
      }
      materials.body.opacity = Math.max(0, 1 - dt / MISS_DURATION);
      root.position.y = baseY - dt * dt * 8;
      body.rotation.x += 0.15;
      return;
    }

    // Approaching: scale in after spawning, spin faster and glow brighter near the player.
    const travel = (z - SPAWN_Z) / (PLAYER_Z - SPAWN_Z);
    const proximity = smoothstep(0.55, 1, travel);
    body.scale.setScalar(smoothstep(0, 0.1, travel) * (1 + proximity * 0.08 * Math.sin(state.clock.elapsedTime * 10)));
    body.rotation.z = state.clock.elapsedTime * (1 + proximity * 2);
    materials.body.emissiveIntensity = 0.7 + proximity * 1.8;
  });

  return (
    <group ref={rootRef} position={[baseX, baseY, SPAWN_Z]}>
      <group ref={bodyRef} scale={0}>
        <mesh geometry={BODY_GEOMETRY} material={materials.body} />
        <mesh geometry={WIRE_GEOMETRY} material={shared.wire} />
        <mesh geometry={CORE_GEOMETRY} material={CORE_MATERIAL} position={[0, 0, NOTE_SIZE * 0.2]} />
      </group>

      <group ref={shardsRef} visible={false}>
        {shardDirs.map((_, i) => (
          <mesh key={i} geometry={SHARD_GEOMETRY} material={shared.shard} />
        ))}
      </group>
      <mesh ref={flashRef} geometry={FLASH_GEOMETRY} material={materials.flash} visible={false} />
      <mesh ref={ringRef} geometry={RING_GEOMETRY} material={materials.ring} visible={false} />
    </group>
  );
};

export default React.memo(Note);
