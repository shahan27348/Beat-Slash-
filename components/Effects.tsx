/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
*/

import React, { useEffect, useMemo } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

/** Neon bloom. Takes over rendering (frame priority 1) while mounted. */
const Effects: React.FC = () => {
  const { gl, scene, camera, size } = useThree();

  const { composer, bloom } = useMemo(() => {
    const composer = new EffectComposer(gl);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.85, 0.55, 0.75);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());
    return { composer, bloom };
  }, [gl, scene, camera]);

  useEffect(() => {
    composer.setPixelRatio(gl.getPixelRatio());
    composer.setSize(size.width, size.height);
    // Bloom is blurry anyway, half resolution keeps it cheap.
    bloom.setSize(Math.round(size.width / 2), Math.round(size.height / 2));
  }, [composer, bloom, gl, size]);

  useEffect(() => () => composer.dispose(), [composer]);

  useFrame((_, delta) => composer.render(delta), 1);
  return null;
};

export default Effects;
