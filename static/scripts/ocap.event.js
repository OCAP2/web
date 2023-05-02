class GameEvents {
	constructor() {
		this._events = [];
	}

	addEvent (event) {
		this._events.push(event);
	}

	init () {
		for (const event of this._events) {
			event.init();
		}
	}

	// Return an array of events that occured on the given frame
	getEventsAtFrame (f) {
		var events = [];
		this._events.forEach((event) => {
			if (event.frameNum == f) {
				events.push(event);
			}
		});

		return events;
	}

	getEvents () { return this._events }

	getActiveEvents () {
		return this._events.filter((event) => event.frameNum <= playbackFrame);
	}
}

class GameEvent {
	lastFrameNumUpdate = null;
	objectID = null;
	_forceUpdate = false;
	_element = null;

	constructor(frameNum, type, objectID = null) {
		this.frameNum = frameNum;
		this.type = type;
		this.objectID = objectID;
	}

	getElement () { return this._element };

	// initialize event once all events are known
	init () { }

	// forces an update for the next frame
	forceUpdate () {
		this._forceUpdate = true;
	}
	// check if update() call is needed
	needsUpdate (f, onlyVisible = true) {
		return ((!onlyVisible || f >= this.frameNum) && this.lastFrameNumUpdate !== f) || this._forceUpdate;
	}
	// update element
	update (f) {
		this.lastFrameNumUpdate = f;
		this._forceUpdate = false;
	}

	// update time related to frameNum
	updateTime () { }

	// get previous event for the same objectID based given constructor
	getPreviousObjectEvent (type) {
		const events = gameEvents.getEvents();
		const thisIndex = events.indexOf(this);
		if (thisIndex === -1) return null;

		for (const event of events.slice(0, thisIndex).reverse()) {
			if (event instanceof type && event.objectID === this.objectID) {
				return event;
			}
		}

		return null;
	}

	// move the camera on position
	focusOnPosition (position) {
		entityToFollow = null;
		map.setView(armaToLatLng(position), map.getZoom(), { animate: true });
	}
}

// TODO: Handle case where victim is a vehicle
class HitKilledEvent extends GameEvent {
	constructor(frameNum, type, causedBy, victim, distance, weapon) {
		super(frameNum, type);
		this.causedBy = causedBy;
		this.victim = victim;
		this.distance = distance;
		this.weapon = weapon;
		this._element = null;

		// If causedBy is null, victim was likely killed/hit by collision/fire/exploding vehicle
		// TODO: Use better way of handling this
		if (this.causedBy == null) {
			const disconnectEvent = gameEvents.getEventsAtFrame(this.frameNum).find((v) => v instanceof ConnectEvent && v.type === "disconnected" && v.unitName === this.victim.getName());
			if (disconnectEvent) {
				this.causedBy = this.victim;
				this.weapon = "Disconnect";
			} else {
				this.causedBy = new Unit(null, null, getLocalizable("something"), null, null, null, null); // Dummy unit
				this.weapon = "N/A";
			}
			this.distance = 0;
		}

		// === Create UI element for this event (for later use)
		// Victim
		const victimSpan = document.createElement("span");
		if (victim instanceof Unit) { victimSpan.className = this.victim.getSideClass() }
		victimSpan.className += " bold";
		victimSpan.textContent = this.victim.getName();

		// CausedBy
		const causedBySpan = document.createElement("span");
		if ((causedBy instanceof Unit) && (causedBy.getId() != null) && !ui.disableKillCount) {
			causedBySpan.className = this.causedBy.getSideClass();
			switch (this.type) {
				case "killed":
					causedBySpan.textContent = `${this.causedBy.getName()} (${causedBy.killCount - (causedBy.teamKillCount * 2)} kills)`;
					break;
				case "hit":
					causedBySpan.textContent = `${this.causedBy.getName()} (${causedBy.killCount - (causedBy.teamKillCount * 2)} kills)`;
					break;
			}
		} else {
			causedBySpan.textContent = this.causedBy.getName()
		}
		causedBySpan.className += " medium";

		const textSpan = document.createElement("span");
		switch (this.type) {
			case "killed":
				localizable(textSpan, "by_killer");
				break;
			case "hit":
				localizable(textSpan, "by_injured");
				break;
		}

		this.detailsDiv = document.createElement("div");
		this.detailsDiv.className = "eventDetails";
		this.updateTime();

		const li = document.createElement("li");
		li.appendChild(victimSpan);
		li.appendChild(textSpan);
		li.appendChild(causedBySpan);
		li.appendChild(this.detailsDiv);

		// When clicking on event, skip playback to point of event, move camera to victim's position
		li.addEventListener("click", () => {
			console.log(this.victim);

			// Aim to skip back to a point just before this event
			let targetFrame = this.frameNum - playbackMultiplier;
			let latLng = this.victim.getLatLngAtFrame(targetFrame);

			// Rare case: victim did not exist at target frame, fallback to event frame
			if (latLng == null) {
				targetFrame = this.frameNum;
				latLng = this.victim.getLatLngAtFrame(targetFrame);
			}

			ui.setMissionCurTime(targetFrame);
			//map.setView(latLng, map.getZoom());
			//this.victim.flashHighlight();
			this.victim.follow();
		});
		this._element = li;
	};

	updateTime () {
		this.detailsDiv.textContent = ui.getTimeString(this.frameNum) + " - " + this.distance + "m - " + this.weapon;
	}
}

class ConnectEvent extends GameEvent {
	constructor(frameNum, type, unitName) {
		super(frameNum, type);
		this.unitName = unitName;

		// Create list element for this event (for later use)
		var span = document.createElement("span");
		span.className = "medium";
		localizable(span, this.type, "", `${this.unitName.encodeHTMLEntities()} `);

		this.detailsDiv = document.createElement("div");
		this.detailsDiv.className = "eventDetails";
		this.updateTime();

		var li = document.createElement("li");
		li.appendChild(span);
		li.appendChild(this.detailsDiv);
		this._element = li;
	};

	updateTime () {
		this.detailsDiv.textContent = ui.getTimeString(this.frameNum);
	}
}

class CapturedEvent extends GameEvent {
	constructor(frameNum, type, objectType, unitName, unitColor, objectColor, objectPosition) {
		super(frameNum, type);
		this.objectType = objectType;
		this.unitName = unitName;
		this.unitColor = unitColor;
		this.objectColor = objectColor;
		this.objectPosition = objectPosition;
		this._marker = null;

		let icon = "hd_unknown";
		let translation = "captured_something";
		switch (this.objectType) {
			case "flag":
				icon = "mil_flag";
				translation = "captured_flag";
				break;
		}

		// Create list element for this event (for later use)
		const unitSpan = document.createElement("span");
		unitSpan.className = "medium";
		unitSpan.textContent = `${this.unitName} `;
		colorElement(unitSpan, this.unitColor);

		const messageSpan = document.createElement("span");
		messageSpan.className = "medium";
		localizable(messageSpan, "captured_flag", " ", " ");

		const img = document.createElement("img");
		img.style.height = "12px";
		colorMarkerIcon(img, icon, this.objectColor);

		this.detailsDiv = document.createElement("div");
		this.detailsDiv.className = "eventDetails";
		this.updateTime();

		const li = document.createElement("li");
		li.appendChild(unitSpan);
		li.appendChild(messageSpan);
		li.appendChild(img);
		if (this.timerSpan) {
			li.appendChild(this.timerSpan);
		}
		li.appendChild(this.detailsDiv);
		this._element = li;

		if (this.objectPosition) {
			this._element.classList.add("action");
			this._element.addEventListener("click", () => {
				map.setView(armaToLatLng(this.objectPosition), map.getZoom(), { animate: true });
			});
		}
	};

	update (f) {
		if (!this.needsUpdate(f, false)) return;

		const markerVisible = this.markerIsVisible(f);
		if (!this._marker && markerVisible) {
			const color = "#" + getPulseMarkerColor(this.unitColor);
			this._marker = L.marker.pulse(armaToLatLng(this.objectPosition), { iconSize: [50, 50], color: color, fillColor: 'transparent', iterationCount: 1 }).addTo(map);
		} else if (this._marker && !markerVisible) {
			this._marker.remove();
			this._marker = null;
		}

		super.update(f);
	}

	markerIsVisible (f) {
		if (!this.objectPosition) return false;
		return f >= this.frameNum;

	}

	updateTime () {
		this.detailsDiv.textContent = ui.getTimeString(this.frameNum);
	}
}

class TerminalHackStartEvent extends GameEvent {
	constructor(frameNum, type, unitName, unitColor, terminalColor, terminalID, terminalPosition, countDownTimer) {
		super(frameNum, type, terminalID);
		this.unitName = unitName;
		this.unitColor = unitColor;
		this.terminalColor = terminalColor;
		this.terminalPosition = terminalPosition;
		this.countDownTimer = countDownTimer;
		this._marker = null;
		this._state = "running";

		// Create list element for this event (for later use)
		const unitSpan = document.createElement("span");
		unitSpan.className = "medium";
		unitSpan.textContent = this.unitName;
		colorElement(unitSpan, this.unitColor);

		const messageSpan = document.createElement("span");
		messageSpan.className = "medium";
		localizable(messageSpan, "is_hacking_terminal", " ", " ");

		const img = document.createElement("img");
		img.style.height = "12px";
		colorMarkerIcon(img, "loc_Transmitter", this.terminalColor);

		if (this.countDownTimer > 0) {
			this.timerSpan = document.createElement("span");
			this.timerSpan.className = "medium";
		}

		this.detailsDiv = document.createElement("div");
		this.detailsDiv.className = "eventDetails";
		this.updateTime();

		const li = document.createElement("li");
		li.appendChild(unitSpan);
		li.appendChild(messageSpan);
		li.appendChild(img);
		if (this.timerSpan) {
			li.appendChild(this.timerSpan);
		}
		li.appendChild(this.detailsDiv);
		this._element = li;

		if (this.terminalPosition) {
			this._element.classList.add("action");
			this._element.addEventListener("click", () => {
				this.focusOnPosition(this.terminalPosition);
			});
		}
	};

	update (f) {
		if (!this.needsUpdate(f, false)) return;

		const markerVisible = this.markerIsVisible(f);
		if (!this._marker && markerVisible) {
			this._marker = L.marker.pulse(armaToLatLng(this.terminalPosition), { iconSize: [50, 50], color: 'red', fillColor: 'transparent' }).addTo(map);
		} else if (this._marker && !markerVisible) {
			this._marker.remove();
			this._marker = null;
		}

		if (this.timerSpan) {
			if (this._state === "interrupted") {
				this.timerSpan.textContent = ` (interrupted)`;
			} else if (this._state === "running") {
				const secondsRunning = ((+f - this.frameNum) * frameCaptureDelay / 1000);
				const secondsLeft = this.countDownTimer - secondsRunning;
				if (secondsRunning < 0) return;
				if (secondsLeft > 0) {
					this.timerSpan.textContent = ` (${secondsLeft} seconds left)`;
				} else {
					this.timerSpan.textContent = ` (complete)`;
				}
			}
		}

		super.update(f);
	}

	markerIsVisible (f) {
		if (!this.terminalPosition) return false;
		if (f < this.frameNum) return false;
		if (this._state !== "running") return false;
		const secondsRunning = ((f - this.frameNum) * frameCaptureDelay / 1000);
		const secondsLeft = this.countDownTimer - secondsRunning;
		return secondsLeft > 0;
	}

	updateTime () {
		this.detailsDiv.textContent = ui.getTimeString(this.frameNum);
	}

	getState () { return this._state; }
	setState (state) {
		this._state = state;
		this.forceUpdate();
	}
}

class TerminalHackUpdateEvent extends GameEvent {
	constructor(frameNum, type, unitName, unitColor, terminalColor, terminalID, state) {
		super(frameNum, type, terminalID);
		this.unitName = unitName;
		this.unitColor = unitColor;
		this.terminalColor = terminalColor;
		this.state = state;
		this._triggered = false;
		this._oldState = null;

		// Create list element for this event (for later use)
		const unitSpan = document.createElement("span");
		unitSpan.className = "medium";
		unitSpan.textContent = this.unitName;
		colorElement(unitSpan, this.unitColor);

		const messageSpan = document.createElement("span");
		messageSpan.className = "medium";
		if (this.type === "terminalHackCanceled") {
			localizable(messageSpan, "interrupted_hack", " ", " ");
		} else {
			messageSpan.textContent = "ERROR UNKNOWN TYPE";
		}

		const img = document.createElement("img");
		img.style.height = "12px";
		colorMarkerIcon(img, "loc_Transmitter", this.terminalColor);

		this.detailsDiv = document.createElement("div");
		this.detailsDiv.className = "eventDetails";
		this.updateTime();

		const li = document.createElement("li");
		li.appendChild(unitSpan);
		li.appendChild(messageSpan);
		li.appendChild(img);
		li.appendChild(this.detailsDiv);
		this._element = li;
	}

	init () {
		this._parent = this.getPreviousObjectEvent(TerminalHackStartEvent);
		if (this._parent && this._parent.terminalPosition) {
			this._element.classList.add("action");
			this._element.addEventListener("click", () => {
				this.focusOnPosition(this._parent.terminalPosition);
			});
		}
	}

	update (f) {
		if (!this.needsUpdate(f, false)) return;

		if (f >= this.frameNum && !this._triggered) {
			if (this._parent) {
				this._oldState = this._parent.getState();
				this._parent.setState(this.state);
			}
			this._triggered = true;
		} else if (f < this.frameNum && this._triggered) {
			if (this._parent) {
				this._parent.setState(this._oldState);
			}
			this._triggered = false;
		}

		super.update(f);
	}

	updateTime () {
		this.detailsDiv.textContent = ui.getTimeString(this.frameNum);
	}
}

// [20, "generalEvent", "Mission has started!"]
class generalEvent extends GameEvent {
	constructor(frameNum, type, msg) {
		super(frameNum, type);
		this.msg = msg;
		this._element = null;

		var span = document.createElement("span");
		span.className = "medium";
		span.textContent = msg;
		var li = document.createElement("li");
		li.appendChild(span)
		this._element = li;
	};
};

// [4639, "endMission", ["EAST", "Offar Factory зазахвачена. Победа Сил РФ."]]
class endMissionEvent extends GameEvent {
	constructor(frameNum, type, side, msg) {
		super(frameNum, type);
		this.msg = msg;
		this.side = side;
		this._element = null;

		// Create list element for this event (for later use)
		var span = document.createElement("span");
		span.className = "medium";

		if (this.side === "") {
			span.textContent = this.msg;
		} else {
			localizable(span, "win", ` ${side}. ${this.msg.encodeHTMLEntities()}`);
			switch (true) {
				case (this.side === "EAST"):
					span.className = "opfor";
					break;
				case (this.side === "WEST"):
					span.className = "blufor";
					break;
				case (this.side === "IND"):
					span.className = "ind";
					break;
				case (this.side === "CIV"):
					span.className = "civ";
					break;
			}
		}

		var li = document.createElement("li");
		li.appendChild(span);
		this._element = li;
	};
}
