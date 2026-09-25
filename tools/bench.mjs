// tools/bench.mjs
//
// Headless decode benchmark + correctness-regression harness for the pure-JS
// Draco decoder. The core decoder (src/compression/Decode.js) has no `three`
// dependency, so it runs directly in Node without installing anything.
//
//   node tools/bench.mjs           # time decode + check output vs baseline
//   node tools/bench.mjs --save    # (re)write the correctness baseline
//   node tools/bench.mjs --wasm    # also time the draco3d WASM decoder (adds a JS× speedup column)
//
// For each sample it prints ms/decode, faces/points and MB/s, plus a sha256 of
// the fully decoded geometry (face indices + every attribute's per-point values,
// exactly what DRACOLoader emits). The hash lets a run assert the result is
// byte-identical to a saved baseline so an optimization can't silently change
// output. The .glb samples embed Draco buffers but need glTF parsing, so the
// harness uses the pure .drc files only.

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { performance } from 'perf_hooks';
import { DecoderBuffer } from '../src/core/DecoderBuffer.js';
import { Decoder } from '../src/compression/Decode.js';
import { AttributeArrays } from '../src/attributes/PointAttribute.js';
import { EncodedGeometryType } from '../src/compression/config/CompressionShared.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SAMPLES_DIR = path.join(ROOT, 'samples');
const BASELINE_FILE = path.join(__dirname, 'bench-baseline.json');

// (file, timed-iteration count) — more iterations for tiny meshes to stabilise.
// Pure .drc files hold one mesh; .glb files embed one or more Draco buffers via
// the KHR_draco_mesh_compression extension (broader topology coverage: normals,
// texcoords, multiple primitives) which we extract and decode the same way.
const SAMPLES = [
  ['cube.drc', 2000],
  ['cube-edgebreaker.drc', 2000],
  ['duck.drc', 500],
  ['bunny.drc', 200],
  ['gears.glb', 200],
  ['forest_house.glb', 100],
  ['rolex.glb', 60],
  ['ferrari.glb', 30], // 51 primitives, ~358k faces — large clean stress test
];

const GLB_MAGIC = 0x46546c67;
const GLB_CHUNK_JSON = 0x4e4f534a;
const GLB_CHUNK_BIN = 0x004e4942;

// Returns the list of Draco-compressed buffers (one Uint8Array per primitive)
// for a sample. .drc -> a single buffer; .glb -> every KHR_draco primitive.
function readSample(name) {
  const buf = fs.readFileSync(path.join(SAMPLES_DIR, name));
  const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  if (!name.endsWith('.glb')) return [u8];

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
    if (ctype === GLB_CHUNK_JSON) {
      json = JSON.parse(new TextDecoder().decode(u8.subarray(off, off + clen)));
    } else if (ctype === GLB_CHUNK_BIN) {
      binOff = off;
    }
    off += clen;
  }
  const buffers = [];
  for (const mesh of json.meshes) {
    for (const prim of mesh.primitives) {
      const ext = prim.extensions && prim.extensions.KHR_draco_mesh_compression;
      if (!ext) continue;
      const bv = json.bufferViews[ext.bufferView];
      const start = binOff + (bv.byteOffset || 0);
      buffers.push(u8.subarray(start, start + bv.byteLength));
    }
  }
  if (buffers.length === 0) throw new Error(`${name}: no Draco primitives`);
  return buffers;
}

// Decode one buffer into a Mesh/PointCloud. The encoded input is only read, so
// the same Uint8Array can be reused across iterations with a fresh buffer view.
// The source decoder now retains portable records. Include original-value
// materialization in this historical core-decode benchmark so deferred work is
// not silently excluded. Public loader benchmarks additionally include mapping
// to point order and requested output types.
function materialize(geom) {
  geom._materializedAttributes = [];
  for (let i = 0; i < geom.numAttributes(); i++) {
    const att = geom.attribute(i);
    geom._materializedAttributes.push(att.extractTo(AttributeArrays[att.dataType] || Float64Array, att.size, null));
  }
  return geom;
}

function decode(u8) {
  const db = new DecoderBuffer();
  db.init(u8, u8.length);
  const type = Decoder.getEncodedGeometryType(db);
  const decoder = new Decoder();
  if (type === EncodedGeometryType.TRIANGULAR_MESH) {
    const r = decoder.decodeMeshFromBuffer(db);
    if (!r.ok) throw new Error(r.message);
    return { geom: materialize(r.mesh), isMesh: true };
  }
  const r = decoder.decodePointCloudFromBuffer(db);
  if (!r.ok) throw new Error(r.message);
  return { geom: materialize(r.pointCloud), isMesh: false };
}

// Decode one buffer with the draco3d WASM reference, then free the WASM-side
// objects. Used only by --wasm to time WASM decode under the same loop as JS.
function decodeWASM(module, decoder, u8) {
  const buffer = new module.DecoderBuffer();
  buffer.Init(new Int8Array(u8.buffer, u8.byteOffset, u8.byteLength), u8.byteLength);
  const type = decoder.GetEncodedGeometryType(buffer);
  let geom;
  if (type === module.TRIANGULAR_MESH) {
    geom = new module.Mesh();
    decoder.DecodeBufferToMesh(buffer, geom);
  } else {
    geom = new module.PointCloud();
    decoder.DecodeBufferToPointCloud(buffer, geom);
  }
  module.destroy(buffer);
  module.destroy(geom);
}

// Hash the complete decoded result. Values go through a Float64Array, which
// exactly represents the FLOAT32 / INT32 attribute values, so an identical
// decode always yields an identical digest.
function hashGeometry(geom, isMesh) {
  const h = crypto.createHash('sha256');
  const numPoints = geom.numPoints();
  const numAttributes = geom.numAttributes();
  const numFaces = isMesh ? geom.numFaces() : 0;
  h.update(Buffer.from(Int32Array.from([isMesh ? 1 : 0, numFaces, numPoints, numAttributes]).buffer));

  if (isMesh) {
    const faces = new Int32Array(numFaces * 3);
    for (let i = 0; i < numFaces; i++) {
      const f = geom.face(i);
      faces[i * 3] = f[0];
      faces[i * 3 + 1] = f[1];
      faces[i * 3 + 2] = f[2];
    }
    h.update(Buffer.from(faces.buffer));
  }

  for (let a = 0; a < numAttributes; a++) {
    const att = geom.attribute(a);
    const nc = att ? att.numComponents : 0;
    const hasBuf = att && att.values !== null;
    // Hash structural metadata always (so a present->absent change is caught),
    // then the per-point values when the attribute is actually backed by data.
    h.update(Buffer.from(Int32Array.from([
      att ? att.uniqueId : -1, att ? att.attributeType : -1, nc, hasBuf ? 1 : 0,
    ]).buffer));
    if (!hasBuf) continue;
    const vals = att.extractTo(Float64Array, numPoints);
    h.update(Buffer.from(vals.buffer));
  }
  return h.digest('hex');
}

async function main() {
  const save = process.argv.includes('--save');
  const withWasm = process.argv.includes('--wasm');
  const baseline = fs.existsSync(BASELINE_FILE)
    ? JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'))
    : null;
  const results = {};
  let anyFail = false;

  let wasmMod = null;
  let wasmDecoder = null;
  if (withWasm) {
    const draco3d = (await import('draco3d')).default;
    wasmMod = await draco3d.createDecoderModule({});
    wasmDecoder = new wasmMod.Decoder();
  }

  console.log('sample'.padEnd(26) + 'ms/decode'.padStart(11) + 'MB/s'.padStart(9) +
    (withWasm ? 'JS×'.padStart(8) : '') + '   faces/points            check');
  console.log('-'.repeat(80));

  for (const [name, iters] of SAMPLES) {
    const buffers = readSample(name);
    const bytes = buffers.reduce((s, b) => s + b.length, 0);

    // Warmup (let the JIT settle) + correctness snapshot over all primitives.
    const h = crypto.createHash('sha256');
    let nf = 0;
    let np = 0;
    let empty = 0;
    for (const u8 of buffers) {
      let last;
      for (let i = 0; i < 25; i++) last = decode(u8);
      h.update(hashGeometry(last.geom, last.isMesh));
      const f = last.isMesh ? last.geom.numFaces() : 0;
      const pts = last.geom.numPoints();
      nf += f;
      np += pts;
      if (f === 0 && pts === 0) empty++;
    }
    const hash = h.digest('hex');

    // Timed loop (decode every primitive in the sample, once per iteration).
    const t0 = performance.now();
    for (let i = 0; i < iters; i++) {
      for (const u8 of buffers) decode(u8);
    }
    const ms = (performance.now() - t0) / iters;

    // Optional: time the WASM decoder over the same buffers/iterations so the
    // JS× speedup ratio is reproducible (JS× = WASM ms / JS ms; >1 means JS is
    // faster). Warm up first, mirroring the JS warmup above.
    let speedupTag = '';
    if (withWasm) {
      for (let i = 0; i < 25; i++) for (const u8 of buffers) decodeWASM(wasmMod, wasmDecoder, u8);
      const w0 = performance.now();
      for (let i = 0; i < iters; i++) {
        for (const u8 of buffers) decodeWASM(wasmMod, wasmDecoder, u8);
      }
      const wms = (performance.now() - w0) / iters;
      speedupTag = (wms / ms).toFixed(2).padStart(7) + '×';
    }

    const mbps = (bytes / 1024 / 1024) / (ms / 1000);
    results[name] = hash;

    let status = 'baseline';
    if (baseline && baseline[name] !== undefined) {
      const ok = baseline[name] === hash;
      status = ok ? 'OK' : 'CHANGED';
      if (!ok) anyFail = true;
    }
    const emptyTag = empty > 0 ? ` (${empty} empty)` : '';
    console.log(
      name.padEnd(26) +
      ms.toFixed(3).padStart(11) +
      mbps.toFixed(1).padStart(9) +
      speedupTag +
      `   ${nf}/${np}${emptyTag}`.padEnd(26) +
      `  ${status} ${hash.slice(0, 12)}`
    );
  }

  if (withWasm) wasmMod.destroy(wasmDecoder);

  if (save || !baseline) {
    fs.writeFileSync(BASELINE_FILE, JSON.stringify(results, null, 2) + '\n');
    console.log(`\nWrote correctness baseline -> ${path.relative(ROOT, BASELINE_FILE)}`);
  } else if (anyFail) {
    console.error('\n*** OUTPUT CHANGED vs baseline — decode is no longer byte-identical ***');
    process.exit(1);
  } else {
    console.log('\nAll outputs match baseline.');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
