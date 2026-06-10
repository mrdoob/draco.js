// compression/entropy/ANSCoding.js - ported from compression/entropy/ans.h
// Asymmetric Numeral Systems (rANS), decode-only. http://arxiv.org/abs/1311.2540v2

export const ANS_P8_PRECISION = 256;
export const ANS_L_BASE = 4096;
const ANS_IO_BASE = 256;

function memGetLe16(buf, offset) {
  return buf[offset] | (buf[offset + 1] << 8);
}

function memGetLe24(buf, offset) {
  return buf[offset] | (buf[offset + 1] << 8) | (buf[offset + 2] << 16);
}

function memGetLe32(buf, offset) {
  return (
    (buf[offset]) |
    (buf[offset + 1] << 8) |
    (buf[offset + 2] << 16) |
    ((buf[offset + 3] << 24) >>> 0) // >>> 0 to stay unsigned
  );
}

export class AnsDecoder {

  constructor() {
    this.buf = null; // Uint8Array
    this.bufOffset = 0;
    this.state = 0;
  }

}

// offset is the number of encoded bytes. Returns 0 on success, 1 on error.
export function ansReadInit(ans, buf, offset) {
  if (offset < 1) {
    return 1;
  }
  ans.buf = buf;
  const x = buf[offset - 1] >> 6;
  if (x === 0) {
    ans.bufOffset = offset - 1;
    ans.state = buf[offset - 1] & 0x3F;
  } else if (x === 1) {
    if (offset < 2) {
      return 1;
    }
    ans.bufOffset = offset - 2;
    ans.state = memGetLe16(buf, offset - 2) & 0x3FFF;
  } else if (x === 2) {
    if (offset < 3) {
      return 1;
    }
    ans.bufOffset = offset - 3;
    ans.state = memGetLe24(buf, offset - 3) & 0x3FFFFF;
  } else {
    return 1;
  }
  ans.state += ANS_L_BASE;
  if (ans.state >= ANS_L_BASE * ANS_IO_BASE) {
    return 1;
  }
  return 0;
}

export function ansReadEnd(ans) {
  return ans.state === ANS_L_BASE;
}

export class RAnsDecoder {

  constructor(ransPrecisionBits) {
    this.ransPrecisionBits = ransPrecisionBits;
    this.ransPrecision = 1 << ransPrecisionBits;
    this.ransPrecisionMask = this.ransPrecision - 1;
    this.lRansBase = this.ransPrecision * 4;
    this.lutTable = null; // Uint32Array
    this.probTable = null; // Uint32Array, flat
    this.cumProbTable = null; // Uint32Array, flat
    // State inlined (not a nested AnsDecoder) so the ransRead() hot loop touches own props.
    this.buf = null;
    this.bufOffset = 0;
    this.state = 0;
  }

  // offset is the number of bytes encoded. Returns 0 on success, non-zero on error.
  readInit(buf, offset) {
    if (offset < 1) {
      return 1;
    }
    this.buf = buf;
    const x = buf[offset - 1] >> 6;
    if (x === 0) {
      this.bufOffset = offset - 1;
      this.state = buf[offset - 1] & 0x3F;
    } else if (x === 1) {
      if (offset < 2) {
        return 1;
      }
      this.bufOffset = offset - 2;
      this.state = memGetLe16(buf, offset - 2) & 0x3FFF;
    } else if (x === 2) {
      if (offset < 3) {
        return 1;
      }
      this.bufOffset = offset - 3;
      this.state = memGetLe24(buf, offset - 3) & 0x3FFFFF;
    } else if (x === 3) {
      this.bufOffset = offset - 4;
      this.state = memGetLe32(buf, offset - 4) & 0x3FFFFFFF;
    } else {
      return 1;
    }
    this.state += this.lRansBase;
    if (this.state >= this.lRansBase * ANS_IO_BASE) {
      return 1;
    }
    return 0;
  }

  readEnd() {
    return this.state === this.lRansBase;
  }

  ransRead() {
    // Cache state in locals for the renormalization loop: read once, write back once.
    const buf = this.buf;
    const lRansBase = this.lRansBase;
    let state = this.state;
    let bufOffset = this.bufOffset;
    while (state < lRansBase && bufOffset > 0) {
      state = (state << 8) | buf[--bufOffset];
    }
    const quo = state >>> this.ransPrecisionBits;
    const rem = state & this.ransPrecisionMask;
    const symbol = this.lutTable[rem];
    this.state = quo * this.probTable[symbol] + rem - this.cumProbTable[symbol];
    this.bufOffset = bufOffset;
    return symbol;
  }

  // Batch ransRead() into out[0..count): all fields hoisted to locals, state
  // written back once. Removes per-symbol property reads and call indirection.
  decodeSymbols(out, count) {
    const buf = this.buf;
    const lRansBase = this.lRansBase;
    const ransPrecisionBits = this.ransPrecisionBits;
    const ransPrecisionMask = this.ransPrecisionMask;
    const lutTable = this.lutTable;
    const probTable = this.probTable;
    const cumProbTable = this.cumProbTable;
    let state = this.state;
    let bufOffset = this.bufOffset;
    for (let i = 0; i < count; ++i) {
      while (state < lRansBase && bufOffset > 0) {
        state = (state << 8) | buf[--bufOffset];
      }
      const rem = state & ransPrecisionMask;
      const symbol = lutTable[rem];
      out[i] = symbol;
      state = (state >>> ransPrecisionBits) * probTable[symbol] + rem - cumProbTable[symbol];
    }
    this.state = state;
    this.bufOffset = bufOffset;
  }

  // Builds the ransPrecision-entry lookup table. Returns false on bad input data.
  ransBuildLookUpTable(tokenProbs, numSymbols) {
    // lutTable is indexed by `rem` (random in [0, ransPrecision)), so it's the
    // hottest random read in decodeSymbols()/ransRead(). Its values are symbol
    // ids (< numSymbols), so pick the narrowest element type that holds them:
    // shrinking the table (up to 4x) keeps that random access closer to cache.
    const LutArray = numSymbols <= 256 ? Uint8Array
      : (numSymbols <= 65536 ? Uint16Array : Uint32Array);
    const lutTable = new LutArray(this.ransPrecision);
    const probTable = new Uint32Array(numSymbols);
    const cumProbTable = new Uint32Array(numSymbols);
    this.lutTable = lutTable;
    this.probTable = probTable;
    this.cumProbTable = cumProbTable;
    let cumProb = 0;
    let actProb = 0;
    for (let i = 0; i < numSymbols; ++i) {
      const prob = tokenProbs[i];
      probTable[i] = prob;
      cumProbTable[i] = cumProb;
      cumProb += prob;
      if (cumProb > this.ransPrecision) {
        return false;
      }
      // Manual loop for short runs: fill()'s per-call overhead dominates them.
      if (prob < 32) {
        for (let j = actProb; j < cumProb; ++j) {
          lutTable[j] = i;
        }
      } else {
        lutTable.fill(i, actProb, cumProb);
      }
      actProb = cumProb;
    }
    if (cumProb !== this.ransPrecision) {
      return false;
    }
    return true;
  }

}
