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
				case (side == "EAST"):
					span.className = "opfor";
					break;
				case (side == "WEST"):
					span.className = "blufor";
					break;
				case (side == "IND"):
					span.className = "ind";
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
