// compression/attributes/prediction_schemes/MeshPredictionSchemeGeometricNormalDecoder.js - ported from compression/attributes/prediction_schemes/mesh_prediction_scheme_geometric_normal_decoder.h

import { MeshPredictionSchemeDecoder } from './MeshPredictionSchemeDecoder.js';
import { NormalPredictionMode } from '../../config/CompressionShared.js';
import { OctahedronToolBox } from '../NormalCompressionUtils.js';
import { MeshPredictionSchemeGeometricNormalPredictorArea } from './MeshPredictionSchemeGeometricNormalPredictorArea.js';
import { RAnsBitDecoder } from '../../bit_coders/RAnsBitDecoder.js';

const GEOMETRY_ATTRIBUTE_POSITION = 0;

/**
 * Decoder for geometric normal prediction. Predicts normals using the
 * surrounding triangle geometry, then converts to octahedral coordinates.
 */
class MeshPredictionSchemeGeometricNormalDecoder extends MeshPredictionSchemeDecoder {

  constructor(attribute, transform, meshData) {
    super(attribute, transform, meshData);
    this._predictor = new MeshPredictionSchemeGeometricNormalPredictorArea(meshData);
    this._octahedronToolBox = new OctahedronToolBox();
    this._flipNormalBitDecoder = new RAnsBitDecoder();
  }

  isInitialized() {
    if (!this._predictor.isInitialized()) return false;
    if (!this._meshData.isInitialized()) return false;
    if (!this._octahedronToolBox.isInitialized()) return false;
    return true;
  }

  getNumParentAttributes() {
    return 1;
  }

  getParentAttributeType(i) {
    return GEOMETRY_ATTRIBUTE_POSITION;
  }

  setParentAttribute(att) {
    if (att.attributeType !== GEOMETRY_ATTRIBUTE_POSITION) return false;
    if (att.numComponents !== 3) return false;
    this._predictor.setPositionAttribute(att);
    return true;
  }

  setQuantizationBits(q) {
    this._octahedronToolBox.setQuantizationBits(q);
  }

  decodePredictionData(buffer) {
    if (!this._transform.decodeTransformData(buffer)) return false;

    if (buffer.bitstreamVersion < 0x0202) {
      const predictionMode = buffer.decodeUint8();
      if (predictionMode === undefined) return false;
      if (predictionMode > NormalPredictionMode.TRIANGLE_AREA) return false;
      if (!this._predictor.setNormalPredictionMode(predictionMode)) return false;
    }

    if (!this._flipNormalBitDecoder.startDecoding(buffer)) return false;

    return true;
  }

  computeOriginalValues(inCorr, outData, size, numComponents, entryToPointIdMap) {
    this.setQuantizationBits(this._transform.quantizationBits());
    this._predictor.setEntryToPointIdMap(entryToPointIdMap);

    const cornerMapSize = this._meshData.dataToCornerMap.length;

    // Cache integer positions once so the per-corner ring traversal reads from
    // a flat array instead of mappedIndex + convertValue per fetch.
    this._predictor.buildPositionCache(cornerMapSize);

    const predNormal3D = new Int32Array(3);
    const predNormalOct = new Int32Array(2);

    for (let dataId = 0; dataId < cornerMapSize; ++dataId) {
      const cornerId = this._meshData.dataToCornerMap[dataId];
      this._predictor.computePredictedValue(cornerId, predNormal3D);

      this._octahedronToolBox.canonicalizeIntegerVector(predNormal3D);

      if (this._flipNormalBitDecoder.decodeNextBit()) {
        predNormal3D[0] = -predNormal3D[0];
        predNormal3D[1] = -predNormal3D[1];
        predNormal3D[2] = -predNormal3D[2];
      }

      this._octahedronToolBox.integerVectorToQuantizedOctahedralCoords(
        predNormal3D, predNormalOct
      );

      const dataOffset = dataId * 2;
      this._transform.computeOriginalValue(
        predNormalOct, 0,
        inCorr, dataOffset,
        outData, dataOffset
      );
    }

    this._flipNormalBitDecoder.endDecoding();
    return true;
  }

}

export { MeshPredictionSchemeGeometricNormalDecoder };
