// compression/config/CompressionShared.js - ported from compression/config/compression_shared.h

// Latest Draco bit-stream versions.
export const kDracoPointCloudBitstreamVersionMajor = 2;
export const kDracoPointCloudBitstreamVersionMinor = 3;
export const kDracoMeshBitstreamVersionMajor = 2;
export const kDracoMeshBitstreamVersionMinor = 2;

export function DRACO_BITSTREAM_VERSION(major, minor) {
  return (major << 8) | minor;
}

export const EncodedGeometryType = {
  INVALID_GEOMETRY_TYPE: -1,
  POINT_CLOUD: 0,
  TRIANGULAR_MESH: 1,
  NUM_ENCODED_GEOMETRY_TYPES: 2
};

export const MeshEncoderMethod = {
  MESH_SEQUENTIAL_ENCODING: 0,
  MESH_EDGEBREAKER_ENCODING: 1
};

export const SequentialAttributeEncoderType = {
  SEQUENTIAL_ATTRIBUTE_ENCODER_GENERIC: 0,
  SEQUENTIAL_ATTRIBUTE_ENCODER_INTEGER: 1,
  SEQUENTIAL_ATTRIBUTE_ENCODER_QUANTIZATION: 2,
  SEQUENTIAL_ATTRIBUTE_ENCODER_NORMALS: 3
};

export const PredictionSchemeMethod = {
  PREDICTION_NONE: -2,
  PREDICTION_UNDEFINED: -1,
  PREDICTION_DIFFERENCE: 0,
  MESH_PREDICTION_PARALLELOGRAM: 1,
  MESH_PREDICTION_MULTI_PARALLELOGRAM: 2,
  MESH_PREDICTION_TEX_COORDS_DEPRECATED: 3,
  MESH_PREDICTION_CONSTRAINED_MULTI_PARALLELOGRAM: 4,
  MESH_PREDICTION_TEX_COORDS_PORTABLE: 5,
  MESH_PREDICTION_GEOMETRIC_NORMAL: 6,
  NUM_PREDICTION_SCHEMES: 7
};

export const PredictionSchemeTransformType = {
  PREDICTION_TRANSFORM_NONE: -1,
  PREDICTION_TRANSFORM_DELTA: 0,
  PREDICTION_TRANSFORM_WRAP: 1,
  PREDICTION_TRANSFORM_NORMAL_OCTAHEDRON: 2,
  PREDICTION_TRANSFORM_NORMAL_OCTAHEDRON_CANONICALIZED: 3,
  NUM_PREDICTION_SCHEME_TRANSFORM_TYPES: 4
};

export const MeshTraversalMethod = {
  MESH_TRAVERSAL_DEPTH_FIRST: 0,
  MESH_TRAVERSAL_PREDICTION_DEGREE: 1,
  NUM_TRAVERSAL_METHODS: 2
};

export const MeshEdgebreakerConnectivityEncodingMethod = {
  MESH_EDGEBREAKER_STANDARD_ENCODING: 0,
  MESH_EDGEBREAKER_PREDICTIVE_ENCODING: 1, // Deprecated.
  MESH_EDGEBREAKER_VALENCE_ENCODING: 2
};

// Draco header V1
export class DracoHeader {

  constructor() {
    this.versionMajor = 0;
    this.versionMinor = 0;
    this.encoderType = 0;
    this.encoderMethod = 0;
    this.flags = 0;
  }

}

export const NormalPredictionMode = {
  ONE_TRIANGLE: 0, // To be deprecated.
  TRIANGLE_AREA: 1
};

export const SymbolCodingMethod = {
  SYMBOL_CODING_TAGGED: 0,
  SYMBOL_CODING_RAW: 1,
  NUM_SYMBOL_CODING_METHODS: 2
};

// Mask for setting and getting the bit for metadata in |flags| of header.
export const METADATA_FLAG_MASK = 0x8000;
