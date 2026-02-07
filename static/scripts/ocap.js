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
var entitiesLayerGroup = L.layerGroup([]);
var markersLayerGroup = L.layerGroup([]);
var systemMarkersLayerGroup = L.layerGroup([]);
var projectileMarkersLayerGroup = L.layerGroup([]);
var gridLayer = null;
var map = null;
var mapDiv = null;
var METERS_PER_DEGREE = 111320; // Meters per degree of longitude at the equator
var useMapLibreMode = false; // true when map has MapLibre style data
var mapLibreLayer = null;    // reference to MapLibre basemap layer
var mapBounds = null;
var worldObject = null;
var mapAvailable = false;
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

// Counter/score state for respawn tickets and custom counters
var counterState = {
	active: false,           // Whether to show counter UI
	type: null,              // 'respawnTickets' or 'custom'
	sides: [],               // Array of side names being tracked (e.g., ['WEST', 'EAST'])
	events: []               // Sorted list of {frameNum, values} for scrubbing
};

// Side name mapping for respawnTickets (indices: missionNS=0, east=1, west=2, ind=3)
var respawnTicketsSideMap = {
	1: 'EAST',
	2: 'WEST',
	3: 'GUER'
};

// Display labels for sides
var sideDisplayLabels = {
	'WEST': 'BLUFOR',
	'EAST': 'OPFOR',
	'GUER': 'IND',
	'CIV': 'CIV'
};

// CSS classes for side colors
var sideColorClasses = {
	'WEST': 'blufor',
	'EAST': 'opfor',
	'GUER': 'ind',
	'CIV': 'civ'
};

/**
 * Get counter values at a specific frame (for scrubbing support)
 * @param {number} f - Frame number
 * @returns {Object|null} - Values object {WEST: 5, EAST: 3} or null
 */
function getCounterValuesAtFrame(f) {
	let result = null;
	for (const evt of counterState.events) {
		if (evt.frameNum <= f) {
			result = evt.values;
		} else {
			break;
		}
	}
	return result;
}

/**
 * Update the counter display UI for the given frame
 * @param {number} f - Frame number
 */
function updateCounterDisplay(f) {
	const display = document.getElementById('counterDisplay');
	if (!display) return;

	if (!counterState.active || counterState.sides.length === 0) {
		display.style.display = 'none';
		return;
	}

	const values = getCounterValuesAtFrame(f);
	if (!values) {
		display.style.display = 'none';
		return;
	}

	// Build display content: "BLUFOR 5 : 3 OPFOR"
	let html = '';
	counterState.sides.forEach((side, index) => {
		if (index > 0) {
			html += '<span class="separator">:</span>';
		}
		const label = sideDisplayLabels[side] || side;
		const colorClass = sideColorClasses[side] || '';
		const value = values[side] !== undefined ? values[side] : '?';
		html += `<span class="side-score ${colorClass}">${label} ${value}</span>`;
	});

	display.innerHTML = html;
	display.style.display = 'inline-block';
}

/**
 * Reset counter state (call when loading new operation)
 */
function resetCounterState() {
	counterState.active = false;
	counterState.type = null;
	counterState.sides = [];
	counterState.events = [];
	const display = document.getElementById('counterDisplay');
	if (display) {
		display.style.display = 'none';
		display.innerHTML = '';
	}
}

/**
 * Process a counter event and update state
 * @param {number} frameNum - Frame number
 * @param {string} type - Event type (respawnTickets, counterInit, counterSet)
 * @param {Array} data - Event data
 */
function processCounterEvent(frameNum, type, data) {
	if (type === 'counterInit') {
		// Custom counter initialization - data is array of sides
		// Only use custom counter if not already using one
		if (counterState.type !== 'custom') {
			counterState.active = true;
			counterState.type = 'custom';
			counterState.sides = data.map(side => {
				// Normalize side names (handle both "west" and "WEST")
				if (typeof side === 'string') {
					return side.toUpperCase();
				}
				return side;
			});
			counterState.events = [];
		}
	} else if (type === 'counterSet') {
		// Custom counter update - data is array of values matching sides order
		if (counterState.type === 'custom' && counterState.sides.length > 0) {
			const values = {};
			counterState.sides.forEach((side, index) => {
				values[side] = data[index] !== undefined ? data[index] : 0;
			});
			counterState.events.push({ frameNum, values });
		}
	} else if (type === 'respawnTickets') {
		// BIS respawn tickets - data is [missionNS, east, west, ind]
		// Only use if no custom counter is active
		if (counterState.type !== 'custom') {
			// Check if any tickets are actually used (not all -1)
			const hasValidTickets = data.some((val, idx) => idx > 0 && val >= 0);
			if (hasValidTickets) {
				if (!counterState.active) {
					counterState.active = true;
					counterState.type = 'respawnTickets';
					// Determine which sides have valid tickets
					counterState.sides = [];
					[1, 2, 3].forEach(idx => {
						if (data[idx] >= 0 && respawnTicketsSideMap[idx]) {
							counterState.sides.push(respawnTicketsSideMap[idx]);
						}
					});
				}
				// Add event with values
				const values = {};
				counterState.sides.forEach(side => {
					const idx = Object.keys(respawnTicketsSideMap).find(k => respawnTicketsSideMap[k] === side);
					if (idx !== undefined) {
						values[side] = data[idx];
					}
				});
				counterState.events.push({ frameNum, values });
			}
		}
	}
}

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

const skipAnimationDistance = 222; // 800 kph at 1 sec frame delay, cruise for most planes - objects changing a larger distance than this would represent will be temporarily hidden between frames because it's assumed they're teleporting
let requestedFrame;

function getArguments () {
	// let args = new Object();
	// window.location.search.replace("?", "").split("&").forEach(function (s) {
	// 	let values = s.split("=");
	// 	if (values.length > 1) {
	// 		args[values[0]] = values[1].replace(/%20/g, " ");
	// 	}
	// });

	let args = new URLSearchParams(window.location.search);


	// console.log(args);
	return args;
}

function initOCAP () {
	mapDiv = document.getElementById("map");
	defineIcons();
	ui = new UI();

	// Fetch server version
	fetch('api/version')
		.then(response => response.json())
		.then(data => {
			ui.setServerVersion(data.BuildVersion || 'unknown');
		})
		.catch(() => {
			ui.setServerVersion('unknown');
		});

	// Check storage persistence and warn Safari users
	checkStoragePersistence();

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
			if (args.get('file')) {
				document.addEventListener("mapInited", function (event) {
					let args = getArguments();
					if (args.get('x') && args.get('y') && args.get('zoom')) {
						let coords = [parseFloat(args.get('x')), parseFloat(args.get('y'))];
						let zoom = parseFloat(args.get('zoom'));
						map.setView(coords, zoom);
					}
					if (args.get('frame')) {
						ui.setMissionCurTime(parseInt(args.get('frame')));
					}
				}, false);

				document.addEventListener("operationProcessed", function (event) {
					let bounds = getMapMarkerBounds();
					map.fitBounds(bounds);
				});

				return loadOperationByFilename(args.get('file'));
			}
		})
		.catch((error) => {
			ui.showHint(error);
		});

	if (args.get('experimental')) ui.showExperimental();
}

async function getWorldByName (worldName) {
	console.log("Getting world " + worldName);

	let defaultMap = {
		"name": "NOT FOUND",
		"displayName": "NOT FOUND",
		"worldname": "NOT FOUND",
		"worldSize": 16384,
		"imageSize": 16384,
		"multiplier": 1,
		"maxZoom": 6,
		"minZoom": 0,
		"hasTopo": true,
		"hasTopoRelief": false,
		"hasTopoDark": false,
		"hasColorRelief": false,
		"attribution": "Bohemia Interactive and 3rd Party Developers"
	};

	// 1. Try local map data
	try {
		const localMapRes = await fetch(
			'images/maps/' + worldName + '/map.json',
			{ cache: "no-store" }
		);
		if (localMapRes.status === 200) {
			return Object.assign(defaultMap, await localMapRes.json(), {
				_baseUrl: 'images/maps/' + worldName
			});
		}
	} catch (error) {
		console.error('Error fetching/parsing local map.json', error.message || error);
	}

	// 2. Fallback to cloud CDN if enabled
	if (ui.useCloudTiles) {
		// 2a. Try pmtiles CDN (MapLibre-capable)
		try {
			var pmtilesRes = await fetch(
				`https://pmtiles.ocap2.com/${worldName}/map.json`,
				{ cache: "no-store" }
			);
			if (pmtilesRes.status === 200) {
				return Object.assign(defaultMap, await pmtilesRes.json(), {
					_useCloudTiles: true,
					_baseUrl: `https://pmtiles.ocap2.com/${worldName}`,
					maplibre: true // subdomain implies MapLibre support
				});
			}
		} catch (error) {
			console.warn('pmtiles CDN fetch failed:', error.message || error);
		}

		// 2b. Try legacy raster CDN
		try {
			var rasterRes = await fetch(
				`https://maps.ocap2.com/${worldName}/map.json`,
				{ cache: "no-store" }
			);
			if (rasterRes.status === 200) {
				return Object.assign(defaultMap, await rasterRes.json(), {
					_useCloudTiles: true,
					_baseUrl: `https://maps.ocap2.com/${worldName}`
				});
			}
		} catch (error) {
			console.warn('Raster CDN fetch failed:', error.message || error);
		}

		// 2c. Nothing found — placeholder
		Object.assign(defaultMap, {
			"imageSize": 30720,
			"worldSize": 30720,
			"multiplier": 1,
			"worldName": worldName
		});
		console.warn("World not found, using blank map");
		alert(`The map for this mission (worldName: ${worldName}) is not available locally or in the cloud.\n\nA placeholder will be shown instead. Please report this issue on the OCAP2 Discord.\n\nhttps://discord.gg/wQusAQnrBP`);
		worldName = "";

		return defaultMap;
	} else {
		return Promise.reject(`Map "${worldName}" is not installed`);
	}
}

function initMap (world) {
	// Bad
	mapMaxNativeZoom = world.maxZoom
	mapMaxZoom = mapMaxNativeZoom + 2

	imageSize = world.imageSize;
	multiplier = world.multiplier;

	useMapLibreMode = Boolean(world.maplibre) || Boolean(world.maplibreStyle);
	console.log("[OCAP] Map mode:", useMapLibreMode ? "MapLibre + PMTiles" : "Legacy raster tiles");

	var mapOptions;

	if (useMapLibreMode) {
		// EPSG:3857 mode for MapLibre GL basemap
		var worldSizeDeg = world.worldSize / METERS_PER_DEGREE;
		mapOptions = {
			center: [worldSizeDeg / 2, worldSizeDeg / 2],
			zoom: 12,
			maxZoom: 20,
			minZoom: 10,
			zoomControl: false,
			scrollWheelZoom: true,
			zoomAnimation: true,
			fadeAnimation: true,
			crs: L.CRS.EPSG3857,
			attributionControl: true,
			zoomSnap: 1,
			zoomDelta: 1,
			closePopupOnClick: false,
			preferCanvas: true
		};
	} else {
		// Legacy mode: custom OCAP CRS for raster tiles
		var factorx = multiplier;
		var factory = multiplier;

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

				// Multiply by 2^mapMaxNativeZoom to convert from CRS units to meters
				return Math.sqrt(dx * dx + dy * dy) * Math.pow(2, mapMaxNativeZoom);
			},
			infinite: true
		});

		mapOptions = {
			center: [0, 0],
			zoom: 0,
			maxNativeZoom: mapMaxNativeZoom,
			maxZoom: mapMaxZoom,
			minNativeZoom: 0,
			minZoom: 0,
			// zoominfoControl: true, // moved for custom position
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
		};
	}

	// Create map
	map = L.map('map', mapOptions);

	// Create SVG renderer for shapes that need pattern fills (Canvas doesn't support SVG patterns)
	window.svgRenderer = L.svg();
	window.svgRenderer.addTo(map);


	// Hide marker popups once below a certain zoom level
	map.on("zoom", function () {
		var hideThreshold = useMapLibreMode ? 14 : 4;
		ui.hideMarkerPopups = map.getZoom() <= hideThreshold;
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


	// Setup layer groups
	entitiesLayerGroup.addTo(map);
	markersLayerGroup.addTo(map);
	systemMarkersLayerGroup.addTo(map);
	projectileMarkersLayerGroup.addTo(map);

	if (useMapLibreMode) {
		// Register PMTiles protocol for MapLibre (once)
		if (!window._pmtilesRegistered) {
			let pmtilesProtocol = new pmtiles.Protocol();
			maplibregl.addProtocol("pmtiles", pmtilesProtocol.tile);
			window._pmtilesRegistered = true;
			console.log("[OCAP] PMTiles protocol registered");
		}

		// Build style candidates list — frontend probes to discover which exist
		var styleBase = world._baseUrl + '/styles/';
		// Correct font base URL — resolved against page location so it works
		// regardless of where the style JSON is served from (local or CDN).
		var fontsBaseURL = new URL('images/maps/fonts/', window.location.href).href;

		var styleCandidates = [
			{ label: getLocalizable('basemap_topographic'),        url: styleBase + 'topo.json' },
			{ label: getLocalizable('basemap_topographic_dark'),   url: styleBase + 'topo-dark.json' },
			{ label: getLocalizable('basemap_satellite'),          url: styleBase + 'satellite.json' },
			{ label: getLocalizable('basemap_hybrid'),             url: styleBase + 'hybrid.json' },
			{ label: getLocalizable('basemap_color_relief'),       url: styleBase + 'color-relief.json' },
			{ label: getLocalizable('basemap_topographic_relief'), url: styleBase + 'topo-relief.json' }
		];

		// Resolve saved style preference
		var savedStyleIdx = parseInt(localStorage.getItem('ocap-maplibre-style'), 10) || 0;
		if (savedStyleIdx < 0 || savedStyleIdx >= styleCandidates.length) savedStyleIdx = 0;
		var initialStyle = styleCandidates[savedStyleIdx].url;

		// Add MapLibre basemap layer
		console.log("[OCAP] Loading MapLibre style:", initialStyle);
		mapLibreLayer = L.maplibreGL({
			style: initialStyle,
			interactive: false,
			renderWorldCopies: false,
			// Rewrite font glyph requests to use the correct server path.
			// The glyphs URL in the style JSON uses relative paths that may
			// resolve incorrectly depending on where the style is served from.
			transformRequest: function (url, resourceType) {
				if (resourceType === 'Glyphs') {
					// Extract fontstack and range from the URL path
					var match = url.match(/([^/]+)\/(\d+-\d+\.pbf)(?:\?|$)/);
					if (match) {
						return { url: fontsBaseURL + match[1] + '/' + match[2] };
					}
				}
			}
		});
		mapLibreLayer.addTo(map);

		// Fit map to world bounds
		var worldSizeDeg = world.worldSize / METERS_PER_DEGREE;
		map.fitBounds(L.latLngBounds(
			L.latLng(0, 0),
			L.latLng(worldSizeDeg, worldSizeDeg)
		));
	}


	// worldName = world.worldName;

	if (!useMapLibreMode) {
		// Setup raster tile layers
		var baseLayers = [];

		let topoLayerUrl = "";
		let topoDarkLayerUrl = "";
		let topoReliefLayerUrl = "";
		let colorReliefLayerUrl = "";


		if (worldName === "") {
			console.log("World name missing or not rendered. Using default map.")
			topoLayerUrl = 'https://maps.ocap2.com/missing_tiles.png';
		} else {
			var tileBase = world._baseUrl;
			console.log("Streaming map tiles from:", tileBase);
			topoLayerUrl = tileBase + '/{z}/{x}/{y}.png';
			topoDarkLayerUrl = tileBase + '/topoDark/{z}/{x}/{y}.png';
			topoReliefLayerUrl = tileBase + '/topoRelief/{z}/{x}/{y}.png';
			colorReliefLayerUrl = tileBase + '/colorRelief/{z}/{x}/{y}.png';
		}

		console.log("Getting bounds for layers...")
		mapBounds = getMapImageBounds()

		if (world.hasTopo) {
			topoLayer = L.tileLayer(topoLayerUrl, {
				maxNativeZoom: world.maxZoom,
				// maxZoom: mapMaxZoom,
				minNativeZoom: world.minZoom,
				bounds: mapBounds,
				label: getLocalizable('basemap_topographic'),
				attribution: "Map Data &copy; " + world.attribution,
				noWrap: true,
				tms: false,
				keepBuffer: 4,
				// opacity: 0.7,
				errorTileUrl: 'https://maps.ocap2.com/missing_tiles.png'
			});
			baseLayers.push(topoLayer);
		}

		if (world.hasTopoDark) {
			topoDarkLayer = L.tileLayer(topoDarkLayerUrl, {
				maxNativeZoom: world.maxZoom,
				// maxZoom: mapMaxZoom,
				minNativeZoom: world.minZoom,
				bounds: mapBounds,
				label: getLocalizable('basemap_topographic_dark'),
				attribution: "Map Data &copy; " + world.attribution,
				noWrap: true,
				tms: false,
				keepBuffer: 4,
				// opacity: 0.8,
				errorTileUrl: 'https://maps.ocap2.com/missing_tiles.png'
			});
			baseLayers.push(topoDarkLayer);
		}

		if (world.hasTopoRelief) {
			topoReliefLayer = L.tileLayer(topoReliefLayerUrl, {
				maxNativeZoom: world.maxZoom,
				// maxZoom: mapMaxZoom,
				minNativeZoom: world.minZoom,
				bounds: mapBounds,
				label: getLocalizable('basemap_topographic_relief'),
				attribution: "Map Data &copy; " + world.attribution,
				noWrap: true,
				tms: false,
				keepBuffer: 4,
				// opacity: 0.9,
				errorTileUrl: 'https://maps.ocap2.com/missing_tiles.png'
			});
			baseLayers.push(topoReliefLayer);
		}

		if (world.hasColorRelief) {
			colorReliefLayer = L.tileLayer(colorReliefLayerUrl, {
				maxNativeZoom: world.maxZoom,
				// maxZoom: mapMaxZoom,
				minNativeZoom: world.minZoom,
				bounds: mapBounds,
				attribution: "Map Data &copy; " + world.attribution,
				label: getLocalizable('basemap_color_relief'),
				noWrap: true,
				tms: false,
				keepBuffer: 4,
				// opacity: 1,
				errorTileUrl: 'https://maps.ocap2.com/missing_tiles.png'
			});
			baseLayers.push(colorReliefLayer);
		}
	}


	// setup controls

	// Create grid layer
	gridLayer = new L.Layer.Grid();

	overlayLayerControl = L.control.layers({}, {
		// overlay layers
		"Units and Vehicles": entitiesLayerGroup,
		"Selected Side Markers": markersLayerGroup,
		"Editor/Briefing Markers": systemMarkersLayerGroup,
		"Projectile Markers": projectileMarkersLayerGroup,
		"Coordinate Grid": gridLayer
	}, {
		position: 'bottomright',
		collapsed: false
	});
	overlayLayerControl.addTo(map);

	if (useMapLibreMode) {
		var previewCenter = [worldSizeDeg / 2, worldSizeDeg / 2];
		L.control.maplibreStyles(mapLibreLayer, styleCandidates, {
			center: previewCenter,
			zoom: 12
		}).addTo(map);
	} else {
		baseLayerControl = L.control.basemaps({
			basemaps: baseLayers,
			tileX: 2,  // tile X coordinate
			tileY: 6,  // tile Y coordinate
			tileZ: 4   // tile zoom level
		}, {
			position: 'bottomright',
		});
		baseLayerControl.addTo(map);
	}


	// Add zoom control
	L.control.zoominfo({
		position: 'bottomright'
	}).addTo(map);

	// Add scale ruler
	L.control.scale({
		position: 'bottomleft',
		metric: true,
		imperial: false,
		maxWidth: 150
	}).addTo(map);


	function test () {
		// Add marker to map on click
		map.on("click", function (e) {
			console.debug("latLng", e.latlng);
			console.debug("LayerPoint", e.layerPoint);
			if (useMapLibreMode) {
				console.debug("Arma coords", [e.latlng.lng * METERS_PER_DEGREE, e.latlng.lat * METERS_PER_DEGREE]);
			} else {
				console.debug("Projected", map.project(e.latlng, mapMaxNativeZoom));
			}
		})
	}


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

function getMapImageBounds () {
	if (useMapLibreMode) {
		var worldSizeDeg = worldObject.worldSize / METERS_PER_DEGREE;
		mapBounds = L.latLngBounds(
			L.latLng(0, 0),
			L.latLng(worldSizeDeg, worldSizeDeg)
		);
		return mapBounds;
	}
	// Legacy mode (existing code unchanged)
	console.debug("Calculating map bounds from map image size");
	mapBounds = new L.LatLngBounds(
		map.unproject([0, worldObject.imageSize], mapMaxNativeZoom),
		map.unproject([worldObject.imageSize, 0], mapMaxNativeZoom)
	);
	return mapBounds;
}

function getMapMarkerBounds () {

	let boundaryMarks = markers.filter(item => {
		return item._type === "moduleCoverMap"
	});

	if (boundaryMarks.length === 4) {
		console.debug("Found boundary marks from BIS_moduleCoverMap")
		let boundaryPoints = boundaryMarks.map(item => armaToLatLng(item._positions[0][1]));
		let boundaryPolygon = L.polygon(boundaryPoints, { color: "#000000", fill: false, interactive: false, noClip: true }).addTo(map);

		return boundaryPolygon.getBounds();
	}

	// calculate map bounds from markers
	console.debug(`Calculating map bounds from ${markers.length} markers`)
	var markerBounds = L.latLngBounds()
	let invalidMarkers = [];
	markers.forEach(item => {
		if (item._positions[0] === undefined) {
			return invalidMarkers.push(item)
		}
		if (item._positions[0][1] === undefined) {
			return invalidMarkers.push(item)
		}

		// some marker positions are nested in an array, account for this
		if (Array.isArray(item._positions[0][1][0])) {
			return markerBounds.extend(armaToLatLng(item._positions[0][1][0]));
		} else {
			return markerBounds.extend(armaToLatLng(item._positions[0][1]));
		};
	});

	if (invalidMarkers.length > 0) {
		console.debug(`Found ${invalidMarkers.length} potentially invalid markers, ignoring them`, invalidMarkers)
	}


	return markerBounds;
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
	if (useMapLibreMode) {
		// EPSG:3857 mode: convert meters to degrees (near equator, 1° ≈ 111320m)
		// Arma Y axis is north, X axis is east — maps to lat/lng directly
		return L.latLng(coords[1] / METERS_PER_DEGREE, coords[0] / METERS_PER_DEGREE);
	}
	// Legacy mode: pixel-based projection
	var pixelCoords;
	pixelCoords = [(coords[0] * multiplier) + trim, (imageSize - (coords[1] * multiplier)) + trim];
	return map.unproject(pixelCoords, mapMaxNativeZoom);
}

// Returns date object as little endian (day, month, year) string
function dateToLittleEndianString (date) {
	return (date.getUTCDate() + "/" + (date.getUTCMonth() + 1) + "/" + date.getUTCFullYear());
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

/**
 * Load an operation, automatically choosing streaming or legacy mode based on format
 * @param {Object} op - Operation object with id, filename, storageFormat, schemaVersion
 * @returns {Promise}
 */
async function loadOperation(op) {
	// Use streaming for protobuf/flatbuffers formats
	if (op.storageFormat === 'protobuf' || op.storageFormat === 'flatbuffers') {
		// Get schema version from operation or default to 1
		const schemaVersion = op.schemaVersion || 1;
		console.log(`Loading operation ${op.id} using streaming mode (${op.storageFormat}, schema v${schemaVersion})`);
		return processOpStreaming(op.id, op.storageFormat, schemaVersion, op.filename);
	}
	// Fall back to legacy JSON loading
	console.log(`Loading operation using legacy JSON mode`);
	return processOp("data/" + op.filename);
}

/**
 * Load an operation by filename (for URL parameter support)
 * Fetches operation info first to determine format
 * @param {string} filename - Operation filename
 * @returns {Promise}
 */
async function loadOperationByFilename(filename) {
	// First, try to find the operation in the database to get format info
	try {
		const response = await fetch('api/v1/operations');
		if (response.ok) {
			const operations = await response.json();
			const op = operations.find(o => o.filename === filename);
			if (op) {
				return loadOperation(op);
			}
		}
	} catch (e) {
		console.warn('Could not fetch operations list:', e);
	}

	// Fallback to legacy JSON loading if operation not found in database
	console.log(`Operation not found in database, using legacy JSON mode`);
	return processOp("data/" + filename);
}

// Read operation JSON data and create unit objects
function processOp (filepath, opRecord) {
	console.log("Processing operation: (" + filepath + ")...");
	const time = new Date();
	// Strip "data/" prefix and .json extension since /file/:name endpoint adds .json.gz
	fileName = filepath.substr(5, filepath.length).replace(/\.json$/, '');

	let data;
	return fetch(filepath)
		.then((res) => res.json())
		.then((json) => {
			data = json;
			worldName = data.worldName.toLowerCase();
			return worldName;
		})
		.then((wn) => getWorldByName(wn))
		.then((world) => {
			worldObject = world;
			document.dispatchEvent(new Event("worldLoaded"))
			multiplier = world.multiplier;
			missionName = data.missionName;

			let playedDate;
			if (opRecord) {
				playedDate = opRecord.date;
			} else {
				// try to parse from filename
				// if filename has "\d__\d" format, use that
				// else no date, in the event a temp file is referenced
				let dateMatch = fileName.match(/^\d{4}_\d{2}_\d{2}/);
				if (dateMatch) {
					playedDate = dateMatch[0].replace(/_/g, "-");
				} else {
					playedDate = "<UnknownDate>";
				}
			}

			let worldDisplayName;
			if ([undefined, "NOT FOUND"].includes(world.displayName)) {
				if (world.name == "NOT FOUND") {
					worldDisplayName = world.worldName
				} else {
					worldDisplayName = world.name
				}
			} else {
				worldDisplayName = world.displayName
			}
			ui.setMissionName(`${missionName} - Recorded ${playedDate} on ${worldDisplayName}`);

			extensionVersion = data.extensionVersion;
			ui.setExtensionVersion(extensionVersion);
			addonVersion = data.addonVersion;
			ui.setAddonVersion(addonVersion);
			endFrame = data.endFrame;
			frameCaptureDelay = data.captureDelay * 1000;
			ui.setMissionEndTime(endFrame);
			if (data.times) {
				ui.detectTimes(data.times);
			}
			ui.checkAvailableTimes();

			markers = [];
			resetCounterState();

			var showCiv = false;
			var showWest = false;
			var showEast = false;
			var showGuer = false;
			var arrSide = ["GLOBAL", "EAST", "WEST", "GUER", "CIV"];

			// Loop through entities
			(data.entities ?? []).forEach(function (entityJSON) {
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
						console.error(`Failed to process ${markerJSON[9]} with type ${markerJSON[0]} and text "${markerJSON[1]}"\nError: ${err}\nMarkerJSON: ${JSON.stringify(markerJSON, null, 2)}`)
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
			var invalidHitKilledEvents = [];
			(data.events ?? []).forEach(function (eventJSON) {
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
							invalidHitKilledEvents.push({
								"reason": "null/unknown victim/causedBy",
								"victim": victim,
								"causedBy": causedBy,
								"event": eventJSON
							});
						}

						// Incrememt kill/death count for killer/victim
						if (type === "killed" && (causedBy != null)) {
							if (causedBy !== victim) {
								if (causedBy._side === victim._side) {
									causedBy.teamKillCount++;
								} else {
									causedBy.killCount++;
								}
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
					case (type === "respawnTickets"):
						processCounterEvent(frameNum, type, eventJSON[2]);
						break;
					case (type === "counterInit"):
						processCounterEvent(frameNum, type, eventJSON[2]);
						break;
					case (type === "counterSet"):
						processCounterEvent(frameNum, type, eventJSON[2]);
						break;
				}

				// Add event to gameEvents list
				if (gameEvent != null) {
					gameEvents.addEvent(gameEvent);
				}
			});

			if (invalidHitKilledEvents.length > 0) {
				console.warn("WARNING: " + invalidHitKilledEvents.length + " hit/killed events will use 'something' as the victim/killer. See the debug stream for a full list.");
				console.debug(invalidHitKilledEvents);
			}

			gameEvents.init();

			console.log("Finished processing operation (" + (new Date() - time) + "ms).");
			console.debug("Addon version: " + data.addonVersion);
			console.debug("Extension version: " + data.extensionVersion);
			console.debug("Extension build: " + data.extensionBuild);
			console.debug("Total frames: " + data.endFrame);
			console.debug("Total entities: " + (data.entities?.length ?? 0));
			console.debug("Total markers: " + (data.Markers?.length ?? 0));
			console.debug("Total events: " + (data.events?.length ?? 0));
			if ((data.Markers?.length ?? 0) > 50000) {
				console.warn("WARNING: This mission contains more than 50,000 markers. This may cause performance issues and indicate configured or malformed marker exclusion settings in the addon.");
			}
			console.log("Initializing map...");
			console.debug(JSON.stringify(world, null, 2));
			initMap(world);
			startPlaybackLoop();
			toggleHitEvents(false);
			// playPause();
			ui.hideModal();

			// fire event
			document.dispatchEvent(new Event('operationLoaded'));
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
						if (ui.nameDisplayMode !== "none") {
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
				updateCounterDisplay(playbackFrame);

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

// Global chunk manager for streaming playback
let chunkManager = null;
let storageManager = null;
let isStreamingMode = false;

/**
 * Detect if browser is Safari
 * @returns {boolean}
 */
function isSafari() {
	const ua = navigator.userAgent.toLowerCase();
	return ua.includes('safari') && !ua.includes('chrome') && !ua.includes('chromium');
}

/**
 * Request persistent storage and warn Safari users about ITP limitations
 */
async function checkStoragePersistence() {
	// Request persistent storage if available
	if (navigator.storage && navigator.storage.persist) {
		const isPersisted = await navigator.storage.persisted();
		if (!isPersisted) {
			const granted = await navigator.storage.persist();
			console.log(`Persistent storage ${granted ? 'granted' : 'denied'}`);
		}
	}

	// Warn Safari users about ITP 7-day eviction
	if (isSafari()) {
		console.warn('Safari detected: Storage may be evicted after 7 days due to ITP');
		// Show warning in UI after a short delay
		setTimeout(() => {
			if (ui && typeof ui.showHint === 'function') {
				ui.showHint('Safari: Cached recordings may be cleared after 7 days of inactivity');
			}
		}, 3000);
	}
}

/**
 * Check if operation supports streaming and return format info
 * @param {string} operationId
 * @returns {Promise<Object|null>}
 */
async function getOperationFormat(operationId) {
	try {
		const response = await fetch(`api/v1/operations/${operationId}/format`);
		if (!response.ok) return null;
		return response.json();
	} catch (e) {
		console.warn('Failed to get operation format:', e);
		return null;
	}
}

/**
 * Process operation using streaming/chunked mode
 * @param {string} operationId - Operation ID from database
 * @param {string} format - Storage format ('protobuf' or 'flatbuffers')
 * @param {number} schemaVersion - Schema version (default: 1)
 * @returns {Promise<void>}
 */
async function processOpStreaming(operationId, format = 'protobuf', schemaVersion = 1, operationFilename = null) {
	console.log(`Processing operation (streaming mode): ${operationId} (format: ${format}, schema: v${schemaVersion})`);
	const time = new Date();

	// Set global fileName for download functionality
	// Strip .json extension since /file/:name endpoint adds .json.gz
	fileName = (operationFilename || operationId).replace(/\.json$/, '');

	// Get versioned loader from registry
	const loader = LoaderRegistry.getLoader(schemaVersion);

	// Check if browser caching is enabled (opt-in via URL param ?cache=1)
	const urlParams = new URLSearchParams(window.location.search);
	const enableBrowserCache = urlParams.get('cache') === '1';

	// Show loading indicator
	ui.showLoading('Initializing streaming playback...');

	// Initialize storage manager if needed (only if caching enabled)
	if (enableBrowserCache && !storageManager) {
		storageManager = new StorageManager();
		await storageManager.init();
	}

	ui.updateLoadingProgress(1, 4, 'Loading manifest...');

	// Fetch manifest
	let manifest;
	const cachedManifest = enableBrowserCache ? await storageManager.getManifest(operationId, format) : null;
	if (cachedManifest) {
		manifest = loader.decodeManifest(cachedManifest, format);
		console.log('Loaded manifest from cache');
	} else {
		const response = await fetch(`api/v1/operations/${operationId}/manifest`);
		if (!response.ok) {
			throw new Error(`Failed to fetch manifest: ${response.status}`);
		}
		const data = await response.arrayBuffer();
		manifest = loader.decodeManifest(data, format);
		// Cache manifest (only if enabled)
		if (enableBrowserCache) {
			storageManager.saveManifest(operationId, data, format).catch(e => {
				console.warn('Failed to cache manifest:', e);
			});
		}
	}

	// Initialize chunk manager with format, loader, and cache setting
	const baseUrl = window.location.pathname.replace(/\/[^/]*$/, '');
	chunkManager = new ChunkManager(operationId, manifest, storageManager, baseUrl, {
		format: format,
		enableBrowserCache: enableBrowserCache,
		loader: loader
	});
	isStreamingMode = true;

	// Set up mission metadata
	worldName = manifest.worldName.toLowerCase();
	missionName = manifest.missionName;
	endFrame = manifest.frameCount;
	frameCaptureDelay = manifest.captureDelayMs;

	ui.setMissionName(missionName);
	ui.setMissionEndTime(endFrame);

	// Set version info from manifest
	if (manifest.extensionVersion) {
		extensionVersion = manifest.extensionVersion;
		ui.setExtensionVersion(extensionVersion);
	}
	if (manifest.addonVersion) {
		addonVersion = manifest.addonVersion;
		ui.setAddonVersion(addonVersion);
	}

	// Process times if available
	if (manifest.times && manifest.times.length > 0) {
		const times = manifest.times.map(t => ({
			frameNum: t.frameNum,
			systemTimeUTC: t.systemTimeUtc,
			date: t.date,
			timeMultiplier: t.timeMultiplier,
			time: t.time
		}));
		ui.detectTimes(times);
	}
	ui.checkAvailableTimes();

	markers = [];
	resetCounterState();

	// Initialize entities from manifest
	let showSides = { WEST: false, EAST: false, GUER: false, CIV: false };

	for (const entDef of manifest.entities) {
		if (entDef.type === 'unit') {
			// Create group if needed
			let group = groups.findGroup(entDef.groupName, entDef.side);
			if (group == null) {
				group = new Group(entDef.groupName, entDef.side);
				groups.addGroup(group);
			}

			// Convert framesFired from protobuf format to expected format
			// Protobuf: [{frameNum, posX, posY, posZ}, ...]
			// Expected: [[frameNum, [x, y, z]], ...]
			const framesFired = (entDef.framesFired || []).map(ff => [
				ff.frameNum,
				[ff.posX, ff.posY, ff.posZ]
			]);

			// Create unit with empty positions (will be filled from chunks)
			const unit = new Unit(
				entDef.startFrame,
				entDef.id,
				entDef.name,
				group,
				entDef.side,
				entDef.isPlayer,
				[], // Empty positions - will use chunks
				framesFired,
				entDef.role
			);
			unit._streamingMode = true;
			unit._endFrame = entDef.endFrame;
			entities.add(unit);

			// Track sides
			if (showSides.hasOwnProperty(entDef.side)) {
				showSides[entDef.side] = true;
			}
		} else {
			// Create vehicle with empty positions
			const vehicle = new Vehicle(
				entDef.startFrame,
				entDef.id,
				entDef.vehicleClass,
				entDef.name,
				[] // Empty positions - will use chunks
			);
			vehicle._streamingMode = true;
			vehicle._endFrame = entDef.endFrame;
			entities.add(vehicle);
		}
	}

	// Process events from manifest
	for (const evt of manifest.events) {
		let gameEvent = null;
		switch (evt.type) {
			case 'killed':
			case 'hit':
				const victim = entities.getById(evt.targetId);
				const causedBy = entities.getById(evt.sourceId);
				if (causedBy && evt.type === 'killed' && victim) {
					if (causedBy !== victim && causedBy._side === victim._side) {
						causedBy.teamKillCount++;
					}
					if (causedBy !== victim) {
						causedBy.killCount++;
					}
					victim.deathCount++;
				}
				gameEvent = new HitKilledEvent(evt.frameNum, evt.type, causedBy, victim, evt.distance, evt.weapon);
				ui.addTickToTimeline(evt.frameNum);
				break;
			case 'connected':
			case 'disconnected':
				gameEvent = new ConnectEvent(evt.frameNum, evt.type, evt.message);
				break;
			case 'endMission':
				gameEvent = new endMissionEvent(evt.frameNum, evt.type, evt.message, '');
				break;
			case 'respawnTickets':
			case 'counterInit':
			case 'counterSet':
				if (evt.message) {
					processCounterEvent(evt.frameNum, evt.type, JSON.parse(evt.message));
				}
				break;
		}
		if (gameEvent) {
			gameEvents.addEvent(gameEvent);
		}
	}

	// Process markers from manifest
	const arrSide = ['GLOBAL', 'EAST', 'WEST', 'GUER', 'CIV'];
	for (const m of manifest.markers) {
		if (m.type.includes('zoneTrigger') || m.type.includes('Empty')) continue;

		const player = m.playerId >= 0 ? entities.getById(m.playerId) : -1;
		// Format: [frameNum, [posX, posY, posZ], direction, alpha]
		// For POLYLINE: [frameNum, [[x1, y1], [x2, y2], ...], direction, alpha]
		const positions = m.positions.map(p => {
			// Check if this position has POLYLINE coordinates
			if (p.lineCoords && p.lineCoords.length >= 4) {
				// Convert flat [x1, y1, x2, y2, ...] to [[x1, y1], [x2, y2], ...]
				const coords = [];
				for (let i = 0; i < p.lineCoords.length; i += 2) {
					coords.push([p.lineCoords[i], p.lineCoords[i + 1]]);
				}
				return [p.frameNum, coords, p.direction, p.alpha];
			}
			// Regular single-point position
			return [p.frameNum, [p.posX, p.posY, p.posZ], p.direction, p.alpha];
		});

		const marker = new Marker(
			m.type,
			m.text,
			player,
			m.color,
			m.startFrame,
			m.endFrame,
			m.side,
			positions,
			m.size,
			m.shape,
			m.brush
		);
		markers.push(marker);
	}

	gameEvents.init();

	// Show side filters
	const countShowSide = Object.values(showSides).filter(v => v).length;
	for (const [side, show] of Object.entries(showSides)) {
		const elem = document.getElementById('side' + side.charAt(0) + side.slice(1).toLowerCase());
		if (elem) {
			if (show) {
				elem.style.width = `calc(${100 / countShowSide}% - 2.5px)`;
				elem.style.display = 'inline-block';
			} else {
				elem.style.display = 'none';
			}
		}
	}

	// Set initial side
	if (showSides.WEST) ui.switchSide('WEST');
	else if (showSides.EAST) ui.switchSide('EAST');
	else if (showSides.GUER) ui.switchSide('IND');
	else if (showSides.CIV) ui.switchSide('CIV');

	console.log(`Finished processing manifest (${new Date() - time}ms).`);

	ui.updateLoadingProgress(3, 4, 'Loading map...');

	// Get world info and init map
	const world = await getWorldByName(worldName);
	worldObject = world;  // Set global for getMapImageBounds()
	initMap(world);

	ui.updateLoadingProgress(4, 4, 'Starting playback...');

	// Start playback with streaming
	startStreamingPlaybackLoop();

	toggleHitEvents(false);
	ui.hideModal();
	ui.hideLoading();
	ui.showStreamingMode();
}

/**
 * Streaming playback loop - loads chunks on demand
 */
function startStreamingPlaybackLoop() {
	let killlines = [];
	let firelines = [];

	async function playbackFunction() {
		// Ensure current chunk is loaded
		if (chunkManager && !playbackPaused) {
			try {
				await chunkManager.ensureLoaded(playbackFrame);
			} catch (e) {
				console.error('Failed to load chunk:', e);
				playbackPaused = true;
				ui.showHint('Error loading playback data');
				return;
			}
		}

		if (!playbackPaused || lastDrawnFrame !== playbackFrame) {
			requestedFrame = requestAnimationFrame(() => {
				// Remove killlines & firelines from last frame
				killlines.forEach(line => map.removeLayer(line));
				firelines.forEach(line => map.removeLayer(line));
				killlines = [];
				firelines = [];

				countCiv = 0;
				countEast = 0;
				countGuer = 0;
				countWest = 0;

				// Update entities from chunk data
				for (const entity of entities.getAll()) {
					if (entity._streamingMode && chunkManager) {
						const state = chunkManager.getEntityState(playbackFrame, entity.getId());
						if (state) {
							entity.updateFromState(state);
						} else if (entity._marker) {
							// Only remove marker if chunk is loaded (entity truly doesn't exist in this frame)
							// If chunk is loading, keep the last known position to prevent flickering
							if (chunkManager.isChunkLoaded(playbackFrame)) {
								entity.removeMarker();
							}
							// If chunk is loading, do nothing - entity keeps its last position
						}
					} else {
						entity.updateRender(playbackFrame);
						entity.manageFrame(playbackFrame);
					}

					if (entity instanceof Unit) {
						// Count alive units
						if (entity._alive === 1) {
							switch (entity._side) {
								case 'WEST': countWest++; break;
								case 'EAST': countEast++; break;
								case 'GUER': countGuer++; break;
								case 'CIV': countCiv++; break;
							}
						}

						// Draw fire line (if enabled)
						var projectilePos = entity.firedOnFrame(playbackFrame);
						if (projectilePos != null && ui.firelinesEnabled) {
							const entityPos = entity.getLatLng();
							if (entityPos) {
								const line = L.polyline([entityPos, armaToLatLng(projectilePos)], {
									color: entity.getSideColour(),
									weight: 2,
									opacity: 0.4
								});
								line.addTo(map);
								firelines.push(line);
							}
						}
					}
				}

				ui.updateTitleSide();

				// Display events
				for (const event of gameEvents.getEvents()) {
					if (event.frameNum <= playbackFrame) {
						ui.addEvent(event);

						if (event.frameNum === playbackFrame) {
							if (event.type === 'killed') {
								const victim = event.victim;
								const killer = event.causedBy;
								if (killer && killer.id && victim) {
									const victimPos = victim.getLatLng();
									const killerPos = killer.getLatLng();
									if (victimPos && killerPos) {
										const line = L.polyline([victimPos, killerPos], {
											color: killer.getSideColour(),
											weight: 2,
											opacity: 0.4
										});
										line.addTo(map);
										killlines.push(line);
									}
								}
							}

							if (event.type === 'hit' && event.victim) {
								event.victim.flashHit();
							}
						}
					} else {
						ui.removeEvent(event);
					}
				}

				// Update markers
				for (const marker of markers) {
					marker.manageFrame(playbackFrame);
					marker.hideMarkerPopup(!ui.markersEnable);
				}

				// Handle entityToFollow
				if (entityToFollow != null) {
					const latLng = entityToFollow.getLatLng();
					if (latLng) {
						map.setView(latLng, map.getZoom());
					} else {
						entityToFollow.unfollow();
					}
				}

				if (!playbackPaused && playbackFrame !== endFrame) {
					playbackFrame++;
				}
				if (playbackFrame === endFrame) {
					playbackPaused = true;
					playPauseButton.style.backgroundPosition = '0 0';
				}

				ui.setMissionCurTime(playbackFrame);
				updateCounterDisplay(playbackFrame);

				lastDrawnFrame = playbackFrame;
			});
		} else {
			requestAnimationFrame(() => {
				for (const entity of entities.getAll()) {
					if (!entity._streamingMode) {
						entity.updateRender(playbackFrame);
					}
				}
				for (const marker of markers) {
					marker.updateRender(playbackFrame);
				}
			});
		}

		setTimeout(playbackFunction, frameCaptureDelay / playbackMultiplier);
	}

	setTimeout(playbackFunction, frameCaptureDelay / playbackMultiplier);
}
