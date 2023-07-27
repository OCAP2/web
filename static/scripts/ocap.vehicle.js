class Vehicle extends Entity {
	constructor(startFrameNum, id, type, name, positions) {
		super(startFrameNum, id, name, positions);
		this._popupClassName = "leaflet-popup-vehicle";
		this._type = type;
		this._crew = []; // Crew in order: [driver,gunner,commander,turrets,cargo]

		let iconType = null;
		switch (type) {
			case "sea":
				iconType = icons.ship;
				break;
			case "parachute":
				iconType = icons.parachute;
				break;
			case "heli":
				iconType = icons.heli;
				break;
			case "plane":
				iconType = icons.plane;
				break;
			case "truck":
				iconType = icons.truck;
				break;
			case "car":
				iconType = icons.car;
				break;
			case "apc":
				iconType = icons.apc;
				break;
			case "tank":
				iconType = icons.tank;
				break;
			case "static-mortar":
				iconType = icons.unknown; // TODO
				break;
			case "static-weapon":
				iconType = icons.unknown; // TODO
				break;
			default:
				iconType = icons.unknown;
		}

		this.iconType = iconType;
		this._realIcon = iconType.dead;
		this._tempIcon = iconType.dead;

		this._positionsHasFrames = (positions.length > 0 && !!positions[0].frames);
	}

	createMarker (latLng) {
		super.createMarker(latLng);

		let popup = this._createPopup(this._name);
		this._marker.bindPopup(popup).openPopup();

		// Wait until popup loads, set permanent size
		var checkPopupLoad = setInterval(() => {
			if (popup._contentNode != null) {
				popup._contentNode.style.width = "200px";
				clearInterval(checkPopupLoad);
			}
		}, 100);

		// Add vehicle name tooltip on marker hover
		/*		let markerEl = this._marker.getElement();
				markerEl.addEventListener("mouseover", (event) => {
					ui.cursorTargetBox.textContent = this._name;
					ui.showCursorTooltip(this._name);
				});*/
	}

	_updateAtFrame (relativeFrameIndex) {
		super._updateAtFrame(relativeFrameIndex);

		const position = this.getPosAtFrame(relativeFrameIndex);
		if (!position || position === undefined) return;
		this.setCrew(position.crew);
	}

	setCrew (crew) {
		let content = "";
		if (ui.nicknameEnable) {
			this._crew = crew;
			// this._marker.getPopup().setContent(`Test`); // Very slow (no need to recalc layout), use ._content instead

			let crewLength = crew.length;
			content = `${this._name.encodeHTMLEntities()} <i>(0)</i>`;
			if (crewLength > 0) {
				let crewLengthString = `<i>(${crewLength})</i>`;
				let crewString = this.getCrewString();

				if (crewString.length > 0) {
					let title = `<u>${this._name.encodeHTMLEntities()}</u> ${crewLengthString}`;
					content = `${title}<br>${crewString}`;
				} else {
					content = `${this._name.encodeHTMLEntities()} ${crewLengthString}`;
				}

				// Change vehicle icon depending on driver's side
				let driverId = crew[0];
				let driver = entities.getById(driverId);
				let icon = this.iconType[driver.sideClass];
				if (this._realIcon !== icon) {
					this.setMarkerIcon(icon);
					this._realIcon = icon; // Vehicle icon will now remain this colour until a unit of a differet side becomes driver
				}
			}
		}
		let popup = this._marker.getPopup();
		if (popup) {
			// let popupContent = popup._content;

			// if (popupContent !== content) {
			// 	popupContent = content;
			// }
			popup.setContent(content);
		}

	}

	getCrew () {
		return this._crew;
	}

	getCrewString () {
		if (this._crew.length === 0) { return " " }

		let str = "";
		this._crew.forEach(function (unitId) {
			//if (unitId != -1) {
			let unit = entities.getById(unitId);

			// Only include player names
			// if (unit.isPlayer) {
			str += (unit.getName().encodeHTMLEntities() + "<br/>");
			// }
			//};
		});
		return str;
	}

	// If vehicle has crew, return side colour of 1st crew member. Else return black.
	getSideColour () {
		let crew = this._crew;
		if (crew.length > 0) {
			return entities.getById(crew[0]).getSideColour();
		} else {
			return "black";
		}
	}
}
