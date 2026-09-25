// compression/point_cloud/PointCloudDecoder.js - ported from point_cloud/point_cloud_decoder.h/cc

import { Status, StatusCode, okStatus } from '../../core/Status.js';
import { MetadataDecoder } from '../../metadata/MetadataDecoder.js';
import {
  DracoHeader,
  EncodedGeometryType,
  DRACO_BITSTREAM_VERSION,
  METADATA_FLAG_MASK,
  kDracoPointCloudBitstreamVersionMajor,
  kDracoPointCloudBitstreamVersionMinor,
  kDracoMeshBitstreamVersionMajor,
  kDracoMeshBitstreamVersionMinor
} from '../config/CompressionShared.js';

// Abstract base for all point cloud and mesh decoders; holds shared logic.
class PointCloudDecoder {

  constructor() {
    this._pointCloud = null;
    this._buffer = null;
    this._versionMajor = 0;
    this._versionMinor = 0;
    this._attributesDecoders = [];
    this._attributeToDecoderMap = [];
  }

  // Returns a Status; on success outHeader is populated.
  static decodeHeader(buffer, outHeader) {
    const kIoErrorMsg = 'Failed to parse Draco header.';
    const bytes = buffer.decodeBytes(5);
    if (bytes === undefined) {
      return new Status(StatusCode.IO_ERROR, kIoErrorMsg);
    }
    const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3], bytes[4]);
    if (magic !== 'DRACO') {
      return new Status(StatusCode.DRACO_ERROR, 'Not a Draco file.');
    }
    outHeader.versionMajor = buffer.decodeUint8();
    if (outHeader.versionMajor === undefined) {
      return new Status(StatusCode.IO_ERROR, kIoErrorMsg);
    }
    outHeader.versionMinor = buffer.decodeUint8();
    if (outHeader.versionMinor === undefined) {
      return new Status(StatusCode.IO_ERROR, kIoErrorMsg);
    }
    outHeader.encoderType = buffer.decodeUint8();
    if (outHeader.encoderType === undefined) {
      return new Status(StatusCode.IO_ERROR, kIoErrorMsg);
    }
    outHeader.encoderMethod = buffer.decodeUint8();
    if (outHeader.encoderMethod === undefined) {
      return new Status(StatusCode.IO_ERROR, kIoErrorMsg);
    }
    outHeader.flags = buffer.decodeUint16();
    if (outHeader.flags === undefined) {
      return new Status(StatusCode.IO_ERROR, kIoErrorMsg);
    }
    return okStatus();
  }

  // Main entry point for point cloud decoding.
  decode(inBuffer, outPointCloud) {
    this._buffer = inBuffer;
    this._pointCloud = outPointCloud;

    const header = new DracoHeader();
    const headerStatus = PointCloudDecoder.decodeHeader(this._buffer, header);
    if (!headerStatus.ok()) {
      return headerStatus;
    }

    if (header.encoderType !== this.getGeometryType()) {
      return new Status(StatusCode.DRACO_ERROR,
        'Using incompatible decoder for the input geometry.');
    }

    this._versionMajor = header.versionMajor;
    this._versionMinor = header.versionMinor;

    const maxSupportedMajorVersion =
      header.encoderType === EncodedGeometryType.POINT_CLOUD
        ? kDracoPointCloudBitstreamVersionMajor
        : kDracoMeshBitstreamVersionMajor;
    const maxSupportedMinorVersion =
      header.encoderType === EncodedGeometryType.POINT_CLOUD
        ? kDracoPointCloudBitstreamVersionMinor
        : kDracoMeshBitstreamVersionMinor;

    // Version compatibility check.
    if (this._versionMajor < 1 || this._versionMajor > maxSupportedMajorVersion) {
      return new Status(StatusCode.UNKNOWN_VERSION, 'Unknown major version.');
    }
    if (this._versionMajor === maxSupportedMajorVersion &&
        this._versionMinor > maxSupportedMinorVersion) {
      return new Status(StatusCode.UNKNOWN_VERSION, 'Unknown minor version.');
    }

    this._buffer.bitstreamVersion =
      DRACO_BITSTREAM_VERSION(this._versionMajor, this._versionMinor);

    // Only the current Draco 2.2 mesh bitstream is supported; pre-2.2 decode
    // paths were removed, so older meshes are rejected rather than mis-decoded.
    if (header.encoderType === EncodedGeometryType.TRIANGULAR_MESH &&
        this._buffer.bitstreamVersion < DRACO_BITSTREAM_VERSION(2, 2)) {
      return new Status(StatusCode.UNKNOWN_VERSION,
        'Unsupported bitstream version (only Draco 2.2 meshes are supported).');
    }

    if (header.flags & METADATA_FLAG_MASK) {
      const metadataStatus = this._decodeMetadata();
      if (!metadataStatus.ok()) {
        return metadataStatus;
      }
    }

    if (!this.initializeDecoder()) {
      return new Status(StatusCode.DRACO_ERROR, 'Failed to initialize the decoder.');
    }
    if (!this.decodeGeometryData()) {
      return new Status(StatusCode.DRACO_ERROR, 'Failed to decode geometry data.');
    }
    if (!this.decodePointAttributes()) {
      return new Status(StatusCode.DRACO_ERROR, 'Failed to decode point attributes.');
    }
    return okStatus();
  }

  setAttributesDecoder(attDecoderId, decoder) {
    if (attDecoderId < 0) {
      return false;
    }
    while (this._attributesDecoders.length <= attDecoderId) {
      this._attributesDecoders.push(null);
    }
    this._attributesDecoders[attDecoderId] = decoder;
    return true;
  }

  getPortableAttribute(parentAttId) {
    if (parentAttId < 0 || parentAttId >= this._pointCloud.numAttributes()) {
      return null;
    }
    const parentAttDecoderId = this._attributeToDecoderMap[parentAttId];
    return this._attributesDecoders[parentAttDecoderId].getPortableAttribute(parentAttId);
  }

  attributesDecoder(decId) {
    return this._attributesDecoders[decId];
  }

  numAttributesDecoders() {
    return this._attributesDecoders.length;
  }

  pointCloud() {
    return this._pointCloud;
  }

  buffer() {
    return this._buffer;
  }

  // -- Protected virtual methods (override in subclasses) --

  initializeDecoder() {
    return true;
  }

  decodeGeometryData() {
    return true;
  }

  decodePointAttributes() {
    const numAttributesDecoders = this._buffer.decodeUint8();
    if (numAttributesDecoders === undefined) {
      return false;
    }
    for (let i = 0; i < numAttributesDecoders; ++i) {
      if (!this.createAttributesDecoder(i)) {
        return false;
      }
    }
    for (let i = 0; i < this._attributesDecoders.length; ++i) {
      if (!this._attributesDecoders[i].init(this, this._pointCloud)) {
        return false;
      }
    }
    for (let i = 0; i < numAttributesDecoders; ++i) {
      if (!this._attributesDecoders[i].decodeAttributesDecoderData(this._buffer)) {
        return false;
      }
    }
    // Map each attribute id to its decoder id.
    for (let i = 0; i < numAttributesDecoders; ++i) {
      const numAttributes = this._attributesDecoders[i].getNumAttributes();
      for (let j = 0; j < numAttributes; ++j) {
        const attId = this._attributesDecoders[i].getAttributeId(j);
        while (this._attributeToDecoderMap.length <= attId) {
          this._attributeToDecoderMap.push(0);
        }
        this._attributeToDecoderMap[attId] = i;
      }
    }
    if (!this.decodeAllAttributes()) {
      return false;
    }
    if (!this.onAttributesDecoded()) {
      return false;
    }
    return true;
  }

  decodeAllAttributes() {
    for (let i = 0; i < this._attributesDecoders.length; i++) {
      if (!this._attributesDecoders[i].decodeAttributes(this._buffer)) {
        return false;
      }
    }
    return true;
  }

  onAttributesDecoded() {
    return true;
  }

  _decodeMetadata() {
    // Skip (not surface) the geometry metadata so its bytes are consumed and the
    // bitstream stays aligned; otherwise a metadata-bearing file decodes to empty.
    const metadataDecoder = new MetadataDecoder();
    if (!metadataDecoder.skipGeometryMetadata(this._buffer)) {
      return new Status(StatusCode.DRACO_ERROR, 'Failed to decode metadata.');
    }
    return okStatus();
  }

}

export { PointCloudDecoder };
