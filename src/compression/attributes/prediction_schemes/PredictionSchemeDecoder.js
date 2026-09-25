// compression/attributes/prediction_schemes/PredictionSchemeDecoder.js - ported from compression/attributes/prediction_schemes/prediction_scheme_decoder.h

/**
 * Base class for typed prediction scheme decoders. C++ templates this on
 * <DataTypeT, TransformT>; here the transform is a constructor param.
 */
class PredictionSchemeDecoder {

  constructor(attribute, transform) {
    this._transform = transform;
  }

  decodePredictionData(buffer) {
    if (!this._transform.decodeTransformData(buffer)) {
      return false;
    }
    return true;
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

  areCorrectionsPositive() {
    return this._transform.areCorrectionsPositive();
  }

}

export { PredictionSchemeDecoder };
