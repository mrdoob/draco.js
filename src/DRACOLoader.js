import {
	BufferAttribute,
	BufferGeometry,
	Color,
	ColorManagement,
	FileLoader,
	Loader,
	LinearSRGBColorSpace,
	SRGBColorSpace
} from 'three';

import { Decoder } from './compression/Decode.js';
import { DecoderBuffer } from './core/DecoderBuffer.js';
import { EncodedGeometryType } from './compression/config/CompressionShared.js';

const _taskCache = new WeakMap();

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

class DRACOLoader extends Loader {

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

	setWorkerLimit() {

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

		const geometryPending = new Promise( ( resolve, reject ) => {

			try {

				const geometry = this._decodeBuffer( buffer, taskConfig );
				resolve( geometry );

			} catch ( e ) {

				reject( e );

			}

		} );

		_taskCache.set( buffer, {

			key: taskKey,
			promise: geometryPending

		} );

		return geometryPending;

	}

	_decodeBuffer( buffer, taskConfig ) {

		const byteArray = new Uint8Array( buffer );
		const decoderBuffer = new DecoderBuffer();
		decoderBuffer.init( byteArray, byteArray.length );

		const geometryType = Decoder.getEncodedGeometryType( decoderBuffer );

		if ( geometryType !== EncodedGeometryType.TRIANGULAR_MESH ) {

			throw new Error( 'THREE.DRACOLoader: Unexpected geometry type.' );

		}

		const decoder = new Decoder();
		const result = decoder.decodeMeshFromBuffer( decoderBuffer );

		if ( ! result.ok ) {

			throw new Error( 'THREE.DRACOLoader: ' + result.message );

		}

		return this._buildGeometry( result.mesh, taskConfig );

	}

	_buildGeometry( dracoGeometry, taskConfig ) {

		const attributeIDs = taskConfig.attributeIDs;
		const attributeTypes = taskConfig.attributeTypes;

		const geometry = new BufferGeometry();
		const numPoints = dracoGeometry.numPoints();

		// Extract requested attributes.

		for ( const attributeName in attributeIDs ) {

			const OutputTypedArray = _typedArrayMap[ attributeTypes[ attributeName ] ];
			if ( ! OutputTypedArray ) continue;

			let attribute;

			if ( taskConfig.useUniqueIDs ) {

				const uniqueId = attributeIDs[ attributeName ];
				attribute = dracoGeometry.getAttributeByUniqueId( uniqueId );

			} else {

				const typeEnum = _attributeTypeMap[ attributeIDs[ attributeName ] ];
				if ( typeEnum === undefined ) continue;

				attribute = dracoGeometry.getNamedAttribute( typeEnum );

			}

			if ( ! attribute ) continue;

			const itemSize = attribute.numComponents;
			const array = this._extractAttributeData( dracoGeometry, attribute, numPoints, OutputTypedArray );

			const bufferAttribute = new BufferAttribute( array, itemSize );

			if ( attributeName === 'color' ) {

				this._assignVertexColorSpace( bufferAttribute, taskConfig.vertexColorSpace );
				bufferAttribute.normalized = ( array instanceof Float32Array ) === false;

			}

			geometry.setAttribute( attributeName, bufferAttribute );

		}

		// Extract face indices.

		const numFaces = dracoGeometry.numFaces();
		const index = new Uint32Array( numFaces * 3 );
		index.set( dracoGeometry.faces_.subarray( 0, numFaces * 3 ) );

		geometry.setIndex( new BufferAttribute( index, 1 ) );

		return geometry;

	}

	_extractAttributeData( dracoGeometry, attribute, numPoints, OutputTypedArray ) {

		return attribute.extractTo( OutputTypedArray, numPoints );

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

		return this;

	}

	dispose() {

		return this;

	}

}

export { DRACOLoader };
