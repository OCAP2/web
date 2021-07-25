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
		this._restoreAnimation = false;
		this._positionsHasFrames = false;
	}

	// Correct index by taking into account startFrameNum.
	// e.g. If requested frame is 31, and entity startFrameNum is 30,
	// then relative frame index is 1 (31-30).
	// If relative index is < 0, then entity doesn't exist yet
	getRelativeFrameIndex(f) {
		return (f - this._startFrameNum);
	}

	getPosAtFrame(relativeFrameIndex) {
		if (!this._notExistYet(relativeFrameIndex) && !this._notExistAnymore(relativeFrameIndex)) {
			if (this._positionsHasFrames) {
				return this._positions.find((position) => {
					return relativeFrameIndex >= (position.frames[0] - this._startFrameNum) && relativeFrameIndex <= (position.frames[1] - this._startFrameNum);
				});
			} else {
				return this._positions[relativeFrameIndex];
			}
		}
	}

	// Get LatLng at specific frame
	getLatLngAtFrame(f) {
		const relativeFrameIndex = this.getRelativeFrameIndex(f);
		const pos = this.getPosAtFrame(relativeFrameIndex);
		if (pos) { return armaToLatLng(pos.position) }
		return;
	}

	// Get LatLng at current frame
	getLatLng() {
		return this.getLatLngAtFrame(playbackFrame);
	}

	getMarker() {
		return this._marker;
	}

	setElement(el) {
		this._element = el;
	}

	getElement() {
		return this._element;
	}

	getName() {
		return this._name;
	}

	getId() {
		return this._id;
	}

	_createPopup(content) {
		let popup = L.popup({
			autoPan: false,
			autoClose: false,
			closeButton: false,
			className: this._popupClassName
		});
		popup.setContent(content);
		return popup;
	}

	createMarker(latLng) {
		this._marker = L.marker(latLng, {
			icon: this._realIcon,
			rotationOrigin: this._markerRotationOrigin
		});
		this._marker.addTo(map);
	}

	// TODO: Optimise this. No need to remove marker (and recreate it later).
	// 		 Instead, hide marker and then unhide it later when needed again
	// Remove marker if exists
	removeMarker() {
		let marker = this._marker;
		if (marker != null) {
			map.removeLayer(marker);
			this._marker = null;
			this.remove();
		}
	}

	// NOOP
	remove() {}

	/*
	getMarkerEditableGroup() {
		let doc = this._marker.getElement().contentDocument;
		return doc.getElementById("editable");
	};

	setMarkerColour(colour) {
		let g = this.getMarkerEditableGroup();

		// May be null if not loaded yet
		if (g != null) {
			g.style.fill = colour;
		};
	};
	*/

	setMarkerIcon(icon) {
		if (this._marker) {
			this._marker.setIcon(icon);
		}
		if (this._curIcon) {
			this._curIcon = icon;
		}
	}

	setMarkerOpacity(opacity) {
		this._marker.setOpacity(opacity);

		let popup = this._marker.getPopup();
		if (popup != null) {
			popup.getElement().style.opacity = opacity;
		}
	}

	hideMarkerPopup(bool) {
		if (!this._marker) return;
		let popup = this._marker.getPopup();
		if (popup == null) { return }

		let element = popup.getElement();
		let display = "inherit";
		if (bool || !ui.nicknameEnable) { display = "none" }

		if (element.style.display !== display) {
			element.style.display = display;
		}
	}

	removeElement() {
		this._element.parentElement.removeChild(this._element);
		this._element = null;
	}

	// Does entity now exist (for the first time) at relativeFrameIndex
	_existFirstTime(relativeFrameIndex) {
		return (relativeFrameIndex === 0);
	}

	// Does entity exist yet (not connected/hasn't spawned) at relativeFrameIndex
	_notExistYet(relativeFrameIndex) {
		return (relativeFrameIndex < 0);
	}

	// Does entity exist anymore (disconnected/garbage collected) at relativeFrameIndex
	_notExistAnymore(relativeFrameIndex) {
		if (this._positionsHasFrames) {
			return relativeFrameIndex > (this._positions[this._positions.length - 1].frames[1] - this._startFrameNum);
		}
		return (relativeFrameIndex >= this._positions.length);
	}

	// Is relativeFrameIndex out of bounds
	isFrameOutOfBounds(relativeFrameIndex) {
		return ((this._notExistYet(relativeFrameIndex)) || (this._notExistAnymore(relativeFrameIndex)));
	}

	// Update entiy position, direction, and alive status at valid frame
	_updateAtFrame(relativeFrameIndex) {
		const position = this.getPosAtFrame(relativeFrameIndex);
		if (!position) return;

		// Set pos
		let latLng = armaToLatLng(position.position);
		if (this._marker == null) { // First time unit has appeared on map
			this.createMarker(latLng);
		} else {
			this._marker.setLatLng(latLng);
		}

		// Set direction
		if (relativeFrameIndex > 0) {
			const angle = closestEquivalentAngle(this._marker.options.rotationAngle, this._positions[relativeFrameIndex].direction);
			this._marker.setRotationAngle(angle);
		} else {
			this._marker.setRotationAngle(this._positions[relativeFrameIndex].direction);
		}

		// Set alive status
		this.setAlive(this._positions[relativeFrameIndex].alive);

		//Hide popup
		this.hideMarkerPopup(ui.hideMarkerPopups);
	}

	updateRender(f) {
		const relativeFrameIndex = this.getRelativeFrameIndex(f);

		if (this._restoreAnimation) {
			if (this._marker) {
				let distance = 0;
				if (relativeFrameIndex >= 0 && relativeFrameIndex+1 < this._positions.length) {
					const posA = this._positions[relativeFrameIndex].position;
					const posB = this._positions[relativeFrameIndex+1].position;
					const a = posA[0] - posB[0];
					const b = posA[1] - posB[1];
					distance = Math.sqrt(a*a + b*b);
				}
				if (distance < skipAnimationDistance) {
					const icon = this._marker.getElement();
					const popup = this._marker.getPopup();
					if (icon) icon.style.display = "block";
					if (popup) this._marker.openPopup();
					this._restoreAnimation = false;
				}
			} else {
				this._restoreAnimation = false;
			}
		} else if (this._marker) {
			let distance = 0;
			if (relativeFrameIndex > 0 && relativeFrameIndex < this._positions.length) {
				const posA = this._positions[relativeFrameIndex].position;
				const posB = this._positions[relativeFrameIndex-1].position;
				const a = posA[0] - posB[0];
				const b = posA[1] - posB[1];
				distance = Math.sqrt(a*a + b*b);
			}

			if (distance >= skipAnimationDistance) { // teleport should not jump through the map
				const icon = this._marker.getElement();
				const popup = this._marker.getPopup();
				if (icon) icon.style.display = "none";
				if (popup) this._marker.closePopup();
				this._restoreAnimation = true;
			}
		}

		//Hide popup
		this.hideMarkerPopup(ui.hideMarkerPopups);
	}

	// Manage entity at given frame
	manageFrame(f) {
		f = this.getRelativeFrameIndex(f);

		if (this.isFrameOutOfBounds(f)) { // Entity does not exist on frame
			this.removeMarker();
		} else {
			this._updateAtFrame(f)
		}
	}

	_flash(icon, framesToSpan) {
		this.setMarkerIcon(icon);
		this._lockMarkerIcon = true;
		setTimeout(() => {
			//this._marker.setIcon(this._tempIcon);
			this._lockMarkerIcon = false;
		}, (frameCaptureDelay / playbackMultiplier) * framesToSpan);
	}

	flashHit() {
		this._flash(this.iconType.hit, 3);
	}

	flashHighlight() {
		this._flash(this.iconType.follow, 6);
	}

	setAlive(alive) {
		switch (alive) {
			case 0:
				let icon = this.iconType.dead;
				this._alive = alive;

				if (this._curIcon !== icon) {
					this.setMarkerIcon(icon);
				}
				this._tempIcon = (icon);
				this.setMarkerOpacity(0.4);
				break;
			case 1:
				this._alive = alive;
				//console.log(this._marker);
				if ((!this._lockMarkerIcon) && (this._curIcon !== this._realIcon)) {
					this.setMarkerIcon(this._realIcon);
				}
				this.setMarkerOpacity(1);
				break;
			case 2:
				if ((!this._lockMarkerIcon) && (this._curIcon !== this.iconType.unconscious)) {
					this.setMarkerIcon(this.iconType.unconscious);
				}
				this.setMarkerOpacity(1);
				break;
			default:
				break;
		}
	}

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
	}

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
	}
}
