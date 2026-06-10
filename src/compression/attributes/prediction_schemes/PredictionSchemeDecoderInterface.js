// compression/attributes/prediction_schemes/PredictionSchemeDecoderInterface.js - ported from compression/attributes/prediction_schemes/prediction_scheme_decoder_interface.h

/**
 * Abstract interface for prediction schemes used during attribute decoding.
 */
class PredictionSchemeDecoderInterface {

  isInitialized() {
    return false;
  }

  /** True if all correction values are guaranteed to be positive. */
  areCorrectionsPositive() {
    return false;
  }

  getNumParentAttributes() {
    return 0;
  }

  getParentAttributeType(i) {
    return -1; // INVALID
  }

  setParentAttribute(att) {
    return false;
  }

  decodePredictionData(buffer) {
    return true;
  }

  /** Reverts the prediction applied during encoding, writing original values to outData. */
  computeOriginalValues(inCorr, outData, size, numComponents, entryToPointIdMap) {
    return false;
  }

}

export { PredictionSchemeDecoderInterface };
