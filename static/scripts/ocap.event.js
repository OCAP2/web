class GameEvents {
	constructor() {
		this._events = [];
	};

	addEvent(event) {
		this._events.push(event);
	};

	// Return an array of events that occured on the given frame
	getEventsAtFrame(f) {
		var events = [];
		this._events.forEach((event) => {
			if (event.frameNum == f) {
				events.push(event);
			}
		});

		return events;
	};

	getEvents() { return this._events };
}

// TODO: Handle case where victim is a vehicle
class HitKilledEvent {
	constructor(frameNum, type, causedBy, victim, distance, weapon) {
		this.frameNum = frameNum; // Frame number that event occurred
		this.timecode = dateToTimeString(new Date(frameNum * frameCaptureDelay));
		this.type = type; // "hit" or "killed"
		this.causedBy = causedBy;
		this.victim = victim;
		this.distance = distance;
		this.weapon = weapon;
		this._element = null;

		// If causedBy is null, victim was likely killed/hit by collision/fire/exploding vehicle
		// TODO: Use better way of handling this
		if (this.causedBy == null) {
			this.distance = 0;
			this.weapon = "N/A";
			this.causedBy = new Unit(null, null, getLocalizable("something"), null, null, null, null); // Dummy unit
		}


		// === Create UI element for this event (for later use)
		// Victim
		var victimSpan = document.createElement("span");
		if (victim instanceof Unit) { victimSpan.className = this.victim.getSideClass() }
		victimSpan.className += " bold";
		victimSpan.textContent = this.victim.getName();

		// CausedBy
		var causedBySpan = document.createElement("span");
		if ((causedBy instanceof Unit) && (causedBy.getId() != null)) {
			causedBySpan.className = this.causedBy.getSideClass()
			switch (this.type) {
				case "killed":
					causedBySpan.textContent = this.causedBy.getName() + " (" + (causedBy.killCount + 1) + " kills)";
					break;
				case "hit":
					causedBySpan.textContent = this.causedBy.getName() + " (" + (causedBy.killCount) + " kills)";
					break;
			}
		} else {
			causedBySpan.textContent = this.causedBy.getName()
		}
		causedBySpan.className += " medium";

		var textSpan = document.createElement("span");
		switch (this.type) {
			case "killed":
				localizable(textSpan, "by_killer");
				break;
			case "hit":
				localizable(textSpan, "by_injured");
				break;
		}

		var detailsDiv = document.createElement("div");
		detailsDiv.className = "eventDetails";
		detailsDiv.textContent = this.timecode + " - " + this.distance + "m - " + this.weapon;

		var li = document.createElement("li");
		li.appendChild(victimSpan);
		li.appendChild(textSpan);
		li.appendChild(causedBySpan);
		li.appendChild(detailsDiv);

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

	getElement() { return this._element };
}

class ConnectEvent {
	constructor(frameNum, type, unitName) {
		this.frameNum = frameNum;
		this.timecode = dateToTimeString(new Date(frameNum * frameCaptureDelay));
		this.type = type;
		this.unitName = unitName;
		this._element = null;

		// Create list element for this event (for later use)
		var span = document.createElement("span");
		span.className = "medium";
		localizable(span, this.type, "", `${this.unitName} `);

		var detailsDiv = document.createElement("div");
		detailsDiv.className = "eventDetails";
		detailsDiv.textContent = this.timecode;

		var li = document.createElement("li");
		li.appendChild(span);
		li.appendChild(detailsDiv);
		this._element = li;
	};

	getElement() { return this._element };
}

class CaptureFlagEvent {
	constructor(frameNum, type, unitName, unitSide, flagSide) {
		this.frameNum = frameNum;
		this.timecode = dateToTimeString(new Date(frameNum * frameCaptureDelay));
		this.type = type;
		this.unitName = unitName;
		this.unitSide = unitSide;
		this.flagSide = flagSide;
		this._element = null;

		// Create list element for this event (for later use)
		const unitSpan = document.createElement("span");
		unitSpan.className = "medium";
		unitSpan.textContent = `${this.unitName} `;
		if (this.unitSide !== "") {
			switch (true) {
				case (this.unitSide === "EAST"):
					unitSpan.className = "opfor";
					break;
				case (this.unitSide === "WEST"):
					unitSpan.className = "blufor";
					break;
				case (this.unitSide === "IND"):
					unitSpan.className = "ind";
					break;
				case (this.unitSide === "CIV"):
					unitSpan.className = "civ";
					break;
			}
		}

		const messageSpan = document.createElement("span");
		messageSpan.className = "medium";
		localizable(messageSpan, "captured_flag", " ", " ");

		const img = document.createElement("img");
		img.src = "/images/markers/mil_flag/ffffff.png";
		img.style.height = "12px";
		if (this.flagSide !== "") {
			switch (true) {
				case (this.flagSide === "EAST"):
					img.src = "/images/markers/mil_flag/ff0000.png";
					break;
				case (this.flagSide === "WEST"):
					img.src = "/images/markers/mil_flag/00a8ff.png";
					break;
				case (this.flagSide === "IND"):
					img.src = "/images/markers/mil_flag/00cc00.png";
					break;
				case (this.flagSide === "CIV"):
					img.src = "/images/markers/mil_flag/C900FF.png";
					break;
			}
		}

		const detailsDiv = document.createElement("div");
		detailsDiv.className = "eventDetails";
		detailsDiv.textContent = this.timecode;

		const li = document.createElement("li");
		li.appendChild(unitSpan);
		li.appendChild(messageSpan);
		li.appendChild(img);
		li.appendChild(detailsDiv);
		this._element = li;
	};

	getElement() { return this._element };
}

// [4639, "endMission", ["EAST", "Offar Factory зазахвачена. Победа Сил РФ."]]
class endMissionEvent {
	constructor(frameNum, type, side, msg) {
		this.frameNum = frameNum;
		this.timecode = dateToTimeString(new Date(frameNum * frameCaptureDelay));
		this.type = type;
		this.msg = msg;
		this.side = side;
		this._element = null;

		// Create list element for this event (for later use)
		var span = document.createElement("span");
		span.className = "medium";

		if (this.side == "") {
			span.textContent = msg;
		} else {
			localizable(span, "win", ` ${side}. ${msg}`);
			switch (true) {
				case (this.side == "EAST"):
					span.className = "opfor";
					break;
				case (this.side == "WEST"):
					span.className = "blufor";
					break;
				case (this.side == "IND"):
					span.className = "ind";
					break;
				case (this.side == "CIV"):
					span.className = "civ";
					break;
			}
		}

		var li = document.createElement("li");
		li.appendChild(span);
		this._element = li;
	};

	getElement() { return this._element };
}

class customEvent {
	constructor(frameNum, type, msg) {
		this.frameNum = frameNum;
		this.timecode = dateToTimeString(new Date(frameNum * frameCaptureDelay));
		this.type = type;
		this.msg = msg;
		this._element = null;

		// Create list element for this event (for later use)
		var span = document.createElement("span");
		span.className = "medium";
		localizable(span, this.type, "", `${this.msg} `);

		var detailsDiv = document.createElement("div");
		detailsDiv.className = "eventDetails";
		detailsDiv.textContent = this.timecode;

		var li = document.createElement("li");
		li.appendChild(span);
		li.appendChild(detailsDiv);
		this._element = li;
	};

	getElement () { return this._element };
}
