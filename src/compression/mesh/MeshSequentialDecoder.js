// compression/mesh/MeshSequentialDecoder.js - ported from mesh/mesh_sequential_decoder.h/cc

import { MeshDecoder } from './MeshDecoder.js';
import { decodeVarint } from '../../core/VarintDecoding.js';
import { decodeSymbols } from '../entropy/SymbolDecoding.js';
import { SequentialAttributeDecodersController } from '../attributes/SequentialAttributeDecodersController.js';
import { LinearSequencer } from '../attributes/LinearSequencer.js';

class MeshSequentialDecoder extends MeshDecoder {

  constructor() {
    super();
  }

  decodeConnectivity() {
    let numFaces;
    let numPoints;

    numFaces = decodeVarint(this.buffer());
    if (numFaces === undefined) return false;
    numPoints = decodeVarint(this.buffer());
    if (numPoints === undefined) return false;

    // Compressed sequential encoding can only handle (2^32 - 1) / 3 indices.
    if (numFaces > 0xFFFFFFFF / 3) {
      return false;
    }
    if (numFaces > this.buffer().remainingSize / 3) {
      return false;
    }

    const connectivityMethod = this.buffer().decodeUint8();
    if (connectivityMethod === undefined) {
      return false;
    }

    // Reserve once without changing the count: addFace still appends and keeps
    // partial-decode behavior, without copying the entire buffer for each face.
    const mesh = this.mesh();
    mesh._ensureFaceCapacity(mesh.numFaces() + numFaces);

    if (connectivityMethod === 0) {
      if (!this._decodeAndDecompressIndices(numFaces)) {
        return false;
      }
    } else {
      if (numPoints < 256) {
        for (let i = 0; i < numFaces; ++i) {
          const face = [0, 0, 0];
          for (let j = 0; j < 3; ++j) {
            const val = this.buffer().decodeUint8();
            if (val === undefined) return false;
            face[j] = val;
          }
          this.mesh().addFace(face);
        }
      } else if (numPoints < (1 << 16)) {
        for (let i = 0; i < numFaces; ++i) {
          const face = [0, 0, 0];
          for (let j = 0; j < 3; ++j) {
            const val = this.buffer().decodeUint16();
            if (val === undefined) return false;
            face[j] = val;
          }
          this.mesh().addFace(face);
        }
      } else if (numPoints < (1 << 21)) {
        for (let i = 0; i < numFaces; ++i) {
          const face = [0, 0, 0];
          for (let j = 0; j < 3; ++j) {
            const val = decodeVarint(this.buffer());
            if (val === undefined) return false;
            face[j] = val;
          }
          this.mesh().addFace(face);
        }
      } else {
        for (let i = 0; i < numFaces; ++i) {
          const face = [0, 0, 0];
          for (let j = 0; j < 3; ++j) {
            const val = this.buffer().decodeUint32();
            if (val === undefined) return false;
            face[j] = val;
          }
          this.mesh().addFace(face);
        }
      }
    }

    this.pointCloud().setNumPoints(numPoints);
    return true;
  }

  createAttributesDecoder(attDecoderId) {
    // Sequential meshes store attribute values directly in point order, so a
    // LinearSequencer drives the SequentialAttributeDecodersController.
    return this.setAttributesDecoder(
      attDecoderId,
      new SequentialAttributeDecodersController(
        new LinearSequencer(this.pointCloud().numPoints())
      )
    );
  }

  _decodeAndDecompressIndices(numFaces) {
    const indicesBuffer = new Uint32Array(numFaces * 3);
    if (!decodeSymbols(numFaces * 3, 1, this.buffer(), indicesBuffer)) {
      return false;
    }
    // Reconstruct the indices from the differences.
    // See MeshSequentialEncoder::CompressAndEncodeIndices() for more details.
    let lastIndexValue = 0; // This will always be >= 0.
    let vertexIndex = 0;
    for (let i = 0; i < numFaces; ++i) {
      const face = [0, 0, 0];
      for (let j = 0; j < 3; ++j) {
        const encodedVal = indicesBuffer[vertexIndex++];
        let indexDiff = (encodedVal >>> 1);
        if (encodedVal & 1) {
          if (indexDiff > lastIndexValue) {
            // Subtracting indexDiff would result in a negative index.
            return false;
          }
          indexDiff = -indexDiff;
        } else {
          if (indexDiff > (0x7FFFFFFF - lastIndexValue)) {
            // Adding indexDiff to lastIndexValue would overflow.
            return false;
          }
        }
        const indexValue = (indexDiff + lastIndexValue) | 0;
        face[j] = indexValue;
        lastIndexValue = indexValue;
      }
      this.mesh().addFace(face);
    }
    return true;
  }

}

export { MeshSequentialDecoder };
