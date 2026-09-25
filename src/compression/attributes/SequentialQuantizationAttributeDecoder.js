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
    return this._decodeQuantizedDataInfo();
  }

  // Override: dequantize the values instead of a generic integer store.
  _storeValues(numPoints) {
    return this._dequantizeValues(numPoints);
  }

  _decodeQuantizedDataInfo() {
    let att = this.getPortableAttribute();
    if (att === null) {
      // Null only in backward-compatibility mode; fall back to the raw attribute.
      att = this.attribute;
    }
    return this._quantizationTransform.decodeParameters(att, this.decoder.buffer());
  }

  _dequantizeValues(numValues) {
    return this._quantizationTransform.inverseTransformAttribute(
      this.getPortableAttribute(), this.attribute
    );
  }

}

export { SequentialQuantizationAttributeDecoder };
