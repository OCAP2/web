import './App.css';
import DeckGL from '@deck.gl/react';
import {useCallback, useEffect, useMemo, useState} from "react";
import {COORDINATE_SYSTEM, MapView, WebMercatorViewport} from "@deck.gl/core";
import {BitmapLayer, GeoJsonLayer, IconLayer, PathLayer, TextLayer} from "@deck.gl/layers";
import TopPanel from "./Panel/TopPanel";
import LeftPanel from "./Panel/LeftPanel";
import BottomPanel from "./Panel/BottomPanel";
import {ScenegraphLayer} from "@deck.gl/mesh-layers";
import {TerrainLayer} from "@deck.gl/geo-layers";

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

const ICON_MAPPING = {
	marker: {x: 0, y: 0, width: 128, height: 128, mask: true}
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

const r_earth = 6378000
function addLatLng([lat, lng], [x, y]) {
	let d = 180 / Math.PI
	let nlat = lat + (x / r_earth) * d
	let nlng = lng + (y / r_earth) * d / Math.cos(nlat * Math.PI / 180)
	return [nlat, nlng]
}

function App() {
	const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
	const [frameNo, setFrameNo] = useState(0);

	const [data, setData] = useState([]);
	const [trees, setTrees] = useState([]);
	const [dataUnits, setDataUnits] = useState([]);
	const [dataCars, setDataCars] = useState([]);
	const [dataBoats, setDataBoats] = useState([]);
	const [dataTrucks, setDataTrucks] = useState([]);
	const [dataAPCs, setDataAPCs] = useState([]);
	const [dataTanks, setDataTanks] = useState([]);
	const [dataHelis, setDataHelis] = useState([]);
	const [dataPlanes, setDataPlanes] = useState([]);

	useEffect(() => {
		fetch("/data/2021_07_27__22_36_opt_latest.json")
			.then(r => r.json())
			.then(r => {
				geoLayer = new GeoJsonLayer({
					id: 'geojson-terrain',
					coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
					data: `images/maps/${r.worldName.toLowerCase()}/geo.json`,
					pickable: true,
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
					getElevation: 0
				});


				const [centerLat, centerLng] = addLatLng([INITIAL_VIEW_STATE.minimap.latitude, INITIAL_VIEW_STATE.minimap.longitude], [18001 / 2, 18001 / 2]);
				INITIAL_VIEW_STATE.main.latitude = centerLat;
				INITIAL_VIEW_STATE.main.longitude = centerLng;
				INITIAL_VIEW_STATE.minimap.latitude = centerLat;
				INITIAL_VIEW_STATE.minimap.longitude = centerLng;
				setViewState(() => ({
					main: INITIAL_VIEW_STATE.main,
					minimap: INITIAL_VIEW_STATE.minimap,
				}));

				const entities = r.entities.map((entity) => {
					const positions = Array.from(Array(r.endFrame).keys()).map(() => [[0,0,0],0]);
					if (entity.type !== "unit" && entity.positions.some((d) => d.length >= 5)) {
						for (const position of entity.positions) {
							const startFrame = position[4][0];
							const endFrame = position[4][1];

							for (let i = startFrame; i <= endFrame; i++) {
								positions[i] = position;
							}
						}
					} else {
						for (let i = 0; i < entity.positions.length; i++) {
							const positionIndex = i + entity.startFrameNum;
							positions[positionIndex] = entity.positions[i];
						}
					}

					entity.positions = positions;

					return entity;
				});

				setData(entities);
				setDataUnits(entities.filter(d => d.type === "unit"));
				setDataCars(entities.filter(d => d.class === "car"));
				setDataTrucks(entities.filter(d => d.class === "truck"));
				setDataBoats(entities.filter(d => d.class === "boat"));
				setDataAPCs(entities.filter(d => d.class === "apc"));
				setDataTanks(entities.filter(d => d.class === "tank"));
				setDataHelis(entities.filter(d => d.class === "heli"));
				setDataPlanes(entities.filter(d => d.class === "plane"));

				return r;
			})
			.then((r) => {
				return fetch(`images/maps/${r.worldName.toLowerCase()}/trees.json`)
					.then(r => r.json())
					.then(r => {
						const objects = [];
						for (const feature of r.features) {
							objects.push({
								position: feature.geometry.coordinates,
							});
						}
						setTrees(objects);
					});
			})
			.then(() => {
				let i = 0;
				setInterval(() => {
					setFrameNo(++i);
				}, 100);
			});



	}, []);

	const onViewStateChange = useCallback(({viewState: newViewState}) => {
		setViewState(() => ({
			main: newViewState,
			minimap: INITIAL_VIEW_STATE.minimap,
		}));
	}, []);

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
		// new IconLayer({
		// 	coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
		// 	id: 'entity-layer',
		// 	data: data,
		// 	pickable: true,
		// 	// iconAtlas and iconMapping are required
		// 	// getIcon: return a string
		// 	iconAtlas: 'https://raw.githubusercontent.com/visgl/deck.gl-data/master/website/icon-atlas.png',
		// 	iconMapping: ICON_MAPPING,
		// 	getIcon: d => 'marker',
		// 	sizeScale: 15,
		// 	visible: true,
		// 	getPosition: d => d.positions[frameNo][0],
		// 	getAngle: d => 360-d.positions[frameNo][1]+180,
		// 	getSize: d => 5,
		// 	getColor: d => [100, 140, 0],
		// 	updateTriggers: {
		// 		getPosition: frameNo,
		// 		getAngle: frameNo,
		// 	}
		// }),
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
				}

				let color = [];
				switch (d.side) {
					case "WEST":
						color = [100, 100, 140];
						break;
					case "EAST":
						color = [140, 100, 100];
						break;
					case "GUER":
						color = [100, 140, 0];
						break;
				}

				if (d.positions[frameNo][3] === 1) { // in vehicle
					color.push(0);
				} else {
					color.push(255);
				}

				return color;
			},
			getOrientation: d => [0, 360-d.positions[frameNo][1]+90, 0],
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
			pickable: true,
			getPosition: d => d.positions[frameNo][0],
			getColor: d => {
				let color = [0,0,0];
				switch (d.side) {
					case "WEST":
						color = [100, 100, 140];
						break;
					case "EAST":
						color = [140, 100, 100];
						break;
					case "GUER":
						color = [100, 140, 0];
						break;
				}

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
		new ScenegraphLayer({
			coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
			id: 'cars-layer',
			data: dataCars,
			scenegraph: 'objects/car.gltf',
			sizeScale: 15,
			getPosition: d => d.positions[frameNo][0],
			getColor: d => {
				switch (d.positions[frameNo][2]) {
					case 0:
						return [0, 0, 0, 50];
					default:
						return [100, 140, 0, 255];
				}
			},
			getOrientation: d => [0, 360-d.positions[frameNo][1]+90, 0],
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
			},
		}),
		new ScenegraphLayer({
			coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
			id: 'truck-layer',
			data: dataTrucks,
			scenegraph: 'objects/truck.gltf',
			sizeScale: 15,
			getPosition: d => d.positions[frameNo][0],
			getColor: d => {
				switch (d.positions[frameNo][2]) {
					case 0:
						return [0, 0, 0, 50];
					default:
						return [100, 140, 0, 255];
				}
			},
			getOrientation: d => [0, 360-d.positions[frameNo][1]+90, 0],
			sizeMinPixels: 10,
			sizeMaxPixels: 30,
			_lighting: 'pbr',
			updateTriggers: {
				getPosition: frameNo,
				getOrientation: frameNo,
			},
			transitions: {
				getPosition: 100,
				getColor: frameNo,
				getOrientation: 100
			},
			parameters: {
				depthTest: true
			},
		}),
		// new SimpleMeshLayer({
		// 	coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
		// 	coordinateOrigin: [0, 0, 0],
		// 	id: 'boat-layer',
		// 	data: dataBoats,
		// 	mesh: 'objects/car.obj',
		// 	sizeScale: 3,
		// 	loaders: [OBJLoader],
		// 	getPosition: d => d.positions[frameNo][0],
		// 	getColor: d => [100, 140, 0],
		// 	getOrientation: d => [0, 360-d.positions[frameNo][1]+90, 0],
		// 	updateTriggers: {
		// 		getPosition: frameNo,
		// 		getOrientation: frameNo,
		// 	},
		// 	transitions: {
		// 		getPosition: 100,
		// 		getOrientation: 100
		// 	},
		// }),
		new ScenegraphLayer({
			coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
			id: 'apc-layer',
			data: dataAPCs,
			scenegraph: 'objects/apc.gltf',
			sizeScale: 15,
			getPosition: d => d.positions[frameNo][0],
			getColor: d => {
				switch (d.positions[frameNo][2]) {
					case 0:
						return [0, 0, 0, 50];
					default:
						return [100, 140, 0, 255];
				}
			},
			getOrientation: d => [0, 360-d.positions[frameNo][1]+90, 0],
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
			},
		}),
		new ScenegraphLayer({
			coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
			id: 'tank-layer',
			data: dataTanks,
			scenegraph: 'objects/tank.gltf',
			sizeScale: 15,
			getPosition: d => d.positions[frameNo][0],
			getColor: d => {
				switch (d.positions[frameNo][2]) {
					case 0:
						return [0, 0, 0, 50];
					default:
						return [100, 140, 0, 255];
				}
			},
			getOrientation: d => [0, 360-d.positions[frameNo][1]+90, 0],
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
			},
		}),
		new ScenegraphLayer({
			coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
			id: 'heli-layer',
			data: dataHelis,
			scenegraph: 'objects/heli.gltf',
			sizeScale: 15,
			getPosition: d => d.positions[frameNo][0],
			getColor: d => {
				switch (d.positions[frameNo][2]) {
					case 0:
						return [0, 0, 0, 50];
					default:
						return [100, 140, 0, 255];
				}
			},
			getOrientation: d => [0, 360-d.positions[frameNo][1]+90, 0],
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
			},
		}),
		new ScenegraphLayer({
			coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
			id: 'plane-layer',
			data: dataPlanes,
			scenegraph: 'objects/plane.gltf',
			sizeScale: 15,
			getPosition: d => d.positions[frameNo][0],
			getColor: d => {
				switch (d.positions[frameNo][2]) {
					case 0:
						return [0, 0, 0, 50];
					default:
						return [100, 140, 0, 255];
				}
			},
			getOrientation: d => [0, 360-d.positions[frameNo][1]+90, 0],
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
			},
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
		<DeckGL
			layers={layers}
			views={[mainView, minimapView]}
			viewState={viewState}
			parameters={{depthTest: false}}
			onViewStateChange={onViewStateChange}
			layerFilter={layerFilter}
		>
			<MapView id="main">
				<TopPanel></TopPanel>
				<LeftPanel></LeftPanel>
				<BottomPanel></BottomPanel>
			</MapView>
			<MapView id="minimap">
				<div style={minimapBackgroundStyle} />
			</MapView>
		</DeckGL>
	);
}

export default App;
