// compression/entropy/RAnsSymbolDecoder.js - ported from compression/entropy/rans_symbol_decoder.h

import { RAnsDecoder } from './ANSCoding.js';

// rANS precision for the given unique-symbols bit length, clamped to [12, 20].
function computeRAnsPrecisionFromUniqueSymbolsBitLength(symbolsBitLength) {
  const unclamped = Math.trunc((3 * symbolsBitLength) / 2);
  if (unclamped < 12) return 12;
  if (unclamped > 20) return 20;
  return unclamped;
}

// Decodes symbols using rANS. uniqueSymbolsBitLength must match the encoder's.
export class RAnsSymbolDecoder {

  constructor(uniqueSymbolsBitLength) {
    this.uniqueSymbolsBitLength_ = uniqueSymbolsBitLength;
    this.ransPrecisionBits_ = computeRAnsPrecisionFromUniqueSymbolsBitLength(uniqueSymbolsBitLength);
    this.ransPrecision_ = 1 << this.ransPrecisionBits_;
    this.probabilityTable_ = null;
    this.numSymbols_ = 0;
    this.ans_ = new RAnsDecoder(this.ransPrecisionBits_);
  }

  get numSymbols() {
    return this.numSymbols_;
  }

  // Initialize the decoder and decode the probability table.
  create(buffer) {
    if (buffer.bitstreamVersion === 0) {
      return false;
    }

    const val = buffer.decodeVarintUint32();
    if (val === undefined) return false;
    this.numSymbols_ = val;

    // Reject an unreasonably high symbol count.
    if (Math.trunc(this.numSymbols_ / 64) > buffer.remainingSize) {
      return false;
    }

    const numSymbols = this.numSymbols_;
    const probabilityTable = new Uint32Array(numSymbols);
    this.probabilityTable_ = probabilityTable;
    if (numSymbols === 0) {
      return true;
    }

    // Read via a local cursor instead of a decodeUint8() call per byte.
    const data = buffer.data;
    const startPos = buffer.decodedSize;
    const endPos = startPos + buffer.remainingSize;
    let pos = startPos;
    for (let i = 0; i < numSymbols; ++i) {
      if (pos >= endPos) return false;
      const probData = data[pos++];

      // Low 2 bits = token: 0-2 is the extra-byte count, 3 is run-length of zero-prob entries.
      const token = probData & 3;
      if (token === 3) {
        const offset = probData >> 2;
        if (i + offset >= numSymbols) {
          return false;
        }
        // The run's probabilities stay 0; the freshly allocated table already is.
        i += offset;
      } else {
        const extraBytes = token;
        let prob = probData >> 2;
        for (let b = 0; b < extraBytes; ++b) {
          if (pos >= endPos) return false;
          // Shift 8 bits per extra byte, minus 2 for the two token bits.
          prob |= data[pos++] << (8 * (b + 1) - 2);
        }
        probabilityTable[i] = prob;
      }
    }
    buffer.advance(pos - startPos);

    if (!this.ans_.ransBuildLookUpTable(this.probabilityTable_, this.numSymbols_)) {
      return false;
    }
    return true;
  }

  // Starts decoding, advancing buffer past the encoded data.
  startDecoding(buffer) {
    const bytesEncoded = buffer.decodeVarintUint64();
    if (bytesEncoded === undefined) return false;

    if (bytesEncoded > buffer.remainingSize) {
      return false;
    }

    const dataHead = buffer.dataHead;
    buffer.advance(Number(bytesEncoded));
    if (this.ans_.readInit(dataHead, Number(bytesEncoded)) !== 0) {
      return false;
    }
    return true;
  }

  endDecoding() {
    this.ans_.readEnd();
  }

}
