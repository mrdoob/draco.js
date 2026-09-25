// tools/verify-wasm.mjs
//
// WASM-parity test: decode every sample with BOTH the pure-JS decoder and
// Google's reference draco3d WASM decoder, and assert the results are identical
// — face indices exactly, per-point attribute values exactly (with a tiny
// floating-point tolerance reported separately). This is the ground-truth check
// that our optimizations (and the decoder in general) are correct.
//
//   node tools/verify-wasm.mjs            # check all samples
//   node tools/verify-wasm.mjs bunny.drc  # check one sample
//
// Exits non-zero if any primitive diverges from the WASM reference.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { DecoderBuffer } from '../src/core/DecoderBuffer.js';
import { Decoder } from '../src/compression/Decode.js';
import { EncodedGeometryType } from '../src/compression/config/CompressionShared.js';

const require = createRequire(import.meta.url);
const draco3d = require('draco3d');

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SAMPLES_DIR = path.join(ROOT, 'samples');

// Strict: the JS decoder is expected to be BIT-IDENTICAL to the WASM reference
// (all arithmetic is rounded to float32 to match Draco's C++). Any non-zero
// difference is a failure. Raise this only to triage a new divergence.
const FLOAT_EPS = 0;

const GLB_MAGIC = 0x46546c67;
const GLB_CHUNK_JSON = 0x4e4f534a;
const GLB_CHUNK_BIN = 0x004e4942;

// Returns [{buffer, label}] — one Draco buffer per primitive.
function readSample(name) {
  const buf = fs.readFileSync(path.join(SAMPLES_DIR, name));
  const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
  if (!name.endsWith('.glb')) return [{ buffer: u8, label: name }];

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
  const out = [];
  let p = 0;
  for (let m = 0; m < json.meshes.length; m++) {
    for (const prim of json.meshes[m].primitives) {
      const ext = prim.extensions && prim.extensions.KHR_draco_mesh_compression;
      if (!ext) continue;
      const bv = json.bufferViews[ext.bufferView];
      const start = binOff + (bv.byteOffset || 0);
      out.push({ buffer: u8.subarray(start, start + bv.byteLength), label: `${name}#${p++}` });
    }
  }
  return out;
}

function decodeJS(u8) {
  const db = new DecoderBuffer();
  db.init(u8, u8.length);
  const type = Decoder.getEncodedGeometryType(db);
  const decoder = new Decoder();
  if (type === EncodedGeometryType.TRIANGULAR_MESH) {
    const r = decoder.decodeMeshFromBuffer(db);
    return { ok: r.ok, msg: r.message, geom: r.mesh, isMesh: true };
  }
  const r = decoder.decodePointCloudFromBuffer(db);
  return { ok: r.ok, msg: r.message, geom: r.pointCloud, isMesh: false };
}

function decodeWASM(module, decoder, u8) {
  const buffer = new module.DecoderBuffer();
  buffer.Init(new Int8Array(u8.buffer, u8.byteOffset, u8.byteLength), u8.byteLength);
  const type = decoder.GetEncodedGeometryType(buffer);
  let geom;
  let status;
  let isMesh;
  if (type === module.TRIANGULAR_MESH) {
    geom = new module.Mesh();
    status = decoder.DecodeBufferToMesh(buffer, geom);
    isMesh = true;
  } else {
    geom = new module.PointCloud();
    status = decoder.DecodeBufferToPointCloud(buffer, geom);
    isMesh = false;
  }
  const ok = status.ok();
  module.destroy(buffer);
  return { ok, geom, isMesh };
}

// Compares one primitive. Returns { pass, issues: [...], maxFloatDiff }.
function compare(module, decoder, js, wasm) {
  const issues = [];
  let maxFloatDiff = 0;

  // A failed decode must never count as a pass: without this, a JS/WASM error
  // that yields zero points slips through (nothing left to compare).
  if (!js.ok) issues.push(`JS decode failed: ${js.msg}`);
  if (!wasm.ok) issues.push('WASM decode failed');

  const jsPts = js.geom ? js.geom.numPoints() : 0;
  const wPts = wasm.geom.num_points();
  const jsFaces = js.isMesh && js.geom ? js.geom.numFaces() : 0;
  const wFaces = wasm.isMesh ? wasm.geom.num_faces() : 0;

  if (js.isMesh !== wasm.isMesh) issues.push(`geometry type JS=${js.isMesh ? 'mesh' : 'pc'} WASM=${wasm.isMesh ? 'mesh' : 'pc'}`);
  if (jsPts !== wPts) issues.push(`numPoints JS=${jsPts} WASM=${wPts}`);
  if (jsFaces !== wFaces) issues.push(`numFaces JS=${jsFaces} WASM=${wFaces}`);

  // Face indices (exact). Only if counts agree.
  if (wasm.isMesh && js.isMesh && jsFaces === wFaces && wFaces > 0) {
    const ia = new module.DracoInt32Array();
    let faceMismatch = 0;
    for (let i = 0; i < wFaces && faceMismatch < 4; i++) {
      decoder.GetFaceFromMesh(wasm.geom, i, ia);
      const f = js.geom.face(i);
      if (f[0] !== ia.GetValue(0) || f[1] !== ia.GetValue(1) || f[2] !== ia.GetValue(2)) {
        if (faceMismatch === 0) {
          issues.push(`face[${i}] JS=[${f}] WASM=[${ia.GetValue(0)},${ia.GetValue(1)},${ia.GetValue(2)}]`);
        }
        faceMismatch++;
      }
    }
    module.destroy(ia);
    if (faceMismatch) issues.push(`${faceMismatch}+ face mismatches`);
  }

  // Attributes. Match by attribute index: Draco preserves attribute order, so
  // the a-th WASM attribute corresponds to the a-th JS attribute. (Matching by
  // uniqueId is unsafe — old files like cube.drc give every attribute uid=0.)
  // The type/num-components assertion below catches any real ordering divergence.
  if (jsPts === wPts && wPts > 0) {
    const numAttr = wasm.geom.num_attributes();
    if (js.geom.numAttributes() !== numAttr) {
      issues.push(`numAttributes JS=${js.geom.numAttributes()} WASM=${numAttr}`);
    }
    const n = Math.min(numAttr, js.geom.numAttributes());
    for (let a = 0; a < n; a++) {
      const wattr = decoder.GetAttribute(wasm.geom, a);
      const wtype = wattr.attribute_type();
      const nc = wattr.num_components();
      const jAttr = js.geom.attribute(a);
      if (jAttr.attributeType !== wtype || jAttr.numComponents !== nc) {
        issues.push(`attr#${a} mismatch JS(type=${jAttr.attributeType},nc=${jAttr.numComponents}) WASM(type=${wtype},nc=${nc})`);
        continue;
      }
      const wf = new module.DracoFloat32Array();
      decoder.GetAttributeFloatForAllPoints(wasm.geom, wattr, wf);
      // Deferred source attributes materialize through the same typed-array
      // boundary as DRACOLoader. Float64 preserves the old scalar comparison's
      // original values without introducing an extra Float32 conversion.
      const values = jAttr.extractTo(Float64Array, wPts);
      let mism = 0;       // diffs above FLOAT_EPS (real divergence)
      let exact = 0;      // any non-zero diff (incl. float rounding)
      let firstMism = null;
      let attrMaxDiff = 0;
      for (let i = 0; i < wPts; i++) {
        for (let c = 0; c < nc; c++) {
          const jv = values[i * nc + c];
          const wv = wf.GetValue(i * nc + c);
          const d = Math.abs(jv - wv);
          if (d > attrMaxDiff) attrMaxDiff = d;
          if (d !== 0) exact++;
          // Use !(d <= eps) rather than d > eps so a NaN diff (e.g. NaN in the
          // JS output) is caught instead of silently passing the eps-0 check.
          if (!(d <= FLOAT_EPS)) {
            if (!firstMism) firstMism = `attr#${a} type=${wtype} pt${i}.${c} JS=${jv} WASM=${wv}`;
            mism++;
          }
        }
      }
      if (attrMaxDiff > maxFloatDiff) maxFloatDiff = attrMaxDiff;
      if (mism) issues.push(`${firstMism} (+${mism - 1} more, maxDiff=${attrMaxDiff.toExponential(2)})`);
      module.destroy(wf);
    }
  }

  return { pass: issues.length === 0, issues, maxFloatDiff };
}

async function main() {
  const only = process.argv[2];
  const allGlb = fs.readdirSync(SAMPLES_DIR).filter((f) => f.endsWith('.glb')).sort();
  const allDrc = fs.readdirSync(SAMPLES_DIR).filter((f) => f.endsWith('.drc')).sort();
  const sampleNames = only ? [only] : [...allDrc, ...allGlb];

  const module = await draco3d.createDecoderModule({});
  const decoder = new module.Decoder();

  let totalPrims = 0;
  let failPrims = 0;
  let globalMaxFloatDiff = 0;
  const failedSamples = [];

  for (const name of sampleNames) {
    let prims;
    try {
      prims = readSample(name);
    } catch (e) {
      console.log(`${name}: SKIP (${e.message})`);
      continue;
    }
    let samplePass = true;
    const lines = [];
    for (const { buffer, label } of prims) {
      totalPrims++;
      const js = decodeJS(buffer);
      const wasm = decodeWASM(module, decoder, buffer);
      const r = compare(module, decoder, js, wasm);
      if (r.maxFloatDiff > globalMaxFloatDiff) globalMaxFloatDiff = r.maxFloatDiff;
      if (!r.pass) {
        failPrims++;
        samplePass = false;
        lines.push(`    ${label}: ${r.issues.slice(0, 4).join(' | ')}`);
      }
      module.destroy(wasm.geom);
    }
    const tag = samplePass ? 'PASS' : 'FAIL';
    console.log(`${tag.padEnd(5)} ${name}  (${prims.length} prim${prims.length === 1 ? '' : 's'})`);
    for (const l of lines) console.log(l);
    if (!samplePass) failedSamples.push(name);
  }

  module.destroy(decoder);

  console.log('\n' + '='.repeat(60));
  console.log(`primitives: ${totalPrims}, failed: ${failPrims}`);
  console.log(`max float diff (passing attrs): ${globalMaxFloatDiff.toExponential(2)} (eps ${FLOAT_EPS})`);
  if (failedSamples.length) {
    console.log(`FAILED samples: ${failedSamples.join(', ')}`);
    process.exit(1);
  }
  console.log('All samples match the WASM reference. ✔');
}

main();
