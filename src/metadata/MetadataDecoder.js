// metadata/MetadataDecoder.js - ported from metadata/metadata_decoder.h/cc
// Metadata is never surfaced, so this only parses far enough to consume the exact
// bytes it occupies, keeping the bitstream aligned. (Full port lives in git history.)

import { decodeVarint } from '../core/VarintDecoding.js';

// Nesting-depth cap to avoid stack overflow.
const kMaxSubmetadataLevel = 1000;

class MetadataDecoder {

  constructor() {
    this.buffer_ = null;
  }

  // Skips per-attribute metadata followed by the geometry-level metadata.
  skipGeometryMetadata(inBuffer) {
    this.buffer_ = inBuffer;

    const numAttMetadata = decodeVarint(this.buffer_);
    if (numAttMetadata === undefined) {
      return false;
    }

    for (let i = 0; i < numAttMetadata; ++i) {
      // Attribute unique id, then its metadata block.
      if (decodeVarint(this.buffer_) === undefined) {
        return false;
      }
      if (!this._skipMetadata(0)) {
        return false;
      }
    }

    return this._skipMetadata(0);
  }

  // Discards one metadata block (key-value entries plus nested sub-metadata).
  // Sub-blocks read depth-first in stream order, matching the C++ stack traversal.
  _skipMetadata(level) {
    if (level > kMaxSubmetadataLevel) {
      return false;
    }

    const numEntries = decodeVarint(this.buffer_);
    if (numEntries === undefined) {
      return false;
    }
    for (let i = 0; i < numEntries; ++i) {
      if (!this._skipEntry()) {
        return false;
      }
    }

    const numSubMetadata = decodeVarint(this.buffer_);
    if (numSubMetadata === undefined) {
      return false;
    }
    if (numSubMetadata > this.buffer_.remainingSize) {
      return false;
    }
    for (let i = 0; i < numSubMetadata; ++i) {
      // Sub-metadata name, then its block.
      if (!this._skipName()) {
        return false;
      }
      if (!this._skipMetadata(level + 1)) {
        return false;
      }
    }

    return true;
  }

  // Skips a key-value entry: name then a length-prefixed value.
  _skipEntry() {
    if (!this._skipName()) {
      return false;
    }
    const dataSize = decodeVarint(this.buffer_);
    if (dataSize === undefined || dataSize === 0) {
      return false;
    }
    if (dataSize > this.buffer_.remainingSize) {
      return false;
    }
    this.buffer_.advance(dataSize);
    return true;
  }

  // Skips a name (uint8 length prefix followed by that many bytes).
  _skipName() {
    const nameLen = this.buffer_.decodeUint8();
    if (nameLen === undefined || nameLen > this.buffer_.remainingSize) {
      return false;
    }
    this.buffer_.advance(nameLen);
    return true;
  }

}

export { MetadataDecoder };
