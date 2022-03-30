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
var topoLayer = null;
var satLayer = null;
var terrainLayer = null;
var terrainDarkLayer = null;
var contourLayer = null;
var baseLayerControl = null;
var overlayLayerControl = null;
var geoJsonHouses = null;
var entitiesLayerGroup = L.layerGroup([]);
var markersLayerGroup = L.layerGroup([]);
var systemMarkersLayerGroup = L.layerGroup([]);
var projectileMarkersLayerGroup = L.layerGroup([]);
var map = null;
var mapDiv = null;
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

// Mission details
var worldName = "";
var missionName = "";
var endFrame = 0;
var missionCurDate = new Date(0);

// Icons
var icons = null;
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

function initOCAP () {
	mapDiv = document.getElementById("map");
	defineIcons();
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
						let coords = [parseFloat(args.x), parseFloat(args.y)];
						let zoom = parseFloat(args.zoom);
						map.setView(coords, zoom);
					} else {
						map.setView([0, 0], mapMaxNativeZoom);
					}
					if (args.frame) {
						ui.setMissionCurTime(parseInt(args.frame));
					}
				}, false);
				return processOp("data/" + args.file);
			}
		})
		.catch((error) => {
			ui.showHint(error);
		});

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
		"maxZoomSatellite": 6,
		"maxZoomGameMap": 6,
		"maxZoomTerrain": 6,
		"maxZoomTerrainDark": 6,
		"hasTopo": true,
		"hasSatellite": false,
		"hasGameMap": false,
		"hasTerrain": false,
		"hasTerrainDark": false,
		"attribution": "Bohemia Interactive and 3rd Party Developers"
	};

	let mapJsonUrl;
	if (ui.useCloudTiles) {
		mapJsonUrl = `http://ocap2maps.site.nfoservers.com/maps/${worldName}/map.json`;
	} else {
		mapJsonUrl = 'images/maps/' + worldName + '/map.json';
	}
	return fetch(mapJsonUrl)
		.then((res) => res.json())
		.then((data) => {
			// console.log(data);
			map = data;
			return Object.assign(defaultMap, map);
		})
		.catch(() => {
			ui.showHint(`Error: Map "${worldName}" is not installed`);
		});
}

function initMap (world) {
	// Bad
	mapMaxNativeZoom = world.maxZoom
	mapMaxZoom = mapMaxNativeZoom + 3

	imageSize = world.imageSize;
	multiplier = world.multiplier;

	var factorx = multiplier;
	var factory = multiplier;
	// var factorx = 1;
	// var factory = 1;

	L.CRS.OCAP = L.extend({}, L.CRS.Simple, {
		projection: L.Projection.LonLat,
		transformation: new L.Transformation(factorx, 0, -factory, 0),
		// Changing the transformation is the key part, everything else is the same.
		// By specifying a factor, you specify what distance in meters one pixel occupies (as it still is CRS.Simple in all other regards).
		// In this case, I have a tile layer with 256px pieces, so Leaflet thinks it's only 256 meters wide.
		// I know the map is supposed to be 2048x2048 meters, so I specify a factor of 0.125 to multiply in both directions.
		// In the actual project, I compute all that from the gdal2tiles tilemapresources.xml, 
		// which gives the necessary information about tilesizes, total bounds and units-per-pixel at different levels.


		// Scale, zoom and distance are entirely unchanged from CRS.Simple
		scale: function (zoom) {
			return Math.pow(2, zoom);
		},

		zoom: function (scale) {
			return Math.log(scale) / Math.LN2;
		},

		distance: function (latlng1, latlng2) {
			var dx = latlng2.lng - latlng1.lng,
				dy = latlng2.lat - latlng1.lat;

			return Math.sqrt(dx * dx + dy * dy);
		},
		infinite: true
	});

	// Create map
	map = L.map('map', {
		maxNativeZoom: mapMaxNativeZoom,
		maxZoom: mapMaxZoom,
		minNativeZoom: 0,
		minZoom: 0,
		zoominfoControl: true,
		zoomControl: false,
		scrollWheelZoom: true,
		zoomAnimation: true,
		fadeAnimation: true,
		crs: L.CRS.OCAP,
		attributionControl: true,
		zoomSnap: 1,
		zoomDelta: 1,
		closePopupOnClick: false,
		preferCanvas: true
	});



	// Hide marker popups once below a certain zoom level
	map.on("zoom", function () {
		ui.hideMarkerPopups = map.getZoom() <= 4;
		// if (map.getZoom() <= 5 && geoJsonHouses != null) {
		// 	geoJsonHouses.setStyle(function (geoJsonFeature) {
		// 		return {
		// 			color: "#4D4D4D",
		// 			interactive: false,
		// 			fill: true,
		// 			opacity: 0,
		// 			fillOpacity: 0,
		// 			noClip: true,
		// 			// renderer: L.canvas()
		// 			// weight: geoJsonFeature.properties.width * window.multiplier,
		// 		};
		// 	});
		// } else if (geoJsonHouses != null) {
		// 	geoJsonHouses.setStyle(function (geoJsonFeature) {
		// 		return {
		// 			color: "#4D4D4D",
		// 			interactive: false,
		// 			fill: true,
		// 			opacity: 1,
		// 			fillOpacity: 1,
		// 			noClip: true,
		// 			// renderer: L.canvas()
		// 			// weight: geoJsonFeature.properties.width * window.multiplier,
		// 		};
		// 	});
		// }
	});

	let playbackPausedBeforeZoom;
	map.on("zoomstart", () => {
		cancelAnimationFrame(requestedFrame);
		document.getElementById("container").classList.add("zooming");
		playbackPausedBeforeZoom = playbackPaused;
		if (!playbackPaused) {
			playbackPaused = true;
		}
	});
	map.on("zoomend", () => {
		document.getElementById("container").classList.remove("zooming");
		playbackPaused = playbackPausedBeforeZoom;
	});
	map.on("popupopen", (e) => {
		e.popup.getElement().classList.add("animation");
	});
	map.on("popupclose", (e) => {
		e.popup.getElement().classList.remove("animation");
	});
	map.on("dragstart", function () {
		if (entityToFollow != null) {
			entityToFollow.unfollow();
		}
	});
	console.log("Got world: ", world);


	let args = getArguments();
	if (!args.x || !args.y || !args.zoom) {
		map.setView(map.unproject([imageSize / 2, imageSize / 2]), mapMinZoom);
	}


	var mapBounds = new L.LatLngBounds(
		map.unproject([0, imageSize], mapMaxNativeZoom),
		map.unproject([imageSize, 0], mapMaxNativeZoom)
	);
	map.fitBounds(mapBounds);



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

	overlayLayerControl = L.control.layers({}, {
		// overlay layers
		"Units and Vehicles": entitiesLayerGroup,
		"Selected Side Markers": markersLayerGroup,
		"Editor/Briefing Markers": systemMarkersLayerGroup,
		"Projectile Markers": projectileMarkersLayerGroup
	}, {
		position: 'topright',
		collapsed: false
	}).addTo(map);

	var baseLayers = [];

	entitiesLayerGroup.addTo(map);
	markersLayerGroup.addTo(map);
	systemMarkersLayerGroup.addTo(map);
	projectileMarkersLayerGroup.addTo(map);


	// worldName = world.worldName;


	let topoLayerUrl = "";
	let satLayerUrl = "";
	let gameMapLayerUrl = "";
	let terrainLayerUrl = "";
	let terrainDarkLayerUrl = "";
	let contourLayerUrl = "";

	// console.log(ui.useCloudTiles)

	switch (ui.useCloudTiles) {
		case true: {
			topoLayerUrl = ('http://ocap2maps.site.nfoservers.com/maps/' + worldName + '/{z}/{x}/{y}.png');
			satLayerUrl = ('http://ocap2maps.site.nfoservers.com/maps/' + worldName + '/sat/{z}/{x}/{y}.png');
			gameMapLayerUrl = ('http://ocap2maps.site.nfoservers.com/maps/' + worldName + '/game-map/{z}/{x}/{y}.png');
			terrainLayerUrl = ('http://ocap2maps.site.nfoservers.com/maps/' + worldName + '/terrain/{z}/{x}/{y}.png');
			terrainDarkLayerUrl = ('http://ocap2maps.site.nfoservers.com/maps/' + worldName + '/terrain-dark/{z}/{x}/{y}.png');
			contourLayerUrl = ('http://ocap2maps.site.nfoservers.com/maps/' + worldName + '/contours.geojson');
			break;
		}
		case false: {
			topoLayerUrl = ('images/maps/' + worldName + '/{z}/{x}/{y}.png');
			satLayerUrl = ('images/maps/' + worldName + '/sat/{z}/{x}/{y}.png');
			gameMapLayerUrl = ('images/maps/' + worldName + '/game-map/{z}/{x}/{y}.png');
			terrainLayerUrl = ('images/maps/' + worldName + '/terrain/{z}/{x}/{y}.png');
			terrainDarkLayerUrl = ('images/maps/' + worldName + '/terrain-dark/{z}/{x}/{y}.png');
			contourLayerUrl = ('images/maps/' + worldName + '/contours.geojson');
			break;
		}
	}

	if (world.hasTopo) {
		topoLayer = L.tileLayer(topoLayerUrl, {
			maxNativeZoom: world.maxZoom,
			// maxZoom: mapMaxZoom,
			minNativeZoom: world.minZoom,
			bounds: mapBounds,
			label: "Topographic",
			attribution: "Map Data &copy; " + world.attribution,
			noWrap: true,
			tms: false,
			keepBuffer: 4,
			// opacity: 0.7,
			errorTileUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fc/Missing_Mathematical_Tile.jpg/730px-Missing_Mathematical_Tile.jpg'
		});
		baseLayers.push(topoLayer);
	}

	if (world.hasGameMap) {
		gameMapLayer = L.tileLayer(gameMapLayerUrl, {
			maxNativeZoom: world.maxZoomGameMap,
			// maxZoom: mapMaxZoom,
			minNativeZoom: world.minZoom,
			bounds: mapBounds,
			label: "Game Map",
			attribution: "Map Data &copy; " + world.attribution + " | Data gathered using <a href='https://github.com/gruppe-adler/grad_mtg'>GRAD_MTG<a/>",
			noWrap: true,
			tms: false,
			keepBuffer: 4,
			// opacity: 0.9,
			errorTileUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fc/Missing_Mathematical_Tile.jpg/730px-Missing_Mathematical_Tile.jpg'
		});
		baseLayers.push(gameMapLayer);
	}

	if (world.hasSatellite) {
		satLayer = L.tileLayer(satLayerUrl, {
			maxNativeZoom: world.maxZoomSatellite,
			// maxZoom: mapMaxZoom,
			minNativeZoom: world.minZoom,
			bounds: mapBounds,
			label: "Satellite",
			attribution: "Map Data &copy; " + world.attribution + " | Data gathered using <a href='https://github.com/gruppe-adler/grad_meh'>GRAD_MEH<a/>",
			noWrap: true,
			tms: false,
			keepBuffer: 4,
			// opacity: 0.8,
			errorTileUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fc/Missing_Mathematical_Tile.jpg/730px-Missing_Mathematical_Tile.jpg'
		});
		baseLayers.push(satLayer);
	}

	if (world.hasTerrain) {
		terrainLayer = L.tileLayer(terrainLayerUrl, {
			maxNativeZoom: world.maxZoomTerrain,
			// maxZoom: mapMaxZoom,
			minNativeZoom: world.minZoom,
			bounds: mapBounds,
			attribution: "Map Data &copy; " + world.attribution + " | Data gathered using <a href='https://github.com/gruppe-adler/grad_meh'>GRAD_MEH<a/>",
			label: "Terrain",
			noWrap: true,
			tms: false,
			keepBuffer: 4,
			// opacity: 1,
			errorTileUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fc/Missing_Mathematical_Tile.jpg/730px-Missing_Mathematical_Tile.jpg'
		});
		baseLayers.push(terrainLayer);
	}


	if (world.hasTerrainDark) {
		terrainDarkLayer = L.tileLayer(terrainDarkLayerUrl, {
			maxNativeZoom: world.maxZoomTerrainDark,
			// maxZoom: mapMaxZoom,
			minNativeZoom: world.minZoom,
			bounds: mapBounds,
			label: "Terrain (Dark)",
			attribution: "Map Data &copy; " + world.attribution,
			noWrap: true,
			tms: false,
			keepBuffer: 4,
			// opacity: 0.8,
			errorTileUrl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/f/fc/Missing_Mathematical_Tile.jpg/730px-Missing_Mathematical_Tile.jpg'
		});
		baseLayers.push(terrainDarkLayer);
	}



	baseLayerControl = map.addControl(L.control.basemaps({
		basemaps: baseLayers,
		tileX: 2,  // tile X coordinate
		tileY: 6,  // tile Y coordinate
		tileZ: 4   // tile zoom level
	}));


	map.createPane("buildings");
	map.createPane("roads");
	map.createPane("forest");
	map.createPane("rock");


	function getGeoJson (path) {
		return fetch(path)
			.then((res) => res.json())
			.then((data) => {
				return data;
			});
	}
	function RGBToHex (rgbArr) {
		r = rgbArr[0].toString(16);
		g = rgbArr[1].toString(16);
		b = rgbArr[2].toString(16);

		if (r.length == 1)
			r = "0" + r;
		if (g.length == 1)
			g = "0" + g;
		if (b.length == 1)
			b = "0" + b;

		return "#" + r + g + b;
	}
	var myRenderer = L.canvas({ padding: 0.5 });




	function test () {
		// Add marker to map on click
		map.on("click", function (e) {
			// latLng, layerPoint, containerPoint, originalEvent
			console.debug("latLng");
			console.debug(e.latlng);
			console.debug("LayerPoint");
			console.debug(e.layerPoint);
			console.debug("Projected");
			console.debug(map.project(e.latlng, mapMaxNativeZoom));
		})
	}



	// tree
	// getGeoJson(`images/maps/${worldName}/geojson/tree.geojson`)
	// 	.then(geoJson => {
	// 		console.log(geoJson.features[0].geometry.coordinates);

	// var t = {
	// 	"type": "FeatureCollection",
	// 	"features": []
	// }
	// t.features = geoJson.features.map(feature => {
	// 	// feature.geometry.coordinates.pop()
	// 	var coords = feature.geometry.coordinates;
	// 	// coords = geoJsonToLatLng(coords);
	// 	// coords = armaToLatLng(coords);
	// 	// coords = [coords.lng, -1 * coords.lat];

	// 	var origin = map.getPixelOrigin();
	// 	coords[0] = (coords[0] + origin.x) * 0.015;
	// 	coords[1] = (coords[1] + origin.y) * 0.015;

	// 	// console.debug(coords);




	// 	// L.circleMarker(coords, {
	// 	// 	radius: 1,
	// 	// 	color: "#00FF00"
	// 	// }).addTo(map);
	// 	feature.geometry.coordinates = coords;
	// 	// console.debug(feature.geometry.coordinates);
	// 	return feature;
	// })
	// // var r = t.map(feature => {
	// // 	feature.geometry.coordinates = armaToLatLng(feature.geometry.coordinates)
	// // 	return feature;
	// // })
	// console.log(t.features[0].geometry.coordinates);
	// return t

	// 	return geoJson
	// })
	// .then(geoJson => {
	// console.log(geoJson);
	// L.geoJSON(geoJson, {
	// 	pointToLayer: function (geoJsonPoint, latlng) {
	// 		// return L.corridor(latlng, {
	// 		// 	radius: 5 * 0.015 * window.multiplier,
	// 		// 	color: "#009900",
	// 		// 	opacity: 0.8,
	// 		// 	fill: false,
	// 		// 	interactive: false
	// 		// })
	// 		// return L.marker(latlng, {
	// 		// 	icon: L.icon({
	// 		// 		iconUrl: `images/maps/${worldName}/tree.png`,
	// 		// 		iconSize: [5, 5]
	// 		// 	}),
	// 		// 	opacity: 1,
	// 		// 	interactive: false
	// 		// })
	// 		return L.circleMarker(latlng, {
	// 			radius: 5 * 0.015 * window.multiplier,
	// 			color: "#009900",
	// 			opacity: 0.4,
	// 			fill: false,
	// 			interactive: false
	// 		});
	// 	},
	// 	coordsToLatLng: function (coords) {
	// 		return armaToLatLng(coords);
	// 	},
	// 	pane: map.getPane("forest")
	// }).addTo(map)

	// L.vectorGrid.slicer(geoJson, {
	// 	rendererFactory: L.canvas.tile,
	// 	maxNativeZoom: mapMaxNativeZoom,
	// 	// maxZoom: mapMaxZoom,
	// 	// minNativeZoom: 6,
	// 	minZoom: 0,
	// 	// minZoom: 6,
	// 	// bounds: mapBounds,
	// 	attribution: "11Map Data &copy; " + world.attribution,
	// 	noWrap: true,
	// 	tms: false,
	// 	keepBuffer: 4,
	// 	updateWhenIdle: true,
	// 	updateWhenZooming: false,
	// 	// coordsToLatLng: function (coords) {
	// 	// 	return armaToLatLng(coords);
	// 	// },
	// 	vectorTileLayerStyles: {
	// 		// 	function (properties, zoom, geometryDimension)
	// 		sliced: function (properties, zoom, geometryDimension) {
	// 			// 	// return L.circle(properties.geometry.coordinates), {
	// 			return {
	// 				radius: 5 * 0.015 * window.multiplier,
	// 				// radius: 5 * window.multiplier,
	// 				color: "#009900",
	// 				opacity: 0.4,
	// 				fill: false,
	// 				interactive: false
	// 			}
	// 		}
	// 	}
	// }).addTo(map);

	// console.log("Loaded trees");

	// })

	// forest
	// getGeoJson(`images/maps/${worldName}/geojson/forest.geojson`)
	// 	.then(geoJson => {
	// 		// console.log(geoJson[0]);
	// 		var t = geoJson.map(feature => {
	// 			feature.geometry.coordinates[0].pop()
	// 			return feature;
	// 		})
	// 		// console.log(t[0]);
	// 		return t
	// 	})
	// 	.then(geoJson => {
	// 		console.log("Loaded forest");
	// 		console.log(geoJson);
	// 		return L.geoJSON(geoJson, {
	// 			style: function (geoJsonFeature) {
	// 				return {
	// 					color: "#00FF00",
	// 					interactive: false,
	// 					fill: true,
	// 					opacity: 0.5,
	// 					fillOpacity: 0.2,
	// 					noClip: true,
	// 					// renderer: L.canvas()
	// 					// weight: geoJsonFeature.properties.width * window.multiplier,
	// 				};
	// 			},
	// 			// onEachFeature: function (feature, layer) {
	// 			// 	return houseLayer.addLayer(layer);
	// 			// },
	// 			coordsToLatLng: function (coords) {
	// 				return armaToLatLng(coords);
	// 			},
	// 			pane: map.getPane("forest")
	// 		}).addTo(map)
	// 	})
	// 	.then(result => {
	// 		console.log(result);
	// 	})



	// road
	// getGeoJson(`images/maps/${worldName}/geojson/road.geojson`)
	// 	.then(geoJson => {
	// 		// console.log(geoJson);
	// 		L.geoJSON(geoJson, {
	// 			style: function (geoJsonFeature) {
	// 				return {
	// 					color: "#FFD966",
	// 					interactive: false,
	// 					weight: geoJsonFeature.properties.width * window.multiplier,
	// 					noClip: true,
	// 					// renderer: L.canvas()
	// 				}
	// 			},
	// 			coordsToLatLng: function (coords) {
	// 				return armaToLatLng(coords);
	// 			},
	// 			pane: map.getPane("roads")
	// 		}).addTo(map)
	// 	})

	// road bridge
	// getGeoJson(`images/maps/${worldName}/geojson/road-bridge.geojson`)
	// 	.then(geoJson => {
	// 		// console.log(geoJson);
	// 		L.geoJSON(geoJson, {
	// 			style: function (geoJsonFeature) {
	// 				return {
	// 					color: "#AA0000",
	// 					interactive: false,
	// 					weight: geoJsonFeature.properties.width * window.multiplier,
	// 					noClip: true,
	// 					// renderer: L.canvas()
	// 				}
	// 			},
	// 			onEachFeature: function (feature, layer) {

	// 			},
	// 			coordsToLatLng: function (coords) {
	// 				return armaToLatLng(coords);
	// 			},
	// 			pane: map.getPane("roads")
	// 		}).addTo(map)
	// 	})

	// main road
	// getGeoJson(`images/maps/${worldName}/geojson/main_road.geojson`)
	// 	.then(geoJson => {
	// 		// console.log(geoJson);
	// 		L.geoJSON(geoJson, {
	// 			style: function (geoJsonFeature) {
	// 				return {
	// 					color: "#FFFFFF",
	// 					interactive: false,
	// 					weight: geoJsonFeature.properties.width * window.multiplier,
	// 					noClip: true,
	// 					// renderer: L.canvas()
	// 				}
	// 			},
	// 			onEachFeature: function (feature, layer) {

	// 			},
	// 			coordsToLatLng: function (coords) {
	// 				return armaToLatLng(coords);
	// 			},
	// 			pane: map.getPane("roads")
	// 		}).addTo(map)
	// 	})

	// main road bridge
	// getGeoJson(`images/maps/${worldName}/geojson/main_road-bridge.geojson`)
	// 	.then(geoJson => {
	// 		// console.log(geoJson);
	// 		L.geoJSON(geoJson, {
	// 			style: function (geoJsonFeature) {
	// 				return {
	// 					color: "#AA0000",
	// 					interactive: false,
	// 					weight: geoJsonFeature.properties.width * window.multiplier,
	// 					noClip: true,
	// 					// renderer: L.canvas()
	// 				}
	// 			},
	// 			onEachFeature: function (feature, layer) {

	// 			},
	// 			coordsToLatLng: function (coords) {
	// 				return armaToLatLng(coords);
	// 			},
	// 			pane: map.getPane("roads")
	// 		}).addTo(map)
	// 	})


	// track
	// getGeoJson(`images/maps/${worldName}/geojson/track.geojson`)
	// 	.then(geoJson => {
	// 		// console.log(geoJson);
	// 		L.geoJSON(geoJson, {
	// 			style: function (geoJsonFeature) {
	// 				return {
	// 					color: "#FF8099",
	// 					interactive: false,
	// 					weight: geoJsonFeature.properties.width * window.multiplier,
	// 					noClip: true,
	// 					opacity: 1,
	// 					// renderer: L.canvas()
	// 				}
	// 			},
	// 			coordsToLatLng: function (coords) {
	// 				return armaToLatLng(coords);
	// 			},
	// 			pane: map.getPane("roads")
	// 		}).addTo(map)
	// 	})

	// houses
	// getGeoJson(`images/maps/${worldName}/geojson/house.geojson`)
	// 	// .then(geoJson => {
	// 	// console.log(geoJson[0]);
	// 	// var t = geoJson.features.map(feature => {
	// 	// 	feature.geometry.coordinates[0].pop()
	// 	// 	return feature;
	// 	// })
	// 	// console.log(t[0]);
	// 	// return t

	// 	// })
	// 	.then(geoJson => {
	// 		console.log("Loaded houses");
	// 		// console.log(geoJson);
	// 		geoJsonHouses = L.geoJSON(geoJson, {
	// 			style: function (geoJsonFeature) {
	// 				return {
	// 					// color: RGBToHex(geoJsonFeature.properties.color),
	// 					color: "#4D4D4D",
	// 					interactive: false,
	// 					fill: true,
	// 					opacity: 0,
	// 					fillOpacity: 0,
	// 					noClip: true,
	// 					// renderer: L.canvas()
	// 					// weight: geoJsonFeature.properties.width * window.multiplier,
	// 				};
	// 			},
	// 			// onEachFeature: function (feature, layer) {
	// 			// 	return houseLayer.addLayer(layer);
	// 			// },
	// 			coordsToLatLng: function (coords) {
	// 				return armaToLatLng(coords);
	// 			},
	// 			pane: map.getPane("buildings")
	// 		}).addTo(map);
	// 		// L.glify.shapes({
	// 		// 	map,
	// 		// 	data: geoJson,
	// 		// 	color: "#009900"
	// 		// });
	// 	})
	// .then(result => {
	// 	console.log(result);
	// })

	// nameCity
	// getGeoJson(`images/maps/${worldName}/geojson/nameCity.geojson`)
	// 	.then(geoJson => {
	// 		// console.log(geoJson);
	// 		L.geoJSON(geoJson, {
	// 			coordsToLatLng: function (coords) {
	// 				return armaToLatLng(coords);
	// 			},
	// 			pointToLayer: function (geoJsonPoint, latlng) {
	// 				return L.marker(latlng, {
	// 					opacity: 0,
	// 					interactive: false,
	// 					renderer: L.canvas()
	// 				}).bindTooltip(geoJsonPoint.properties.name, {
	// 					permanent: true,
	// 					opacity: 0.8,
	// 					direction: "top"
	// 				}).openTooltip();
	// 			}
	// 		}).addTo(map);
	// 	})

	// nameVillage
	// getGeoJson(`images/maps/${worldName}/geojson/nameVillage.geojson`)
	// 	.then(geoJson => {
	// 		// console.log(geoJson);
	// 		L.geoJSON(geoJson, {
	// 			coordsToLatLng: function (coords) {
	// 				return armaToLatLng(coords);
	// 			},
	// 			pointToLayer: function (geoJsonPoint, latlng) {
	// 				return L.marker(latlng, {
	// 					opacity: 0,
	// 					interactive: false,
	// 					renderer: L.canvas()
	// 				}).bindTooltip(geoJsonPoint.properties.name, {
	// 					permanent: true,
	// 					opacity: 0.4,
	// 					direction: "top"
	// 				}).openTooltip();
	// 			}
	// 		})
	// 			.bindPopup(function (layer) {
	// 				return layer.feature.properties.name;
	// 			}).addTo(map);
	// 	})



	// gdal_contour -a ELEV -i 20 dem.asc contours.geojson
	contourLayer = fetch(contourLayerUrl)
		.then((res) => {
			if (res.status == 200) {
				return res.json();
			} else {
				throw "Contour layer geoJson for " + worldName + " not found."
			}
		})
		.then(geoJson => {
			console.log("Loaded contour lines");
			console.debug(geoJson);

			let contourPane = map.createPane("contourPane");

			var layer = L.geoJSON(geoJson, {
				filter: function (geoJsonFeature) {
					if (geoJsonFeature.properties.ELEV > 0) {
						return true;
					} else {
						return false;
					}
				},
				style: function (geoJsonFeature) {
					var props = geoJsonFeature.properties;
					var color;
					if (props.index == 1) { color = "#FF7777" } else { color = "#444444" };
					return {
						color: color,
						interactive: false,
						fill: false,
						opacity: 0.5,
						// fillOpacity: 0.2,
						noClip: true,
						// renderer: L.canvas()
						// weight: geoJsonFeature.properties.width * window.multiplier,
					};
				},
				coordsToLatLng: function (coords) {
					return armaToLatLng(coords);
				},
				pane: contourPane
			});
			overlayLayerControl.addOverlay(
				layer,
				"20m Contours"
			);

			return layer;
		})
		.catch(err => console.warn("Contour layer geoJson for " + worldName + " not found."))









	map.on("baselayerchange", (event) => {
		// console.log(event.name); // Print out the new active layer
		// console.log(event);
		// multiplier = event.name
	});
	map.on("overlayadd", (event) => {
		// console.log(event.name); // Print out the new active layer
		// console.log(event);
		switch (event.name) {
			case "Units and Vehicles": {
				if (ui.hideMarkerPopups == false) {
					entitiesLayerGroup.eachLayer(layer => {
						layer.openPopup();
					});
				}
				break;
			};
			case "Selected Side Markers": {
				markersLayerGroup.eachLayer(layer => {
					layer.remove()
				})
				markers.forEach(marker => {
					if (marker._player instanceof Unit) {
						marker._marker = null;
					}
				})
				// for (const marker of markers) {
				// 	marker.manageFrame(playbackFrame);
				// }
				break;
			};
			case "Editor/Briefing Markers": {
				if (ui.markersEnable == true) {
					systemMarkersLayerGroup.eachLayer(layer => {
						layer.openPopup();
					})
				}
				break;
			};
			case "Projectile Markers": {
				projectileMarkersLayerGroup.getLayers().forEach(layer => {
					layer.remove()
				})
				markers.forEach(marker => {
					if (marker.isMagIcon()) {
						marker._marker = null;
					}
				})
				break;
			};

			default: {
				break;
			};
		};
	});
	map.on("overlayremove", (event) => {
		// console.log(event.name); // Print out the new active layer
		// console.log(event);
		switch (event.name) {
			case "Units and Vehicles": {
				// ui.hideMarkerPopups = false;
				// entitiesLayerGroup.eachLayer(layer => {
				// 	layer.openPopup();
				// });
				break;
			};
			case "Selected Side Markers": {
				markersLayerGroup.eachLayer(layer => {
					// layer.remove()
				})
				break;
			};
			case "Editor/Briefing Markers": {
				// systemMarkersLayerGroup.eachLayer(layer => {
				// 	layer.openPopup();
				// })
				break;
			};
			case "Projectile Markers": {
				projectileMarkersLayerGroup.getLayers().forEach(layer => {
					layer.remove()
				})

				break;
			};

			default: {
				break;
			};
		};
	});



	// Add keypress event listener
	mapDiv.addEventListener("keypress", function (event) {
		//console.log(event);

		switch (event.charCode) {
			case 32: // Spacebar
				playPause();
				break;
		}
	});

	createInitialMarkers();
	let boundaryMarks = markers.filter(item => {
		return item._type === "moduleCoverMap"
	});
	if (boundaryMarks.length === 4) {
		let boundaryPoints = boundaryMarks.map(item => armaToLatLng(item._positions[0][1]));
		let boundaryPolygon = L.polygon(boundaryPoints, { color: "#000000", fill: false, interactive: false, noClip: true }).addTo(map);
		map.flyToBounds(boundaryPolygon.getBounds());
	} else {
		map.flyToBounds(map.getBounds());
	}

	document.dispatchEvent(new Event("mapInited"));
	// test();
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

function defineIcons () {
	icons = {
		man: {},
		ship: {},
		parachute: {},
		heli: {},
		plane: {},
		truck: {},
		car: {},
		apc: {},
		tank: {},
		staticMortar: {},
		staticWeapon: {},
		unknown: {}
	};

	let imgPathMan = "images/markers/man/";
	// let imgPathManMG = "images/markers/man/MG/";
	// let imgPathManGL = "images/markers/man/GL/";
	// let imgPathManAT = "images/markers/man/AT/";
	// let imgPathManSniper = "images/markers/man/Sniper/";
	// let imgPathManAA = "images/markers/man/AA/";
	let imgPathShip = "images/markers/ship/";
	let imgPathParachute = "images/markers/parachute/";
	let imgPathHeli = "images/markers/heli/";
	let imgPathPlane = "images/markers/plane/";
	let imgPathTruck = "images/markers/truck/";
	let imgPathCar = "images/markers/car/";
	let imgPathApc = "images/markers/apc/";
	let imgPathTank = "images/markers/tank/";
	let imgPathStaticMortar = "images/markers/static-mortar/";
	let imgPathStaticWeapon = "images/markers/static-weapon/";
	let imgPathUnknown = "images/markers/unknown/";


	let imgs = ["blufor", "opfor", "ind", "civ", "logic", "unknown", "dead", "hit", "follow", "unconscious"];
	imgs.forEach((img, i) => {
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
// http://127.0.0.1:5000/?file=2021_08_20__21_24_FNF_TheMountain_Youre_A_Towel_V2_Destroy_EU.json&frame=87&zoom=1&x=-134.6690319189602&y=78.0822715759277
// Converts Arma coordinates [x,y] to LatLng
function armaToLatLng (coords) {
	var pixelCoords;
	pixelCoords = [(coords[0] * multiplier) + trim, (imageSize - (coords[1] * multiplier)) + trim];
	return map.unproject(pixelCoords, mapMaxNativeZoom);
}

function geoJsonToLatLng (coords) {
	// var latLng = coords;
	// latLng = [(coords[0] * multiplier) + trim, (imageSize - (coords[1] * multiplier)) + trim];

	// pixelCoords = map.project(L.latLng(latLng[0], latLng[1]), mapMaxNativeZoom);
	// pixelCoords = [(pixelCoords.x * multiplier) + trim, (imageSize - (pixelCoords.y * multiplier)) + trim];
	// return map.unproject(pixelCoords, mapMaxNativeZoom);


	// coords = map.layerPointToContainerPoint([coords[0], coords[1]]);
	// coords = [coords.x * 0.007, coords.y * 0.004];

	coords = [(coords[0] * multiplier) + trim, -1 * (imageSize - (coords[1] * multiplier)) + trim];
	coords = map.unproject(coords, mapMaxNativeZoom);
	coords = [coords.lng, coords.lat];

	// coords = map.layerPointToLatLng(coords);

	// coords = map.project(L.latLng(coords[1], coords[0]), mapMaxNativeZoom);
	// coords = [coords.x * 0.007 * multiplier, -1 * coords.y * 0.004 * multiplier];

	// coords = map.unproject([coords[0], -1 * coords[1]]);
	// coords = [coords.lng / window.multiplier, -1 * coords.lat / window.multiplier];
	// coords = [coords.lng * 0.015, coords.lat * 0.015];

	// coords = armaToLatLng([coords[0], -1 * coords[1]]);
	// coords = [coords.lng - 100, -1 * coords.lat];
	// coords = [(coords[0] * multiplier) + trim, (imageSize - (coords[1] * multiplier)) + trim];
	return coords
}

// Returns date object as little endian (day, month, year) string
function dateToLittleEndianString (date) {
	return (date.getDate() + "/" + (date.getMonth() + 1) + "/" + date.getFullYear());
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
			// worldName = data.worldName;
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

			if (data.Markers != null) {
				data.Markers.forEach(function (markerJSON) {
					try {
						var type = markerJSON[0];
						var text = markerJSON[1];
						var startFrame = markerJSON[2];
						var endFrame = markerJSON[3];
						var player;
						if (markerJSON[4] == -1) {
							player = -1;
						} else {
							player = entities.getById(markerJSON[4]);
						}
						var color = markerJSON[5];
						var side = arrSide[markerJSON[6] + 1];
						var positions = markerJSON[7];

						// backwards compatibility for marker expansion
						let size = "";
						let shape = "ICON";
						let brush = "Solid";
						if (markerJSON.length > 8) {
							if (markerJSON[9] == "ICON") {
								size = markerJSON[8]
							} else {
								size = markerJSON[8];//.map(value => value * multiplier);
							}
							shape = markerJSON[9];
						}
						if (markerJSON.length > 10) {
							brush = markerJSON[10];
						}

						if (!(type.includes("zoneTrigger") || type.includes("Empty"))) {
							var marker = new Marker(type, text, player, color, startFrame, endFrame, side, positions, size, shape, brush);
							markers.push(marker);
						}
					} catch (err) {
						console.error(`Failed to process ${markerJSON[9]} with text "${markerJSON[1]}"\nError: ${err}`);
					}
				});
			}
			// Show title side
			var countShowSide = 0;
			if (showCiv) countShowSide++;
			if (showEast) countShowSide++;
			if (showGuer) countShowSide++;
			if (showWest) countShowSide++;
			function showTitleSide (elem, isShow) {
				elem = document.getElementById(elem);
				if (isShow) {
					elem.style.width = "calc(" + 100 / countShowSide + "% - 2.5px)";
					elem.style.display = "inline-block";
				} else {
					elem.style.display = "none";
				}
			}

			showTitleSide("sideEast", showEast);
			showTitleSide("sideWest", showWest);
			showTitleSide("sideGuer", showGuer);
			showTitleSide("sideCiv", showCiv);

			if (showWest) {
				ui.switchSide("WEST");
			} else if (showEast) {
				ui.switchSide("EAST");
			} else if (showGuer) {
				ui.switchSide("IND");
			} else if (showCiv) {
				ui.switchSide("CIV");
			}

			// Loop through events
			data.events.forEach(function (eventJSON) {
				var frameNum = eventJSON[0];
				var type = eventJSON[1];

				var gameEvent = null;
				switch (true) {
					case (type == "killed" || type == "hit"):
						const causedByInfo = eventJSON[3];
						const victim = entities.getById(eventJSON[2]);
						const causedBy = entities.getById(causedByInfo[0]); // In older captures, this will return null
						const distance = eventJSON[4];

						//console.log(eventJSON[2]);
						//if (victim == null) {return}; // Temp fix until vehicles are handled (victim is null if reference is a vehicle)

						// Create event object
						let weapon;
						if (causedBy instanceof Unit) {
							weapon = causedByInfo[1];
						} else {
							weapon = "N/A";
						}

						// TODO: Find out why victim/causedBy can sometimes be null
						if (causedBy == null || victim == null) {
							console.warn("unknown victim/causedBy", victim, causedBy);
						}

						// Incrememt kill/death count for killer/victim
						if (type === "killed" && (causedBy != null)) {
							if (causedBy !== victim && causedBy._side === victim._side) {
								causedBy.teamKillCount++;
							}
							if (causedBy !== victim) {
								causedBy.killCount++;
							}
							victim.deathCount++;
						}
						gameEvent = new HitKilledEvent(frameNum, type, causedBy, victim, distance, weapon);

						// Add tick to timeline
						ui.addTickToTimeline(frameNum);
						break;
					case (type == "connected" || type == "disconnected"):
						gameEvent = new ConnectEvent(frameNum, type, eventJSON[2]);
						break;
					case (type === "capturedFlag"): // deprecated
						gameEvent = new CapturedEvent(frameNum, type, "flag", eventJSON[2][0], eventJSON[2][1], eventJSON[2][2], eventJSON[2][3]);
						break;
					case (type === "captured"):
						gameEvent = new CapturedEvent(
							frameNum,
							type,
							eventJSON[2][0], // capture type
							eventJSON[2][1], // unit name
							eventJSON[2][2], // unit color
							eventJSON[2][3], // objective color
							eventJSON[2][4], // objective position
						);
						break;
					case (type === "terminalHackStarted"):
						gameEvent = new TerminalHackStartEvent(
							frameNum,
							type,
							eventJSON[2][0], // unit name
							eventJSON[2][1], // unit color
							eventJSON[2][2], // terminal color
							eventJSON[2][3], // terminal identifier
							eventJSON[2][4], // terminal position
							eventJSON[2][5], // countdown timer
						);
						break;
					case (type === "terminalHackCanceled"):
						gameEvent = new TerminalHackUpdateEvent(
							frameNum,
							type,
							eventJSON[2][0], // unit name
							eventJSON[2][1], // unit color
							eventJSON[2][2], // terminal color
							eventJSON[2][3], // terminal identifier
							eventJSON[2][4], // terminal state
						);
						break;
					case (type == "endMission"):
						gameEvent = new endMissionEvent(frameNum, type, eventJSON[2][0], eventJSON[2][1]);
						break;
					case (type == "generalEvent"):
						gameEvent = new generalEvent(frameNum, type, eventJSON[2]);
						break;
				}
				// Add event to gameEvents list
				if (gameEvent != null) {
					gameEvents.addEvent(gameEvent);
				}
			});

			gameEvents.init();

			console.log("Finished processing operation (" + (new Date() - time) + "ms).");
			initMap(world);
			startPlaybackLoop();
			toggleHitEvents(false);
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
							const entityPos = entity.getLatLng();
							if (entityPos) {
								// console.log(`Shooter pos: ${entity.getLatLng()}\nFired event: ${projectilePos} (is null: ${projectilePos == null})`);
								const line = L.polyline([entity.getLatLng(), armaToLatLng(projectilePos)], {
									color: entity.getSideColour(),
									weight: 2,
									opacity: 0.4
								});
								line.addTo(map);
								firelines.push(line);
							} else {
								console.warn("entity position missing for fire line", entity, projectilePos);
							}
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
					if (!marker.isMagIcon()) {
						if (ui.markersEnable) {
							marker.hideMarkerPopup(false);
						} else {
							marker.hideMarkerPopup(true);
						}
					}
					if (marker.isMagIcon()) {
						if (ui.nicknameEnable) {
							marker.hideMarkerPopup(false);
						} else {
							marker.hideMarkerPopup(true);
						}
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
