import './replay.scss';
import DeckGL from '@deck.gl/react';
import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {COORDINATE_SYSTEM, MapView, WebMercatorViewport} from "@deck.gl/core";
import { GeoJsonLayer, PathLayer, TextLayer} from "@deck.gl/layers";
import Sidebar from "./sidebar";
import Player from "./player";
import {ScenegraphLayer} from "@deck.gl/mesh-layers";
import {TerrainLayer, TripsLayer} from "@deck.gl/geo-layers";
import {addLatLng, distance2D, getSideColor} from "../converter";

const mainView = new MapView({
	id: 'main',
	controller: true
});
const minimapView = new MapView({
	id: 'minimap',
	x: 360,
	y: 50,
	width: 256,
	height: 256,
	clear: true
});

// Viewport settings
const INITIAL_VIEW_STATE = {
	main: {
		longitude: 0,
		latitude: 0,
		zoom: 12,
		minZoom: 12
	},
	minimap: {
		longitude: 0,
		latitude: 0,
		zoom: 10
	}
};

const minimapBackgroundStyle = {
	position: 'absolute',
	zIndex: -1,
	width: '100%',
	height: '100%',
	background: '#fefeff',
	boxShadow: '0 0 8px 2px rgba(0,0,0,0.15)'
};

const terrainLayer = new TerrainLayer({
	coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
	elevationDecoder: {
		rScaler: 5,
		gScaler: 0,
		bScaler: 0,
		offset: 0
	},
	meshMaxError: 2.5,
	elevationData: 'images/maps/vt7/heightmap.png',
	bounds: [0,0,18001,18001]
});

let geoLayer;

function layerFilter({layer, viewport}) {
	const shouldDrawInMinimap = layer.id.startsWith('viewport-bounds');
	if (viewport.id === 'minimap') return shouldDrawInMinimap || layer.id.startsWith('geojson-terrain');
	return !shouldDrawInMinimap;
}

let then = 0;
function Replay({replay}) {
	const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
	const [frameIndex, setFrameIndex] = useState(0);
	const [frameNo, setFrameNo] = useState(0);
	const [fps, setFPS] = useState("0");

	const [trees, setTrees] = useState([]);
	const [dataUnits, setDataUnits] = useState([]);
	const [dataFirelines, setDataFirelines] = useState([]);
	const [dataProjectiles, setDataProjectiles] = useState([]);

	const requestRef = useRef();
	const previousTimeRef = useRef();
	const frame = frameNo + frameIndex;

	const animate = time => {
		{
			time *= 0.001;                          // convert to seconds
			const deltaTime = time - then;          // compute time since last frame
			then = time;                            // remember time for next frame
			const fps = 1 / deltaTime;             // compute frames per second
			setFPS(fps.toFixed(1));  // update fps display
		}

		const deltaTime = new Date() - previousTimeRef.current;
		if (deltaTime < 100) {
			setFrameIndex(deltaTime / 100);
		}
		// Pass on a function to the setter of the state
		// to make sure we always have the latest state
		// setCount(prevCount => (prevCount + deltaTime * 0.01) % 100);
		requestRef.current = requestAnimationFrame(animate);
	}

	useEffect(() => {
		requestRef.current = requestAnimationFrame(animate);
		return () => cancelAnimationFrame(requestRef.current);
	}, []);

	useEffect(() => {
		previousTimeRef.current = new Date();
		const timer = setTimeout(() => {
			if (frameNo >= replay.endFrame-1) {
				setFrameNo(0);
			} else {
				setFrameNo(frameNo + 1);
			}
		}, 100);

		// Clear timeout if the component is unmounted
		return () => clearTimeout(timer);
	}, [frameNo, replay]);

	useEffect(() => {
		if (!replay) return;

		geoLayer = new GeoJsonLayer({
			id: 'geojson-terrain',
			coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
			data: `images/maps/${replay.worldName.toLowerCase()}/geo.json`,
			stroked: true,
			filled: true,
			extruded: false,
			pointType: 'circle',
			lineWidthScale: 2,
			lineWidthMinPixels: 1,
			getFillColor: d => d.properties.fill || [255,0,0],
			getLineColor: d => d.properties.stroke || [0, 0, 0, 0],
			getPointRadius: d => d.properties.radius || 2,
			getLineWidth: d => d.properties["stroke-width"] || 1,
			getElevation: 0,
			parameters: {
				depthTest: false
			}
		});

		const [centerLat, centerLng] = addLatLng([INITIAL_VIEW_STATE.minimap.latitude, INITIAL_VIEW_STATE.minimap.longitude], [18001 / 2, 18001 / 2]);
		setViewState(() => ({
			main: {
				...INITIAL_VIEW_STATE.main,
				latitude: centerLat,
				longitude: centerLng,
			},
			minimap: {
				...INITIAL_VIEW_STATE.minimap,
				latitude: centerLat,
				longitude: centerLng,
			},
		}));

		const fireLines = [];
		for (const entity of replay.entities) {
			for (const firedFrame of entity.framesFired) {
				fireLines.push({
					from: entity.positions[firedFrame[0]][0],
					to: firedFrame[1],
					frameNo: firedFrame[0],
				});
			}
		}

		setDataUnits(replay.entities.filter(d => d.type === "unit"));
		setDataFirelines(fireLines);

		// projectiles
		const projectiles = [];
		for (const marker of replay.Markers.filter((marker) => marker[0] === "mil_triangle")) {
			projectiles.push({
				frames: marker[7].map((v) => v[0]),
				positions: marker[7].map((v) => v[1])
			});
		}
		setDataProjectiles(projectiles);

		fetch(`images/maps/${replay.worldName.toLowerCase()}/trees.json`)
			.then(r => {
				if (r.ok) return r.json()
				throw r;
			})
			.then(r => {
				const objects = [];
				for (const feature of r.features) {
					objects.push({
						position: feature.geometry.coordinates,
					});
				}
				setTrees(objects);
			})
			.catch((err) => {
				console.warn('trees error', err);
			})
	}, [replay]);

	const onViewStateChange = useCallback(({viewState: newViewState}) => {
		setViewState(() => ({
			main: newViewState,
			minimap: viewState.minimap,
		}));
	}, [viewState.minimap]);

	const viewportBounds = useMemo(
		() => {
			const {width, height} = viewState.main;
			if (!width) return null;
			const viewport = new WebMercatorViewport(viewState.main);

			const topLeft = viewport.unproject([0, 0]);
			const topRight = viewport.unproject([width, 0]);
			const bottomLeft = viewport.unproject([0, height]);
			const bottomRight = viewport.unproject([width, height]);

			return [[topLeft, topRight, bottomRight, bottomLeft, topLeft]];
		},
		[viewState]
	);

	const vehicleLayers = Object.keys(replay.entityObjects).filter((key) => replay.entityObjects[key].length > 0).map((key) => {
		return new ScenegraphLayer({
			coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
			id: `vehicle-layer-${key}`,
			data: replay.entityObjects[key],
			scenegraph: `objects/${key}.gltf`,
			sizeScale: 15,
			getPosition: d => d.getPosition(frame),
			getColor: d => d.getColor(frameNo),
			getOrientation: d => d.getOrientation(frame),
			getScale: d => d.isActive(frameNo) ? [1,1,1] : [0,0,0],
			sizeMinPixels: 10,
			sizeMaxPixels: 30,
			_lighting: 'pbr',
			updateTriggers: {
				getColor: frameNo,
				getOrientation: frame,
				getPosition: frame,
				getScale: frameNo,
			},
		});
	})

	const layers = [
		// terrainLayer,
		geoLayer,
		// new BitmapLayer({
		// 	id: 'bitmap-layer',
		// 	coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
		// 	bounds: [
		// 		0,
		// 		0,
		// 		18001,
		// 		18001
		// 	],
		// 	image: '/images/vt7.png'
		// }),
		new ScenegraphLayer({
			coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
			id: 'tree-layer',
			data: trees,
			scenegraph: 'objects/tree.glb',
			sizeScale: 3,
			getPosition: d => d.position,
			getOrientation: d => [0, 0, 90],
			// sizeMinPixels: 10,
			// sizeMaxPixels: 30,
			_lighting: 'pbr',
			parameters: {
				depthTest: true
			}
		}),
		new ScenegraphLayer({
			coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
			id: 'units-layer',
			data: dataUnits,
			scenegraph: 'objects/man.gltf',
			sizeScale: 15,
			getPosition: d => d.positions[frameNo][0],
			getColor: d => {
				switch (d.positions[frameNo][2]) {
					case 0:
						return [0, 0, 0, 50];
					case 2:
						return [255, 168, 26, 255];
					default:
						let color = getSideColor(d.side);
						color.push(255);
						return color;
				}
			},
			getOrientation: d => d.positions[frameNo][1],
			getScale: d => {
				if (d.positions[frameNo][0][0] !== 0 && d.positions[frameNo][3] === 0) return [1,1,1];
				return [0,0,0];
			},
			sizeMinPixels: 10,
			sizeMaxPixels: 30,
			_lighting: 'pbr',
			updateTriggers: {
				getPosition: frameNo,
				getColor: frameNo,
				getOrientation: frameNo,
			},
			transitions: {
				getPosition: 100,
				getOrientation: 100
			},
			parameters: {
				depthTest: true
			}
		}),
		new TextLayer({
			coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
			id: 'text-layer',
			data: dataUnits,
			getPosition: d => d.positions[frameNo][0],
			getColor: d => {
				let color = getSideColor(d.side);

				if (d.positions[frameNo][3] === 1) { // in vehicle
					color.push(0);
				} else {
					color.push(255);
				}

				return color;
			},
			getSize: 32,
			getAngle: 0,
			getText: d => d.name,
			getTextAnchor: 'middle',
			updateTriggers: {
				getPosition: frameNo,
				getColor: frameNo,
			},
			transitions: {
				getPosition: 100,
			},
			sizeScale: 1,
			parameters: {
				depthTest: true
			},
		}),
		...vehicleLayers,
		// new LineLayer({
		// 	coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
		// 	id: 'fireline-layer',
		// 	data: dataFirelines,
		// 	getWidth: 3,
		// 	getSourcePosition: d => d.from,
		// 	getTargetPosition: d => d.to,
		// 	getColor: d => [255, 0, 0, d.frameNo >= frameNo && d.frameNo <= frameNo + 3 ? 255 : 0],
		// 	updateTriggers: {
		// 		getColor: frameNo,
		// 	},
		// }),
		new TripsLayer({
			coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
			id: 'fireline-layer',
			data: dataFirelines,
			getPath: d => [
				d.from,
				d.to,
			],
			// deduct start timestamp from each data point to avoid overflow
			getTimestamps: d => [d.frameNo,d.frameNo+Math.ceil(distance2D(d.from, d.to)/600)],
			getColor: d => [255, 0, 0, 255],
			opacity: 0.8,
			widthMinPixels: 2,
			fadeTrail: true,
			trailLength: 2,
			currentTime: frame,
			animationSpeed: 100,
		}),
		new TripsLayer({
			coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
			id: 'projectile-layer',
			data: dataProjectiles,
			getPath: d => d.positions,
			// deduct start timestamp from each data point to avoid overflow
			getTimestamps: d => d.frames,
			getColor: d => [255, 128, 0, 255],
			opacity: 0.8,
			widthMinPixels: 5,
			fadeTrail: true,
			billboard: true,
			trailLength: 15,
			currentTime: frame,
			animationSpeed: 100,
		}),
		new PathLayer({
			id: 'viewport-bounds',
			data: viewportBounds,
			getPath: d => d,
			getColor: [255, 0, 0],
			getWidth: 2,
			widthUnits: 'pixels'
		}),
	];

	return (
		<div className="body">
			<div>
				<DeckGL
					layers={layers}
					views={[mainView, minimapView]}
					viewState={viewState}
					onViewStateChange={onViewStateChange}
					layerFilter={layerFilter}
				>
					<MapView id="main"/>
					<MapView id="minimap">
						<div style={minimapBackgroundStyle} />
					</MapView>
				</DeckGL>
			</div>
			<Sidebar/>
			<Player/>
			<div className="fps">{fps} ({frame})</div>
		</div>
	);
}

export default Replay;
