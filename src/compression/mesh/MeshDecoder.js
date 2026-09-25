// compression/mesh/MeshDecoder.js - ported from mesh/mesh_decoder.h/cc

import { PointCloudDecoder } from '../point_cloud/PointCloudDecoder.js';
import { EncodedGeometryType } from '../config/CompressionShared.js';

class MeshDecoder extends PointCloudDecoder {

  constructor() {
    super();
    this._mesh = null;
  }

  getGeometryType() {
    return EncodedGeometryType.TRIANGULAR_MESH;
  }

  decodeMesh(options, inBuffer, outMesh) {
    this._mesh = outMesh;
    return this.decode(options, inBuffer, outMesh);
  }

  getCornerTable() {
    return null;
  }

  getAttributeCornerTable(/* attId */) {
    return null;
  }

  getAttributeEncodingData(/* attId */) {
    return null;
  }

  mesh() {
    return this._mesh;
  }

  decodeGeometryData() {
    if (this._mesh === null) {
      return false;
    }
    if (!this.decodeConnectivity()) {
      return false;
    }
    return super.decodeGeometryData();
  }

}

export { MeshDecoder };
