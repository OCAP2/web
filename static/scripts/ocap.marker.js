// OCAP Marker v2 - Grid pattern debug version
console.log('ocap.marker.js loaded - GridPattern debug version');

// Debug function to find and fix pattern fills - call from console: window.debugPatternFills()
window.debugPatternFills = function() {
	console.log('=== Debugging Pattern Fills ===');

	// Check if Leaflet.pattern override is in place
	if (L.SVG && L.SVG.prototype._superUpdateStyle) {
		console.log('L.SVG._updateStyle override IS in place');
	} else {
		console.log('WARNING: L.SVG._updateStyle override NOT found!');
	}

	// Find all SVG paths in the map
	const svgPaths = document.querySelectorAll('.leaflet-overlay-pane path');
	console.log(`Found ${svgPaths.length} SVG paths`);

	svgPaths.forEach((path, i) => {
		const fill = path.getAttribute('fill');
		console.log(`Path ${i}: fill="${fill}"`);
	});

	// Find all pattern definitions
	const patterns = document.querySelectorAll('pattern');
	console.log(`Found ${patterns.length} patterns:`);
	patterns.forEach(p => {
		console.log(`  Pattern id="${p.id}":`, p.outerHTML.substring(0, 200));
	});

	// Check the defs element
	const defs = document.querySelector('defs');
	if (defs) {
		console.log('Defs element found:', defs.outerHTML.substring(0, 500));
	} else {
		console.log('No defs element found!');
	}
};

// Function to manually apply pattern fills to all markers that need them
window.applyPatternFills = function() {
	console.log('=== Applying Pattern Fills ===');
	if (typeof markers === 'undefined') {
		console.log('markers array not found');
		return;
	}

	let applied = 0;
	markers.forEach((m, i) => {
		if (m._brushPattern && m._marker && m._marker._path) {
			const patternUrl = L.Pattern._getPatternUrl(L.stamp(m._brushPattern));
			console.log(`Marker ${i}: applying pattern ${patternUrl}`);
			m._marker._path.setAttribute('fill', patternUrl);
			applied++;
		}
	});
	console.log(`Applied patterns to ${applied} markers`);
};

// Ensure pattern fills are applied after any style update
// This patches Leaflet's SVG renderer to always check for fillPattern
(function() {
	if (!L.SVG) {
		console.log('L.SVG not found, skipping pattern patch');
		return;
	}

	const originalUpdateStyle = L.SVG.prototype._updateStyle;
	L.SVG.prototype._updateStyle = function(layer) {
		originalUpdateStyle.call(this, layer);

		// Apply fill pattern if present
		if (layer.options && layer.options.fill && layer.options.fillPattern && layer._path) {
			const patternUrl = L.Pattern._getPatternUrl(L.stamp(layer.options.fillPattern));
			layer._path.setAttribute('fill', patternUrl);
		}
	};
	console.log('Patched L.SVG._updateStyle for pattern fills');
})();

// Custom GridPattern for true grid/cross patterns (horizontal + vertical lines)
L.GridPattern = L.Pattern.extend({
	options: {
		weight: 2,
		spaceWeight: 4,
		color: '#000000',
		opacity: 1.0
	},

	_addShapes: function () {
		// Calculate size first
		var w = this.options.weight;
		var s = this.options.spaceWeight;
		var size = w + s;

		console.log(`GridPattern._addShapes: weight=${w}, space=${s}, size=${size}, color=${this.options.color}`);

		// Update pattern dimensions before creating shapes
		this.options.width = size;
		this.options.height = size;

		// Horizontal line
		var hLineD = 'M0 ' + (w / 2) + ' H ' + size;
		this._hLine = new L.PatternPath({
			stroke: true,
			weight: this.options.weight,
			color: this.options.color,
			opacity: this.options.opacity,
			d: hLineD
		});

		// Vertical line
		var vLineD = 'M' + (w / 2) + ' 0 V ' + size;
		this._vLine = new L.PatternPath({
			stroke: true,
			weight: this.options.weight,
			color: this.options.color,
			opacity: this.options.opacity,
			d: vLineD
		});

		console.log(`GridPattern paths: hLine.d="${hLineD}", vLine.d="${vLineD}"`);

		this.addShape(this._hLine);
		this.addShape(this._vLine);

		// After shapes are added, verify DOM
		setTimeout(() => {
			if (this._dom) {
				console.log('GridPattern DOM after addShapes:', this._dom.outerHTML);
			}
		}, 100);
	},

	_update: function () {
		if (!this._hLine || !this._vLine) return;

		var w = this.options.weight;
		var s = this.options.spaceWeight;
		var size = w + s;

		// Update pattern size to fit the grid cell
		this.options.width = size;
		this.options.height = size;

		// Horizontal line at top of cell
		this._hLine.options.d = 'M0 ' + (w / 2) + ' H ' + size;
		// Vertical line at left of cell
		this._vLine.options.d = 'M' + (w / 2) + ' 0 V ' + size;
	},

	setStyle: L.Pattern.prototype.setStyle
});

L.gridPattern = function (options) {
	return new L.GridPattern(options);
};

class Marker {
	constructor(type, text, player, color, startFrame, endFrame, side, positions, size, shape, brush) {
		this._type = type;
		this._typeLower = type.toLowerCase();
		this._text = text;
		this._player = player; // Entity obj
		this._color = `#${color}`; // 00FF00 (hex color)
		this._startFrame = startFrame; // 22
		this._endFrame = endFrame; // 35
		this._side = side; // -1,0,1,2 (int, pairs to global array)
		this._positions = positions;
		// [
		// 	[
		// 		0(frame),
		// 		[
		// 			800(x),
		// 			1200(y),
		// 			[0](z)
		// 		],
		// 		0(dir in compass bearing),
		// 		1(alpha 0-100)
		// 	]
		// ]
		// coords for polylines are in subarray format
		// [
		// 	[
		// 		800(x),
		// 		1200(y)
		// 	],
		// 		600(x),
		// 		900(y)
		// 	]
		// ]
		this._size = size; // [1,1]
		this._shape = shape;
		// "ICON"
		// "RECTANGLE"
		// "ELLIPSE"
		// "POLYLINE"

		if (this._type.search("magIcons") > -1) {
			this._icon = L.icon({ iconSize: [35, 35], iconUrl: `images/markers/${this._typeLower}.png` });
		} else if (!this._shape || !this._size) {
			this._icon = L.icon({ iconSize: [35, 35], iconUrl: `images/markers/${type}/${color}.png` });
		} else if (this._shape == "ICON") {
			this._size = this._size.map(value => {
				return (value * 35);
			});
			this._icon = L.icon({ iconSize: this._size, iconUrl: `images/markers/${type}/${color}.png` });
		} else {
			this._icon = null;
		}

		// "Solid" (default)
		// "SolidFull" (A3 only)
		// "Horizontal"
		// "Vertical"
		// "Grid"
		// "FDiagonal"
		// "BDiagonal"
		// "DiagGrid"
		// "Cross"
		// "Border"
		// "SolidBorder"

		if (!(undefined === brush && undefined === shape)) {
			this._brush = brush;
			console.log(`Marker created: shape=${shape}, brush=${brush}, color=${this._color}`);
			this._brushPattern = null;
			this._brushPatternOptions = null;
			switch (brush) {
				case "solid":
				case "Solid":
					this._shapeOptions = {
						color: this._color,
						stroke: false,
						fill: true,
						fillOpacity: 0.3
					};
					break;
				case "solidfull":
				case "SolidFull":
					this._shapeOptions = {
						color: this._color,
						stroke: false,
						fill: true,
						fillOpacity: 0.8
					};
					break;
				case "horizontal":
				case "Horizontal":
					this._brushPatternOptions = {
						color: this._color,
						opacity: 1,
						angle: 0,
						weight: 2
					};
					this._shapeOptions = {
						color: this._color,
						stroke: false,
						fill: true,
						fillOpacity: 0.2
					};
					break;
				case "vertical":
				case "Vertical":
					this._brushPatternOptions = {
						color: this._color,
						opacity: 1,
						angle: 90,
						weight: 2
					};
					this._shapeOptions = {
						color: this._color,
						stroke: false,
						fill: true,
						fillOpacity: 0.2
					};
					break;
				case "grid":
				case "Grid":
				case "GRID":
					this._brushPatternOptions = {
						color: this._color,
						opacity: 1.0,
						weight: 2,
						spaceWeight: 6
					};
					this._useGridPattern = true; // Use L.GridPattern for true grid
					this._shapeOptions = {
						color: this._color,
						stroke: false,
						fill: true,
						fillOpacity: 0.5
					};
					break;
				case "fdiagonal":
				case "FDiagonal":
					this._brushPatternOptions = {
						color: this._color,
						opacity: 1,
						angle: 315,
						weight: 2,
						spaceWeight: 6
					};
					this._shapeOptions = {
						color: this._color,
						stroke: false,
						fill: true,
						fillOpacity: 0.2
					};
					break;
				case "bdiagonal":
				case "BDiagonal":
					this._brushPatternOptions = {
						color: this._color,
						opacity: 1,
						angle: 45,
						weight: 2,
						spaceWeight: 6
					};
					this._shapeOptions = {
						color: this._color,
						stroke: false,
						fill: true,
						fillOpacity: 0.2
					};
					break;
				case "diaggrid":
				case "DiagGrid":
					this._brushPatternOptions = {
						color: this._color,
						opacity: 0.8,
						angle: 45,
						weight: 1,
						spaceWeight: 3,
						spaceOpacity: 0.0
					};
					this._shapeOptions = {
						color: this._color,
						stroke: false,
						fill: true,
						fillOpacity: 0.2,
					};
					break;
				case "cross":
				case "Cross":
				case "CROSS":
					this._brushPatternOptions = {
						color: this._color,
						opacity: 1.0,
						weight: 2,
						spaceWeight: 6
					};
					this._useGridPattern = true; // Use L.GridPattern for cross pattern
					this._shapeOptions = {
						color: this._color,
						stroke: false,
						fill: true,
						fillOpacity: 0.5
					};
					break;
				case "border":
				case "Border":
					this._shapeOptions = {
						color: this._color,
						stroke: true,
						fill: false,
						fillOpacity: 0
					};
					break;
				case "solidborder":
				case "SolidBorder":
					this._shapeOptions = {
						color: this._color,
						stroke: true,
						fill: true,
						fillOpacity: 0.3
					};
					break;
				default:
					break;
			}

			// Create pattern if brush options were set
			if (this._brushPatternOptions) {
				if (this._useGridPattern) {
					this._brushPattern = new L.GridPattern(this._brushPatternOptions);
					console.log(`GridPattern created for brush=${brush}:`, this._brushPattern);
				} else {
					this._brushPattern = new L.StripePattern(this._brushPatternOptions);
					console.log(`StripePattern created for brush=${brush}:`, this._brushPattern);
				}
			}
		} else {
			this._shapeOptions = {
				color: this._color,
				stroke: false,
				fill: true,
				fillOpacity: 0.3
			};
		}
		this._marker = null;
		this._isShow = false;
		this._popup = "";
		this._popupClassName = "leaflet-popup-unit";
		this._systemMarkers = ["ObjectMarker", "moduleCoverMap", "safeStart"];
	}

	updateRender (f) {
		if (this._shape === "RECTANGLE" || this._shape === "ELLIPSE") {
			const frameIndex = this._markerOnFrame(f);
			if (frameIndex >= 0 && (this._side === ui.currentSide || this._side === "GLOBAL")) {
				this._updateAtFrame(frameIndex);
			}
		}
	}

	removeMarker () {
		let marker = this._marker;
		if (marker != null) {
			marker.remove();
			this._marker = null;
		}
	}

	manageFrame (f) {
		const frameIndex = this._markerOnFrame(f);
		if (frameIndex != null && (this._side === ui.currentSide || this._side === "GLOBAL")) {
			this._updateAtFrame(frameIndex);
		} else {
			// this.hide();
			this.removeMarker();
		}
	}

	_updateAtFrame (f) {
		let frameData = this._positions[f];
		let pos = frameData[1];
		if (pos.length === 1) { pos = pos[0] }
		let dir = frameData[2];
		let alpha = frameData[3];

		if (this._shape === "RECTANGLE" && Array.isArray(pos[0])) {
			console.log("wrong RECTANGLE positions, converting to POLYLINE");
			this._shape = "POLYLINE";
		}

		let latLng;
		let points;
		if (this._marker == null) {
			// console.log(`UPDATE AT FRAME: attempting to create marker ${this._name}`)

			if (this._shape === "ICON") {
				latLng = armaToLatLng(pos);
				if (alpha === undefined || alpha === null) { alpha = 1 }
				this._createMarker(latLng, dir, alpha);
			} else if (this._shape === "ELLIPSE") {
				let centerX = pos[0];
				let centerY = pos[1];
				// Ensure size is valid array, fallback to [100, 100] if not
				let radiusX = (Array.isArray(this._size) && this._size[0]) ? this._size[0] : 100;
				let radiusY = (Array.isArray(this._size) && this._size[1]) ? this._size[1] : 100;

				// Calculate ellipse perimeter points in Arma coordinates
				let pointsRaw = this._calculateEllipsePoints(centerX, centerY, radiusX, radiusY);
				points = pointsRaw.map(coord => {
					return armaToLatLng(coord);
				});

				// Apply rotation around center
				let pointsRotate = this._rotatePoints(armaToLatLng(pos), points, dir);

				if (alpha === undefined || alpha === null) { alpha = 0.2 }
				this._createMarker(pointsRotate, dir, alpha);
			} else if (this._shape === "RECTANGLE") {
				let startX = pos[0];
				let startY = pos[1];
				let sizeX = this._size[0];
				let sizeY = this._size[1];

				let pointsRaw = [
					[startX - sizeX, startY + sizeY], // top left
					[startX + sizeX, startY + sizeY], // top right
					[startX + sizeX, startY - sizeY], // bottom right
					[startX - sizeX, startY - sizeY] // bottom left
				];
				points = pointsRaw.map(coord => {
					return armaToLatLng(coord);
				});
				// let bounds = L.latLngBounds(points);

				// process rotation around center
				let pointsRotate = this._rotatePoints(armaToLatLng(pos), points, dir);

				if (alpha === undefined || alpha === null) { alpha = 0.3 }

				this._createMarker(pointsRotate, dir, alpha);
			} else if (this._shape === "POLYLINE") {
				if (Array.isArray(pos[0])) {
					let simplePoints = L.LineUtil.simplify(pos);
					points = simplePoints.map(coord => {
						return armaToLatLng(coord);
					});
				} else {
					points = armaToLatLng([pos[0], pos[1]])
				}
				if (alpha === undefined || alpha === null) { alpha = 1 }
				this._createMarker(points, dir, alpha);
			}
		} else {
			// console.log(`UPDATE AT FRAME: attempting to update marker ${this._name}`)

			if (this._shape === "ICON") {
				latLng = armaToLatLng(pos);
				if (alpha === undefined || alpha === null) { alpha = 1 }

				this._marker.setRotationAngle(dir);
				this._marker.setLatLng(latLng);
			} else if (this._shape === "ELLIPSE") {
				latLng = armaToLatLng(pos);
				let centerX = pos[0];
				let centerY = pos[1];
				// Ensure size is valid array, fallback to [100, 100] if not
				let radiusX = (Array.isArray(this._size) && this._size[0]) ? this._size[0] : 100;
				let radiusY = (Array.isArray(this._size) && this._size[1]) ? this._size[1] : 100;
				if (alpha === undefined || alpha === null) { alpha = 0.3 }

				// Calculate ellipse perimeter points in Arma coordinates
				let pointsRaw = this._calculateEllipsePoints(centerX, centerY, radiusX, radiusY);
				points = pointsRaw.map(coord => {
					return armaToLatLng(coord);
				});

				// check if update is needed
				let variance = 0;
				try {
					let curMarkerCenter = this._marker.getCenter();
					variance = variance + Math.abs((Math.abs(curMarkerCenter.lat) - Math.abs(latLng.lat)));
					variance = variance + Math.abs((Math.abs(curMarkerCenter.lng) - Math.abs(latLng.lng)));

					// Apply rotation around center
					let pointsRotate = this._rotatePoints(armaToLatLng(pos), points, dir);
					this._marker.setLatLngs(pointsRotate).redraw();
				} catch {
					// If the layer is hidden, this will error because _marker.getCenter() will fail
				}
			} else if (this._shape === "RECTANGLE") {
				latLng = armaToLatLng(pos);
				let startX = pos[0];
				let startY = pos[1];
				let sizeX = this._size[0];
				let sizeY = this._size[1];
				if (alpha === undefined || alpha === null) { alpha = 0.3 }

				let pointsRaw = [
					[startX - sizeX, startY + sizeY], // top left
					[startX + sizeX, startY + sizeY], // top right
					[startX + sizeX, startY - sizeY], // bottom right
					[startX - sizeX, startY - sizeY] // bottom left
				];
				points = pointsRaw.map(coord => {
					return armaToLatLng(coord);
				});
				// let bounds = L.latLngBounds(points);

				// check if update is needed
				let variance = 0;
				try {
					curMarkerCenter = this._marker.getCenter(); variance = variance + Math.abs((Math.abs(curMarkerCenter.lat) - Math.abs(latLng.lat)));
					variance = variance + Math.abs((Math.abs(curMarkerCenter.lng) - Math.abs(latLng.lng)));

					// if (variance > 5) {
					// process rotation around center
					let pointsRotate = this._rotatePoints(armaToLatLng(pos), points, dir);
					this._marker.setLatLngs(pointsRotate).redraw();
				} catch {
					// If the layer is hidden, this will error because _marker.getCenter() will fail, but that's fine, we don't need to update it if it's hidden
				};

				// };
			} else if (this._shape === "POLYLINE") {
				if (alpha === undefined || alpha === null) { alpha = 1 }
				// do nothing, polylines can't be moved
			}

			this.show(alpha);
		}
	}

	_rotatePoints (center, points, yaw) {
		const res = []
		const centerPoint = map.latLngToLayerPoint(center)
		const angle = yaw * (Math.PI / 180)
		for (let i = 0; i < points.length; i++) {
			const p = map.latLngToLayerPoint(points[i])
			// translate to center
			const p2 = new L.Point(p.x - centerPoint.x, p.y - centerPoint.y)
			// rotate using matrix rotation
			const p3 = new L.Point(Math.cos(angle) * p2.x - Math.sin(angle) * p2.y, Math.sin(angle) * p2.x + Math.cos(angle) * p2.y)
			// translate back to center
			let p4 = new L.Point(p3.x + centerPoint.x, p3.y + centerPoint.y)
			// done with that point
			p4 = map.layerPointToLatLng(p4)
			res.push(p4)
		}
		return res
	}

	// Calculate ellipse perimeter points in Arma coordinates
	// cx, cy: center position in Arma meters
	// rx, ry: radii in Arma meters (from markerSize)
	// Returns array of [x, y] points in Arma coordinates
	_calculateEllipsePoints (cx, cy, rx, ry, numPoints = 36) {
		const points = [];
		for (let i = 0; i < numPoints; i++) {
			const angle = (i / numPoints) * 2 * Math.PI;
			const x = cx + rx * Math.cos(angle);
			const y = cy + ry * Math.sin(angle);
			points.push([x, y]);
		}
		return points;
	}

	isMagIcon () {
		if (
			// projectiles
			(
				this._type.search("magIcons") > -1 ||
				this._type === "Minefield" ||
				this._type === "mil_triangle"
			) &&
			this._side === "GLOBAL"
		) { return true } else { return false };
	}

	hide () {
		// if (this._isShow == true) {
		this._isShow = false;
		this.setMarkerOpacity(0);
		this.hideMarkerPopup(true);
		// };
	}

	show (alpha) {
		this._isShow = true;
		if (this._shape == "ICON") {
			this.setMarkerOpacity(alpha);
		} else if (this._shape == "ELLIPSE") {
			this.setMarkerOpacity(alpha);
		} else if (this._shape == "RECTANGLE") {
			this.setMarkerOpacity(alpha);
		} else if (this._shape == "POLYLINE") {
			this.setMarkerOpacity(alpha);
		}
	}

	_createMarker (latLng, dir, alpha) {
		let marker;
		let popupText = "";

		if ((this._player === -1 || this._player === false) && this._shape === "ICON") {
			// objNull passed, no owner. system marker with basic popup

			let markerCustomText = "";
			if (this._text) { markerCustomText = this._text.encodeHTMLEntities(); }

			marker = L.marker(latLng, { icon: this._icon, interactive: false, rotationOrigin: "50% 50%" })
			marker.addTo(systemMarkersLayerGroup);

			if (markerCustomText != "") {
				let popup = this._createPopup(markerCustomText);
				marker.bindPopup(popup).openPopup();
			};

			// Set direction
			marker.setRotationAngle(dir);

		} else if (this._player instanceof Unit && this._shape === "ICON") {
			let interactiveVal = false;

			let markerCustomText = "";
			if (this._text) { markerCustomText = this._text.encodeHTMLEntities(); }

			if (
				// objectives
				markerCustomText.search("Terminal") > -1 ||
				markerCustomText.search("Sector") > -1
			) {
				popupText = markerCustomText;
			} else if (
				// map borders & custom objects
				this._systemMarkers.includes(this._type) &&
				this._side === "GLOBAL"
			) {
				// console.log("system marker")
			} else if (
				// projectiles
				(
					this._type.search("magIcons") > -1 ||
					this._type === "Minefield" ||
					this._type === "mil_triangle"
				) &&
				this._side === "GLOBAL"
			) {
				popupText = `${this._player.getName().encodeHTMLEntities()} ${markerCustomText}`;
			} else if (this._side === "GLOBAL") {
				popupText = markerCustomText;
			} else {
				// all normal player marks
				interactiveVal = true;
				popupText = `${this._side} ${this._player.getName().encodeHTMLEntities()} ${markerCustomText}`;
			}

			marker = L.marker(latLng, { icon: this._icon, interactive: interactiveVal, rotationOrigin: "50% 50%" })
			if (
				// projectiles
				(
					this._type.search("magIcons") > -1 ||
					this._type === "Minefield" ||
					this._type === "mil_triangle"
				) &&
				this._side === "GLOBAL"
			) {
				marker.addTo(projectileMarkersLayerGroup);
			} else if (this._player instanceof Unit) {
				marker.addTo(markersLayerGroup);
			} else {
				marker.addTo(systemMarkersLayerGroup);
			}
			let popup = this._createPopup(popupText);
			marker.bindPopup(popup).openPopup();

			// Set direction
			marker.setRotationAngle(dir);
		}

		if (this._shape === "ELLIPSE") {
			// latLng now contains polygon points (calculated in _updateAtFrame)
			let polygonOptions = Object.assign({}, this._shapeOptions, { noClip: false, interactive: false });
			let patternUrl = null;
			if (this._brushPattern) {
				this._brushPattern.addTo(map);
				polygonOptions.fillPattern = this._brushPattern;
				patternUrl = L.Pattern._getPatternUrl(L.stamp(this._brushPattern));
				console.log(`ELLIPSE with pattern - patternUrl:`, patternUrl);
			}
			marker = L.polygon(latLng, polygonOptions);

			// Apply pattern fill by hooking into the layer's rendering
			if (patternUrl) {
				marker._customPatternUrl = patternUrl;
				// Set up 'add' listener BEFORE calling addTo
				marker.on('add', function() {
					console.log('ELLIPSE add event fired, _path:', !!this._path);
					// The path might not exist yet, use a small delay
					setTimeout(() => {
						if (this._path) {
							console.log('Applying pattern fill (from add event):', this._customPatternUrl);
							this._path.setAttribute('fill', this._customPatternUrl);
						}
					}, 10);
				});
			}

			marker.addTo(systemMarkersLayerGroup);

			// Also try applying immediately after addTo
			if (patternUrl && marker._path) {
				console.log('Applying pattern fill (immediate):', patternUrl);
				marker._path.setAttribute('fill', patternUrl);
			}
		} else if (this._shape === "RECTANGLE") {
			let polygonOptions = Object.assign({}, this._shapeOptions, { noClip: false, interactive: false });
			let patternUrl = null;
			if (this._brushPattern) {
				this._brushPattern.addTo(map);
				polygonOptions.fillPattern = this._brushPattern;
				patternUrl = L.Pattern._getPatternUrl(L.stamp(this._brushPattern));
			}
			marker = L.polygon(latLng, polygonOptions);

			// Apply pattern fill by hooking into the layer's rendering
			if (patternUrl) {
				marker._customPatternUrl = patternUrl;
				marker.on('add', function() {
					setTimeout(() => {
						if (this._path) {
							this._path.setAttribute('fill', this._customPatternUrl);
						}
					}, 10);
				});
			}

			marker.addTo(systemMarkersLayerGroup);

			if (patternUrl && marker._path) {
				marker._path.setAttribute('fill', patternUrl);
			}
		} else if (this._shape === "POLYLINE") {
			marker = L.polyline(latLng, { color: this._color, opacity: 1, noClip: true, lineCap: 'butt', lineJoin: 'round', interactive: false })

			if (this._player === -1 || this._player === false) {
				marker.addTo(systemMarkersLayerGroup)
			} else {
				marker.addTo(markersLayerGroup);
			}
		}

		this._marker = marker;
		this.show(alpha);

	}

	_createPopup (content) {
		let popup = L.popup({
			autoPan: false,
			autoClose: false,
			closeButton: false,
			className: this._popupClassName
		});
		popup.setContent(content);
		return popup;
	}

	_markerOnFrame (f) {
		if (this._startFrame <= f && this._endFrame >= f) {
			let index = null;
			let startIndex = 0;
			let lastIndex = this._positions.length - 1;
			let lastLength;
			do {
				lastLength = lastIndex - startIndex + 1;
				index = Math.floor((lastIndex - startIndex) / 2) + startIndex;
				if (this._positions[index][0] > f) {
					lastIndex = index - 1;
				} else {
					startIndex = index;
				}
			} while (lastLength != (lastIndex - startIndex + 1));
			return lastIndex;
		}
		if (this._startFrame <= f && this._endFrame == -1) {
			return this._positions.length - 1;
		}
		return
	}

	setMarkerOpacity (opacity) {
		if (this._marker != null) {
			let strokeOpacity = 1;
			let fillOpacity = 1;
			if (opacity > 0) {
				if (this._shapeOptions) {
					if (this._shapeOptions.stroke === true) {
						strokeOpacity = 1;
					} else {
						strokeOpacity = 0;
					}
					if (this._shapeOptions.fill === true) {
						fillOpacity = Math.min(this._shapeOptions.fillOpacity, opacity);
					} else {
						fillOpacity = 0;
					}
				} else {
					strokeOpacity = opacity + 0.3;
					fillOpacity = opacity;
				}
			} else {
				strokeOpacity = 0;
				fillOpacity = 0;
			}
			if (this._shape == "ICON") {
				this._marker.setOpacity(opacity);
				// let popup = this._marker.getPopup();
				// if (popup != null) {
				// 	if (opacity > 0) { popup.openPopup() } else { this.hideMarkerPopup(true) };
				// }
			} else if (this._shape == "ELLIPSE") {
				this._marker.setStyle({ opacity: strokeOpacity, fillOpacity: fillOpacity });
			} else if (this._shape == "RECTANGLE") {
				this._marker.setStyle({ opacity: strokeOpacity, fillOpacity: fillOpacity });
			} else if (this._shape == "POLYLINE") {
				this._marker.setStyle({ opacity: opacity });
			}
		}
	}

	hideMarkerPopup (bool) {
		if (!this._marker) return;
		let popup = this._marker.getPopup();
		if (popup == null) { return }

		let element = popup.getElement();
		if (element) {
			let display = "inherit";
			if (bool) { display = "none" }

			if (element.style.display !== display) {
				element.style.display = display;
			}
		}
		return true;
	}
}
