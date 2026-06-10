// compression/mesh/MeshEdgebreakerTraversalDecoder.js - ported from mesh/mesh_edgebreaker_traversal_decoder.h

import { DecoderBuffer } from '../../core/DecoderBuffer.js';
import { TOPOLOGY_C } from './MeshEdgebreakerShared.js';
import { RAnsBitDecoder } from '../bit_coders/RAnsBitDecoder.js';

// Default traversal decoder: reads traversal data directly from a buffer.
class MeshEdgebreakerTraversalDecoder {

  constructor() {
    this._buffer = new DecoderBuffer();
    this._symbolBuffer = new DecoderBuffer();
    this._startFaceDecoder = null; // RAnsBitDecoder
    this._attributeConnectivityDecoders = null; // Array of RAnsBitDecoder
    this._numAttributeData = 0;
    this._decoderImpl = null;
  }

  init(decoder) {
    this._decoderImpl = decoder;
    const srcBuffer = decoder.getDecoder().buffer();
    this._buffer.init(
      srcBuffer.dataHead,
      srcBuffer.remainingSize,
      srcBuffer.bitstreamVersion
    );
  }

  bitstreamVersion() {
    return this._decoderImpl.getDecoder().bitstreamVersion();
  }

  // Ignored by default; overridden by predictive/valence decoders.
  setNumEncodedVertices(/* numVertices */) {}

  setNumAttributeData(numData) {
    this._numAttributeData = numData;
  }

  // Sets outBuffer to the data encoded after the traversal section.
  start(outBuffer) {
    if (!this.decodeTraversalSymbols()) {
      return false;
    }
    if (!this.decodeStartFaces()) {
      return false;
    }
    if (!this.decodeAttributeSeams()) {
      return false;
    }
    outBuffer.init(
      this._buffer.dataHead,
      this._buffer.remainingSize,
      this._buffer.bitstreamVersion
    );
    return true;
  }

  decodeStartFaceConfiguration() {
    if (this._startFaceDecoder === null) return false;
    return this._startFaceDecoder.decodeNextBit() ? true : false;
  }

  decodeSymbol() {
    let symbol = this._symbolBuffer.decodeLeastSignificantBits32(1);
    if (symbol === TOPOLOGY_C) {
      return symbol;
    }
    // Non-C symbols carry two additional bits.
    const symbolSuffix = this._symbolBuffer.decodeLeastSignificantBits32(2);
    symbol |= (symbolSuffix << 1);
    return symbol;
  }

  newActiveCornerReached(/* corner */) {}

  mergeVertices(/* dest, source */) {}

  done() {
    if (this._symbolBuffer.bitDecoderActive) {
      this._symbolBuffer.endBitDecoding();
    }
    if (this._startFaceDecoder !== null) {
      this._startFaceDecoder.endDecoding();
    }
  }

  get buffer() {
    return this._buffer;
  }

  decodeTraversalSymbols() {
    this._symbolBuffer.init(
      this._buffer.dataHead,
      this._buffer.remainingSize,
      this._buffer.bitstreamVersion
    );
    const traversalSize = this._symbolBuffer.startBitDecoding(true);
    if (traversalSize === undefined) {
      return false;
    }
    // Advance the main buffer past the symbol data.
    this._buffer.init(
      this._symbolBuffer.dataHead,
      this._symbolBuffer.remainingSize,
      this._symbolBuffer.bitstreamVersion
    );
    if (traversalSize > this._buffer.remainingSize) {
      return false;
    }
    this._buffer.advance(traversalSize);
    return true;
  }

  decodeStartFaces() {
    // Start faces are coded with an RAnsBitDecoder.
    try {
      this._startFaceDecoder = this._createRAnsBitDecoder();
      if (this._startFaceDecoder === null) {
        return false;
      }
      return this._startFaceDecoder.startDecoding(this._buffer);
    } catch (e) {
      return false;
    }
  }

  decodeAttributeSeams() {
    if (this._numAttributeData > 0) {
      this._attributeConnectivityDecoders = [];
      for (let i = 0; i < this._numAttributeData; ++i) {
        const decoder = this._createRAnsBitDecoder();
        if (decoder === null) {
          return false;
        }
        if (!decoder.startDecoding(this._buffer)) {
          return false;
        }
        this._attributeConnectivityDecoders.push(decoder);
      }
    }
    return true;
  }

  _createRAnsBitDecoder() {
    return new RAnsBitDecoder();
  }

}

export { MeshEdgebreakerTraversalDecoder };
