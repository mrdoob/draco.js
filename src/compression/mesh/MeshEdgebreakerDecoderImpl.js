// compression/mesh/MeshEdgebreakerDecoderImpl.js - ported from mesh/mesh_edgebreaker_decoder_impl.h/cc

import { DecoderBuffer } from '../../core/DecoderBuffer.js';
import { decodeVarint } from '../../core/VarintDecoding.js';
import { MeshTraversalMethod } from '../config/CompressionShared.js';
import { MeshAttributeElementType } from '../../mesh/Mesh.js';
import {
  TOPOLOGY_C, TOPOLOGY_S, TOPOLOGY_L, TOPOLOGY_R, TOPOLOGY_E,
  TopologySplitEventData,
  RIGHT_FACE_EDGE
} from './MeshEdgebreakerShared.js';
import { SequentialAttributeDecodersController } from '../attributes/SequentialAttributeDecodersController.js';
import { DepthFirstTraverser } from './traverser/DepthFirstTraverser.js';
import { MaxPredictionDegreeTraverser } from './traverser/MaxPredictionDegreeTraverser.js';
import { MeshTraversalSequencer } from './traverser/MeshTraversalSequencer.js';
import { MeshAttributeIndicesEncodingObserver } from './traverser/MeshAttributeIndicesEncodingObserver.js';
import { MeshAttributeCornerTable } from '../../mesh/MeshAttributeCornerTable.js';

const kInvalidCornerIndex = -1;

// Edgebreaker decoder; based on Isenburg et al'02 "Spirale Reversi: Reverse
// decoding of the Edgebreaker encoding".
class MeshEdgebreakerDecoderImpl {

  constructor(TraversalDecoderClass) {
    this._decoder = null;
    this._cornerTable = null;
    this._cornerTraversalStack = [];
    this._topologySplitData = [];
    this._initFaceConfigurations = [];
    this._initCorners = [];
    this._isVertHole = [];
    this._numEncodedVertices = 0;
    this._posEncodingData = new MeshAttributeIndicesEncodingData();
    this._posDataDecoderId = -1;
    // Cache of vertex-traversal results keyed by corner table, so attributes
    // sharing connectivity traverse once.
    this._vertexTraversalCache = new Map();
    this._attributeData = [];
    this._traversalDecoder = new TraversalDecoderClass();
  }

  init(decoder) {
    this._decoder = decoder;
    return true;
  }

  getDecoder() {
    return this._decoder;
  }

  getCornerTable() {
    return this._cornerTable;
  }

  getAttributeCornerTable(attId) {
    for (let i = 0; i < this._attributeData.length; ++i) {
      const decoderId = this._attributeData[i].decoderId;
      if (decoderId < 0 || decoderId >= this._decoder.numAttributesDecoders()) {
        continue;
      }
      const dec = this._decoder.attributesDecoder(decoderId);
      for (let j = 0; j < dec.getNumAttributes(); ++j) {
        if (dec.getAttributeId(j) === attId) {
          if (this._attributeData[i].isConnectivityUsed) {
            return this._attributeData[i].connectivityData;
          }
          return null;
        }
      }
    }
    return null;
  }

  getAttributeEncodingData(attId) {
    for (let i = 0; i < this._attributeData.length; ++i) {
      const decoderId = this._attributeData[i].decoderId;
      if (decoderId < 0 || decoderId >= this._decoder.numAttributesDecoders()) {
        continue;
      }
      const dec = this._decoder.attributesDecoder(decoderId);
      for (let j = 0; j < dec.getNumAttributes(); ++j) {
        if (dec.getAttributeId(j) === attId) {
          return this._attributeData[i].encodingData;
        }
      }
    }
    return this._posEncodingData;
  }

  createAttributesDecoder(attDecoderId) {
    const attDataId = this._decoder.buffer().decodeInt8();
    if (attDataId === undefined) return false;

    const decoderType = this._decoder.buffer().decodeUint8();
    if (decoderType === undefined) return false;

    if (attDataId >= 0) {
      if (attDataId >= this._attributeData.length) {
        return false; // Unexpected attribute data.
      }
      if (this._attributeData[attDataId].decoderId >= 0) {
        return false;
      }
      this._attributeData[attDataId].decoderId = attDecoderId;
    } else {
      if (this._posDataDecoderId >= 0) {
        return false;
      }
      this._posDataDecoderId = attDecoderId;
    }

    const traversalMethod = this._decoder.buffer().decodeUint8();
    if (traversalMethod === undefined) return false;
    if (traversalMethod >= MeshTraversalMethod.NUM_TRAVERSAL_METHODS) {
      return false;
    }

    const mesh = this._decoder.mesh();
    let sequencer = null;

    if (decoderType === MeshAttributeElementType.MESH_VERTEX_ATTRIBUTE) {
      let encodingData = null;
      if (attDataId < 0) {
        encodingData = this._posEncodingData;
      } else {
        encodingData = this._attributeData[attDataId].encodingData;
        this._attributeData[attDataId].isConnectivityUsed = false;
      }

      sequencer = this._createVertexTraversalSequencer(
        encodingData, this._cornerTable, mesh, traversalMethod);
    } else {
      // Per-corner attribute decoder.
      if (traversalMethod !== MeshTraversalMethod.MESH_TRAVERSAL_DEPTH_FIRST) {
        return false;
      }
      if (attDataId < 0) {
        return false;
      }

      const encodingData = this._attributeData[attDataId].encodingData;
      const attCornerTable = this._attributeData[attDataId].connectivityData;

      sequencer = this._createVertexTraversalSequencer(
        encodingData, attCornerTable, mesh, traversalMethod);
    }

    if (!sequencer) {
      return false;
    }

    const attController = new SequentialAttributeDecodersController(sequencer);
    return this._decoder.setAttributesDecoder(attDecoderId, attController);
  }

  _createVertexTraversalSequencer(encodingData, cornerTable, mesh, traversalMethod) {
    const traversalSequencer = new MeshTraversalSequencer(
      mesh, encodingData, this._vertexTraversalCache);

    const observer = new MeshAttributeIndicesEncodingObserver(
      cornerTable, mesh, traversalSequencer, encodingData);

    const traverser =
      traversalMethod === MeshTraversalMethod.MESH_TRAVERSAL_PREDICTION_DEGREE
        ? new MaxPredictionDegreeTraverser()
        : new DepthFirstTraverser();
    traverser.init(cornerTable, observer);

    traversalSequencer.setTraverser(traverser);
    return traversalSequencer;
  }

  decodeConnectivity() {
    const numEncodedVertices = decodeVarint(this._decoder.buffer());
    if (numEncodedVertices === undefined) return false;
    this._numEncodedVertices = numEncodedVertices;

    const numFaces = decodeVarint(this._decoder.buffer());
    if (numFaces === undefined) return false;

    if (numFaces > 0x7FFFFFFF / 3) {
      return false; // Draco cannot handle this many faces.
    }
    if (this._numEncodedVertices > numFaces * 3) {
      return false;
    }

    // Min edges assuming each is shared by two faces vs max edges between the
    // vertices; if max < min a manifold mesh is impossible.
    const minNumFaceEdges = Math.floor(3 * numFaces / 2);
    const maxNumVertexEdges = this._numEncodedVertices *
      (this._numEncodedVertices - 1) / 2;
    if (maxNumVertexEdges < minNumFaceEdges) {
      return false;
    }

    const numAttributeData = this._decoder.buffer().decodeUint8();
    if (numAttributeData === undefined) return false;

    const numEncodedSymbols = decodeVarint(this._decoder.buffer());
    if (numEncodedSymbols === undefined) return false;

    if (numFaces < numEncodedSymbols) {
      return false;
    }
    const maxEncodedFaces = numEncodedSymbols + Math.floor(numEncodedSymbols / 3);
    if (numFaces > maxEncodedFaces) {
      return false;
    }

    const numEncodedSplitSymbols = decodeVarint(this._decoder.buffer());
    if (numEncodedSplitSymbols === undefined) return false;

    if (numEncodedSplitSymbols > numEncodedSymbols) {
      return false; // Split symbols are a sub-set of all symbols.
    }
    this._cornerTable = new CornerTable();
    this._vertexTraversalCache = new Map();
    this._topologySplitData = [];
    this._initFaceConfigurations = [];
    this._initCorners = [];

    this._attributeData = [];
    for (let i = 0; i < numAttributeData; ++i) {
      const ad = new AttributeData();
      ad.attributeSeamCorners = new Int32Array(numFaces * 3);
      ad.numSeamCorners = 0;
      this._attributeData.push(ad);
    }

    if (!this._cornerTable.reset(
      numFaces, this._numEncodedVertices + numEncodedSplitSymbols)) {
      return false;
    }

    // All vertices start as holes (boundaries). Uint8Array (1=hole) keeps the
    // per-vertex reads/writes monomorphic; vertex count never exceeds this
    // length (enforced via maxNumVertices), so fixed-size storage is safe.
    this._isVertHole = new Uint8Array(
      this._numEncodedVertices + numEncodedSplitSymbols).fill(1);

    if (this._decodeHoleAndTopologySplitEvents(this._decoder.buffer()) === -1) {
      return false;
    }

    this._traversalDecoder.init(this);
    // One extra vertex per split symbol.
    this._traversalDecoder.setNumEncodedVertices(
      this._numEncodedVertices + numEncodedSplitSymbols);
    this._traversalDecoder.setNumAttributeData(numAttributeData);

    const traversalEndBuffer = new DecoderBuffer();
    if (!this._traversalDecoder.start(traversalEndBuffer)) {
      return false;
    }

    const numConnectivityVerts = this._decodeConnectivity(numEncodedSymbols);
    if (numConnectivityVerts === -1) {
      return false;
    }

    this._decoder.buffer().init(
      traversalEndBuffer.dataHead,
      traversalEndBuffer.remainingSize,
      this._decoder.buffer().bitstreamVersion
    );

    if (this._attributeData.length > 0) {
      this._decodeAttributeConnectivities();
    }
    this._traversalDecoder.done();

    let previousConnectivityData = null;
    for (let i = 0; i < this._attributeData.length; ++i) {
      const connectivityData = this._attributeData[i].connectivityData;
      connectivityData.initEmpty(this._cornerTable);
      // Indexed loop avoids a for..of iterator per seam.
      const seamCorners = this._attributeData[i].attributeSeamCorners;
      const seamCount = this._attributeData[i].numSeamCorners;
      for (let s = 0; s < seamCount; ++s) {
        connectivityData.addSeamEdge(seamCorners[s]);
      }
      if (connectivityData.hasSameSeams(previousConnectivityData)) {
        connectivityData.adoptVertexRecompute(previousConnectivityData);
      } else if (!connectivityData.recomputeVertices(null, null)) {
        return false;
      }
      previousConnectivityData = connectivityData;
    }

    this._posEncodingData.init(this._cornerTable.numVertices());
    for (let i = 0; i < this._attributeData.length; ++i) {
      let attConnectivityVerts =
        this._attributeData[i].connectivityData.numVertices();
      if (attConnectivityVerts < this._cornerTable.numVertices()) {
        attConnectivityVerts = this._cornerTable.numVertices();
      }
      this._attributeData[i].encodingData.init(attConnectivityVerts);
    }
    if (!this._assignPointsToCorners(numConnectivityVerts)) {
      return false;
    }
    return true;
  }

  onAttributesDecoded() {
    return true;
  }

  _isTopologySplit(encoderSymbolId, outResult) {
    if (this._topologySplitData.length === 0) {
      return false;
    }
    const back = this._topologySplitData[this._topologySplitData.length - 1];
    if (back.sourceSymbolId > encoderSymbolId) {
      // Malformed: source symbol is greater than the current encoder_symbol_id.
      outResult.encoderSplitSymbolId = -1;
      return true;
    }
    if (back.sourceSymbolId !== encoderSymbolId) {
      return false;
    }
    outResult.faceEdge = back.sourceEdge;
    outResult.encoderSplitSymbolId = back.splitSymbolId;
    this._topologySplitData.pop();
    return true;
  }


  _decodeConnectivity(numSymbols) {
    // Reverse decoding of the edgebreaker-encoded symbols.
    const activeCornerStack =
      new Int32Array(numSymbols + this._topologySplitData.length + 16);
    let activeCornerStackSize = 0;
    const topologySplitActiveCorners = new Map();
    const invalidVertices = [];
    const removeInvalidVertices = this._attributeData.length === 0;

    let maxNumVertices = this._isVertHole.length;
    let numFacesDecoded = 0;

    // Hoist the two corner-indexed flat arrays. Unlike _vertexCorners (grown by
    // addNewVertex), these are sized once in reset() and never reallocated, so
    // direct indexed writes are safe and skip the per-call method dispatch that
    // showed up in profiles. All corners written below are fresh (>= 0).
    const cornerToVertex = this._cornerTable._cornerToVertex;
    const oppositeCorners = this._cornerTable._oppositeCorners;
    const numCorners = this._cornerTable.numCorners();

    // Inlinable accessors that handle negative indices and avoid polymorphic dispatch.
    const next = (c) => c < 0 ? -1 : ((c % 3 === 2) ? c - 2 : c + 1);
    const prev = (c) => c < 0 ? -1 : ((c % 3 === 0) ? c + 2 : c - 1);
    const vertex = (c) => (c < 0 || c >= numCorners) ? -1 : cornerToVertex[c];
    const opposite = (c) => (c < 0 || c >= numCorners) ? -1 : oppositeCorners[c];
    const leftMostCorner = (v) => (v < 0 || v >= this._cornerTable._vertexCorners.length) ? -1 : this._cornerTable._vertexCorners[v];

    const swingLeft = (c) => {
      const n = next(c);
      const o = opposite(n);
      return o < 0 ? -1 : next(o);
    };
    const swingRight = (c) => {
      const p = prev(c);
      const o = opposite(p);
      return o < 0 ? -1 : prev(o);
    };

    // Hot loop: accessors are inlined as flat-array reads + corner-triple
    // arithmetic rather than calling the helpers above. _decodeConnectivity
    // exceeds V8's inlining budget, so those helpers stayed real monomorphic
    // calls costing ~15% of decode in profiles. All corners reached here in a
    // well-formed stream are valid (>= 0, < numCorners) and the flat arrays are
    // -1-initialized, so the helpers' guards are unneeded -- except the swing-
    // left boundary terminator below. Helpers remain for the cold post-loop code.
    const vc = this._cornerTable; // _vertexCorners is re-read (addNewVertex may realloc).
    for (let symbolId = 0; symbolId < numSymbols; ++symbolId) {
      const faceIndex = numFacesDecoded++;
      let checkTopologySplit = false;
      const symbol = this._traversalDecoder.decodeSymbol();

      if (symbol === TOPOLOGY_C) {
        // Create a new face between two edges on the open boundary.
        if (activeCornerStackSize === 0) return -1;

        const cornerA = activeCornerStack[activeCornerStackSize - 1];
        const nA = cornerA % 3 === 2 ? cornerA - 2 : cornerA + 1; // next(cornerA)
        const vertexX = cornerToVertex[nA];
        const lmcX = vc._vertexCorners[vertexX];                  // leftMostCorner(vertexX)
        const cornerB = lmcX % 3 === 2 ? lmcX - 2 : lmcX + 1;     // next(lmcX)

        if (cornerA === cornerB) return -1;
        if (oppositeCorners[cornerA] !== kInvalidCornerIndex ||
            oppositeCorners[cornerB] !== kInvalidCornerIndex) {
          return -1;
        }

        const corner = 3 * faceIndex;
        oppositeCorners[cornerA] = corner + 1;
        oppositeCorners[corner + 1] = cornerA;
        oppositeCorners[cornerB] = corner + 2;
        oppositeCorners[corner + 2] = cornerB;

        const pA = cornerA % 3 === 0 ? cornerA + 2 : cornerA - 1; // prev(cornerA)
        const nB = cornerB % 3 === 2 ? cornerB - 2 : cornerB + 1; // next(cornerB)
        const vertAPrev = cornerToVertex[pA];
        const vertBNext = cornerToVertex[nB];

        if (vertexX === vertAPrev || vertexX === vertBNext) return -1;

        cornerToVertex[corner] = vertexX;
        cornerToVertex[corner + 1] = vertBNext;
        cornerToVertex[corner + 2] = vertAPrev;
        vc._vertexCorners[vertAPrev] = corner + 2;
        this._isVertHole[vertexX] = 0; // mark vertex x interior
        activeCornerStack[activeCornerStackSize - 1] = corner;

      } else if (symbol === TOPOLOGY_R || symbol === TOPOLOGY_L) {
        // Create a new face extending from the open boundary edge.
        if (activeCornerStackSize === 0) return -1;

        const cornerA = activeCornerStack[activeCornerStackSize - 1];
        if (oppositeCorners[cornerA] !== kInvalidCornerIndex) {
          return -1;
        }

        const corner = 3 * faceIndex;
        let oppCorner, cornerL, cornerR;
        if (symbol === TOPOLOGY_R) {
          oppCorner = corner + 2;
          cornerL = corner + 1;
          cornerR = corner;
        } else {
          oppCorner = corner + 1;
          cornerL = corner;
          cornerR = corner + 2;
        }
        oppositeCorners[oppCorner] = cornerA;
        oppositeCorners[cornerA] = oppCorner;

        const newVertIndex = this._cornerTable.addNewVertex();
        if (this._cornerTable.numVertices() > maxNumVertices) return -1;

        cornerToVertex[oppCorner] = newVertIndex;
        vc._vertexCorners[newVertIndex] = oppCorner;

        const pA = cornerA % 3 === 0 ? cornerA + 2 : cornerA - 1; // prev(cornerA)
        const vertexR = cornerToVertex[pA];
        cornerToVertex[cornerR] = vertexR;
        vc._vertexCorners[vertexR] = cornerR;

        const nA = cornerA % 3 === 2 ? cornerA - 2 : cornerA + 1; // next(cornerA)
        cornerToVertex[cornerL] = cornerToVertex[nA];

        activeCornerStack[activeCornerStackSize - 1] = corner;
        checkTopologySplit = true;

      } else if (symbol === TOPOLOGY_S) {
        // Merge the two last active edges from the active stack into a new face.
        if (activeCornerStackSize === 0) return -1;

        const cornerB = activeCornerStack[activeCornerStackSize - 1];
        activeCornerStackSize--;

        // Corner "a" may be a normal active edge or one from a topology split event.
        const splitCorner = topologySplitActiveCorners.get(symbolId);
        if (splitCorner !== undefined) {
          activeCornerStack[activeCornerStackSize++] = splitCorner;
        }
        if (activeCornerStackSize === 0) return -1;

        const cornerA = activeCornerStack[activeCornerStackSize - 1];
        if (cornerA === cornerB) return -1;
        if (oppositeCorners[cornerA] !== kInvalidCornerIndex ||
            oppositeCorners[cornerB] !== kInvalidCornerIndex) {
          return -1;
        }

        const corner = 3 * faceIndex;
        oppositeCorners[cornerA] = corner + 2;
        oppositeCorners[corner + 2] = cornerA;
        oppositeCorners[cornerB] = corner + 1;
        oppositeCorners[corner + 1] = cornerB;

        const pA = cornerA % 3 === 0 ? cornerA + 2 : cornerA - 1; // prev(cornerA)
        const vertexP = cornerToVertex[pA];
        cornerToVertex[corner] = vertexP;
        const nA = cornerA % 3 === 2 ? cornerA - 2 : cornerA + 1; // next(cornerA)
        cornerToVertex[corner + 1] = cornerToVertex[nA];

        const pB = cornerB % 3 === 0 ? cornerB + 2 : cornerB - 1; // prev(cornerB)
        const vertBPrev = cornerToVertex[pB];
        cornerToVertex[corner + 2] = vertBPrev;
        vc._vertexCorners[vertBPrev] = corner + 2;

        let cornerN = cornerB % 3 === 2 ? cornerB - 2 : cornerB + 1; // next(cornerB)
        const vertexN = cornerToVertex[cornerN];
        this._traversalDecoder.mergeVertices(vertexP, vertexN);
        // Update the left-most corner on the newly merged vertex.
        vc._vertexCorners[vertexP] = vc._vertexCorners[vertexN]; // leftMostCorner(vertexN)

        // Update vertex id at corner "n" and all corners CCW from it.
        // swingLeft(c) = next(opposite(next(c))).
        const firstCorner = cornerN;
        while (cornerN !== kInvalidCornerIndex) {
          cornerToVertex[cornerN] = vertexP;
          const sn = cornerN % 3 === 2 ? cornerN - 2 : cornerN + 1; // next(cornerN)
          const so = oppositeCorners[sn];                           // opposite(sn)
          cornerN = so < 0 ? -1 : (so % 3 === 2 ? so - 2 : so + 1); // next(so) or boundary
          if (cornerN === firstCorner) {
            return -1; // back at start: should not happen for split symbols
          }
        }
        // Isolate the old vertex n.
        vc._vertexCorners[vertexN] = -1;
        if (removeInvalidVertices) {
          invalidVertices.push(vertexN);
        }
        activeCornerStack[activeCornerStackSize - 1] = corner;

      } else if (symbol === TOPOLOGY_E) {
        const corner = 3 * faceIndex;
        const firstVertIndex = this._cornerTable.addNewVertex();
        // Three new vertices at the corners of the new face.
        this._cornerTable.addNewVertex();
        this._cornerTable.addNewVertex();

        if (this._cornerTable.numVertices() > maxNumVertices) return -1;

        cornerToVertex[corner] = firstVertIndex;
        cornerToVertex[corner + 1] = firstVertIndex + 1;
        cornerToVertex[corner + 2] = firstVertIndex + 2;

        vc._vertexCorners[firstVertIndex] = corner;
        vc._vertexCorners[firstVertIndex + 1] = corner + 1;
        vc._vertexCorners[firstVertIndex + 2] = corner + 2;
        activeCornerStack[activeCornerStackSize++] = corner; // push the tip corner
        checkTopologySplit = true;

      } else {
        return -1; // unknown symbol
      }

      this._traversalDecoder.newActiveCornerReached(
        activeCornerStack[activeCornerStackSize - 1]);

      if (checkTopologySplit) {
        const encoderSymbolId = numSymbols - symbolId - 1;
        const splitResult = { faceEdge: 0, encoderSplitSymbolId: 0 };
        while (this._isTopologySplit(encoderSymbolId, splitResult)) {
          if (splitResult.encoderSplitSymbolId < 0) return -1;

          const actTopCorner = activeCornerStack[activeCornerStackSize - 1];
          let newActiveCorner;
          if (splitResult.faceEdge === RIGHT_FACE_EDGE) {
            // next(actTopCorner)
            newActiveCorner = actTopCorner % 3 === 2 ? actTopCorner - 2 : actTopCorner + 1;
          } else {
            // prev(actTopCorner)
            newActiveCorner = actTopCorner % 3 === 0 ? actTopCorner + 2 : actTopCorner - 1;
          }
          // Encoder split symbol id -> decoder symbol id.
          const decoderSplitSymbolId =
            numSymbols - splitResult.encoderSplitSymbolId - 1;
          topologySplitActiveCorners.set(decoderSplitSymbolId, newActiveCorner);
        }
      }
    }

    if (this._cornerTable.numVertices() > maxNumVertices) {
      return -1;
    }

    // Decode start faces and connect them to the faces from the active stack.
    while (activeCornerStackSize > 0) {
      const corner = activeCornerStack[activeCornerStackSize - 1];
      activeCornerStackSize--;

      const interiorFace =
        this._traversalDecoder.decodeStartFaceConfiguration();

      if (interiorFace) {
        if (numFacesDecoded >= this._cornerTable.numFaces()) {
          return -1;
        }

        const cornerA = corner;
        const vertN = vertex(next(cornerA));
        const cornerB = next(leftMostCorner(vertN));

        const vertX = vertex(next(cornerB));
        const cornerC = next(leftMostCorner(vertX));

        if (corner === cornerB || corner === cornerC || cornerB === cornerC) {
          return -1;
        }
        if (opposite(corner) !== kInvalidCornerIndex ||
            opposite(cornerB) !== kInvalidCornerIndex ||
            opposite(cornerC) !== kInvalidCornerIndex) {
          return -1;
        }

        const vertP = vertex(next(cornerC));

        const faceIndex = numFacesDecoded++;
        const newCorner = 3 * faceIndex;
        oppositeCorners[newCorner] = corner;
        oppositeCorners[corner] = newCorner;
        oppositeCorners[newCorner + 1] = cornerB;
        oppositeCorners[cornerB] = newCorner + 1;
        oppositeCorners[newCorner + 2] = cornerC;
        oppositeCorners[cornerC] = newCorner + 2;

        cornerToVertex[newCorner] = vertX;
        cornerToVertex[newCorner + 1] = vertP;
        cornerToVertex[newCorner + 2] = vertN;

        // Mark all three vertices interior.
        this._isVertHole[vertX] = 0;
        this._isVertHole[vertP] = 0;
        this._isVertHole[vertN] = 0;

        this._initFaceConfigurations.push(true);
        this._initCorners.push(newCorner);
      } else {
        // The initial face wasn't interior.
        this._initFaceConfigurations.push(false);
        this._initCorners.push(corner);
      }
    }

    if (numFacesDecoded !== this._cornerTable.numFaces()) {
      return -1;
    }

    let numVertices = this._cornerTable.numVertices();
    // Remove invalid (isolated) vertices by swapping them with the last valid
    // vertex in the table. Matches C++ mesh_edgebreaker_decoder_impl.cc.
    // Must iterate forward (not reverse) to match C++ iteration order.
    for (let ivIdx = 0; ivIdx < invalidVertices.length; ++ivIdx) {
      const invalidVert = invalidVertices[ivIdx];
      let srcVert = numVertices - 1;
      while (leftMostCorner(srcVert) === kInvalidCornerIndex) {
        srcVert = --numVertices - 1;
      }
      if (srcVert < invalidVert) continue;

      // Remap all corners of srcVert to invalidVert. VertexCornersIterator
      // logic: swing left first, then swing right on boundary.
      const startCid = leftMostCorner(srcVert);
      let cid = startCid;
      let leftTraversal = true;
      while (cid !== kInvalidCornerIndex) {
        if (vertex(cid) !== srcVert) {
          return -1;
        }
        cornerToVertex[cid] = invalidVert;
        if (leftTraversal) {
          const nextC = swingLeft(cid);
          if (nextC === kInvalidCornerIndex) {
            // Open boundary reached; switch to right traversal from start.
            leftTraversal = false;
            cid = swingRight(startCid);
          } else if (nextC === startCid) {
            break; // closed fan
          } else {
            cid = nextC;
          }
        } else {
          cid = swingRight(cid);
        }
      }

      this._cornerTable._vertexCorners[invalidVert] = leftMostCorner(srcVert);
      this._cornerTable._vertexCorners[srcVert] = -1;
      this._isVertHole[invalidVert] = this._isVertHole[srcVert];
      this._isVertHole[srcVert] = 0;
      numVertices--;
    }
    return numVertices;
  }

  // Hole events were removed from the bitstream in 2.1; for 2.2 this only
  // decodes the inline topology-split events.
  _decodeHoleAndTopologySplitEvents(decoderBuffer) {
    const numTopologySplits = decodeVarint(decoderBuffer);
    if (numTopologySplits === undefined) return -1;

    if (numTopologySplits > 0) {
      if (numTopologySplits > this._cornerTable.numFaces()) {
        return -1;
      }
      // Source and split symbol ids use delta + varint coding.
      let lastSourceSymbolId = 0;
      for (let i = 0; i < numTopologySplits; ++i) {
        const eventData = new TopologySplitEventData();
        const delta = decodeVarint(decoderBuffer);
        if (delta === undefined) return -1;
        eventData.sourceSymbolId = delta + lastSourceSymbolId;
        const delta2 = decodeVarint(decoderBuffer);
        if (delta2 === undefined) return -1;
        if (delta2 > eventData.sourceSymbolId) return -1;
        eventData.splitSymbolId = eventData.sourceSymbolId - delta2;
        lastSourceSymbolId = eventData.sourceSymbolId;
        this._topologySplitData.push(eventData);
      }
      // Split edges come from a direct bit decoder.
      decoderBuffer.startBitDecoding(false);
      for (let i = 0; i < numTopologySplits; ++i) {
        const edgeData = decoderBuffer.decodeLeastSignificantBits32(1);
        this._topologySplitData[i].sourceEdge = edgeData & 1;
      }
      decoderBuffer.endBitDecoding();
    }
    return decoderBuffer.decodedSize;
  }

  // Decode every face's attribute seam connectivity in one flat pass over
  // corners (bitstream >= 2.1). The per-face entry point this replaces re-read
  // the opposite-corner array, attribute-data list and connectivity decoders on
  // each of its numFaces calls; hoisting them here leaves only the irreducible
  // per-corner decodeNextBit work. Within each face the three corners are
  // visited in encoder edge order [base, next, prev] = [c, c+1, c+2] (the
  // caller always starts a face at its base corner, so next/prev need no wrap).
  _decodeAttributeConnectivities() {
    const oppositeCorners = this._cornerTable.oppositeCornerArray();
    const attributeData = this._attributeData;
    const numAttrData = attributeData.length;
    const connectivityDecoders =
      this._traversalDecoder._attributeConnectivityDecoders;
    const numCorners = this._cornerTable.numCorners();

    for (let corner = 0; corner < numCorners; corner += 3) {
      const srcFaceId = (corner / 3) | 0;
      for (let k = 0; k < 3; ++k) {
        const cc = corner + k;
        const oppCorner = oppositeCorners[cc];
        if (oppCorner === kInvalidCornerIndex) {
          for (let i = 0; i < numAttrData; ++i) {
            const ad = attributeData[i];
            ad.attributeSeamCorners[ad.numSeamCorners++] = cc;
          }
        } else if (((oppCorner / 3) | 0) >= srcFaceId) {
          for (let i = 0; i < numAttrData; ++i) {
            if (connectivityDecoders[i].decodeNextBit()) {
              const ad = attributeData[i];
              ad.attributeSeamCorners[ad.numSeamCorners++] = cc;
            }
          }
        }
      }
    }
  }

  _assignPointsToCorners(numConnectivityVerts) {
    this._decoder.mesh().setNumFaces(this._cornerTable.numFaces());

    const mesh = this._decoder.mesh();
    const ct = this._cornerTable;

    if (this._attributeData.length === 0) {
      // Position-only connectivity: vertex indices equal point indices.
      const numFaces = mesh.numFaces();
      const faces = mesh.faces_;
      const baseCornerToVertex = ct.cornerToVertexArray();
      faces.set(baseCornerToVertex.subarray(0, numFaces * 3));
      this._decoder.pointCloud().setNumPoints(numConnectivityVerts);
      return true;
    }

    // Multiple attributes: deduplicate. pointToCornerMap is only used for its
    // length (the running point id), so track it as a counter, not an array.
    const attributeData = this._attributeData;
    const numAttrData = attributeData.length;
    let numPoints = 0;
    // A corner's final point id is also its face-index entry. Write into the
    // output buffer directly; the connectivity being traversed is separate.
    const cornerToPointMap = mesh.faces_;

    const numVertices = ct.numVertices();
    // Flat connectivity for the inlined swingRight ring walk and per-attribute
    // lookups — avoids dispatch on the polymorphic corner tables for every
    // corner of every ring. swingRight(x) = previous(baseOpp[previous(x)]).
    const vertexLeftmost = ct.vertexLeftmostCornerArray();
    const baseOpp = ct.oppositeCornerArray();
    const baseCornerToVertex = ct.cornerToVertexArray();
    const isVertHole = this._isVertHole;
    const attCornerToVertex = new Array(numAttrData);
    const attVertexOnSeam = new Array(numAttrData);
    for (let i = 0; i < numAttrData; ++i) {
      attCornerToVertex[i] = attributeData[i].connectivityData.cornerToVertexArray();
      attVertexOnSeam[i] = attributeData[i].connectivityData.vertexOnSeamArray();
    }
    const singleAttC2V = numAttrData === 1 ? attCornerToVertex[0] : null;

    // Unified per-vertex anyAttVertexOnSeam flag.
    let anyAttVertexOnSeam;
    if (numAttrData === 1) {
      anyAttVertexOnSeam = attVertexOnSeam[0];
    } else {
      anyAttVertexOnSeam = new Uint8Array(numVertices);
      for (let i = 0; i < numAttrData; ++i) {
        const attSeam = attVertexOnSeam[i];
        for (let v = 0; v < numVertices; ++v) {
          if (attSeam[v]) {
            anyAttVertexOnSeam[v] = 1;
          }
        }
      }
    }

    for (let v = 0; v < numVertices; ++v) {
      let c = vertexLeftmost[v];
      if (c === kInvalidCornerIndex) continue; // isolated vertex

      const isSeamVertex = isVertHole[v] || anyAttVertexOnSeam[v];

      if (!isSeamVertex) {
        // Fast path: every corner in this ring gets the same point id.
        const initialC = c;
        const pointId = numPoints++;
        cornerToPointMap[initialC] = pointId;
        // swingRight (c = prev(baseOpp[prev(c)]))
        let rem = initialC % 3;
        let pv = rem === 0 ? initialC + 2 : initialC - 1;
        let opp = baseOpp[pv];
        c = opp < 0 ? kInvalidCornerIndex : ((opp % 3) === 0 ? opp + 2 : opp - 1);
        while (c !== kInvalidCornerIndex && c !== initialC) {
          cornerToPointMap[c] = pointId;
          rem = c % 3;
          pv = rem === 0 ? c + 2 : c - 1;
          opp = baseOpp[pv];
          c = opp < 0 ? kInvalidCornerIndex : ((opp % 3) === 0 ? opp + 2 : opp - 1);
        }
      } else {
        let deduplicationFirstCorner = c;
        let rem, pv, opp;
        if (!isVertHole[v]) {
          // Find the first seam (of any attribute).
          if (numAttrData === 1) {
            const vertId = singleAttC2V[c];
            rem = c % 3;
            pv = rem === 0 ? c + 2 : c - 1;
            opp = baseOpp[pv];
            let actC = opp < 0 ? kInvalidCornerIndex
              : ((opp % 3) === 0 ? opp + 2 : opp - 1);
            while (actC !== c) {
              if (actC === kInvalidCornerIndex) return false;
              if (singleAttC2V[actC] !== vertId) {
                deduplicationFirstCorner = actC;
                break;
              }
              rem = actC % 3;
              pv = rem === 0 ? actC + 2 : actC - 1;
              opp = baseOpp[pv];
              actC = opp < 0 ? kInvalidCornerIndex
                : ((opp % 3) === 0 ? opp + 2 : opp - 1);
            }
          } else {
            for (let i = 0; i < numAttrData; ++i) {
              if (!attVertexOnSeam[i][v]) {
                continue;
              }
              const attC2V = attCornerToVertex[i];
              const vertId = attC2V[c];
              rem = c % 3;
              pv = rem === 0 ? c + 2 : c - 1;
              opp = baseOpp[pv];
              let actC = opp < 0 ? kInvalidCornerIndex
                : ((opp % 3) === 0 ? opp + 2 : opp - 1);
              let seamFound = false;
              while (actC !== c) {
                if (actC === kInvalidCornerIndex) return false;
                if (attC2V[actC] !== vertId) {
                  deduplicationFirstCorner = actC;
                  seamFound = true;
                  break;
                }
                rem = actC % 3;
                pv = rem === 0 ? actC + 2 : actC - 1;
                opp = baseOpp[pv];
                actC = opp < 0 ? kInvalidCornerIndex
                  : ((opp % 3) === 0 ? opp + 2 : opp - 1);
              }
              if (seamFound) break;
            }
          }
        }

        // Deduplication pass over corners on the processed vertex.
        c = deduplicationFirstCorner;
        cornerToPointMap[c] = numPoints++;
        // Traverse in CW direction (swingRight inlined).
        let prevC = c;
        rem = c % 3;
        pv = rem === 0 ? c + 2 : c - 1;
        opp = baseOpp[pv];
        c = opp < 0 ? kInvalidCornerIndex
          : ((opp % 3) === 0 ? opp + 2 : opp - 1);
        while (c !== kInvalidCornerIndex && c !== deduplicationFirstCorner) {
          let attributeSeam;
          if (numAttrData === 1) {
            attributeSeam = singleAttC2V[c] !== singleAttC2V[prevC];
          } else {
            attributeSeam = false;
            for (let i = 0; i < numAttrData; ++i) {
              const attC2V = attCornerToVertex[i];
              if (attC2V[c] !== attC2V[prevC]) {
                attributeSeam = true;
                break;
              }
            }
          }
          if (attributeSeam) {
            cornerToPointMap[c] = numPoints++;
          } else {
            cornerToPointMap[c] = cornerToPointMap[prevC];
          }
          prevC = c;
          rem = c % 3;
          pv = rem === 0 ? c + 2 : c - 1;
          opp = baseOpp[pv];
          c = opp < 0 ? kInvalidCornerIndex
            : ((opp % 3) === 0 ? opp + 2 : opp - 1);
        }
      }
    }

    this._decoder.pointCloud().setNumPoints(numPoints);
    return true;
  }

}

// Helper class for mesh attribute indices encoding data.
class MeshAttributeIndicesEncodingData {

  constructor() {
    this._vertexToEncodedAttributeValueIndexMap = new Int32Array(0);
    this._encodedAttributeValueIndexToCornerMap = new Int32Array(0);
    this._numValues = 0;
  }

  init(numVertices) {
    // Int32Array (non-negative data indices) keeps the hot prediction-lookup
    // reads monomorphic.
    this._vertexToEncodedAttributeValueIndexMap = new Int32Array(numVertices);
    this._encodedAttributeValueIndexToCornerMap = new Int32Array(numVertices);
    this._numValues = 0;
  }

  // Adopts a traversal result from an identical corner table, avoiding a
  // redundant traversal. The maps depend only on connectivity and are read-only
  // downstream, so sharing is safe.
  adoptTraversalResult(vertexToEncodedMap, encodedToCornerMap, numValues) {
    this._vertexToEncodedAttributeValueIndexMap = vertexToEncodedMap;
    this._encodedAttributeValueIndexToCornerMap = encodedToCornerMap;
    this._numValues = numValues;
  }

  get vertexToEncodedAttributeValueIndexMap() {
    return this._vertexToEncodedAttributeValueIndexMap;
  }

  get encodedAttributeValueIndexToCornerMap() {
    return this._encodedAttributeValueIndexToCornerMap;
  }

  get numValues() {
    return this._numValues;
  }

  set numValues(val) {
    this._numValues = val;
  }

}

// Per-attribute data used by the edgebreaker decoder.
class AttributeData {

  constructor() {
    this.decoderId = -1;
    this.connectivityData = new MeshAttributeCornerTable();
    this.isConnectivityUsed = true;
    this.encodingData = new MeshAttributeIndicesEncodingData();
    this.attributeSeamCorners = new Int32Array(0);
    this.numSeamCorners = 0;
  }

}

// Minimal CornerTable for the decoder (the full one lives in the mesh module).
class CornerTable {

  constructor() {
    this._numFaces = 0;
    this._numCorners = 0;
    this._numVertices = 0;
    this._cornerToVertex = null;   // corner -> vertex
    this._oppositeCorners = null;  // corner -> opposite corner
    this._vertexCorners = null;    // vertex -> left-most corner
  }

  reset(numFaces, numVertices) {
    this._numFaces = numFaces;
    this._numCorners = numFaces * 3;
    // C++ reserve() allocates capacity but keeps size 0; vertices are added
    // incrementally via addNewVertex().
    this._numVertices = 0;
    this._cornerToVertex = new Int32Array(this._numCorners).fill(-1);
    this._oppositeCorners = new Int32Array(this._numCorners).fill(-1);
    this._vertexCorners = new Int32Array(numVertices).fill(-1);
    return true;
  }

  numFaces() {
    return this._numFaces;
  }

  numCorners() {
    return this._numCorners;
  }

  numVertices() {
    return this._numVertices;
  }

  next(corner) {
    if (corner < 0) return -1;
    const rem = corner - ((corner / 3) | 0) * 3;
    return rem === 2 ? corner - 2 : corner + 1;
  }

  previous(corner) {
    if (corner < 0) return -1;
    const rem = corner - ((corner / 3) | 0) * 3;
    return rem === 0 ? corner + 2 : corner - 1;
  }

  vertex(corner) {
    if (corner < 0 || corner >= this._numCorners) return -1;
    return this._cornerToVertex[corner];
  }

  opposite(corner) {
    if (corner < 0 || corner >= this._numCorners) return -1;
    return this._oppositeCorners[corner];
  }

  // Flat-array accessors; let callers avoid polymorphic per-corner dispatch.
  cornerToVertexArray() {
    return this._cornerToVertex;
  }
  oppositeCornerArray() {
    return this._oppositeCorners;
  }
  vertexLeftmostCornerArray() {
    return this._vertexCorners;
  }

  // Mirrors C++ CornerTable::AddNewVertex() (push_back(kInvalidCornerIndex)).
  addNewVertex() {
    const newVertex = this._numVertices;
    this._numVertices++;
    // Array pre-allocated in reset(); extend only when capacity is exceeded.
    if (newVertex >= this._vertexCorners.length) {
      const newArr = new Int32Array(this._vertexCorners.length + 64);
      newArr.fill(-1);
      newArr.set(this._vertexCorners);
      this._vertexCorners = newArr;
    }
    this._vertexCorners[newVertex] = -1;
    return newVertex;
  }

  // Next corner around a vertex, CCW. SwingLeft(c) = Next(Opposite(Next(c))).
  swingLeft(corner) {
    const nextCorner = this.next(corner);
    const oppCorner = this.opposite(nextCorner);
    if (oppCorner < 0) return -1;
    return this.next(oppCorner);
  }

  // Next corner around a vertex, CW. SwingRight(c) = Previous(Opposite(Previous(c))).
  swingRight(corner) {
    const prevCorner = this.previous(corner);
    const oppCorner = this.opposite(prevCorner);
    if (oppCorner < 0) return -1;
    return this.previous(oppCorner);
  }

}

export {
  MeshEdgebreakerDecoderImpl,
  AttributeData,
  CornerTable
};
