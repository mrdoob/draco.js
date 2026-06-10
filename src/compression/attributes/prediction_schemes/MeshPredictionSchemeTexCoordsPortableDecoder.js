// compression/attributes/prediction_schemes/MeshPredictionSchemeTexCoordsPortableDecoder.js - ported from compression/attributes/prediction_schemes/mesh_prediction_scheme_tex_coords_portable_decoder.h

import { MeshPredictionSchemeDecoder } from './MeshPredictionSchemeDecoder.js';
import { MeshPredictionSchemeTexCoordsPortablePredictor } from './MeshPredictionSchemeTexCoordsPortablePredictor.js';
import { RAnsBitDecoder } from '../../bit_coders/RAnsBitDecoder.js';

const GEOMETRY_ATTRIBUTE_POSITION = 0;

/**
 * Decoder for UV coordinate predictions using the portable predictor; preferred
 * over the deprecated MeshPredictionSchemeTexCoordsDecoder.
 */
class MeshPredictionSchemeTexCoordsPortableDecoder extends MeshPredictionSchemeDecoder {

  constructor(attribute, transform, meshData) {
    super(attribute, transform, meshData);
    this._predictor = new MeshPredictionSchemeTexCoordsPortablePredictor(meshData);
  }

  isInitialized() {
    if (!this._predictor.isInitialized()) return false;
    if (!this._meshData.isInitialized()) return false;
    return true;
  }

  getNumParentAttributes() {
    return 1;
  }

  getParentAttributeType(i) {
    return GEOMETRY_ATTRIBUTE_POSITION;
  }

  setParentAttribute(att) {
    if (!att || att.attributeType !== GEOMETRY_ATTRIBUTE_POSITION) return false;
    if (att.numComponents !== 3) return false;
    this._predictor.setPositionAttribute(att);
    return true;
  }

  decodePredictionData(buffer) {
    let numOrientations = buffer.decodeInt32();
    if (numOrientations === undefined || numOrientations < 0) return false;

    this._predictor.resizeOrientations(numOrientations);
    let lastOrientation = true;
    const decoder = new RAnsBitDecoder();
    if (!decoder.startDecoding(buffer)) return false;
    for (let i = 0; i < numOrientations; ++i) {
      if (!decoder.decodeNextBit()) {
        lastOrientation = !lastOrientation;
      }
      this._predictor.setOrientation(i, lastOrientation);
    }
    decoder.endDecoding();
    return super.decodePredictionData(buffer);
  }

  computeOriginalValues(inCorr, outData, size, numComponents, entryToPointIdMap) {
    if (numComponents !== MeshPredictionSchemeTexCoordsPortablePredictor.NUM_COMPONENTS) {
      return false;
    }
    this._predictor.setEntryToPointIdMap(entryToPointIdMap);
    this._transform.init(numComponents);

    const cornerMapSize = this._meshData.dataToCornerMap.length;
    // Cache integer positions once to avoid per-fetch mappedIndex + convertValue.
    this._predictor.buildPositionCache(cornerMapSize);
    for (let p = 0; p < cornerMapSize; ++p) {
      const cornerId = this._meshData.dataToCornerMap[p];
      if (!this._predictor.computePredictedValue(cornerId, outData, p)) {
        return false;
      }

      const dstOffset = p * numComponents;
      this._transform.computeOriginalValue(
        this._predictor.predictedValue, 0,
        inCorr, dstOffset,
        outData, dstOffset
      );
    }
    return true;
  }

}

export { MeshPredictionSchemeTexCoordsPortableDecoder };
