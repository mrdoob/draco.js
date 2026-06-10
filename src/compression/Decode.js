// compression/Decode.js - ported from compression/decode.h/cc

import {
  EncodedGeometryType,
  MeshEncoderMethod,
  DracoHeader
} from './config/CompressionShared.js';
import { DecoderOptions } from './config/DecoderOptions.js';
import { DecoderBuffer } from '../core/DecoderBuffer.js';
import { Mesh } from '../mesh/Mesh.js';

import { MeshSequentialDecoder } from './mesh/MeshSequentialDecoder.js';
import { MeshEdgebreakerDecoder } from './mesh/MeshEdgebreakerDecoder.js';
import { PointCloudDecoder } from './point_cloud/PointCloudDecoder.js';

// Reads the Draco header from a copy of inBuffer without advancing the original,
// so the geometry type can be checked before picking a decoder.
// Returns { ok, header, message }.
function peekHeader(inBuffer) {

  const tempBuffer = new DecoderBuffer();
  tempBuffer.init(inBuffer.data, inBuffer.data.length);
  tempBuffer.bitstreamVersion = inBuffer.bitstreamVersion;
  tempBuffer.advance(inBuffer.decodedSize); // match the original's position

  const header = new DracoHeader();
  const status = PointCloudDecoder.decodeHeader(tempBuffer, header);
  return { ok: status.ok(), header, message: status.errorMsg };

}

function createMeshDecoder(method) {

  if (method === MeshEncoderMethod.MESH_SEQUENTIAL_ENCODING) {

    return new MeshSequentialDecoder();

  } else if (method === MeshEncoderMethod.MESH_EDGEBREAKER_ENCODING) {

    return new MeshEdgebreakerDecoder();

  }

  throw new Error('Unsupported mesh encoding method.');

}

// Decodes Draco-compressed meshes and point clouds.
class Decoder {

  constructor() {

    this.options_ = new DecoderOptions();

  }

  // Returns an EncodedGeometryType value, or INVALID_GEOMETRY_TYPE on error.
  static getEncodedGeometryType(inBuffer) {

    const result = peekHeader(inBuffer);
    if (!result.ok) {
      return EncodedGeometryType.INVALID_GEOMETRY_TYPE;
    }

    if (result.header.encoderType >= EncodedGeometryType.NUM_ENCODED_GEOMETRY_TYPES) {
      return EncodedGeometryType.INVALID_GEOMETRY_TYPE;
    }

    return result.header.encoderType;

  }

  // Returns { mesh, ok, message }.
  decodeMeshFromBuffer(inBuffer) {

    const mesh = new Mesh();
    const status = this.decodeBufferToMesh(inBuffer, mesh);
    if (!status.ok) {
      return { mesh: null, ok: false, message: status.message };
    }

    return { mesh, ok: true, message: '' };

  }

  // Returns { ok, message }.
  decodeBufferToMesh(inBuffer, outGeometry) {

    const result = peekHeader(inBuffer);
    if (!result.ok) {
      return { ok: false, message: result.message };
    }

    if (result.header.encoderType !== EncodedGeometryType.TRIANGULAR_MESH) {
      return { ok: false, message: 'Input is not a mesh.' };
    }

    const decoder = createMeshDecoder(result.header.encoderMethod);
    const status = decoder.decodeMesh(this.options_, inBuffer, outGeometry);
    return { ok: status.ok(), message: status.errorMsg };

  }

  options() {

    return this.options_;

  }

}

export { Decoder };
