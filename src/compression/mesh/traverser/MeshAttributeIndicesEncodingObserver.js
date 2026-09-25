// compression/mesh/traverser/MeshAttributeIndicesEncodingObserver.js - ported from compression/mesh/traverser/mesh_attribute_indices_encoding_observer.h

// Observer that records vertex visit order during mesh traversal.
// Used to generate encoding/decoding order for attribute values.
class MeshAttributeIndicesEncodingObserver {

  constructor(mesh, sequencer, encodingData) {
    this._encodingData = encodingData;
    this._sequencer = sequencer;
    this._vertexToEncodedMap = encodingData.vertexToEncodedAttributeValueIndexMap;
    this._encodedToCornerMap = encodingData.encodedAttributeValueIndexToCornerMap;
    this._faces = mesh.faces_;
  }

  onNewVertexVisited(vertex, corner) {
    const pointId = this._faces[corner];
    this._sequencer.addPointId(pointId);

    const numValues = this._encodingData.numValues;
    this._encodedToCornerMap[numValues] = corner;
    this._vertexToEncodedMap[vertex] = numValues;
    this._encodingData.numValues++;
  }

}

export { MeshAttributeIndicesEncodingObserver };
