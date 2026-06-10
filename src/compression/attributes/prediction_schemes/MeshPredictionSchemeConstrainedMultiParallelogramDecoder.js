// compression/attributes/prediction_schemes/MeshPredictionSchemeConstrainedMultiParallelogramDecoder.js - ported from compression/attributes/prediction_schemes/mesh_prediction_scheme_constrained_multi_parallelogram_decoder.h

import { MeshPredictionSchemeDecoder } from './MeshPredictionSchemeDecoder.js';
import { computeParallelogramPrediction } from './MeshPredictionSchemeParallelogramShared.js';
import { RAnsBitDecoder } from '../../bit_coders/RAnsBitDecoder.js';

const kInvalidCornerIndex = -1;

const OPTIMAL_MULTI_PARALLELOGRAM = 0;
const MAX_NUM_PARALLELOGRAMS = 4;

/**
 * Decoder for the constrained multi-parallelogram encoder. Crease edge flags
 * determine which parallelograms to use.
 */
class MeshPredictionSchemeConstrainedMultiParallelogramDecoder extends MeshPredictionSchemeDecoder {

  constructor(attribute, transform, meshData) {
    super(attribute, transform, meshData);
    this._selectedMode = OPTIMAL_MULTI_PARALLELOGRAM;
    // Crease edges stored per context (number of available parallelograms).
    this._isCreaseEdge = [];
    for (let i = 0; i < MAX_NUM_PARALLELOGRAMS; ++i) {
      this._isCreaseEdge.push([]);
    }
  }

  isInitialized() {
    return this._meshData.isInitialized();
  }

  decodePredictionData(buffer) {
    if (buffer.bitstreamVersion < 0x0202) {
      const mode = buffer.decodeUint8();
      if (mode === undefined) return false;
      if (mode !== OPTIMAL_MULTI_PARALLELOGRAM) return false;
    }

    // Decode crease edge flags via rANS bit coder, one context per parallelogram count.
    for (let i = 0; i < MAX_NUM_PARALLELOGRAMS; ++i) {
      const numFlags = buffer.decodeVarintUint32();
      if (numFlags === undefined) return false;
      if (numFlags > this._meshData.cornerTable.numCorners()) return false;
      if (numFlags > 0) {
        this._isCreaseEdge[i] = new Array(numFlags);
        const decoder = new RAnsBitDecoder();
        if (!decoder.startDecoding(buffer)) return false;
        for (let j = 0; j < numFlags; ++j) {
          this._isCreaseEdge[i][j] = decoder.decodeNextBit();
        }
        decoder.endDecoding();
      }
    }
    return super.decodePredictionData(buffer);
  }

  computeOriginalValues(inCorr, outData, size, numComponents, entryToPointIdMap) {
    this._transform.init(numComponents);

    // Predicted values for all simple parallelograms.
    const predVals = [];
    for (let i = 0; i < MAX_NUM_PARALLELOGRAMS; ++i) {
      predVals.push(new Int32Array(numComponents));
    }

    this._transform.computeOriginalValue(
      predVals[0], 0, inCorr, 0, outData, 0
    );

    const table = this._meshData.cornerTable;
    const vertexToDataMap = this._meshData.vertexToDataMap;
    const oppositeCorners = table.oppositeCornerArray();
    const cornerToVertex = table.cornerToVertexArray();

    const isCreaseEdgePos = new Int32Array(MAX_NUM_PARALLELOGRAMS);
    const multiPredVals = new Int32Array(numComponents);

    const cornerMapSize = this._meshData.dataToCornerMap.length;
    for (let p = 1; p < cornerMapSize; ++p) {
      const startCornerId = this._meshData.dataToCornerMap[p];
      let cornerId = startCornerId;
      let numParallelograms = 0;
      let firstPass = true;

      while (cornerId !== kInvalidCornerIndex) {
        if (computeParallelogramPrediction(
          p, cornerId, oppositeCorners, cornerToVertex, vertexToDataMap,
          outData, numComponents, predVals[numParallelograms])) {
          ++numParallelograms;
          if (numParallelograms === MAX_NUM_PARALLELOGRAMS) break;
        }

        // First swing left, then swing right from start if boundary hit.
        if (firstPass) {
          cornerId = table.swingLeft(cornerId);
        } else {
          cornerId = table.swingRight(cornerId);
        }
        if (cornerId === startCornerId) break;
        if (cornerId === kInvalidCornerIndex && firstPass) {
          firstPass = false;
          cornerId = table.swingRight(startCornerId);
        }
      }

      // Crease edge flags select which parallelograms contribute.
      let numUsedParallelograms = 0;
      if (numParallelograms > 0) {
        for (let i = 0; i < numComponents; ++i) {
          multiPredVals[i] = 0;
        }
        for (let i = 0; i < numParallelograms; ++i) {
          const context = numParallelograms - 1;
          const pos = isCreaseEdgePos[context]++;
          if (this._isCreaseEdge[context].length <= pos) return false;
          const isCrease = this._isCreaseEdge[context][pos];
          if (!isCrease) {
            ++numUsedParallelograms;
            for (let j = 0; j < numComponents; ++j) {
              multiPredVals[j] = (multiPredVals[j] + predVals[i][j]) | 0;
            }
          }
        }
      }

      const dstOffset = p * numComponents;
      if (numUsedParallelograms === 0) {
        const srcOffset = (p - 1) * numComponents;
        this._transform.computeOriginalValue(
          outData, srcOffset, inCorr, dstOffset, outData, dstOffset
        );
      } else {
        for (let c = 0; c < numComponents; ++c) {
          multiPredVals[c] = (multiPredVals[c] / numUsedParallelograms) | 0;
        }
        this._transform.computeOriginalValue(
          multiPredVals, 0, inCorr, dstOffset, outData, dstOffset
        );
      }
    }
    return true;
  }

}

export { MeshPredictionSchemeConstrainedMultiParallelogramDecoder };
