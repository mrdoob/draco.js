# Draco.js

A pure-JavaScript [Draco](https://github.com/google/draco) mesh **loader** for
three.js. It's a drop-in `DRACOLoader` that decodes Draco-compressed triangle
meshes — both the EdgeBreaker connectivity used by glTF's
`KHR_draco_mesh_compression` and Draco's sequential connectivity — directly in
JavaScript.

**[Live demo →](https://mrdoob.github.io/draco.js/)**

Why a JS port instead of the official WASM build?

- **Small** — ~18 KB gzipped (54 KB minified), vs ~100 KB gzipped for the
  `draco3d` WASM decoder + glue (~5× smaller).
- **Simple to ship** — one ES module. No `.wasm` fetch, no worker/glue setup,
  no cross-origin or CSP headaches.
- **Fast** — within ~1.0–1.4× of the WASM decoder on substantial meshes, and
  effectively at parity on the largest, with byte-for-byte identical output.

You trade decode speed for a much smaller, simpler loader. This pays
off most on pages with a single model, where the decoder is a one-time cost that
isn't amortized across many meshes — the model often **displays sooner**
end-to-end because the network savings outweigh the extra decode time.

## Status

Targets **Draco bitstream version 2.2** — what current Draco encoders and glTF
exporters produce. Older bitstreams (< 2.2) are rejected with an error.

Not implemented:

- **Point-cloud decoding** (sequential and KD-tree) — only triangle meshes are
  decoded.
- **Metadata content** — geometry metadata is parsed (so metadata-bearing files
  still decode correctly) but is not surfaced on the returned geometry.

## Usage

`DRACOLoader` is a drop-in replacement for three.js's own `DRACOLoader` — plug it
into `GLTFLoader` the usual way. There's no decoder path or WASM to configure
(`setDecoderPath` / `setDecoderConfig` are accepted but do nothing).

```js
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from './build/DRACOLoader.js';

const gltfLoader = new GLTFLoader();
gltfLoader.setDRACOLoader( new DRACOLoader() );

gltfLoader.load( 'model.glb', ( gltf ) => scene.add( gltf.scene ) );
```

It can also load standalone `.drc` files:

```js
const geometry = await new DRACOLoader().loadAsync( 'model.drc' ); // BufferGeometry
```

## Credits

- Decoder logic is a port of [Google Draco](https://github.com/google/draco)
  (Apache-2.0); it mirrors the original C++ file structure.
- `DRACOLoader.js` follows the API of three.js's
  [`DRACOLoader`](https://github.com/mrdoob/three.js/blob/dev/examples/jsm/loaders/DRACOLoader.js)
  (MIT) so it drops into `GLTFLoader` unchanged.
