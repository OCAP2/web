import './App.css';
import DeckGL from '@deck.gl/react';
import {useCallback, useMemo, useState} from "react";
import {MapView, WebMercatorViewport} from "@deck.gl/core";
import {PathLayer} from "@deck.gl/layers";

const mainView = new MapView({id: 'main', controller: true});
const minimapView = new MapView({
	id: 'minimap',
	x: 20,
	y: 20,
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

function layerFilter({layer, viewport}) {
	const shouldDrawInMinimap =
		layer.id.startsWith('coverage') || layer.id.startsWith('viewport-bounds');
	if (viewport.id === 'minimap') return shouldDrawInMinimap;
	return !shouldDrawInMinimap;
}

function App() {
	const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);

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
			<MapView id="main" />
			<MapView id="minimap">
				<div style={minimapBackgroundStyle} />
			</MapView>
		</DeckGL>
	);
}

export default App;
