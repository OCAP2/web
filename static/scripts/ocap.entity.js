class Entity {
	constructor(startFrameNum, id, name, positions) {
		this._startFrameNum = startFrameNum;
		this._id = id;
		this._name = name;
		this._positions = positions; // pos, dir, alive
		this._marker = null;
		this.iconType = icons.unknown;
		this._realIcon = icons.unknown.dead;
		this._curIcon = icons.unknown.dead;
		this._tempIcon = icons.unknown.dead;
		this._lockMarkerIcon = false; // When true, prevent marker icon from being changed
		this._element = null; // DOM element associated with this entity
		this._alive = 0;
		this._sideColour = "#000000";
		this._markerRotationOrigin = "50% 50%";
		this._popupClassName = "";
	};

	// Correct index by taking into account startFrameNum.
	// e.g. If requested frame is 31, and entity startFrameNum is 30,
	// then relative frame index is 1 (31-30).
	// If relative index is < 0, then entity doesn't exist yet
	getRelativeFrameIndex(f) {
		return (f - this._startFrameNum);
	};

	getPosAtFrame(f) {
		f = this.getRelativeFrameIndex(f);

		var notExistYet = f < 0; // Unit doesn't exist yet
		var notExistAnymore = f >= (this._positions.length); // Unit dead/doesn't exist anymore
		if (notExistYet || notExistAnymore) {
			return;
		} else {
			return this._positions[f].position;
		}
	};

	// Get LatLng at specific frame
	getLatLngAtFrame(f) {
		var pos = this.getPosAtFrame(f);
		if (pos != null) { return armaToLatLng(pos) }
		return;
	};

	// Get LatLng at current frame
	getLatLng() {
		return this.getLatLngAtFrame(playbackFrame);
	};

	getMarker() {
		return this._marker;
	};

	setElement(el) {
		this._element = el;
	};

	getElement() {
		return this._element;
	};

	getName() {
		return this._name;
	};

	getId() {
		return this._id;
	};

	_createPopup(content) {
		let popup = L.popup({
			autoPan: false,
			autoClose: false,
			closeButton: false,
			className: this._popupClassName
		});
		popup.setContent(content);
		return popup;
	};

	createMarker(latLng) {
		let marker = L.marker(latLng).addTo(map);
		marker.setIcon(this._realIcon);
		marker.setRotationOrigin(this._markerRotationOrigin);
		this._marker = marker;
	};

	// TODO: Optimise this. No need to remove marker (and recreate it later).
	// 		 Instead, hide marker and then unhide it later when needed again
	// Remove marker if exists
	removeMarker() {
		let marker = this._marker;
		if (marker != null) {
			map.removeLayer(marker);
			this._marker = null;
		}
	};

	/*	getMarkerEditableGroup() {
			let doc = this._marker.getElement().contentDocument;
			return doc.getElementById("editable");
		};

		setMarkerColour(colour) {
			let g = this.getMarkerEditableGroup();

			// May be null if not loaded yet
			if (g != null) {
				g.style.fill = colour;
			};
		};*/

	setMarkerIcon(icon) {
		if (this._marker) {
			this._marker.setIcon(icon);
		}
		if (this._curIcon) {
			this._curIcon = icon;
		}
	};

	setMarkerOpacity(opacity) {
		this._marker.setOpacity(opacity);

		let popup = this._marker.getPopup();
		if (popup != null) {
			popup.getElement().style.opacity = opacity;
		}
	};

	hideMarkerPopup(bool) {
		let popup = this._marker.getPopup();
		if (popup == null) { return }

		let element = popup.getElement();
		let display = "inherit";
		if (bool || !ui.nicknameEnable) { display = "none" }

		if (element.style.display != display) {
			element.style.display = display;
		}
	};

	removeElement() {
		this._element.parentElement.removeChild(this._element);
		this._element = null;
	};

	// Does entity now exist (for the first time) at relativeFrameIndex
	_existFirstTime(relativeFrameIndex) {
		return (relativeFrameIndex == 0);
	};

	// Does entity exist yet (not connected/hasn't spawned) at relativeFrameIndex
	_notExistYet(relativeFrameIndex) {
		return (relativeFrameIndex < 0);
	};

	// Does entity exist anymore (disconnected/garbage collected) at relativeFrameIndex
	_notExistAnymore(relativeFrameIndex) {
		return (relativeFrameIndex >= this._positions.length);
	};

	// Is relativeFrameIndex out of bounds
	isFrameOutOfBounds(relativeFrameIndex) {
		return ((this._notExistYet(relativeFrameIndex)) || (this._notExistAnymore(relativeFrameIndex)));
	};

	// Update entiy position, direction, and alive status at valid frame
	_updateAtFrame(relativeFrameIndex) {
		// Set pos
		let latLng = armaToLatLng(this._positions[relativeFrameIndex].position);
		if (this._marker == null) { // First time unit has appeared on map
			this.createMarker(latLng);
		} else {
			this._marker.setLatLng(latLng);
		}

		// Set direction
		this._marker.setRotationAngle(this._positions[relativeFrameIndex].direction);

		//Hide popup
		this.hideMarkerPopup(ui.hideMarkerPopups);

		// Set alive status
		this.setAlive(this._positions[relativeFrameIndex].alive);

	};

	// Manage entity at given frame
	manageFrame(f) {
		f = this.getRelativeFrameIndex(f);

		if (this.isFrameOutOfBounds(f)) { // Entity does not exist on frame
			this.removeMarker();
		} else {
			this._updateAtFrame(f)
		}
	};

	_flash(icon, framesToSpan) {
		this.setMarkerIcon(icon);
		this._lockMarkerIcon = true;
		setTimeout(() => {
			//this._marker.setIcon(this._tempIcon);
			this._lockMarkerIcon = false;
		}, (frameCaptureDelay / playbackMultiplier) * framesToSpan);
	};

	flashHit() {
		this._flash(this.iconType.hit, 3);
	};

	flashHighlight() {
		this._flash(this.iconType.follow, 6);
	};

	setAlive(alive) {
		switch (alive) {
			case 0:
				let icon = this.iconType.dead;
				this._alive = alive;

				if (this._curIcon != icon) {
					this.setMarkerIcon(icon);
				}
				this._tempIcon = (icon);
				this.setMarkerOpacity(0.4);
				break;
			case 1:
				this._alive = alive;
				//console.log(this._marker);
				if ((!this._lockMarkerIcon) && (this._curIcon != this._realIcon)) {
					this.setMarkerIcon(this._realIcon);
				}
				this.setMarkerOpacity(1);
				break;
			case 2:
				if ((!this._lockMarkerIcon) && (this._curIcon != this.iconType.unconscious)) {
					this.setMarkerIcon(this.iconType.unconscious);
				}
				this.setMarkerOpacity(1);
				break;
			default:
				break;
		}
	};

	// Change unit's marker colour (highlight) and set as entity to follow
	follow() {
		/*
		this._lockMarkerIcon = true; // Prevent marker colour from being changed
		if (entityToFollow != null) { entityToFollow.unfollow() }; // Unfollow current followed entity (if any)

		let icon = this.iconType.follow;
		this.setMarkerIcon(icon);
		this._tempIcon = icon;
		*/
		entityToFollow = this;
	};

	// Reset unit's marker colour and clear entityToFollow
	unfollow() {
		/*
		this._lockMarkerIcon = false;

		let marker = this.getMarker();
		if (marker != null) {
			this.setMarkerIcon(this._tempIcon);
		};
		*/
		entityToFollow = null;
	};
}
