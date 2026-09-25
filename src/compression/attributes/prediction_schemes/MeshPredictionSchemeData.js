// compression/attributes/prediction_schemes/MeshPredictionSchemeData.js - ported from compression/attributes/prediction_schemes/mesh_prediction_scheme_data.h

/**
 * Stores mesh connectivity data and how it was encoded/decoded.
 */
class MeshPredictionSchemeData {

  constructor() {
    this._cornerTable = null;
    this._vertexToDataMap = null;
    this._dataToCornerMap = null;
  }

  set(cornerTable, dataToCornerMap, vertexToDataMap) {
    this._cornerTable = cornerTable;
    this._dataToCornerMap = dataToCornerMap;
    this._vertexToDataMap = vertexToDataMap;
  }

  get cornerTable() { return this._cornerTable; }

  get vertexToDataMap() { return this._vertexToDataMap; }

  get dataToCornerMap() { return this._dataToCornerMap; }

}

export { MeshPredictionSchemeData };
