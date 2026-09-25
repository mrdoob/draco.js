// core/DataBuffer.js - ported from data_buffer.h/cc

export class DataBuffer {

  constructor() {
    this._data = new Uint8Array(0);
  }

  resize(newSize) {
    if (newSize < 0) return false;
    if (newSize === this._data.length) return true;
    const newData = new Uint8Array(newSize);
    newData.set(this._data.subarray(0, Math.min(this._data.length, newSize)));
    this._data = newData;
    return true;
  }

  write(bytePos, inArray, dataSize) {
    // Fast path: the common caller passes a Uint8Array of exactly dataSize bytes.
    // Avoid allocating a wrapper view per value (dominates storage time / GC pressure).
    if (inArray instanceof Uint8Array) {
      this._data.set(inArray.length === dataSize ? inArray : inArray.subarray(0, dataSize), bytePos);
      return;
    }
    const src = new Uint8Array(inArray.buffer || inArray, inArray.byteOffset || 0, dataSize);
    this._data.set(src, bytePos);
  }

  get data() { return this._data; }
}
