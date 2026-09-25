// compression/attributes/prediction_schemes/PredictionSchemeDecoderFactory.js - ported from compression/attributes/prediction_schemes/prediction_scheme_decoder_factory.h

import { PredictionSchemeMethod, PredictionSchemeTransformType } from '../../config/CompressionShared.js';
import { PredictionSchemeDeltaDecoder } from './PredictionSchemeDeltaDecoder.js';
import { MeshPredictionSchemeParallelogramDecoder } from './MeshPredictionSchemeParallelogramDecoder.js';
import { MeshPredictionSchemeMultiParallelogramDecoder } from './MeshPredictionSchemeMultiParallelogramDecoder.js';
import { MeshPredictionSchemeConstrainedMultiParallelogramDecoder } from './MeshPredictionSchemeConstrainedMultiParallelogramDecoder.js';
import { MeshPredictionSchemeTexCoordsPortableDecoder } from './MeshPredictionSchemeTexCoordsPortableDecoder.js';
import { MeshPredictionSchemeGeometricNormalDecoder } from './MeshPredictionSchemeGeometricNormalDecoder.js';
import { MeshPredictionSchemeData } from './MeshPredictionSchemeData.js';

function createMeshPredictionSchemeDecoder(method, attribute, transform,
  meshData, transformType) {

  // Normal octahedron transforms only support geometric normal prediction.
  if (transformType === PredictionSchemeTransformType.PREDICTION_TRANSFORM_NORMAL_OCTAHEDRON_CANONICALIZED ||
      transformType === PredictionSchemeTransformType.PREDICTION_TRANSFORM_NORMAL_OCTAHEDRON) {
    if (method === PredictionSchemeMethod.MESH_PREDICTION_GEOMETRIC_NORMAL) {
      return new MeshPredictionSchemeGeometricNormalDecoder(
        attribute, transform, meshData
      );
    }
    return null;
  }

  // Wrap and delta transforms accept any mesh prediction scheme.
  switch (method) {
    case PredictionSchemeMethod.MESH_PREDICTION_PARALLELOGRAM:
      return new MeshPredictionSchemeParallelogramDecoder(
        attribute, transform, meshData
      );

    case PredictionSchemeMethod.MESH_PREDICTION_MULTI_PARALLELOGRAM:
      return new MeshPredictionSchemeMultiParallelogramDecoder(
        attribute, transform, meshData
      );

    case PredictionSchemeMethod.MESH_PREDICTION_CONSTRAINED_MULTI_PARALLELOGRAM:
      return new MeshPredictionSchemeConstrainedMultiParallelogramDecoder(
        attribute, transform, meshData
      );

    case PredictionSchemeMethod.MESH_PREDICTION_TEX_COORDS_PORTABLE:
      return new MeshPredictionSchemeTexCoordsPortableDecoder(
        attribute, transform, meshData
      );

    case PredictionSchemeMethod.MESH_PREDICTION_GEOMETRIC_NORMAL:
      return new MeshPredictionSchemeGeometricNormalDecoder(
        attribute, transform, meshData
      );

    default:
      return null;
  }
}

/**
 * Creates a prediction scheme for a decoder and method. If the method is
 * mesh-based and mesh data is available, builds the matching mesh scheme;
 * otherwise falls back to a delta decoder.
 */
function createPredictionSchemeForDecoder(method, attId, decoder, transform) {
  if (method === PredictionSchemeMethod.PREDICTION_NONE) {
    return null;
  }

  const att = decoder.pointCloud().attribute(attId);

  if (decoder.getGeometryType() === 1) { // TRIANGULAR_MESH
    const meshDecoder = decoder;
    const cornerTable = meshDecoder.getCornerTable();
    const encodingData = meshDecoder.getAttributeEncodingData(attId);

    if (cornerTable !== null && encodingData !== null) {
      const meshData = new MeshPredictionSchemeData();
      const attCornerTable = meshDecoder.getAttributeCornerTable(attId);

      meshData.set(
        attCornerTable !== null ? attCornerTable : cornerTable,
        encodingData.encodedAttributeValueIndexToCornerMap,
        encodingData.vertexToEncodedAttributeValueIndexMap
      );

      const transformType = transform.getType ? transform.getType() : -1;
      const ret = createMeshPredictionSchemeDecoder(
        method, att, transform, meshData, transformType
      );
      if (ret !== null) return ret;
    }
  }

  return new PredictionSchemeDeltaDecoder(att, transform);
}

export { createPredictionSchemeForDecoder };
