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
			if (entity.getName().indexOf(name) != -1) {
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
var mapPanes = null;
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
	ui.setModalOpList();
	/*
		window.addEventListener("keypress", function (event) {
			switch (event.charCode) {
				case 32: // Spacebar
					event.preventDefault(); // Prevent space from scrolling page on some browsers
					break;
			};
		});
	*/
	let args = getArguments();
	if (args.file) {
		processOp("data/" + args.file);
		document.addEventListener("mapInited", function (event) {
			let args = getArguments();
			if (args.x && args.y && args.zoom) {
				let coords = [parseFloat(args.x), parseFloat(args.y)];
				let zoom = parseFloat(args.zoom);
				map.setView(coords, zoom);
			}
			if (args.frame) {
				ui.setMissionCurTime(parseInt(args.frame));
			}
		}, false);
	}
}

function setWorld () {
	let jsonPath = "images/maps/maps.json";

	console.log("Getting worlds from " + jsonPath);
	$.getJSON(jsonPath, function (data) {
		worlds = data;
	});
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

	$.ajax({
		url: "images/maps/" + worldName + "/map.json",
		async: false,
		success: function (data) {
			map = data;
		},
		error: function () {
			ui.showHint(`Error: Map "${worldName}" is not installed`);
		}
	});

	return Object.assign(defaultMap, map);
}

function initMap () {
	var world = getWorldByName(worldName);
	// Bad
	mapMaxNativeZoom = world.maxZoom
	mapMaxZoom = mapMaxNativeZoom + 3
	// Create map
	map = L.map('map', {
		//maxZoom: mapMaxZoom,
		zoomControl: false,
		zoomAnimation: true,
		scrollWheelZoom: false,
		fadeAnimation: true,
		crs: L.CRS.Simple,
		attributionControl: false,
		zoomSnap: 0.1,
		zoomDelta: 1,
		closePopupOnClick: false,
		preferCanvas: false
	}).setView([0, 0], mapMaxNativeZoom);

	mapPanes = map.getPanes();

	// Hide marker popups once below a certain zoom level
	map.on("zoom", function () {
		if (map.getZoom() <= 4) {
			ui.hideMarkerPopups = true;
		} else {
			ui.hideMarkerPopups = false;
		}
	});
	console.log("Got world: ");
	console.log(world);

	imageSize = world.imageSize;
	multiplier = world.multiplier;
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
	L.tileLayer('images/maps/' + worldName + '/{z}/{x}/{y}.png', {
		maxNativeZoom: mapMaxNativeZoom,
		maxZoom: mapMaxZoom,
		minZoom: mapMinZoom,
		bounds: mapBounds,
		//attribution: 'MisterGoodson',
		noWrap: true,
		tms: false
	}).addTo(map);

	// Add keypress event listener
	mapDiv.addEventListener("keypress", function (event) {
		//console.log(event);

		switch (event.charCode) {
			case 32: // Spacebar
				playPause();
				break;
		}
	});

	// Add custom handling for mousewheel zooming
	// Prevents map blurring when zooming in too quickly
	mapDiv.addEventListener("wheel", function (event) {
		// We pause playback while zooming to prevent icon visual glitches
		if (!playbackPaused) {
			playbackPaused = true;
			setTimeout(function () {
				playbackPaused = false;
			}, 250);
		}
		// 	console.log(event);
		var zoom;
		if (event.deltaY > 0) { zoom = -0.5 } else { zoom = 0.5 }
		map.zoomIn(zoom, { animate: false });
	});

	map.on("dragstart", function () {
		if (entityToFollow != null) {
			entityToFollow.unfollow();
		}
	});

	createInitialMarkers();
	let boundaryMarks = markers.filter(item => {
		return item._type == "moduleCoverMap"
	});
	if (boundaryMarks.length == 4) {
		let boundaryPoints = boundaryMarks.map(item => armaToLatLng(item._positions[0][1]));
		let boundaryPolygon = L.polygon(boundaryPoints, { color: "#000000", fill: false, interactive: false, noClip: true }).addTo(map);
		map.flyToBounds(boundaryPolygon.getBounds());
	} else {
		map.flyToBounds(map.getBounds());
	}


	document.dispatchEvent(new Event("mapInited"));
	//test();
}

function createInitialMarkers () {
	/*	setTimeout(function() {
			let svg = marker.getElement().contentDocument;
			let g = svg.getElementById("layer1");
			console.log();

			g.setAttribute('fill', 'yellow');
		}, 100);*/

	entities.getAll().forEach(function (entity) {
		// Create and set marker for unit
		var pos = entity.getPosAtFrame(0);
		if (pos != null) { // If unit did exist at start of game
			entity.createMarker(armaToLatLng(pos));
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
	let imgPathManMG = "images/markers/man/MG/";
	let imgPathManGL = "images/markers/man/GL/";
	let imgPathManAT = "images/markers/man/AT/";
	let imgPathManSniper = "images/markers/man/Sniper/";
	let imgPathManAA = "images/markers/man/AA/";
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


	let imgs = ["blufor", "opfor", "ind", "civ", "dead", "hit", "follow", "unconscious"];
	imgs.forEach((img, i) => {
		icons.man[img] = L.icon({ iconSize: [16, 16], iconUrl: `${imgPathMan}${img}.svg` });
		// icons.manMG[img] = L.icon({ iconSize: [16, 16], iconUrl: `${imgPathManMG}${img}.svg` });
		// icons.manGL[img] = L.icon({ iconSize: [16, 16], iconUrl: `${imgPathManGL}${img}.svg` });
		// icons.manAT[img] = L.icon({ iconSize: [16, 16], iconUrl: `${imgPathManAT}${img}.svg` });
		// icons.manSniper[img] = L.icon({ iconSize: [16, 16], iconUrl: `${imgPathManSniper}${img}.svg` });
		// icons.manAA[img] = L.icon({ iconSize: [16, 16], iconUrl: `${imgPathManAA}${img}.svg` });
		icons.ship[img] = L.icon({ iconSize: [28, 28], iconUrl: `${imgPathShip}${img}.svg` });
		icons.parachute[img] = L.icon({ iconSize: [20, 20], iconUrl: `${imgPathParachute}${img}.svg` });
		icons.heli[img] = L.icon({ iconSize: [32, 32], iconUrl: `${imgPathHeli}${img}.svg` });
		icons.plane[img] = L.icon({ iconSize: [32, 32], iconUrl: `${imgPathPlane}${img}.svg` });
		icons.truck[img] = L.icon({ iconSize: [28, 28], iconUrl: `${imgPathTruck}${img}.svg` });
		icons.car[img] = L.icon({ iconSize: [24, 24], iconUrl: `${imgPathCar}${img}.svg` });
		icons.apc[img] = L.icon({ iconSize: [28, 28], iconUrl: `${imgPathApc}${img}.svg` });
		icons.tank[img] = L.icon({ iconSize: [28, 28], iconUrl: `${imgPathTank}${img}.svg` });
		icons.staticMortar[img] = L.icon({ iconSize: [20, 20], iconUrl: `${imgPathStaticMortar}${img}.svg` });
		icons.staticWeapon[img] = L.icon({ iconSize: [20, 20], iconUrl: `${imgPathStaticWeapon}${img}.svg` });
		icons.unknown[img] = L.icon({ iconSize: [28, 28], iconUrl: `${imgPathUnknown}${img}.svg` });
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

// Converts Arma coordinates [x,y] to LatLng
function armaToLatLng (coords) {
	var pixelCoords = [(coords[0] * multiplier) + trim, (imageSize - (coords[1] * multiplier)) + trim];
	return map.unproject(pixelCoords, mapMaxNativeZoom);
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

		var sqMarker = L.polygon(pointsRaw, { noClip: true, interactive: false});
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

function dateToTimeString (date) {
	var hours = date.getUTCHours();
	var minutes = date.getUTCMinutes();
	var seconds = date.getUTCSeconds();
	var string = "";

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
	var time = new Date();
	fileName = filepath.substr(5, filepath.length);
	$.getJSON(filepath, function (data) {
		worldName = data.worldName.toLowerCase();
		var world = getWorldByName(worldName);
		var multiplier = world.multiplier;
		missionName = data.missionName;
		ui.setMissionName(missionName);

		endFrame = data.endFrame;
		frameCaptureDelay = data.captureDelay * 1000;
		ui.setMissionEndTime(endFrame);

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
						positions.push({ position: pos, direction: dir, alive: alive, crew: crew });
					}
				}
			});

			if (type == "unit") {
				//if (entityJSON.name == "Error: No unit") {return}; // Temporary fix for old captures that initialised dead units

				// Add group to global groups object (if new)
				var group = groups.findGroup(entityJSON.group, entityJSON.side);
				if (group == null) {
					group = new Group(entityJSON.group, entityJSON.side);
					groups.addGroup(group);
				}

				// Create unit and add to entities list
				var unit = new Unit(startFrameNum, id, name, group, entityJSON.side, (entityJSON.isPlayer == 1), positions, entityJSON.framesFired);
				entities.add(unit);

				// Show title side
				if (arrSideSelect.indexOf(entityJSON.side) == -1) {
					arrSideSelect.push(entityJSON.side);
					ui.switchSide(entityJSON.side);
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
						default:
							showCiv = true;
							break;
					}
				}
			} else {
				// Create vehicle and add to entities list
				var vehicle = new Vehicle(startFrameNum, id, entityJSON.class, name, positions);
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

		// Loop through events
		data.events.forEach(function (eventJSON) {
			var frameNum = eventJSON[0];
			var type = eventJSON[1];

			var gameEvent = null;
			switch (true) {
				case (type == "killed" || type == "hit"):
					var causedByInfo = eventJSON[3];
					var victim = entities.getById(eventJSON[2]);
					var causedBy = entities.getById(causedByInfo[0]); // In older captures, this will return null
					var distance = eventJSON[4];

					//console.log(eventJSON[2]);
					//if (victim == null) {return}; // Temp fix until vehicles are handled (victim is null if reference is a vehicle)

					// Create event object
					var weapon;
					if (causedBy instanceof Unit) {
						weapon = causedByInfo[1];
					} else {
						weapon = "N/A";
					}
					gameEvent = new HitKilledEvent(frameNum, type, causedBy, victim, distance, weapon);

					// TODO: Find out why victim/causedBy can sometimes be null
					if (causedBy == null || (victim == null)) {
						console.log(victim);
						console.log(causedBy);
					}

					// Incrememt kill/death count for killer/victim
					if (type == "killed" && (causedBy != null)) {
						if (causedBy != victim) {
							causedBy.killCount++;
						}
						victim.deathCount++;
					}

					// Add tick to timeline
					ui.addTickToTimeline(frameNum);
					break;
				case (type == "connected" || type == "disconnected"):
					gameEvent = new ConnectEvent(frameNum, type, eventJSON[2]);
					break;
				case (type == "endMission"):
					gameEvent = new endMissionEvent(frameNum, type, eventJSON[2][0], eventJSON[2][1]);
					break;
			}
			// Add event to gameEvents list
			if (gameEvent != null) {
				gameEvents.addEvent(gameEvent);
			}
		});


		console.log("Finished processing operation (" + (new Date() - time) + "ms).");
		initMap();
		startPlaybackLoop();
		toggleHitEvents(false);
		// playPause();
		ui.hideModal();
	}).fail(function (xhr, textStatus, error) {
		ui.modalBody.innerHTML = `Error: "${filepath}" failed to load.<br/>${error}.`;
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

function startPlaybackLoop () {
	var killlines = [];
	var firelines = [];

	function playbackFunction () {


		requestAnimationFrame(() => {
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

			entities.getAll().forEach(function playbackEntity (entity) {
				//console.log(entity);
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
			});

			ui.updateTitleSide();

			// Display events for this frame (if any)
			gameEvents.getEvents().forEach(function playbackEvent (event) {

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
			});
			markers.forEach(function playbackMarker (marker) {
				if (ui.markersEnable) {
					marker.manageFrame(playbackFrame);
					marker.hideMarkerPopup(false);
				} else {
					marker.manageFrame(playbackFrame);
					marker.hideMarkerPopup(true);
				}
			});
			// Handle entityToFollow
			if (entityToFollow != null) {
				var pos = entityToFollow.getPosAtFrame(playbackFrame);
				if (pos != null) {
					map.setView(armaToLatLng(pos), map.getZoom());
				} else { // Unit has died or does not exist, unfollow
					entityToFollow.unfollow();
				}
			}
			if (!playbackPaused && !(playbackFrame == endFrame)) {
				playbackFrame++;
			}
			if (playbackFrame == endFrame) {
				playbackPaused = true;
				playPauseButton.style.backgroundPosition = "0 0";
			}
			ui.setMissionCurTime(playbackFrame);
		});

		// Run timeout again (creating a loop, but with variable intervals)
		playbackTimeout = setTimeout(playbackFunction, frameCaptureDelay / playbackMultiplier);
	}

	var playbackTimeout = setTimeout(playbackFunction, frameCaptureDelay / playbackMultiplier);
}
