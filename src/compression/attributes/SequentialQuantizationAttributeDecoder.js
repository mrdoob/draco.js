// compression/attributes/SequentialQuantizationAttributeDecoder.js - ported from compression/attributes/sequential_quantization_attribute_decoder.h/cc

import { SequentialIntegerAttributeDecoder } from './SequentialIntegerAttributeDecoder.js';
import { AttributeQuantizationTransform } from '../../attributes/AttributeQuantizationTransform.js';
import { DataType } from '../../core/DracoTypes.js';

// Decoder for attribute values encoded with the
// SequentialQuantizationAttributeEncoder.
class SequentialQuantizationAttributeDecoder extends SequentialIntegerAttributeDecoder {

  constructor() {
    super();
    this._quantizationTransform = new AttributeQuantizationTransform();
  }

  init(decoder, attributeId) {
    if (!super.init(decoder, attributeId)) {
      return false;
    }
    const attribute = decoder.pointCloud().attribute(attributeId);
    // Only floating point attributes can be quantized.
    if (attribute.dataType !== DataType.FLOAT32) {
      return false;
    }
    return true;
  }

  decodeDataNeededByPortableTransform(pointIds, buffer) {
    return this._quantizationTransform.decodeParameters(this.attribute, buffer);
  }

  finalizeAttribute() {
    if (!this._quantizationTransform.init()) return false;
    this.attribute.transform = this._quantizationTransform;
    return true;
  }

}

export { SequentialQuantizationAttributeDecoder };
