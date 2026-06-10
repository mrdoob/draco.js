// compression/attributes/prediction_schemes/PredictionSchemeDeltaDecoder.js - ported from compression/attributes/prediction_schemes/prediction_scheme_delta_decoder.h

import { PredictionSchemeDecoder } from './PredictionSchemeDecoder.js';

/**
 * Decoder for delta coding: value[i] = value[i-1] + correction[i].
 */
class PredictionSchemeDeltaDecoder extends PredictionSchemeDecoder {

  constructor(attribute, transform) {
    super(attribute, transform);
  }

  isInitialized() {
    return true;
  }

  computeOriginalValues(inCorr, outData, size, numComponents, entryToPointIdMap) {
    this._transform.init(numComponents);

    // First element has an all-zero "predicted" value.
    const zeroVals = new Int32Array(numComponents);
    this._transform.computeOriginalValue(
      zeroVals, 0,
      inCorr, 0,
      outData, 0
    );

    // D(i) = D(i-1) + correction(i).
    for (let i = numComponents; i < size; i += numComponents) {
      this._transform.computeOriginalValue(
        outData, i - numComponents,
        inCorr, i,
        outData, i
      );
    }

    return true;
  }

}

export { PredictionSchemeDeltaDecoder };
