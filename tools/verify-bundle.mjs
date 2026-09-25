// tools/verify-bundle.mjs
//
// Verifies that build/DRACOLoader.min.js decodes byte-identically to the
// readable build/DRACOLoader.js. The readable build is a faithful bundle of
// src/ (which tools/bench.mjs validates against a baseline), so if the minified
// bundle matches the readable one on every sample, the minifier preserved
// semantics. Run after any change to tools/mangle.js or the build config:
//
//   npm run build && node tools/verify-bundle.mjs
//
// Decodes the pure .drc samples plus every KHR_draco primitive in the .glb
// samples (same extraction as tools/bench.mjs) through both bundles' public
// DRACOLoader.decodeGeometry API and compares a hash of the resulting
// three.js BufferGeometry (index + every attribute array).

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { DRACOLoader as ReadableLoader } from '../build/DRACOLoader.js';
import { DRACOLoader as MinLoader } from '../build/DRACOLoader.min.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SAMPLES_DIR = path.join(__dirname, '..', 'samples');

const SAMPLES = [
  'cube.drc', 'cube-edgebreaker.drc', 'duck.drc', 'bunny.drc',
  'gears.glb', 'forest_house.glb', 'rolex.glb', 'ferrari.glb',
];

const GLB_MAGIC = 0x46546c67;
const GLB_CHUNK_JSON = 0x4e4f534a;
const GLB_CHUNK_BIN = 0x004e4942;

// Returns ArrayBuffers of the Draco payloads in a sample (.drc -> one,
// .glb -> one per KHR_draco_mesh_compression primitive).
function readSample(name) {
  const buf = fs.readFileSync(path.join(SAMPLES_DIR, name));
  const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  if (!name.endsWith('.glb')) return [u8.slice().buffer];

  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== GLB_MAGIC) throw new Error(`${name}: not a GLB`);
  const total = dv.getUint32(8, true);
  let off = 12;
  let json = null;
  let binOff = 0;
  while (off < total) {
    const clen = dv.getUint32(off, true);
    const ctype = dv.getUint32(off + 4, true);
    off += 8;
    if (ctype === GLB_CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(u8.subarray(off, off + clen)));
    else if (ctype === GLB_CHUNK_BIN) binOff = off;
    off += clen;
  }
  const buffers = [];
  for (const mesh of json.meshes) {
    for (const prim of mesh.primitives) {
      const ext = prim.extensions && prim.extensions.KHR_draco_mesh_compression;
      if (!ext) continue;
      const bv = json.bufferViews[ext.bufferView];
      const start = binOff + (bv.byteOffset || 0);
      buffers.push(u8.slice(start, start + bv.byteLength).buffer);
    }
  }
  return buffers;
}

function hashGeometry(geom) {
  const h = crypto.createHash('sha256');
  if (geom.index) h.update(Buffer.from(geom.index.array.buffer, geom.index.array.byteOffset, geom.index.array.byteLength));
  for (const name of Object.keys(geom.attributes).sort()) {
    const a = geom.attributes[name];
    h.update(name);
    h.update(Buffer.from(a.array.buffer, a.array.byteOffset, a.array.byteLength));
  }
  return h.digest('hex');
}

async function decodeAll(LoaderClass, buffers) {
  // Supply the public configuration from outside the bundle. Its keys must
  // survive property mangling, just like the public method names.
  const loader = new LoaderClass();
  const hashes = [];
  for (const ab of buffers) {
    const geom = await loader.decodeGeometry(ab, {
      attributeIDs: loader.defaultAttributeIDs,
      attributeTypes: loader.defaultAttributeTypes,
      useUniqueIDs: false,
      vertexColorSpace: 'srgb-linear',
    });
    if (!geom.attributes.position?.count) throw new Error('Missing decoded position attribute');
    hashes.push(hashGeometry(geom));
    geom.dispose();
  }
  loader.dispose();
  return hashes;
}

let anyFail = false;
for (const name of SAMPLES) {
  const buffers = readSample(name);
  const readable = await decodeAll(ReadableLoader, buffers);
  const min = await decodeAll(MinLoader, buffers);
  const ok = readable.length === min.length && readable.every((hsh, i) => hsh === min[i]);
  if (!ok) anyFail = true;
  console.log(`${ok ? 'OK    ' : 'FAIL  '}${name.padEnd(24)} R:${readable[0].slice(0, 8)} M:${min[0].slice(0, 8)}`);
}

if (anyFail) {
  console.error('\n*** Minified bundle decodes DIFFERENTLY from readable bundle ***');
  process.exit(1);
}
console.log('\nMinified bundle matches readable bundle on every sample.');
