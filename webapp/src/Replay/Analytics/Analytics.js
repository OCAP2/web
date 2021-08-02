import DeckGL from "@deck.gl/react";
import {COORDINATE_SYSTEM, MapView} from "@deck.gl/core";
import {HexagonLayer} from "@deck.gl/aggregation-layers";
import {useCallback, useEffect, useState} from "react";
import {GeoJsonLayer, PathLayer} from "@deck.gl/layers";
import {addLatLng, getSideColorHighContrast} from "../Converter";
import Configuration from "./Configuration";
import {TripsLayer} from "@deck.gl/geo-layers";

const mainView = new MapView({
	id: 'main',
	controller: true
});

// Viewport settings
const INITIAL_VIEW_STATE = {
	main: {
		longitude: 0,
		latitude: 0,
		zoom: 12,
		minZoom: 12
	}
};

export const INITIAL_CONFIG = {
	activityHexagon: {
		visible: false,
		radius: 10,
		elevationScale: 4,
		upperPercentile: 100,
	},
	travelRoutes: {
		visible: false,
		animate: false,
		include: {
			car: true,
			truck: false,
			apc: false,
			tank: false,
			heli: false,
			plane: false,
		},
	},
}

export const colorRange = [
	[1, 152, 189],
	[73, 227, 206],
	[216, 254, 181],
	[254, 237, 177],
	[254, 173, 84],
	[209, 55, 78]
];

function Analytics({replay}) {
	const [viewState, setViewState] = useState(INITIAL_VIEW_STATE);
	const [config, setConfig] = useState(INITIAL_CONFIG);
	const [timer, setTimer] = useState(0);

	const [geoLayer, setGeoLayer] = useState(null);
	const [dataHexagon, setDataHexagon] = useState([]);
	const [dataTravelRoutes, setDataTravelRoutes] = useState([]);

	useEffect(() => {
		if (!config.travelRoutes.visible || !config.travelRoutes.animate) return;

		const timeout = setTimeout(() => {
			setTimer(timer + 1);
		}, 50);

		// Clear timeout if the component is unmounted
		return () => clearTimeout(timeout);
	}, [timer, config.travelRoutes.visible, config.travelRoutes.animate]);

	useEffect(() => {
		if (!replay) return;

		const [centerLat, centerLng] = addLatLng([INITIAL_VIEW_STATE.main.latitude, INITIAL_VIEW_STATE.main.longitude], [18001 / 2, 18001 / 2]);
		setViewState(() => ({
			main: {
				...INITIAL_VIEW_STATE.main,
				latitude: centerLat,
				longitude: centerLng,
			},
		}));

		setGeoLayer(new GeoJsonLayer({
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
		}));
	}, [replay]);

	useEffect(() => {
		if (!replay) return;

		const positionWithActivity = [];
		for (const entity of replay.entities) {
			for (const position of entity.positions) {
				if (position[0][0] === 0 && position[0][1] === 0) continue;

				positionWithActivity.push({
					position: position[0],
				});
			}

			for (const firedFrame of entity.framesFired) {
				positionWithActivity.push({
					position: entity.positions[firedFrame[0]][0],
				});
				positionWithActivity.push({
					position: firedFrame[1],
				});
			}
		}

		for (const marker of replay.Markers.filter((marker) => marker[0] === "mil_triangle")) {
			for (const position of marker[7]) {
				positionWithActivity.push({
					position: position[1],
				});
			}
		}

		setDataHexagon(positionWithActivity
			.filter((pos) => pos.position[0] !== 0 && pos.position[1] !== 0)
			.map((pos) => ({
				position: addLatLng([0,0], [Math.round(pos.position[0]), Math.round(pos.position[1])])
			}))
		);
	}, [replay]);

	useEffect(() => {
		if (!replay) return;

		const filterClasses = [];
		if (config.travelRoutes.include.car) filterClasses.push("car");
		if (config.travelRoutes.include.truck) filterClasses.push("truck");
		if (config.travelRoutes.include.apc) filterClasses.push("apc");
		if (config.travelRoutes.include.tank) filterClasses.push("tank");
		if (config.travelRoutes.include.heli) filterClasses.push("heli");
		if (config.travelRoutes.include.plane) filterClasses.push("plane");

		const travelRoutes = [];
		for (const entity of replay.entities) {
			const travelRoutePositions = [];
			let travelRouteColor = [];
			for (const position of entity.positions) {
				if (position[0][0] === 0 && position[0][1] === 0) continue;

				if (filterClasses.includes(entity.class)) {
					const crew = position[3];
					if (travelRouteColor.length === 0 && crew.length > 0) {
						const firstCrew = replay.entities.find((e) => e.id === crew[0]);
						if (firstCrew) {
							travelRouteColor = getSideColorHighContrast(firstCrew.side);
							travelRouteColor.push(255);
						}
					}

					if (travelRoutePositions.length === 0 || travelRoutePositions[travelRoutePositions.length-1].toString() !== position[0].toString()) {
						travelRoutePositions.push(position[0]);
					}
				}
			}

			if (travelRoutePositions.length > 0) {
				travelRoutes.push({
					positions: travelRoutePositions,
					coordinates: travelRoutePositions.map((pos) => addLatLng([0,0], pos)),
					color: travelRouteColor,
				});
			}
		}

		setDataTravelRoutes(travelRoutes);
	}, [replay, config]);

	const layers = [
		geoLayer,
		new HexagonLayer({
			id: 'hexagon-layer',
			data: dataHexagon,
			visible: config.activityHexagon.visible,
			colorRange,
			extruded: true,
			radius: config.activityHexagon.radius,
			elevationScale: config.activityHexagon.elevationScale,
			upperPercentile: config.activityHexagon.upperPercentile,
			coverage: 1,
			opacity: 0.5,
			getPosition: d => d.position
		}),
		new PathLayer({
			coordinateSystem: COORDINATE_SYSTEM.METER_OFFSETS,
			id: 'path-layer',
			data: dataTravelRoutes,
			visible: config.travelRoutes.visible && !config.travelRoutes.animate,
			opacity: 0.8,
			widthScale: 2,
			widthMinPixels: 2,
			capRounded: true,
			jointRounded: true,
			getPath: d => d.positions,
			getColor: d => d.color,
			getWidth: d => 5
		}),
		new TripsLayer({
			id: 'trips-layer',
			data: dataTravelRoutes,
			visible: config.travelRoutes.visible && config.travelRoutes.animate,
			getPath: d => d.coordinates,
			getTimestamps: d => d.coordinates.map((p,i) => i),
			getColor: d => d.color,
			opacity: 0.8,
			widthMinPixels: 2,
			capRounded: true,
			jointRounded: true,
			trailLength: 100,
			currentTime: timer,
			shadowEnabled: false
		}),
	];

	const onViewStateChange = useCallback(({viewState: newViewState}) => {
		setViewState(() => ({
			main: newViewState,
		}));
	}, []);

	return (
		<div>
			<DeckGL
				layers={layers}
				views={[mainView]}
				viewState={viewState}
				onViewStateChange={onViewStateChange}
			>
				<MapView id="main"/>
			</DeckGL>
			<Configuration
				onConfigChange={setConfig}
			/>
		</div>
	);
}

export default Analytics;
