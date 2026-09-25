// compression/mesh/traverser/DepthFirstTraverser.js - ported from compression/mesh/traverser/depth_first_traverser.h

const kInvalidCornerIndex = -1;
const kInvalidFaceIndex = -1;
const kInvalidVertexIndex = -1;

// DFS traversal of a mesh over the CornerTable.
class DepthFirstTraverser {

  constructor() {
    this._cornerTable = null;
    this._observer = null;
    this._isFaceVisited = null;
    this._isVertexVisited = null;
    this._cornerTraversalStack = [];
    this._numVisitedFaces = 0;
    // Identifies the traversal order for the shared traversal cache
    // (MESH_TRAVERSAL_DEPTH_FIRST). See MeshTraversalSequencer.
    this._traversalMethodId = 0;
  }

  init(cornerTable, observer) {
    this._cornerTable = cornerTable;
    this._observer = observer;
    this._numVisitedFaces = 0;
    // Extract the corner table's connectivity as flat arrays once, so the
    // traversal reads them directly (via the monomorphic _* helpers below)
    // instead of dispatching through the corner table on every corner. The
    // corner table is one of two classes, so direct ct.vertex()/opposite()
    // calls in the hot loop are polymorphic and not inlined by the JIT.
    this._cornerToVertex = cornerTable.cornerToVertexArray();
    this._oppositeCorners = cornerTable.oppositeCornerArray();
    this._vertexLeftmost = cornerTable.vertexLeftmostCornerArray();
    this._numCorners = cornerTable.numCorners();
  }

  cornerTable() {
    return this._cornerTable;
  }

  onTraversalStart() {
    this._observer.onTraversalStart();
    // The sequencer calls this only after a traversal-cache miss. Allocate
    // scratch storage here so attributes reusing a traversal need none of it.
    const cornerTable = this._cornerTable;
    this._isFaceVisited = new Uint8Array(cornerTable.numFaces());
    this._isVertexVisited = new Uint8Array(cornerTable.numVertices());
    this._cornerTraversalStack = new Int32Array(this._numCorners);
    this._numVisitedFaces = 0;
  }
  onTraversalEnd() {}

  traverseFromCorner(cornerId) {
    if (this._isFaceVisited[(cornerId / 3) | 0]) {
      return true; // Already traversed.
    }

    const isFaceVisited = this._isFaceVisited;
    const isVertexVisited = this._isVertexVisited;
    const observer = this._observer;
    const cornerToVertex = this._cornerToVertex;
    const oppositeCorners = this._oppositeCorners;
    const vertexLeftmost = this._vertexLeftmost;
    const stack = this._cornerTraversalStack;
    let numVisitedFaces = this._numVisitedFaces;

    let stackSize = 0;
    stack[stackSize++] = cornerId;

    // For the first face the other two corners may not be processed yet.
    const nextCorner = (cornerId % 3) === 2 ? cornerId - 2 : cornerId + 1;
    const prevCorner = (cornerId % 3) === 0 ? cornerId + 2 : cornerId - 1;
    const nextVert = cornerToVertex[nextCorner];
    const prevVert = cornerToVertex[prevCorner];
    if (nextVert === kInvalidVertexIndex || prevVert === kInvalidVertexIndex) {
      return false;
    }
    if (!isVertexVisited[nextVert]) {
      isVertexVisited[nextVert] = true;
      observer.onNewVertexVisited(nextVert, nextCorner);
    }
    if (!isVertexVisited[prevVert]) {
      isVertexVisited[prevVert] = true;
      observer.onNewVertexVisited(prevVert, prevCorner);
    }

    while (stackSize > 0) {
      cornerId = stack[stackSize - 1];
      let faceId = (cornerId / 3) | 0;

      if (cornerId === kInvalidCornerIndex || isFaceVisited[faceId]) {
        stackSize--;
        continue;
      }

      while (true) {
        isFaceVisited[faceId] = true;
        numVisitedFaces++;

        const vertId = cornerToVertex[cornerId];
        if (vertId === kInvalidVertexIndex) {
          return false;
        }
        if (!isVertexVisited[vertId]) {
          // Inlined isOnBoundary
          const lc = vertexLeftmost[vertId];
          let onBoundary = true;
          if (lc !== undefined && lc >= 0) {
            const nextLc = (lc % 3) === 2 ? lc - 2 : lc + 1;
            onBoundary = oppositeCorners[nextLc] < 0;
          }
          isVertexVisited[vertId] = true;
          observer.onNewVertexVisited(vertId, cornerId);
          if (!onBoundary) {
            // Move to the right corner: opposite(next(cornerId)).
            const nextCornerId = (cornerId % 3) === 2 ? cornerId - 2 : cornerId + 1;
            cornerId = oppositeCorners[nextCornerId];
            faceId = (cornerId / 3) | 0;
            continue;
          }
        }

        // The current vertex has been already visited or it was on a boundary.
        const nextCornerId = (cornerId % 3) === 2 ? cornerId - 2 : cornerId + 1;
        const rightCornerId = oppositeCorners[nextCornerId];

        const prevCornerId = (cornerId % 3) === 0 ? cornerId + 2 : cornerId - 1;
        const leftCornerId = oppositeCorners[prevCornerId];

        const rightFaceId = rightCornerId === kInvalidCornerIndex
          ? kInvalidFaceIndex : (rightCornerId / 3) | 0;
        const leftFaceId = leftCornerId === kInvalidCornerIndex
          ? kInvalidFaceIndex : (leftCornerId / 3) | 0;

        const isRightVisited = rightFaceId === kInvalidFaceIndex ||
          isFaceVisited[rightFaceId];
        const isLeftVisited = leftFaceId === kInvalidFaceIndex ||
          isFaceVisited[leftFaceId];

        if (isRightVisited) {
          if (isLeftVisited) {
            // Both neighbors visited: this branch ends.
            stackSize--;
            break;
          } else {
            cornerId = leftCornerId;
            faceId = leftFaceId;
          }
        } else {
          if (isLeftVisited) {
            cornerId = rightCornerId;
            faceId = rightFaceId;
          } else {
            // Both neighbors unvisited: continue left, push right to resume later.
            stack[stackSize - 1] = leftCornerId;
            stack[stackSize++] = rightCornerId;
            break;
          }
        }
      }
    }
    this._numVisitedFaces = numVisitedFaces;
    return true;
  }

}

export { DepthFirstTraverser };
