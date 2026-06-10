import { Decoder } from './compression/Decode.js';
import { DecoderBuffer } from './core/DecoderBuffer.js';
import { EncodedGeometryType } from './compression/config/CompressionShared.js';

const _attributeTypeMap = {
	'POSITION': 0,
	'NORMAL': 1,
	'COLOR': 2,
	'TEX_COORD': 3,
	'GENERIC': 4
};

const _typedArrayMap = {
	'Float32Array': Float32Array,
	'Int8Array': Int8Array,
	'Int16Array': Int16Array,
	'Int32Array': Int32Array,
	'Uint8Array': Uint8Array,
	'Uint16Array': Uint16Array,
	'Uint32Array': Uint32Array
};

// Decodes a Draco buffer into plain, transferable typed arrays. Free of any
// three.js dependency, so it runs unchanged on the main thread or in a worker.
function decodeToArrays( buffer, taskConfig ) {

	const byteArray = new Uint8Array( buffer );
	const decoderBuffer = new DecoderBuffer();
	decoderBuffer.init( byteArray, byteArray.length );

	if ( Decoder.getEncodedGeometryType( decoderBuffer ) !== EncodedGeometryType.TRIANGULAR_MESH ) {

		throw new Error( 'THREE.DRACOLoader: Unexpected geometry type.' );

	}

	const result = new Decoder().decodeMeshFromBuffer( decoderBuffer );

	if ( ! result.ok ) {

		throw new Error( 'THREE.DRACOLoader: ' + result.message );

	}

	const dracoGeometry = result.mesh;
	const attributeIDs = taskConfig.attributeIDs;
	const attributeTypes = taskConfig.attributeTypes;
	const numPoints = dracoGeometry.numPoints();
	const attributes = [];

	for ( const attributeName in attributeIDs ) {

		const OutputTypedArray = _typedArrayMap[ attributeTypes[ attributeName ] ];
		if ( ! OutputTypedArray ) continue;

		let attribute;

		if ( taskConfig.useUniqueIDs ) {

			attribute = dracoGeometry.getAttributeByUniqueId( attributeIDs[ attributeName ] );

		} else {

			const typeEnum = _attributeTypeMap[ attributeIDs[ attributeName ] ];
			if ( typeEnum === undefined ) continue;

			attribute = dracoGeometry.getNamedAttribute( typeEnum );

		}

		if ( ! attribute ) continue;

		attributes.push( {
			name: attributeName,
			array: attribute.extractTo( OutputTypedArray, numPoints ),
			itemSize: attribute.numComponents
		} );

	}

	const numFaces = dracoGeometry.numFaces();
	const index = new Uint32Array( numFaces * 3 );
	index.set( dracoGeometry.faces_.subarray( 0, numFaces * 3 ) );

	return { index, attributes };

}

const _isWorker = typeof WorkerGlobalScope !== 'undefined'
	&& typeof self !== 'undefined' && self instanceof WorkerGlobalScope;

let DRACOLoader;

if ( _isWorker ) {

	// Worker mode: the bundle is spawned from its own URL and answers decode
	// requests. The decoded arrays are freshly allocated, so they're transferred
	// back to the main thread rather than copied.
	self.onmessage = function ( event ) {

		const { id, buffer, taskConfig } = event.data;

		try {

			const result = decodeToArrays( buffer, taskConfig );
			const transfer = [ result.index.buffer ];
			for ( const attribute of result.attributes ) transfer.push( attribute.array.buffer );
			self.postMessage( { id, result }, transfer );

		} catch ( error ) {

			self.postMessage( { id, error: error.message } );

		}

	};

} else {

	// three.js is imported dynamically (not statically) so the worker copy of
	// this module can load without resolving the bare 'three' specifier — import
	// maps don't apply inside workers.
	const {
		BufferAttribute,
		BufferGeometry,
		Color,
		ColorManagement,
		FileLoader,
		Loader,
		LinearSRGBColorSpace,
		SRGBColorSpace
	} = await import( 'three' );

	const _taskCache = new WeakMap();

	// A single shared worker, created lazily on first use (or via preload()).
	let _worker = null;
	let _nextId = 0;
	let _workersDisabled = false;
	const _pending = new Map();

	function getWorker() {

		if ( _worker === null ) {

			_worker = new Worker( import.meta.url, { type: 'module' } );

			_worker.onmessage = function ( event ) {

				const task = _pending.get( event.data.id );
				if ( task === undefined ) return;

				_pending.delete( event.data.id );

				if ( event.data.error ) task.reject( new Error( event.data.error ) );
				else task.resolve( event.data.result );

			};

			_worker.onerror = function () {

				// The worker couldn't load (CSP, a bundler that rewrote
				// import.meta.url, …). Disable workers and finish any in-flight
				// tasks on the main thread.
				_workersDisabled = true;
				_worker.terminate();
				_worker = null;

				for ( const [ id, task ] of _pending ) {

					_pending.delete( id );
					try { task.resolve( decodeToArrays( task.buffer, task.taskConfig ) ); }
					catch ( error ) { task.reject( error ); }

				}

			};

		}

		return _worker;

	}

	function decode( buffer, taskConfig ) {

		const runOnMainThread = () => Promise.resolve().then( () => decodeToArrays( buffer, taskConfig ) );

		if ( _workersDisabled || typeof Worker === 'undefined' ) return runOnMainThread();

		let worker;

		try {

			worker = getWorker();

		} catch ( error ) {

			// Worker construction failed (e.g. blocked by CSP, or a cross-origin
			// URL) — fall back to the main thread for good.
			_workersDisabled = true;
			return runOnMainThread();

		}

		return new Promise( ( resolve, reject ) => {

			const id = _nextId ++;

			// Clone (don't transfer) the input so the caller keeps its buffer and
			// the task can be re-run on the main thread if the worker dies. Record
			// the task only after postMessage succeeds, so a throw here (e.g. a
			// detached input buffer) rejects without leaking a _pending entry.
			const clone = buffer.slice( 0 );
			worker.postMessage( { id, buffer: clone, taskConfig }, [ clone ] );
			_pending.set( id, { resolve, reject, buffer, taskConfig } );

		} );

	}

	DRACOLoader = class DRACOLoader extends Loader {

		constructor( manager ) {

			super( manager );

			this.defaultAttributeIDs = {
				position: 'POSITION',
				normal: 'NORMAL',
				color: 'COLOR',
				uv: 'TEX_COORD'
			};

			this.defaultAttributeTypes = {
				position: 'Float32Array',
				normal: 'Float32Array',
				color: 'Float32Array',
				uv: 'Float32Array'
			};

		}

		setDecoderPath() {

			return this;

		}

		setDecoderConfig() {

			return this;

		}

		setWorkerLimit( workerLimit ) {

			_workersDisabled = workerLimit === 0;
			return this;

		}

		load( url, onLoad, onProgress, onError ) {

			const loader = new FileLoader( this.manager );

			loader.setPath( this.path );
			loader.setResponseType( 'arraybuffer' );
			loader.setRequestHeader( this.requestHeader );
			loader.setWithCredentials( this.withCredentials );

			loader.load( url, ( buffer ) => {

				this.parse( buffer, onLoad, onError );

			}, onProgress, onError );

		}

		parse( buffer, onLoad, onError = () => {} ) {

			this.decodeDracoFile( buffer, onLoad, null, null, SRGBColorSpace, onError ).catch( onError );

		}

		decodeDracoFile( buffer, callback, attributeIDs, attributeTypes, vertexColorSpace = LinearSRGBColorSpace, onError = () => {} ) {

			const taskConfig = {
				attributeIDs: attributeIDs || this.defaultAttributeIDs,
				attributeTypes: attributeTypes || this.defaultAttributeTypes,
				useUniqueIDs: !! attributeIDs,
				vertexColorSpace: vertexColorSpace,
			};

			return this.decodeGeometry( buffer, taskConfig ).then( callback ).catch( onError );

		}

		decodeGeometry( buffer, taskConfig ) {

			const taskKey = JSON.stringify( taskConfig );

			if ( _taskCache.has( buffer ) ) {

				const cachedTask = _taskCache.get( buffer );

				if ( cachedTask.key === taskKey ) {

					return cachedTask.promise;

				} else if ( buffer.byteLength === 0 ) {

					throw new Error(

						'THREE.DRACOLoader: Unable to re-decode a buffer with different ' +
						'settings. Buffer has already been transferred.'

					);

				}

			}

			const geometryPending = decode( buffer, taskConfig )
				.then( ( decoded ) => this._buildGeometry( decoded, taskConfig ) );

			_taskCache.set( buffer, {

				key: taskKey,
				promise: geometryPending

			} );

			return geometryPending;

		}

		_buildGeometry( decoded, taskConfig ) {

			const geometry = new BufferGeometry();

			for ( const { name, array, itemSize } of decoded.attributes ) {

				const bufferAttribute = new BufferAttribute( array, itemSize );

				if ( name === 'color' ) {

					this._assignVertexColorSpace( bufferAttribute, taskConfig.vertexColorSpace );
					bufferAttribute.normalized = ( array instanceof Float32Array ) === false;

				}

				geometry.setAttribute( name, bufferAttribute );

			}

			geometry.setIndex( new BufferAttribute( decoded.index, 1 ) );

			return geometry;

		}

		_assignVertexColorSpace( attribute, inputColorSpace ) {

			if ( inputColorSpace !== SRGBColorSpace ) return;

			const _color = new Color();

			for ( let i = 0, il = attribute.count; i < il; i ++ ) {

				_color.fromBufferAttribute( attribute, i );
				ColorManagement.colorSpaceToWorking( _color, SRGBColorSpace );
				attribute.setXYZ( i, _color.r, _color.g, _color.b );

			}

		}

		preload() {

			if ( ! _workersDisabled && typeof Worker !== 'undefined' ) {

				try { getWorker(); } catch ( error ) { _workersDisabled = true; }

			}

			return this;

		}

		dispose() {

			if ( _worker !== null ) { _worker.terminate(); _worker = null; }

			// Settle any in-flight tasks so callers don't hang: the terminated
			// worker will never reply for them.
			for ( const [ id, task ] of _pending ) {

				_pending.delete( id );
				task.reject( new Error( 'THREE.DRACOLoader: Disposed before decode completed.' ) );

			}

			return this;

		}

	};

}

export { DRACOLoader };
