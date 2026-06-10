// tools/mangle.js — rollup plugin that minifies property names aggressively.
//
// terser mangles properties globally by name, so it can't tell our internal
// members from three.js's or built-ins. We mangle everything except a reserved
// "boundary": three's own property names (gathered by INSTANTIATING the classes
// we touch, since instance fields like `normalized` aren't on the prototype), the
// public DRACOLoader API + default attribute names, and every string literal
// (covers data keys compared as strings, e.g. `name === 'color'`). Built-ins are
// protected by terser's own domprops list.

import { minify } from 'terser';
import * as THREE from 'three';

function collectProps(obj, set) {
  for (let o = obj; o && o !== Object.prototype && o !== Function.prototype; o = Object.getPrototypeOf(o)) {
    for (const name of Object.getOwnPropertyNames(o)) set.add(name);
  }
}

const boundary = new Set();
for (const instance of [
  new THREE.BufferGeometry(),
  new THREE.BufferAttribute(new Float32Array(3), 3),
  new THREE.Color(),
  new THREE.FileLoader(),
  new THREE.Loader(),
  THREE.ColorManagement,
]) collectProps(instance, boundary);

// DRACOLoader destructures these names from a dynamic `import('three')`; they
// become property accesses on the module namespace, so reserve exactly the set
// read in src/DRACOLoader.js (keep in sync with the destructure there) —
// otherwise the property mangler renames them and the build breaks.
for (const name of [
  'BufferAttribute', 'BufferGeometry', 'Color', 'ColorManagement',
  'FileLoader', 'Loader', 'LinearSRGBColorSpace', 'SRGBColorSpace'
]) boundary.add(name);

for (const name of [
  // Public DRACOLoader API.
  'load', 'parse', 'parseAsync', 'loadAsync', 'decodeDracoFile', 'decodeGeometry',
  'setDecoderPath', 'setDecoderConfig', 'setWorkerLimit', 'preload', 'dispose',
  'setPath', 'setResourcePath', 'setCrossOrigin', 'setRequestHeader', 'setWithCredentials',
  'defaultAttributeIDs', 'defaultAttributeTypes',
  // Default attribute names — they become three geometry attribute names.
  'position', 'normal', 'color', 'uv',
]) boundary.add(name);

export function mangle() {
  return {
    name: 'mangle',
    async renderChunk(code) {
      const reserved = new Set(boundary);

      // Reserve every string literal in this chunk.
      const ast = this.parse(code);
      (function walk(node) {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'Literal' && typeof node.value === 'string') reserved.add(node.value);
        for (const key in node) {
          const value = node[key];
          if (Array.isArray(value)) { for (const child of value) walk(child); }
          else if (value && typeof value === 'object' && typeof value.type === 'string') walk(value);
        }
      })(ast);

      const result = await minify(code, {
        module: true,
        compress: {
          passes: 3,
          ecma: 2020,
          pure_getters: true,   // our getters are plain field reads — no side effects
          keep_fargs: false,    // nothing relies on Function.prototype.length
        },
        mangle: { properties: { reserved: [...reserved], keep_quoted: true } },
        format: { comments: /@license/, ecma: 2020 },
      });

      return { code: result.code, map: result.map ?? null };
    },
  };
}
