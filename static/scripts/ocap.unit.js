class Unit extends Entity {
	constructor(startFrameNum, id, name, group, side, isPlayer, positions, framesFired) {
		super(startFrameNum, id, name, positions);
		this._group = group;
		this._side = side;
		this.isPlayer = isPlayer;
		this._framesFired = framesFired;
		this.killCount = 0;
		this.deathCount = 0;
		this._sideClass = "";
		this._sideColour = "#FFFFFF";
		this._isInVehicle = false;
		this.iconType = icons.man;
		this._popupClassName = "leaflet-popup-unit";

		// Set colour and icon of unit depeneding on side
		let sideClass = "";
		let sideColour = "";
		switch (this._side) {
			case "WEST":
				sideClass = "blufor";
				sideColour = "#004d99";
				break;
			case "EAST":
				sideClass = "opfor";
				sideColour = "#800000";
				break;
			case "GUER":
				sideClass = "ind";
				sideColour = "#007f00";
				break;
			case "CIV":
				sideClass = "civ";
				sideColour = "#650080";
				break;
		}

		this._sideClass = sideClass;
		this._sideColour = sideColour;
		this._realIcon = this.iconType[sideClass];
		this._tempIcon = this.iconType[sideClass];
		this._markerRotationOrigin = "50% 60%";
	};

	updateName(position) {
		let content = "";
		let name = position.name;
		if (position.isPlayer == 0) {
			name += ' [AI]';
		}
		if (this._name != name) {
			this._name = name;
			this._element.textContent = name + " (" + this.killCount.toString() + ")";
			this._marker.getPopup()._contentNode.innerHTML = name;
		}
	};

	createMarker(latLng) {
		super.createMarker(latLng);

		// Only create a nametag label (popup) for players
		let popup;
		if (this.isPlayer) {
			popup = this._createPopup(this._name);
		} else {
			popup = this._createPopup(this._name + " <b>[AI]</b>");
		}
		this._marker.bindPopup(popup).openPopup();
	};

	_updateAtFrame(relativeFrameIndex) {
		super._updateAtFrame(relativeFrameIndex);
		this.setIsInVehicle(this._positions[relativeFrameIndex].isInVehicle);
		this.addCountList(this);
		this.updateName(this._positions[relativeFrameIndex]);
	};

	setIsInVehicle(isInVehicle) {
		this._isInVehicle = isInVehicle;

		if (isInVehicle) {
			this.setMarkerOpacity(0);
		}/* else {
			this.setMarkerOpacity(1);
		}*/
	};

	get sideClass() { return this._sideClass };

	// Check if unit fired on given frame
	// If true, return position of projectile impact
	firedOnFrame(f) {
		for (let i = 0; i < (this._framesFired.length - 1); i++) {
			let frameNum = this._framesFired[i][0];
			let projectilePos = this._framesFired[i][1];
			if (frameNum == f) { return projectilePos }
		}
		return;
	};

	remove() {
		super.remove();
		this._group.removeUnit(this);
	};

	getSide() {
		return this._side;
	};

	makeElement(liTarget) { // Make and add element to UI target list
		let liUnit = document.createElement("li");
		liUnit.className = "liUnit";
		liUnit.textContent = this._name + " (" + this.killCount.toString() + ")";
		liUnit.addEventListener("click", () => {
			let marker = this.getMarker();
			if (marker != null) {
				map.setView(marker.getLatLng(), map.getZoom(), { animate: true });
				this.follow();
			}
		});
		this.setElement(liUnit);
		liTarget.appendChild(liUnit);
	};

	getSideColour() { return this._sideColour };

	getSideClass() { return this._sideClass };

	setAlive(alive) {
		super.setAlive(alive);
		this._group.addUnit(this);
		switch (alive) {
			case 0:
				this._element.style.opacity = 0.4;
				break;
			case 1:
            	this._element.style.opacity = 1;
				break;
			case 2:
				this._element.style.opacity = 0.8;
				break;
			default:
				break;
		}
	};

	addCountList(unit) {
		let side = unit._side;
		if (unit._alive != 1) {return}
		switch (side) {
			case "WEST":
				countWest ++;
				break;
			case "EAST":
				countEast ++;
				break;
			case "GUER":
				countGuer ++;
				break;
			case "CIV":
				countCiv ++;
				break;
			default:
				break;
		}
	};
}
