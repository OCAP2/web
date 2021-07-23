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

			var brushPattern;
			if (["Cross", "Grid", "DiagGrid"].includes(brush)) {
				// var patternShape = new L.PatternPath({ d: 'M10 0 L7 20 L25 20 Z', fill: true });
				// brushPattern = new L.Pattern({
				// 	patternUnits: "objectBoundingBox",
				// 	patternContentUnits: "objectBoundingBox",
				// 	color: this._color,
				// 	opacity: 1
				// });
				// brushPattern.addShape(patternShape);
				brushPattern = new L.StripePattern({ renderer: L.svg() });
			} else if (["Horizontal", "Vertical", "FDiagonal", "BDiagonal"].includes(brush)) {
				brushPattern = new L.StripePattern({ renderer: L.svg() });
			}
			this._brushPattern = brushPattern;
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
						fillOpacity: 1
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
						fillOpacity: 1
					};
					break;
				case "grid":
				case "Grid":
					this._brushPatternOptions = {
						color: this._color,
						opacity: 0.8,
						angle: 90,
						weight: 1,
						spaceWeight: 1
					};
					this._shapeOptions = {
						color: this._color,
						stroke: false,
						fill: true,
						fillOpacity: 1
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
						fillOpacity: 1
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
						fillOpacity: 1
					};
					break;
				case "diaggrid":
				case "DiagGrid":
					this._brushPatternOptions = {
						color: this._color,
						opacity: 0.8,
						angle: 45,
						weight: 1,
						spaceWeight: 1
					};
					this._shapeOptions = {
						color: this._color,
						stroke: false,
						fill: true,
						fillOpacity: 1,
					};
					break;
				case "cross":
				case "Cross":
					this._brushPatternOptions = {
						color: this._color,
						opacity: 0.8,
						angle: 90,
						weight: 1,
						spaceWeight: 1
					};
					this._shapeOptions = {
						color: this._color,
						stroke: false,
						fill: true,
						fillOpacity: 1
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
	};

	manageFrame (f) {
		let frameIndex = this._markerOnFrame(f);
		if (frameIndex != null && (this._side == ui.currentSide || this._side == "GLOBAL")) {
			this._updateAtFrame(frameIndex);
		} else {
			this.hide();
		}
		return;
	}

	_updateAtFrame (f) {
		let frameData = this._positions[f];
		let pos = frameData[1];
		if (pos.length == 1) { pos = pos[0] }
		let dir = frameData[2];
		let alpha = frameData[3];

		if (this._shape == "RECTANGLE" && Array.isArray(pos[0])) {
			console.warn("wrong RECTANGLE positions, converting to POLYLINE");
			this._shape = "POLYLINE";
		}

		let latLng;
		let points;
		if (this._marker == null) {
			// console.debug(`UPDATE AT FRAME: attempting to create marker ${this._name}`)

			if (this._shape == "ICON") {
				latLng = armaToLatLng(pos);
				if (null == alpha || alpha == 0) { alpha = 1 }
				this._createMarker(latLng, dir, alpha);
			} else if (this._shape == "ELLIPSE") {
				latLng = armaToLatLng(pos);
				if (null == alpha || alpha == 0) { alpha = 0.2 }
				this._createMarker(latLng, dir, alpha);
			} else if (this._shape == "RECTANGLE") {
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

				if (null == alpha || alpha == 0) { alpha = 0.3 }

				this._createMarker(pointsRotate, dir, alpha);
			} else if (this._shape == "POLYLINE") {
				if (Array.isArray(pos[0])) {
					let simplePoints = L.LineUtil.simplify(pos);
					points = simplePoints.map(coord => {
						return armaToLatLng(coord);
					});
				} else {
					points = armaToLatLng([pos[0], pos[1]])
				}
				if (null == alpha || alpha == 0) { alpha = 1 }
				this._createMarker(points, dir, alpha);
			}

		} else {
			// console.debug(`UPDATE AT FRAME: attempting to update marker ${this._name}`)

			if (this._shape == "ICON") {
				latLng = armaToLatLng(pos);
				if (null === alpha || alpha == 0) { alpha = 1 }

				this._marker.setRotationAngle(dir);
				this._marker.setLatLng(latLng);
			} else if (this._shape == "ELLIPSE") {
				latLng = armaToLatLng(pos);
				if (null === alpha || alpha == 0) { alpha = 0.3 }

				// check if update is needed
				let variance = 0;
				let curMarkerCenter = this._marker._latlng;
				variance = variance + Math.abs((Math.abs(curMarkerCenter.lat) - Math.abs(latLng.lat)));
				variance = variance + Math.abs((Math.abs(curMarkerCenter.lng) - Math.abs(latLng.lng)));

				// if (variance > 5) {
				this._marker.setLatLng(latLng).redraw();
				// };
			} else if (this._shape == "RECTANGLE") {
				latLng = armaToLatLng(pos);
				let startX = pos[0];
				let startY = pos[1];
				let sizeX = this._size[0];
				let sizeY = this._size[1];
				if (null === alpha || alpha == 0) { alpha = 0.3 }

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
				let curMarkerCenter = this._marker.getCenter();
				variance = variance + Math.abs((Math.abs(curMarkerCenter.lat) - Math.abs(latLng.lat)));
				variance = variance + Math.abs((Math.abs(curMarkerCenter.lng) - Math.abs(latLng.lng)));

				// if (variance > 5) {
				// process rotation around center
				let pointsRotate = this._rotatePoints(armaToLatLng(pos), points, dir);
				this._marker.setLatLngs(pointsRotate).redraw();
				// };
			} else if (this._shape == "POLYLINE") {
				if (null === alpha || alpha == 0) { alpha = 1 }
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

	hide () {
		// if (this._isShow == true) {
		this._isShow = false;
		this.setMarkerOpacity(0);
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
			marker = L.marker(latLng, { icon: this._icon, interactive: false, rotationOrigin: "50% 50%" }).addTo(map);
			let popup = this._createPopup(markerCustomText);
			marker.bindPopup(popup).openPopup();

			// Set direction
			marker.setRotationAngle(dir);

		} else if (this._shape === "ICON") {
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

			marker = L.marker(latLng, { icon: this._icon, interactive: interactiveVal, rotationOrigin: "50% 50%" }).addTo(map);
			let popup = this._createPopup(popupText);
			marker.bindPopup(popup).openPopup();

			// Set direction
			marker.setRotationAngle(dir);
		}

		if (this._shape === "ELLIPSE") {
			let rad = this._size[0] * 0.015 * window.multiplier;

			if (this._brushPattern) {
				L.Util.setOptions(this._brushPattern, this._brushPatternOptions);
				this._brushPattern.addTo(map);
				marker = L.circle(latLng, { radius: rad, noClip: false, interactive: false, fillPattern: this._brushPattern });
				L.Util.setOptions(marker, this._shapeOptions);
			} else {
				marker = L.circle(latLng, { radius: rad, noClip: false, interactive: false/* , renderer: L.canvas() */ });
				L.Util.setOptions(marker, this._shapeOptions);
			}
			marker.addTo(map);
		} else if (this._shape === "RECTANGLE") {

			if (this._brushPattern) {
				L.Util.setOptions(this._brushPattern, this._brushPatternOptions);
				this._brushPattern.addTo(map);
				marker = L.polygon(latLng, { noClip: false, interactive: false, fillPattern: this._brushPattern });
				L.Util.setOptions(marker, this._shapeOptions);
			} else {
				marker = L.polygon(latLng, { noClip: false, interactive: false/* , renderer: L.canvas() */ });
				L.Util.setOptions(marker, this._shapeOptions);
			}
			marker.addTo(map);
		} else if (this._shape === "POLYLINE") {
			marker = L.polyline(latLng, { color: this._color, opacity: 1, noClip: true, lineCap: 'butt', lineJoin: 'round', interactive: false }).addTo(map);
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
				let popup = this._marker.getPopup();
				if (popup != null) {
					popup.getElement().style.opacity = opacity;
				}
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
		if (this._marker != null) {
			let popup = this._marker.getPopup();
			if (popup == null) { return }

			let element = popup.getElement();
			let display = "inherit";
			if (bool) { display = "none" }

			if (element.style.display != display) {
				element.style.display = display;
			}
		}
	}
}
