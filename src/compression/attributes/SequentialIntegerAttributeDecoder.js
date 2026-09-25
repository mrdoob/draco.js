// compression/attributes/SequentialIntegerAttributeDecoder.js - ported from compression/attributes/sequential_integer_attribute_decoder.h/cc

import { SequentialAttributeDecoder } from './SequentialAttributeDecoder.js';
import { DataType, dataTypeLength } from '../../core/DracoTypes.js';
import { convertSymbolsToSignedInts } from '../../core/BitUtils.js';
import { PredictionSchemeMethod, PredictionSchemeTransformType } from '../config/CompressionShared.js';
import { decodeSymbols } from '../entropy/SymbolDecoding.js';
import { createPredictionSchemeForDecoder } from './prediction_schemes/PredictionSchemeDecoderFactory.js';
import { PredictionSchemeWrapDecodingTransform } from './prediction_schemes/PredictionSchemeWrapDecodingTransform.js';

// Decoder for attributes encoded with the SequentialIntegerAttributeEncoder.
class SequentialIntegerAttributeDecoder extends SequentialAttributeDecoder {

  constructor() {
    super();
    this._predictionScheme = null;
  }

  finalizeAttribute() {
    // Keep the former store-time validation even for unrequested attributes.
    return this.attribute.dataType >= DataType.INT8 && this.attribute.dataType <= DataType.UINT32;
  }

  decodeValues(pointIds, buffer) {
    const predictionSchemeMethod = buffer.decodeInt8();
    if (predictionSchemeMethod === undefined) return false;

    if (predictionSchemeMethod < PredictionSchemeMethod.PREDICTION_NONE ||
        predictionSchemeMethod >= PredictionSchemeMethod.NUM_PREDICTION_SCHEMES) {
      return false;
    }

    if (predictionSchemeMethod !== PredictionSchemeMethod.PREDICTION_NONE) {
      const predictionTransformType = buffer.decodeInt8();
      if (predictionTransformType === undefined) return false;

      if (predictionTransformType < PredictionSchemeTransformType.PREDICTION_TRANSFORM_NONE ||
          predictionTransformType >= PredictionSchemeTransformType.NUM_PREDICTION_SCHEME_TRANSFORM_TYPES) {
        return false;
      }

      this._predictionScheme = this.createIntPredictionScheme(
        predictionSchemeMethod, predictionTransformType
      );
    }

    if (this._predictionScheme) {
      if (!this.initPredictionScheme(this._predictionScheme)) {
        return false;
      }
    }

    if (!this.decodeIntegerValues(pointIds, buffer)) {
      return false;
    }
    return true;
  }

  decodeIntegerValues(pointIds, buffer) {
    const numComponents = this.getNumValueComponents();
    if (numComponents <= 0) {
      return false;
    }
    const numEntries = pointIds.length;
    const numValues = numEntries * numComponents;
    this.preparePortableAttribute(numEntries, numComponents);
    const portableAttributeData = this.getPortableAttributeData();
    if (portableAttributeData === null) {
      return false;
    }

    const compressed = buffer.decodeUint8();
    if (compressed === undefined) return false;

    if (compressed > 0) {
      // decodeSymbols writes uint32 values into the provided array.
      const outUint32 = new Uint32Array(portableAttributeData.buffer,
        portableAttributeData.byteOffset, numValues);
      if (!decodeSymbols(numValues, numComponents, buffer, outUint32)) {
        return false;
      }
    } else {
      const numBytes = buffer.decodeUint8();
      if (numBytes === undefined) return false;

      if (numBytes === dataTypeLength(DataType.INT32)) {
        if (portableAttributeData.byteLength < 4 * numValues) {
          return false;
        }
        const bytes = buffer.decodeBytes(4 * numValues);
        if (bytes === undefined) return false;
        const srcView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        for (let i = 0; i < numValues; i++) {
          portableAttributeData[i] = srcView.getInt32(i * 4, true);
        }
      } else {
        if (buffer.remainingSize < numBytes * numValues) {
          return false;
        }
        for (let i = 0; i < numValues; i++) {
          const valueBytes = buffer.decodeBytes(numBytes);
          if (valueBytes === undefined) return false;
          // Little-endian; |= with << sign-extends into a 32-bit int.
          let val = 0;
          for (let b = 0; b < numBytes; b++) {
            val |= valueBytes[b] << (b * 8);
          }
          portableAttributeData[i] = val;
        }
      }
    }

    if (numValues > 0 && (this._predictionScheme === null ||
                          !this._predictionScheme.areCorrectionsPositive())) {
      // Reinterpret the Int32Array as Uint32 for the signed conversion.
      const asUint32 = new Uint32Array(portableAttributeData.buffer, portableAttributeData.byteOffset, numValues);
      convertSymbolsToSignedInts(asUint32, numValues, portableAttributeData);
    }

    if (this._predictionScheme) {
      if (!this._predictionScheme.decodePredictionData(buffer)) {
        return false;
      }
      if (numValues > 0) {
        if (!this._predictionScheme.computeOriginalValues(
              portableAttributeData, portableAttributeData,
              numValues, numComponents, pointIds)) {
          return false;
        }
      }
    }
    return true;
  }

  // Prediction scheme for decoding integer values; subclasses override for others.
  createIntPredictionScheme(method, transformType) {
    if (transformType !== PredictionSchemeTransformType.PREDICTION_TRANSFORM_WRAP) {
      return null; // For now we support only wrap transform.
    }
    const transform = new PredictionSchemeWrapDecodingTransform();
    return createPredictionSchemeForDecoder(
      method, this.attributeId, this.decoder, transform
    );
  }

  getNumValueComponents() {
    return this.attribute.numComponents;
  }

  preparePortableAttribute(numEntries, numComponents) {
    this.attribute.portable = true;
    this.attribute.portableComponents = numComponents;
    this.attribute.values = new Int32Array(numEntries * numComponents);
  }

  getPortableAttributeData() {
    return this.attribute.size === 0 ? null : this.attribute.values;
  }

}

export { SequentialIntegerAttributeDecoder };
