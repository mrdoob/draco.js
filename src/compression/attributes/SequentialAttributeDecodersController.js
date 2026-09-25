// compression/attributes/SequentialAttributeDecodersController.js - ported from compression/attributes/sequential_attribute_decoders_controller.h/cc

import { AttributesDecoder } from './AttributesDecoder.js';
import { SequentialAttributeDecoder } from './SequentialAttributeDecoder.js';
import { SequentialIntegerAttributeDecoder } from './SequentialIntegerAttributeDecoder.js';
import { SequentialQuantizationAttributeDecoder } from './SequentialQuantizationAttributeDecoder.js';
import { SequentialNormalAttributeDecoder } from './SequentialNormalAttributeDecoder.js';
import { SequentialAttributeEncoderType } from '../config/CompressionShared.js';

// Creates one SequentialAttributeDecoder per attribute; the decoder type is
// chosen from the id encoded by the matching encoder.
class SequentialAttributeDecodersController extends AttributesDecoder {

  constructor(sequencer) {
    super();
    this._sequentialDecoders = [];
    this._pointIds = [];
    this._sequencer = sequencer;
  }

  decodeAttributesDecoderData(buffer) {
    if (!super.decodeAttributesDecoderData(buffer)) {
      return false;
    }
    const numAttributes = this.getNumAttributes();
    this._sequentialDecoders.length = numAttributes;
    for (let i = 0; i < numAttributes; i++) {
      const decoderType = buffer.decodeUint8();
      if (decoderType === undefined) return false;

      this._sequentialDecoders[i] = this.createSequentialDecoder(decoderType);
      if (!this._sequentialDecoders[i]) {
        return false;
      }
      if (!this._sequentialDecoders[i].init(this.getDecoder(), this.getAttributeId(i))) {
        return false;
      }
    }
    return true;
  }

  decodeAttributes(buffer) {
    if (!this._sequencer) {
      return false;
    }
    if (!this._sequencer.generateSequence(this._pointIds)) {
      return false;
    }
    this._pointIds = this._sequencer.getOutputPointIds();

    const numAttributes = this.getNumAttributes();
    for (let i = 0; i < numAttributes; i++) {
      const pa = this.getDecoder().pointCloud().attribute(this.getAttributeId(i));
      if (!this._sequencer.updatePointToAttributeIndexMapping(pa)) {
        return false;
      }
    }
    return super.decodeAttributes(buffer);
  }

  getPortableAttribute(pointAttributeId) {
    const locId = this.getLocalIdForPointAttribute(pointAttributeId);
    if (locId < 0) {
      return null;
    }
    return this._sequentialDecoders[locId].getPortableAttribute();
  }

  decodePortableAttributes(buffer) {
    const numAttributes = this.getNumAttributes();
    for (let i = 0; i < numAttributes; i++) {
      if (!this._sequentialDecoders[i].decodePortableAttribute(
            this._pointIds, buffer)) {
        return false;
      }
    }
    return true;
  }

  decodeDataNeededByPortableTransforms(buffer) {
    const numAttributes = this.getNumAttributes();
    for (let i = 0; i < numAttributes; i++) {
      if (!this._sequentialDecoders[i].decodeDataNeededByPortableTransform(
            this._pointIds, buffer)) {
        return false;
      }
    }
    return true;
  }

  finalizeAttributes() {
    const numAttributes = this.getNumAttributes();
    for (let i = 0; i < numAttributes; i++) {
      if (!this._sequentialDecoders[i].finalizeAttribute(
            this._pointIds)) {
        return false;
      }
    }
    return true;
  }

  createSequentialDecoder(decoderType) {
    switch (decoderType) {
      case SequentialAttributeEncoderType.SEQUENTIAL_ATTRIBUTE_ENCODER_GENERIC:
        return new SequentialAttributeDecoder();

      case SequentialAttributeEncoderType.SEQUENTIAL_ATTRIBUTE_ENCODER_INTEGER:
        return new SequentialIntegerAttributeDecoder();

      case SequentialAttributeEncoderType.SEQUENTIAL_ATTRIBUTE_ENCODER_QUANTIZATION:
        return new SequentialQuantizationAttributeDecoder();

      case SequentialAttributeEncoderType.SEQUENTIAL_ATTRIBUTE_ENCODER_NORMALS:
        return new SequentialNormalAttributeDecoder();

      default:
        break;
    }
    return null;
  }

}

export { SequentialAttributeDecodersController };
