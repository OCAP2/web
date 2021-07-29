import './App.css';
import DeckGL from '@deck.gl/react';
import {useCallback, useEffect, useMemo, useState} from "react";
import {COORDINATE_SYSTEM, MapView, WebMercatorViewport} from "@deck.gl/core";
import {IconLayer, PathLayer} from "@deck.gl/layers";
import TopPanel from "./Panel/TopPanel";
import LeftPanel from "./Panel/LeftPanel";
import BottomPanel from "./Panel/BottomPanel";
import {SimpleMeshLayer} from "@deck.gl/mesh-layers";
import {OBJLoader} from "@loaders.gl/obj";

const mainView = new MapView({id: 'main', controller: true});
const minimapView = new MapView({
	id: 'minimap',
	x: 360,
	y: 50,
	width: '20%',
	height: '20%',
	clear: true
});

// Viewport settings
const INITIAL_VIEW_STATE = {
	main: {
		longitude: -100,
		latitude: 40,
		zoom: 3,
		minZoom: 3
	},
	minimap: {
		longitude: -100,
		latitude: 40,
		zoom: 1
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

function layerFilter({layer, viewport}) {
	const shouldDrawInMinimap =
		layer.id.startsWith('coverage') || layer.id.startsWith('viewport-bounds');
	if (viewport.id === 'minimap') return shouldDrawInMinimap;
	return !shouldDrawInMinimap;
}

function App() {
	const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
	const [data, setData] = useState([]);
	const [frameNo, setFrameNo] = useState(0);

	useEffect(() => {
		fetch("/data/2021_07_27__22_36_opt_latest.json")
			.then(r => r.json())
			.then((d) => {
				setData(d.entities.filter((entity) => entity.positions.length > 0));
				// const dataUnits = data.filter((d) => frameNo >= d.startFrameNum && frameNo - d.startFrameNum < d.positions.length);
				// const dataCar = data.filter((d) => frameNo >= d.startFrameNum && frameNo - d.startFrameNum < d.positions.length && d.class === "car");
				// const dataTruck = data.filter((d) => frameNo >= d.startFrameNum && frameNo - d.startFrameNum < d.positions.length && d.class === "truck");
				// const dataAPC = data.filter((d) => frameNo >= d.startFrameNum && frameNo - d.startFrameNum < d.positions.length && d.class === "apc");
				// const dataTank = data.filter((d) => frameNo >= d.startFrameNum && frameNo - d.startFrameNum < d.positions.length && d.class === "tank");
				// const dataHeli = data.filter((d) => frameNo >= d.startFrameNum && frameNo - d.startFrameNum < d.positions.length && d.class === "heli");
				// const dataPlane = data.filter((d) => frameNo >= d.startFrameNum && frameNo - d.startFrameNum < d.positions.length && d.class === "plane");
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
			minimap: {
				...INITIAL_VIEW_STATE.minimap,
				longitude: newViewState.longitude,
				latitude: newViewState.latitude
			}
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
		new PathLayer({
			id: 'viewport-bounds',
			data: viewportBounds,
			getPath: d => d,
			getColor: [255, 0, 0],
			getWidth: 2,
			widthUnits: 'pixels'
		}),
		new IconLayer({
			coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
			id: 'entity-layer',
			data: data.filter((d) => frameNo >= d.startFrameNum && frameNo - d.startFrameNum < d.positions.length),
			pickable: true,
			// iconAtlas and iconMapping are required
			// getIcon: return a string
			iconAtlas: 'https://raw.githubusercontent.com/visgl/deck.gl-data/master/website/icon-atlas.png',
			iconMapping: ICON_MAPPING,
			getIcon: d => 'marker',

			sizeScale: 15,
			visible: true,
			getPosition: d => {
				const pos = d.positions[frameNo - d.startFrameNum][0];
				pos.push(0);
				return pos;
			},
			getAngle: d => 360-d.positions[frameNo - d.startFrameNum][1]+180,
			getSize: d => 5,
			getColor: d => [100, 140, 0],
			updateTrigger: {
				visible: frameNo,
				getPosition: frameNo,
			}
		}),
		new SimpleMeshLayer({
			coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
			coordinateOrigin: [0,0,0],
			id: 'units-layer',
			data: data.filter((d) => frameNo >= d.startFrameNum && frameNo - d.startFrameNum < d.positions.length && d.type === "unit"),
			mesh: 'objects/man.obj',
			sizeScale: 10,
			loaders: [OBJLoader],
			getPosition: d => {
				const pos = d.positions[frameNo - d.startFrameNum][0];
				pos.push(0);
				return pos;
			},
			getColor: d => {
				switch (d.side) {
					case "WEST":
						return [100, 100, 140];
					case "EAST":
						return [140, 100, 100];
					case "GUER":
						return [100, 140, 0];
				}
			},
			getOrientation: d => [0, 360-d.positions[frameNo - d.startFrameNum][1]-90, 0],
			updateTrigger: {
				visible: frameNo,
				getPosition: frameNo,
			}
		}),
		new SimpleMeshLayer({
			coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
			coordinateOrigin: [0, 0, 0],
			id: 'cars-layer',
			data: data.filter((d) => frameNo >= d.startFrameNum && frameNo - d.startFrameNum < d.positions.length && d.class === "car"),
			mesh: 'objects/car.obj',
			sizeScale: 100,
			loaders: [OBJLoader],
			getPosition: d => {
				const pos = d.positions[frameNo - d.startFrameNum][0];
				return pos;
			},
			getColor: d => [100, 140, 0],
			getOrientation: d => [0, 360-d.positions[frameNo - d.startFrameNum][1]+90, 0],
			updateTrigger: {
				visible: frameNo,
				getPosition: frameNo,
			}
		}),
		new SimpleMeshLayer({
			coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
			coordinateOrigin: [0, 0, 0],
			id: 'truck-layer',
			data: data.filter((d) => frameNo >= d.startFrameNum && frameNo - d.startFrameNum < d.positions.length && d.class === "truck"),
			mesh: 'objects/truck.obj',
			sizeScale: 3,
			loaders: [OBJLoader],
			getPosition: d => {
				const pos = d.positions[frameNo - d.startFrameNum][0];
				return pos;
			},
			getColor: d => [100, 140, 0],
			getOrientation: d => [0, 360-d.positions[frameNo - d.startFrameNum][1]+90, 0],
			updateTrigger: {
				visible: frameNo,
				getPosition: frameNo,
			}
		}),
		new SimpleMeshLayer({
			coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
			coordinateOrigin: [0, 0, 0],
			id: 'apc-layer',
			data: data.filter((d) => frameNo >= d.startFrameNum && frameNo - d.startFrameNum < d.positions.length && d.class === "apc"),
			mesh: 'objects/apc.obj',
			sizeScale: 70,
			loaders: [OBJLoader],
			getPosition: d => {
				const pos = d.positions[frameNo - d.startFrameNum][0];
				pos.push(0);
				return pos;
			},
			getColor: d => [100, 140, 0],
			getOrientation: d => [0, 360-d.positions[frameNo - d.startFrameNum][1], 90],
			updateTrigger: {
				visible: frameNo,
				getPosition: frameNo,
			}
		}),
		new SimpleMeshLayer({
			coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
			coordinateOrigin: [0, 0, 0],
			id: 'tank-layer',
			data: data.filter((d) => frameNo >= d.startFrameNum && frameNo - d.startFrameNum < d.positions.length && d.class === "truck"),
			mesh: 'objects/tank.obj',
			sizeScale: 20,
			loaders: [OBJLoader],
			getPosition: d => {
				const pos = d.positions[frameNo - d.startFrameNum][0];
				return pos;
			},
			getColor: d => [100, 140, 0],
			getOrientation: d => [0, 360-d.positions[frameNo - d.startFrameNum][1]-180, 90],
			updateTrigger: {
				visible: frameNo,
				getPosition: frameNo,
			}
		}),
		new SimpleMeshLayer({
			coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
			coordinateOrigin: [0, 0, 0],
			id: 'heli-layer',
			data: data.filter((d) => frameNo >= d.startFrameNum && frameNo - d.startFrameNum < d.positions.length && d.class === "heli"),
			mesh: 'objects/heli.obj',
			sizeScale: 10,
			loaders: [OBJLoader],
			getPosition: d => {
				const pos = d.positions[frameNo - d.startFrameNum][0];
				return pos;
			},
			getColor: d => [100, 140, 0],
			getOrientation: d => [0, 360-d.positions[frameNo - d.startFrameNum][1]-90, 0],
			updateTrigger: {
				visible: frameNo,
				getPosition: frameNo,
			}
		}),
		new SimpleMeshLayer({
			coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
			coordinateOrigin: [0, 0, 0],
			id: 'plane-layer',
			data: data.filter((d) => frameNo >= d.startFrameNum && frameNo - d.startFrameNum < d.positions.length && d.class === "plane"),
			mesh: 'objects/plane.obj',
			sizeScale: 2,
			loaders: [OBJLoader],
			getPosition: d => {
				const pos = d.positions[frameNo - d.startFrameNum][0];
				return pos;
			},
			getColor: d => [100, 140, 0],
			getOrientation: d => [0, 360-d.positions[frameNo - d.startFrameNum][1]-90, 0],
			updateTrigger: {
				visible: frameNo,
				getPosition: frameNo,
			}
		})
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
