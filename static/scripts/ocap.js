/*
	OCAP - Operation Caputre And Playback
	Copyright (C) 2016 Jamie Goodson (aka MisterGoodson) (goodsonjamie@yahoo.co.uk)

	NOTE: This script is written in ES6 and not intended to be used in a live
	environment. Instead, this script should be transpiled to ES5 for
	browser compatibility (including Chrome).


	This program is free software: you can redistribute it and/or modify
	it under the terms of the GNU General Public License as published by
	the Free Software Foundation, either version 3 of the License, or
	(at your option) any later version.

	This program is distributed in the hope that it will be useful,
	but WITHOUT ANY WARRANTY; without even the implied warranty of
	MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
	GNU General Public License for more details.

	You should have received a copy of the GNU General Public License
	along with this program.  If not, see <http://www.gnu.org/licenses/>.
*/

class Entities {
	constructor() {
		this._entities = [];
	};

	add (entity) {
		this._entities.push(entity);
	};

	getAll () {
		return this._entities;
	};

	getById (id) {
		return this._entities[id]; // Assumes entity IDs are always equal to their index in _entities
	};

	getAllByName (name) {
		let matching = [];
		this._entities.forEach(function (entity) {
			if (entity.getName().indexOf(name) > -1) {
				matching.push(entity);
			}
		});
		return matching;
	};
}

var imageSize = null;
var multiplier = null;
var trim = 0; // Number of pixels that were trimmed when cropping image (used to correct unit placement)
var mapMinZoom = null;
var mapMaxNativeZoom = null;
var mapMaxZoom = null; // mapMaxNativeZoom + 3;
var map = null;
var mapDiv = null;
var initialViewStateValue = {
	latitude: 25,
	longitude: 25,
	zoom: 4,
	pitch: 20,
	bearing: 0
};
var backgroundLayers = [];
var dataLayers = [];
var frameCaptureDelay = 1000; // Delay between capture of each frame in-game (ms). Default: 1000
var playbackMultiplier = 10; // Playback speed. 1 = realtime.
var maxPlaybackMultipler = 60; // Max speed user can set playback to
var minPlaybackMultipler = 1; // Min speed user can set playback to
var playbackMultiplierStep = 1; // Playback speed slider increment value
var playbackPaused = true;
var playbackFrame = 0;
var entityToFollow = null; // When set, camera will follow this unit
var ui = null;
var entities = new Entities();
var groups = new Groups();
var gameEvents = new GameEvents();
var markers = [];
var countEast = 0;
var countWest = 0;
var countGuer = 0;
var countCiv = 0;

var units = [];
var others = [];

// Mission details
var worldName = "";
var missionName = "";
var endFrame = 0;
var missionCurDate = new Date(0);

// Icons
var models = null;
var followColour = "#FFA81A";
var hitColour = "#FF0000";
var deadColour = "#000000";

const skipAnimationDistance = 100;
let requestedFrame;

function getArguments () {
	let args = new Object();
	window.location.search.replace("?", "").split("&").forEach(function (s) {
		let values = s.split("=");
		if (values.length > 1) {
			args[values[0]] = values[1].replace(/%20/g, " ");
		}
	});
	// console.log(args);
	return args;
}

function hexToRGB (hex) {
	var bigint = parseInt(hex, 16);
	var r = (bigint >> 16) & 255;
	var g = (bigint >> 8) & 255;
	var b = bigint & 255;

	return [r, g, b];
};


function terrainColors (elementfill) {
	var color = "000000";
	switch (elementfill) {
		case "url(#colorTracks)":
			color = "332100";
		case "url(#colorRoads)":
			color = "332100";
		case "url(#colorMainRoads)":
			color = "000000";
		case "url(#colorTracksFill)":
			color = "FFE0A6";
		case "url(#colorRoadsFill)":
			color = "FFE0A6";
		case "url(#colorMainRoadsFill)":
			color = "F0B033";
		case "url(#colorRailWay)":
			color = "CC3300";
		case "url(#colorSea)":
			color = "C7E6FC";
		case "url(#colorLand)":
			color = "DFDFDF";
		case "url(#colorForest)":
			color = "CCE699";
		case "url(#colorRocks)":
			color = "D6C7B5";
		case "url(#colorForestBorder)":
			color = "66CC00"
		case "url(#colorRocksBorder)":
			color = "D6C7B5";
		case "url(#colorTrails)":
			color = "000000";
		case "url(#colorTrailsFill)":
			color = "000000";
		case "url(#colorCountlines)":
			color = "D1BA94";
		case "url(#colorCountlinesMain)":
			color = "A67345";
		case "url(#colorCountlinesWater)":
			color = "80C3FF";
		case "url(#colorCountlinesWaterMain)":
			color = "0087FF";
		case "url(#colorGrid)":
			color = "707053";
		case "url(#colorSpot)":
			color = "000000";
	};
	return hexToRgb(color);
};





function initOCAP () {
	mapDiv = document.getElementById("map");
	defineModels();
	ui = new UI();

	const args = getArguments();

	Promise.all([ui.updateCustomize(), ui.setModalOpList()])
		.then(() => {
			/*
				window.addEventListener("keypress", function (event) {
					switch (event.charCode) {
						case 32: // Spacebar
							event.preventDefault(); // Prevent space from scrolling page on some browsers
							break;
					};
				});
			*/
			if (args.file) {
				document.addEventListener("mapInited", function (event) {
					let args = getArguments();
					if (args.x && args.y && args.zoom) {
						initialViewStateValue = {
							latitude: parseFloat(args.x),
							longitude: parseFloat(args.y),
							zoom: parseFloat(args.zoom),
							pitch: 0,
							bearing: 0
						}
					}
					if (args.frame) {
						ui.setMissionCurTime(parseInt(args.frame));
					}
				}, false);

				return processOp("data/" + args.file);
			}
		})

	if (args.experimental) ui.showExperimental();
}

function getWorldByName (worldName) {
	console.log("Getting world " + worldName);
	let map = {};
	let defaultMap = {
		"name": "NOT FOUND",
		"worldname": "NOT FOUND",
		"worldSize": 16384,
		"imageSize": 16384,
		"multiplier": 1,
		"maxZoom": 6,
		"minZoom": 0,
	};

	return fetch(`images/maps/${worldName}/map.json`)
		.then((res) => res.json())
		.then((data) => {
			map = data;
			return Object.assign(defaultMap, map);
		})
		.catch(() => {
			ui.showHint(`Error: Map "${worldName}" is not installed`);
		});
}


let frameNo = 0;
const ICON_MAPPING = {
	marker: { x: 0, y: 0, width: 128, height: 128, mask: true }
};

function initMap (world, data) {
	// Bad
	mapMaxNativeZoom = world.maxZoom
	mapMaxZoom = mapMaxNativeZoom + 3
	mapMinZoom = world.minZoom
	// Create map
	/* map = L.map('map', {
		//maxZoom: mapMaxZoom,
		zoomControl: false,
		zoomAnimation: true,
		scrollWheelZoom: true,
		fadeAnimation: true,
		crs: L.CRS.Simple,
		attributionControl: false,
		zoomSnap: 0.1,
		zoomDelta: 1,
		closePopupOnClick: false,
		preferCanvas: false
	}); */

	units = [];
	for (const entity of data.entities) {
		if (entity.type !== "unit") continue;
		if (entity.positions.length < 1) continue;
		units.push(entity);
	}
	others = [];
	for (const entity of data.entities) {
		if (entity.type === "unit") continue;
		if (entity.positions.length < 1) continue;
		others.push(entity);
	}

	// const tileLayer = new deck.TileLayer({
	// 	id: 'terrain',
	// 	coordinateSystem: deck.COORDINATE_SYSTEM.CARTESIAN,
	// 	bounds: [
	// 		0,
	// 		0,
	// 		world.worldSize,
	// 		world.worldSize
	// 	],
	// 	data: 'images/maps/' + worldName + '/{z}/{x}/{y}.png',
	// 	view: new deck.OrbitView({ id: 'base-map', controller: true }),

	// 	minZoom: 0,
	// 	maxZoom: 6,
	// 	tileSize: 256,

	// 	renderSubLayers: props => {
	// 		const {
	// 			bbox: { west, south, east, north }
	// 		} = props.tile;

	// 		return new deck.BitmapLayer(props, {
	// 			data: null,
	// 			image: props.data,
	// 			bounds: [west, south, east, north],
	// 			coordinateSystem: deck.COORDINATE_SYSTEM.METER_OFFSETS,
	// 		});
	// 	}
	// });

	// const terrainLayer = new deck.BitmapLayer({
	// 	id: 'bitmap-layer',
	// 	coordinateSystem: deck.COORDINATE_SYSTEM.METER_OFFSETS,
	// 	bounds: [
	// 		0,
	// 		0,
	// 		world.worldSize,
	// 		world.worldSize
	// 	],
	// 	image: 'https://i.imgur.com/VRpwq4R.png'
	// });


	// const terrainLayer = new deck.TerrainLayer({
	// 	coordinateSystem: deck.COORDINATE_SYSTEM.CARTESIAN,
	// 	coordinateOrigin: [26.90743, 29.18254, 0],
	// 	elevationDecoder: {
	// 		rScaler: 15,
	// 		gScaler: 0,
	// 		bScaler: 0,
	// 		offset: 0
	// 	},
	// 	minZoom: 0,
	// 	maxZoom: 6,
	// 	tileSize: 256,
	// 	zoomOffset: 0,
	// 	meshMaxError: 30,
	// 	// tesselator: 'delatin',
	// 	elevationData: 'images/maps/' + worldName + '/heightmap/{z}/{x}/{y}.png',
	// 	// elevationData: 'images/maps/' + worldName + '/terrain2.png'//,
	// 	texture: 'images/maps/' + worldName + '/terraintiles/{z}/{x}/{y}.png'
	// 	// bounds: [
	// 	// 	26.90743,
	// 	// 	29.18254,
	// 	// 	27.09271,
	// 	// 	29.34500
	// 	// ]
	// });

	const terrainLayer = new deck.TileLayer({
		// https://wiki.openstreetmap.org/wiki/Slippy_map_tilenames#Tile_servers
		data: 'images/maps/' + worldName + '/terraintiles/{z}/{x}/{y}.png',
		// coordinateSystem: deck.COORDINATE_SYSTEM.METER_OFFSETS,
		// coordinateOrigin: [26.90743, 29.18254, 0],
		// bounds: [
		// 	0,
		// 	0,
		// 	world.worldSize,
		// 	world.worldSize
		// ],
		minZoom: 0,
		maxZoom: 6,
		tileSize: 256,
		zoomOffset: -8,
		views: [
			new deck.MapView({id: 'terrain-view', repeat: true })
		],
		bounds: [
			[60.91914988779904, 26.83365656940842],
			[60.91914988779904, 27.16634343059158],
			[61.08085011220096, 27.167192511259376],
			[61.08085011220096, 26.832807488740624]
		],

		renderSubLayers: props => {
			const {
				bbox: { west, south, east, north }
			} = props.tile;

			return new deck.BitmapLayer(props, {
				data: null,
				image: props.data,
				coordinateSystem: deck.COORDINATE_SYSTEM.METER_OFFSETS,
				coordinateOrigin: [26.90743, 29.18254, 0],
				bounds: [west, south, east, north]
			});
		}
	});

	// const geoJsonTerrain = new deck.GeoJsonLayer({
	// 	id: 'geojson-terrain',
	// 	coordinateSystem: deck.COORDINATE_SYSTEM.LNGLAT,
	// 	// coordinateOrigin: [-61, 27, 0],
	// 	data: `images/maps/${worldName}/${worldName}-terrain.geojson`,
	// 	pickable: true,
	// 	stroked: true,
	// 	filled: true,
	// 	extruded: false,
	// 	pointType: 'circle',
	// 	lineWidthScale: 2,
	// 	lineWidthMinPixels: 1,
	// 	getFillColor: [160, 160, 50, 200],
	// 	getLineColor: [100, 100, 100, 200],
	// 	getPointRadius: 2,
	// 	getLineWidth: 1,
	// 	getElevation: 0
	// });

	const geoJsonForests = new deck.GeoJsonLayer({
		id: 'geojson-forests',
		coordinateSystem: deck.COORDINATE_SYSTEM.LNGLAT,
		// coordinateOrigin: [-61, 27, 0],
		data: `images/maps/${worldName}/${worldName}-forests.geojson`,
		pickable: true,
		stroked: false,
		filled: true,
		extruded: false,
		pointType: 'circle',
		lineWidthScale: 1,
		lineWidthMinPixels: 2,
		getFillColor: [50, 200, 50, 200],
		getLineColor: [100, 100, 100, 200],
		getPointRadius: 2,
		getLineWidth: 1,
		getElevation: 1
	});

	// const geoJsonObjects = new deck.GeoJsonLayer({
	// 	id: 'geojson-objects',
	// 	coordinateSystem: deck.COORDINATE_SYSTEM.LNGLAT,
	// 	// coordinateOrigin: [-61, 27, 0],
	// 	data: `images/maps/${worldName}/${worldName}-objects.geojson`,
	// 	pickable: true,
	// 	stroked: true,
	// 	filled: true,
	// 	extruded: true,
	// 	pointType: 'circle',
	// 	lineWidthScale: 1,
	// 	lineWidthMinPixels: 2,
	// 	getFillColor: [20, 20, 20, 255],
	// 	getLineColor: [0, 0, 0, 200],
	// 	getPointRadius: 2,
	// 	getLineWidth: 1,
	// 	getElevation: 10
	// });

	// const geoJsonRocks = new deck.GeoJsonLayer({
	// 	id: 'geojson-rocks',
	// 	coordinateSystem: deck.COORDINATE_SYSTEM.LNGLAT,
	// 	// coordinateOrigin: [-61, 27, 0],
	// 	data: `images/maps/${worldName}/${worldName}-rocks.geojson`,
	// 	pickable: true,
	// 	stroked: false,
	// 	filled: true,
	// 	extruded: true,
	// 	pointType: 'circle',
	// 	lineWidthScale: 1,
	// 	lineWidthMinPixels: 2,
	// 	getFillColor: [50, 50, 50, 200],
	// 	getLineColor: [0, 0, 0, 200],
	// 	getPointRadius: 2,
	// 	getLineWidth: 1,
	// 	getElevation: 5
	// });

	// const geoJsonRoads = new deck.GeoJsonLayer({
	// 	id: 'geojson-roads',
	// 	coordinateSystem: deck.COORDINATE_SYSTEM.LNGLAT,
	// 	// coordinateOrigin: [-61, 27, 0],
	// 	data: `images/maps/${worldName}/${worldName}-roads.geojson`,
	// 	pickable: true,
	// 	stroked: false,
	// 	filled: true,
	// 	extruded: false,
	// 	pointType: 'circle',
	// 	lineWidthScale: 1,
	// 	lineWidthMinPixels: 2,
	// 	getFillColor: [255, 20, 20, 200],
	// 	getLineColor: [0, 0, 0, 200],
	// 	getPointRadius: 10,
	// 	getLineWidth: 5,
	// 	getElevation: 1
	// });


	function render () {
		const dataUnits = units.filter((d) => frameNo >= d.startFrameNum && frameNo - d.startFrameNum < d.positions.length);
		const dataCar = others.filter((d) => frameNo >= d.startFrameNum && frameNo - d.startFrameNum < d.positions.length && d.class === "car");
		const dataTruck = others.filter((d) => frameNo >= d.startFrameNum && frameNo - d.startFrameNum < d.positions.length && d.class === "truck");
		const dataAPC = others.filter((d) => frameNo >= d.startFrameNum && frameNo - d.startFrameNum < d.positions.length && d.class === "apc");
		const dataTank = others.filter((d) => frameNo >= d.startFrameNum && frameNo - d.startFrameNum < d.positions.length && d.class === "tank");
		const dataHeli = others.filter((d) => frameNo >= d.startFrameNum && frameNo - d.startFrameNum < d.positions.length && d.class === "heli");
		const dataPlane = others.filter((d) => frameNo >= d.startFrameNum && frameNo - d.startFrameNum < d.positions.length && d.class === "plane");
		const iconLayer = new deck.IconLayer({
			coordinateSystem: deck.COORDINATE_SYSTEM.METER_OFFSETS,
			coordinateOrigin: [26.90743, 29.18254, 0],
			id: 'entity-layer',
			data: dataCar,
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
			getAngle: d => 360 - d.positions[frameNo - d.startFrameNum][1],
			getSize: d => 5,
			getColor: d => [100, 140, 0],
			updateTrigger: {
				visible: frameNo,
				getPosition: frameNo,
			}
		});

		const layerUnits = new deck.SimpleMeshLayer({
			coordinateSystem: deck.COORDINATE_SYSTEM.METER_OFFSETS,
			coordinateOrigin: [26.90743, 29.18254, 0],
			id: 'units-layer',
			data: dataUnits,
			// mesh: d => {
			// 	console.log(d.modelType);
			// 	return d.modelType;
			// },
			mesh: 'https://raw.githubusercontent.com/visgl/deck.gl-data/master/website/humanoid_quad.obj',
			sizeScale: 10,
			loaders: [loaders.OBJLoader],
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
			getOrientation: d => [0, 360 - d.positions[frameNo - d.startFrameNum][1] - 90, 0],
			// updateTrigger: {
			// 	visible: frameNo,
			// 	getPosition: frameNo,
			// }
		});
		const layersCar = new deck.SimpleMeshLayer({
			coordinateSystem: deck.COORDINATE_SYSTEM.METER_OFFSETS,
			coordinateOrigin: [26.90743, 29.18254, 0],
			id: 'cars-layer',
			data: dataCar,
			mesh: '/objects/car.obj',
			sizeScale: 100,
			loaders: [loaders.OBJLoader],
			getPosition: d => {
				const pos = d.positions[frameNo - d.startFrameNum][0];
				pos.push(0);
				return pos;
			},
			getColor: d => [100, 140, 0],
			getOrientation: d => [0, 360 - d.positions[frameNo - d.startFrameNum][1] + 90, 0],
			// updateTrigger: {
			// 	visible: frameNo,
			// 	getPosition: frameNo,
			// }
		});
		const layersTruck = new deck.SimpleMeshLayer({
			coordinateSystem: deck.COORDINATE_SYSTEM.METER_OFFSETS,
			coordinateOrigin: [26.90743, 29.18254, 0],
			id: 'truck-layer',
			data: dataTruck,
			mesh: '/objects/truck.obj',
			sizeScale: 3,
			loaders: [loaders.OBJLoader],
			getPosition: d => {
				const pos = d.positions[frameNo - d.startFrameNum][0];
				pos.push(0);
				return pos;
			},
			getColor: d => [100, 140, 0],
			getOrientation: d => [0, 360 - d.positions[frameNo - d.startFrameNum][1] + 90, 0],
			// updateTrigger: {
			// 	visible: frameNo,
			// 	getPosition: frameNo,
			// }
		});
		const layerAPC = new deck.SimpleMeshLayer({
			coordinateSystem: deck.COORDINATE_SYSTEM.METER_OFFSETS,
			coordinateOrigin: [26.90743, 29.18254, 0],
			id: 'apc-layer',
			data: dataAPC,
			mesh: '/objects/apc.obj',
			sizeScale: 70,
			loaders: [loaders.OBJLoader],
			getPosition: d => {
				const pos = d.positions[frameNo - d.startFrameNum][0];
				pos.push(0);
				return pos;
			},
			getColor: d => [100, 140, 0],
			getOrientation: d => [0, 360 - d.positions[frameNo - d.startFrameNum][1], 90],
			// updateTrigger: {
			// 	visible: frameNo,
			// 	getPosition: frameNo,
			// }
		});
		const layerTank = new deck.SimpleMeshLayer({
			coordinateSystem: deck.COORDINATE_SYSTEM.METER_OFFSETS,
			coordinateOrigin: [26.90743, 29.18254, 0],
			id: 'tank-layer',
			data: dataTank,
			mesh: '/objects/tank.obj',
			sizeScale: 20,
			loaders: [loaders.OBJLoader],
			getPosition: d => {
				const pos = d.positions[frameNo - d.startFrameNum][0];
				pos.push(0);
				return pos;
			},
			getColor: d => [100, 140, 0],
			getOrientation: d => [0, 360 - d.positions[frameNo - d.startFrameNum][1] - 180, 90],
			// updateTrigger: {
			// 	visible: frameNo,
			// 	getPosition: frameNo,
			// }
		});
		const layerHeli = new deck.SimpleMeshLayer({
			coordinateSystem: deck.COORDINATE_SYSTEM.METER_OFFSETS,
			coordinateOrigin: [26.90743, 29.18254, 0],
			id: 'heli-layer',
			data: dataHeli,
			mesh: '/objects/heli.obj',
			sizeScale: 10,
			loaders: [loaders.OBJLoader],
			getPosition: d => {
				const pos = d.positions[frameNo - d.startFrameNum][0];
				pos.push(0);
				return pos;
			},
			getColor: d => [100, 140, 0],
			getOrientation: d => [0, 360 - d.positions[frameNo - d.startFrameNum][1] - 90, 0],
			// updateTrigger: {
			// 	visible: frameNo,
			// 	getPosition: frameNo,
			// }
		});
		const layerPlane = new deck.SimpleMeshLayer({
			coordinateSystem: deck.COORDINATE_SYSTEM.METER_OFFSETS,
			coordinateOrigin: [26.90743, 29.18254, 0],
			id: 'plane-layer',
			data: dataPlane,
			mesh: '/objects/plane.obj',
			sizeScale: 2,
			loaders: [loaders.OBJLoader],
			getPosition: d => {
				const pos = d.positions[frameNo - d.startFrameNum][0];
				pos.push(0);
				return pos;
			},
			getColor: d => [100, 140, 0],
			getOrientation: d => [0, 360 - d.positions[frameNo - d.startFrameNum][1] - 90, 0],
			// updateTrigger: {
			// 	visible: frameNo,
			// 	getPosition: frameNo,
			// }
		});

		// map.setProps({ layers: [terrainLayer, geoJsonTerrain, geoJsonForests, geoJsonObjects, geoJsonRoads, geoJsonRocks, iconLayer, layerUnits, layersCar, layersTruck, layerAPC, layerTank, layerHeli, layerPlane] });
		// map.setProps({ layers: [tileLayer, bitmapLayer, terrainLayer, iconLayer, layerUnits, layersCar, layersTruck, layerAPC, layerTank, layerHeli, layerPlane]});
		map.setProps({ layers: [terrainLayer, geoJsonForests, iconLayer, layerUnits, layersCar, layersTruck, layerAPC, layerTank, layerHeli, layerPlane] });
	}

	// setInterval(() => {
	// 	frameNo += 1;
	// 	render();
	// }, 100);






	map = new deck.DeckGL({
		initialViewState: initialViewStateValue,
		controller: true,
		container: 'map',
		_animate: true,
		layers: [
			// tileLayer,
			// bitmapLayer,
			terrainLayer
		]/* ,
		view: new deck.MapView({ id: 'base-map', controller: true }) */
	});

	render();

	// Hide marker popups once below a certain zoom level
	// map.on("zoom", function () {
	// 	ui.hideMarkerPopups = map.getZoom() <= 4;
	// });

	// let playbackPausedBeforeZoom;
	// map.on("zoomstart", () => {
	// 	cancelAnimationFrame(requestedFrame);
	// 	document.getElementById("container").classList.add("zooming");
	// 	playbackPausedBeforeZoom = playbackPaused;
	// 	if (!playbackPaused) {
	// 		playbackPaused = true;
	// 	}
	// });
	// map.on("zoomend", () => {
	// 	document.getElementById("container").classList.remove("zooming");
	// 	playbackPaused = playbackPausedBeforeZoom;
	// });
	// map.on("popupopen", (e) => {
	// 	e.popup.getElement().classList.add("animation");
	// });
	// map.on("popupclose", (e) => {
	// 	e.popup.getElement().classList.remove("animation");
	// });
	// map.on("dragstart", function () {
	// 	if (entityToFollow != null) {
	// 		entityToFollow.unfollow();
	// 	}
	// });

	console.log("Got world: ", world);

	// imageSize = world.imageSize;
	// multiplier = world.multiplier;
	// let args = getArguments();
	// if (!args.x || !args.y || !args.zoom) {
	// 	map.setView(map.unproject([imageSize / 2, imageSize / 2]), mapMinZoom);
	// }

	// var mapBounds = new L.LatLngBounds(
	// 	map.unproject([0, imageSize], mapMaxNativeZoom),
	// 	map.unproject([imageSize, 0], mapMaxNativeZoom)
	// );
	// map.fitBounds(mapBounds);

	// Setup tile layer
	// L.tileLayer('images/maps/' + worldName + '/{z}/{x}/{y}.png', {
	// 	maxNativeZoom: mapMaxNativeZoom,
	// 	maxZoom: mapMaxZoom,
	// 	minZoom: mapMinZoom,
	// 	bounds: mapBounds,
	// 	//attribution: 'MisterGoodson',
	// 	noWrap: true,
	// 	tms: false
	// }).addTo(map);


	// Add keypress event listener
	mapDiv.addEventListener("keypress", function (event) {
		//console.log(event);

		switch (event.charCode) {
			case 32: // Spacebar
				playPause();
				break;
		}
	});

	// createInitialMarkers();
	// let boundaryMarks = markers.filter(item => {
	// 	return item._type === "moduleCoverMap"
	// });
	// if (boundaryMarks.length === 4) {
	// 	let boundaryPoints = boundaryMarks.map(item => armaToLatLng(item._positions[0][1]));
	// 	let boundaryPolygon = L.polygon(boundaryPoints, { color: "#000000", fill: false, interactive: false, noClip: true }).addTo(map);
	// 	map.flyToBounds(boundaryPolygon.getBounds());
	// } else {
	// 	map.flyToBounds(map.getBounds());
	// }

	document.dispatchEvent(new Event("mapInited"));
	//test();
}

function createInitialMarkers () {
	entities.getAll().forEach(function (entity) {
		// Create and set marker for unit
		const pos = entity.getPosAtFrame(0);
		if (pos) { // If unit did exist at start of game
			entity.createMarker(armaToLatLng(pos.position));
		}
	});
}

function defineModels () {
	models = {
		man: 'https://raw.githubusercontent.com/visgl/deck.gl-data/master/website/humanoid_quad.obj',
		ship: 'objects/car.obj',
		parachute: 'objects/car.obj',
		heli: 'objects/heli.obj',
		plane: 'objects/heli.obj',
		truck: 'objects/car.obj',
		car: 'objects/car.obj',
		apc: 'objects/apc.obj',
		tank: 'objects/tank.obj',
		staticMortar: 'objects/apc.obj',
		staticWeapon: 'objects/apc.obj',
		unknown: 'objects/apc.obj'
	};
	/* 
		let imgPathMan = "static/models/apc.obj";
		// let imgPathManMG = "images/markers/man/MG/";
		// let imgPathManGL = "images/markers/man/GL/";
		// let imgPathManAT = "images/markers/man/AT/";
		// let imgPathManSniper = "images/markers/man/Sniper/";
		// let imgPathManAA = "images/markers/man/AA/";
		let imgPathShip = "static/models/apc.obj";
		let imgPathParachute = "static/models/apc.obj";
		let imgPathHeli = "static/models/FighterHelicopter.obj";
		let imgPathPlane = "static/models/FighterHelicopter.obj";
		let imgPathTruck = "static/models/apc.obj";
		let imgPathCar = "static/models/apc.obj";
		let imgPathApc = "static/models/apc.obj";
		let imgPathTank = "static/models/m1_clean.obj";
		let imgPathStaticMortar = "static/models/apc.obj";
		let imgPathStaticWeapon = "static/models/apc.obj";
		let imgPathUnknown = "static/models/apc.obj";
	
	
		models = 
	
	
		let models = ["blufor", "opfor", "ind", "civ", "unknown", "dead", "hit", "follow", "unconscious"];
		models.forEach((img, i) => {
			icons.man[img] = L.icon({ className: "animation", iconSize: [16, 16], iconUrl: `${imgPathMan}${img}.svg` });
			// icons.manMG[img] = L.icon({ className: "animation", iconSize: [16, 16], iconUrl: `${imgPathManMG}${img}.svg` });
			// icons.manGL[img] = L.icon({ className: "animation", iconSize: [16, 16], iconUrl: `${imgPathManGL}${img}.svg` });
			// icons.manAT[img] = L.icon({ className: "animation", iconSize: [16, 16], iconUrl: `${imgPathManAT}${img}.svg` });
			// icons.manSniper[img] = L.icon({ className: "animation", iconSize: [16, 16], iconUrl: `${imgPathManSniper}${img}.svg` });
			// icons.manAA[img] = L.icon({ className: "animation", iconSize: [16, 16], iconUrl: `${imgPathManAA}${img}.svg` });
			icons.ship[img] = L.icon({ className: "animation", iconSize: [28, 28], iconUrl: `${imgPathShip}${img}.svg` });
			icons.parachute[img] = L.icon({ className: "animation", iconSize: [20, 20], iconUrl: `${imgPathParachute}${img}.svg` });
			icons.heli[img] = L.icon({ className: "animation", iconSize: [32, 32], iconUrl: `${imgPathHeli}${img}.svg` });
			icons.plane[img] = L.icon({ className: "animation", iconSize: [32, 32], iconUrl: `${imgPathPlane}${img}.svg` });
			icons.truck[img] = L.icon({ className: "animation", iconSize: [28, 28], iconUrl: `${imgPathTruck}${img}.svg` });
			icons.car[img] = L.icon({ className: "animation", iconSize: [24, 24], iconUrl: `${imgPathCar}${img}.svg` });
			icons.apc[img] = L.icon({ className: "animation", iconSize: [28, 28], iconUrl: `${imgPathApc}${img}.svg` });
			icons.tank[img] = L.icon({ className: "animation", iconSize: [28, 28], iconUrl: `${imgPathTank}${img}.svg` });
			icons.staticMortar[img] = L.icon({ className: "animation", iconSize: [20, 20], iconUrl: `${imgPathStaticMortar}${img}.svg` });
			icons.staticWeapon[img] = L.icon({ className: "animation", iconSize: [20, 20], iconUrl: `${imgPathStaticWeapon}${img}.svg` });
			icons.unknown[img] = L.icon({ className: "animation", iconSize: [28, 28], iconUrl: `${imgPathUnknown}${img}.svg` });
		});
	 */
}

function goFullscreen () {
	if (document.webkitIsFullScreen) {
		document.webkitExitFullscreen();
		return;
	}
	var element = document.getElementById("container");
	if (element.requestFullscreen) {
		element.requestFullscreen();
	} else if (element.mozRequestFullScreen) {
		element.mozRequestFullScreen();
	} else if (element.webkitRequestFullscreen) {
		element.webkitRequestFullscreen();
	} else if (element.msRequestFullscreen) {
		element.msRequestFullscreen();
	}
}

// Converts Arma coordinates [x,y] to LatLng
function armaToLatLng (coords) {
	const pixelCoords = [(coords[0] * multiplier) + trim, (imageSize - (coords[1] * multiplier)) + trim];
	return pixelCoords;
}

// Returns date object as little endian (day, month, year) string
function dateToLittleEndianString (date) {
	return (date.getDate() + "/" + (date.getMonth() + 1) + "/" + date.getFullYear());
}

function test () {
	// Add marker to map on click
	map.on("click", function (e) {
		//console.log(e.latlng);

		console.log(map.project(e.latlng, mapMaxNativeZoom));

		brushPattern = {
			color: "#FF0000",
			opacity: 1,
			angle: 45,
			weight: 2,
			spaceWeight: 6
		};

		var brushPatternObj = new L.StripePattern(brushPattern);
		brushPatternObj.addTo(map)

		shapeOptions = {
			color: "#FF0000",
			stroke: true,
			fill: true,
			fillPattern: brushPatternObj
		};

		var circleMarker;
		circleMarker = L.circle(e.latlng, shapeOptions);
		L.Util.setOptions(circleMarker, { radius: 20, interactive: false });
		circleMarker.addTo(map);


		let pos = e.latlng;
		let startX = pos.lat;
		let startY = pos.lng;
		let sizeX = 75;
		let sizeY = 75;

		let pointsRaw = [
			[startX - sizeX, startY + sizeY], // top left
			[startX + sizeX, startY + sizeY], // top right
			[startX + sizeX, startY - sizeY], // bottom right
			[startX - sizeX, startY - sizeY] // bottom left
		];

		const sqMarker = L.polygon(pointsRaw, { noClip: true, interactive: false });
		L.Util.setOptions(sqMarker, shapeOptions);
		// if (brushPattern) {
		// 	L.Util.setOptions(sqMarker, { fillPattern: brushPatternObj, fillOpacity: 1.0});
		// };
		sqMarker.addTo(map);

		// var marker = L.circleMarker(e.latlng).addTo(map);
		// marker.setRadius(5);
	});

	// var marker = L.circleMarker(armaToLatLng([2438.21, 820])).addTo(map);
	// marker.setRadius(5);

	// var marker = L.circleMarker(armaToLatLng([2496.58, 5709.34])).addTo(map);
	// marker.setRadius(5);
}

function dateToTimeString (date, isUtc = false) {
	let hours = date.getHours();
	let minutes = date.getMinutes();
	let seconds = date.getSeconds();
	if (isUtc) {
		hours = date.getUTCHours();
		minutes = date.getUTCMinutes();
		seconds = date.getUTCSeconds();
	}
	let string = "";

	/*	if (hours < 10) {
			string += "0";
		}*/
	string += (hours + ":");

	if (minutes < 10) {
		string += "0";
	}
	string += (minutes + ":");

	if (seconds < 10) {
		string += "0";
	}
	string += seconds;

	return string;
}

// Convert time in seconds to a more readable time format
// e.g. 121 seconds -> 2 minutes
// e.g. 4860 seconds -> 1 hour, 21 minutes
function secondsToTimeString (seconds) {
	let mins = Math.round(seconds / 60);

	if (mins < 60) {
		let minUnit = (mins > 1 ? "mins" : "min");

		return `${mins} ${minUnit}`;
	} else {
		let hours = Math.floor(mins / 60);
		let remainingMins = mins % 60;
		let hourUnit = (hours > 1 ? "hrs" : "hr");
		let minUnit = (remainingMins > 1 ? "mins" : "min");

		return `${hours} ${hourUnit}, ${remainingMins} ${minUnit}`;
	}
}

// Read operation JSON data and create unit objects
function processOp (filepath) {
	console.log("Processing operation: (" + filepath + ")...");
	const time = new Date();
	fileName = filepath.substr(5, filepath.length);

	return fetch(filepath)
		.then((res) => res.json())
		.then((data) => {
			worldName = data.worldName.toLowerCase();
			return Promise.all([data, getWorldByName(worldName)]);
		})
		.then(([data, world]) => {
			var multiplier = world.multiplier;
			missionName = data.missionName;
			ui.setMissionName(missionName);

			endFrame = data.endFrame;
			frameCaptureDelay = data.captureDelay * 1000;
			ui.setMissionEndTime(endFrame);
			if (data.times) {
				ui.detectTimes(data.times);
			}
			ui.checkAvailableTimes();

			var showCiv = false;
			var showWest = false;
			var showEast = false;
			var showGuer = false;
			var arrSide = ["GLOBAL", "EAST", "WEST", "GUER", "CIV"];


			// Loop through entities
			data.entities.forEach(function (entityJSON) {
				//console.log(entityJSON);

				let type = entityJSON.type;
				let startFrameNum = entityJSON.startFrameNum;
				let id = entityJSON.id;
				let name = entityJSON.name;
				let arrSideSelect = [];
				// Convert positions into array of objects
				let positions = [];
				entityJSON.positions.forEach(function (entry, i) {
					if (entry == []) {
						positions.push(positions[i - 1]);
					} else {
						let pos = entry[0];
						let dir = entry[1];
						let alive = entry[2];

						if (type == "unit") {
							let name = entry[4];
							if (name == "" && i != 0)
								name = positions[i - 1].name;
							if (name == "" && i == 0)
								name = "unknown";
							positions.push({ position: pos, direction: dir, alive: alive, isInVehicle: (entry[3] == 1), name: name, isPlayer: entry[5] });
						} else {
							let crew = entry[3];
							const vehicle = { position: pos, direction: dir, alive: alive, crew: crew };
							if (entry.length >= 5) {
								vehicle.frames = entry[4];
							}
							positions.push(vehicle);
						}
					}
				});

				if (type === "unit") {
					//if (entityJSON.name == "Error: No unit") {return}; // Temporary fix for old captures that initialised dead units

					// Add group to global groups object (if new)
					let group = groups.findGroup(entityJSON.group, entityJSON.side);
					if (group == null) {
						group = new Group(entityJSON.group, entityJSON.side);
						groups.addGroup(group);
					}

					// Create unit and add to entities list
					const unit = new Unit(startFrameNum, id, name, group, entityJSON.side, (entityJSON.isPlayer === 1), positions, entityJSON.framesFired, entityJSON.role);
					entities.add(unit);

					// Show title side
					if (arrSideSelect.indexOf(entityJSON.side) === -1) {
						arrSideSelect.push(entityJSON.side);
						switch (entityJSON.side) {
							case "WEST":
								showWest = true;
								break;
							case "EAST":
								showEast = true;
								break;
							case "GUER":
								showGuer = true;
								break;
							case "CIV":
								showCiv = true;
								break;
						}
					}
				} else {
					// Create vehicle and add to entities list
					const vehicle = new Vehicle(startFrameNum, id, entityJSON.class, name, positions);
					entities.add(vehicle);
				}
			});

			console.log("Finished processing operation (" + (new Date() - time) + "ms).");
			initMap(world, data);
			// startPlaybackLoop();
			// toggleHitEvents(false);
			// playPause();
			ui.hideModal();
		}).catch((error) => {
			ui.modalBody.innerHTML = `Error: "${filepath}" failed to load.<br/>${error}.`;
			console.error(error);
		});
}

function playPause () {
	playbackPaused = !playbackPaused;

	if (playbackPaused) {
		playPauseButton.style.backgroundPosition = "0 0";
	} else {
		playPauseButton.style.backgroundPosition = `-${playPauseButton.offsetWidth}px 0`;
	}
}

function toggleHitEvents (showHint = true) {
	ui.showHitEvents = !ui.showHitEvents;

	let text;
	if (ui.showHitEvents) {
		ui.filterHitEventsButton.style.opacity = 1;
		text = getLocalizable("shown");
	} else {
		ui.filterHitEventsButton.style.opacity = 0.5;
		text = getLocalizable("hidden");
	}

	if (showHint) {
		ui.showHint(getLocalizable("event_fire") + text);
	}
}

function toggleConnectEvents (showHint = true) {
	ui.showConnectEvents = !ui.showConnectEvents;

	let text;
	if (ui.showConnectEvents) {
		ui.filterConnectEventsButton.style.opacity = 1;
		text = getLocalizable("shown");
	} else {
		ui.filterConnectEventsButton.style.opacity = 0.5;
		text = getLocalizable("hidden");
	}

	if (showHint) {
		ui.showHint(getLocalizable("event_dis-connected") + text);
	}
}

let lastDrawnFrame = -1;
function startPlaybackLoop () {
	var killlines = [];
	var firelines = [];

	function playbackFunction () {
		if (!playbackPaused || lastDrawnFrame !== playbackFrame) {
			requestedFrame = requestAnimationFrame(() => {
				// Remove killines & firelines from last frame
				killlines.forEach(function (line) {
					map.removeLayer(line);
				});
				firelines.forEach(function (line) {
					map.removeLayer(line);
				});

				countCiv = 0;
				countEast = 0;
				countGuer = 0;
				countWest = 0;

				for (const entity of entities.getAll()) {
					entity.updateRender(playbackFrame);
					entity.manageFrame(playbackFrame);

					if (entity instanceof Unit) {
						// Draw fire line (if enabled)
						var projectilePos = entity.firedOnFrame(playbackFrame);
						if (projectilePos != null && ui.firelinesEnabled) {
							// console.log(entity);
							// console.log(`Shooter pos: ${entity.getLatLng()}\nFired event: ${projectilePos} (is null: ${projectilePos == null})`);
							var line = L.polyline([entity.getLatLng(), armaToLatLng(projectilePos)], {
								color: entity.getSideColour(),
								weight: 2,
								opacity: 0.4
							});
							line.addTo(map);
							firelines.push(line);
						}
					}
				}

				ui.updateTitleSide();

				// Display events for this frame (if any)
				for (const event of gameEvents.getEvents()) {

					// Check if event is supposed to exist by this point
					if (event.frameNum <= playbackFrame) {
						ui.addEvent(event);

						// Draw kill line
						if (event.frameNum == playbackFrame) {
							if (event.type == "killed") {
								var victim = event.victim;
								var killer = event.causedBy;

								// Draw kill line
								if (killer.id) {
									//console.log(victim);
									//console.log(killer);
									var victimPos = victim.getLatLng();
									var killerPos = killer.getLatLng();

									if (victimPos != null && killerPos != null) {
										var line = L.polyline([victimPos, killerPos], {
											color: killer.getSideColour(),
											weight: 2,
											opacity: 0.4
										});
										line.addTo(map);
										killlines.push(line);
									}
								}
							}

							// Flash unit's icon
							if (event.type == "hit") {
								var victim = event.victim;
								victim.flashHit();
							}
						}

					} else {
						ui.removeEvent(event);
					}
				}
				for (const marker of markers) {
					marker.manageFrame(playbackFrame);
					if (ui.markersEnable) {
						marker.hideMarkerPopup(false);
					} else {
						marker.hideMarkerPopup(true);
					}
				}

				// Handle entityToFollow
				if (entityToFollow != null) {
					const relativeFrameIndex = entityToFollow.getRelativeFrameIndex(playbackFrame);
					const pos = entityToFollow.getPosAtFrame(relativeFrameIndex);
					if (pos) {
						map.setView(armaToLatLng(pos.position), map.getZoom());
					} else { // Unit has died or does not exist, unfollow
						entityToFollow.unfollow();
					}
				}
				if (!playbackPaused && playbackFrame !== endFrame) {
					playbackFrame++;
				}
				if (playbackFrame === endFrame) {
					playbackPaused = true;
					playPauseButton.style.backgroundPosition = "0 0";
				}
				ui.setMissionCurTime(playbackFrame);

				lastDrawnFrame = playbackFrame;
			});
		} else {
			requestAnimationFrame(() => {
				for (const entity of entities.getAll()) {
					entity.updateRender(playbackFrame);
				}
				for (const marker of markers) {
					marker.updateRender(playbackFrame);
				}
			});
		}

		// Run timeout again (creating a loop, but with variable intervals)
		playbackTimeout = setTimeout(playbackFunction, frameCaptureDelay / playbackMultiplier);
	}

	var playbackTimeout = setTimeout(playbackFunction, frameCaptureDelay / playbackMultiplier);
}

function colorElement (element, color) {
	if (!color) {
		return;
	}

	if (color === "EAST") {
		element.className = "opfor";
	} else if (color === "WEST") {
		element.className = "blufor";
	} else if (color === "IND") {
		element.className = "ind";
	} else if (color === "CIV") {
		element.className = "civ";
	} else if (color && color.startsWith('#')) {
		element.style.color = color;
	}
}

function getMarkerColor (color, defaultColor = "ffffff") {
	let hexColor = defaultColor;
	if (!color) {
		return hexColor;
	}

	if (color === "EAST") {
		hexColor = "ff0000";
	} else if (color === "WEST") {
		hexColor = "00a8ff";
	} else if (color === "IND") {
		hexColor = "00cc00";
	} else if (color === "CIV") {
		hexColor = "C900FF";
	} else if (color && color.startsWith('#')) {
		hexColor = color.substring(1);
	} else {
		console.warn("unknown color", color);
	}

	return hexColor;
}
function colorMarkerIcon (element, icon, color) {
	element.src = `/images/markers/${icon}/${getMarkerColor(color)}.png`;
}


function getPulseMarkerColor (color, defaultColor = "000000") {
	let hexColor = defaultColor;
	if (!color) {
		return hexColor;
	}

	if (color === "EAST") {
		hexColor = "ff0000";
	} else if (color === "WEST") {
		hexColor = "004c99";
	} else if (color === "IND") {
		hexColor = "00cc00";
	} else if (color === "CIV") {
		hexColor = "C900FF";
	} else if (color && color.startsWith('#')) {
		hexColor = color.substring(1);
	} else {
		console.warn("unknown color", color);
	}

	return hexColor;
}

String.prototype.encodeHTMLEntities = function () {
	return this.replace(/[\u00A0-\u9999<>\&]/gim, (i) => {
		return '&#' + i.charCodeAt(0) + ';';
	});
}

function closestEquivalentAngle (from, to) {
	const delta = ((((to - from) % 360) + 540) % 360) - 180;
	return from + delta;
}

