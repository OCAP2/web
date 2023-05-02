class UI {
	constructor() {
		this.leftPanel = null;
		this.rightPanel = null;
		this.bottomPanel = null;
		this.eventList = null;
		this.listWest = null;
		this.listEast = null;
		this.listGuer = null;
		this.listCiv = null;
		this.sideWest = null;
		this.sideEast = null;
		this.sideGuer = null;
		this.sideCiv = null;
		this.missionCurTime = null;
		this.missionEndTime = null;
		this.frameSlider = null;
		this.modal = null;
		this.modalHeader = null;
		this.modalFilter = null;
		this.modalBody = null;
		this.modalButtons = null;
		this.statsDialog = null;
		this.statsDialogBody = null;
		this.missionName = null;
		//this.loadOpButton = null;
		this.playPauseButton = null;
		this.playbackSpeedSliderContainer = null;
		this.playbackSpeedSlider = null;
		this.playbackSpeedVal = null;
		this.aboutButton = null;
		this.shareButton = null;
		this.statsButton = null;
		this.toggleFirelinesButton = null;
		this.toggleMarkersButton = null;
		this.hint = null;
		this.eventTimeline = null;
		this.frameSliderWidthInPercent = -1;
		this.filterHitEventsButton = null;
		this.filterConnectEventsButton = null;
		this.showHitEvents = true;
		this.showConnectEvents = true;
		this.markersEnable = true;
		this.firelinesEnabled = true;
		this.filterEventsInput = null;
		this.hideMarkerPopups = false;
		this.cursorTargetBox = null;
		this.cursorTooltip = null;
		this.currentSide = "";
		this.toggleNickname = null;
		this.toggleTime = null;
		this.nicknameEnable = true;
		this.filterTagGameInput = null;
		this.filterGameInput = null;
		this.calendar1 = null;
		this.calendar2 = null;
		this.filterSubmit = null;
		this.systemTime = null;
		this.missionDate = null;
		this.missionTimeMultiplier = null;
		this.elapsedTime = null;

		this.disableKillCount = false;
		this.useCloudTiles = true;

		this._init();
	};

	_init() {
		// Setup top panel
		this.missionName = document.getElementById("missionName");

		/* // Load operation button
		var loadOpButton = document.getElementById("loadOpButton");
		loadOpButton.addEventListener("click", function() {
			//TODO: Show op selection menu, reset all variables + clear all panels.
			ui.showHint("Not yet implemented.");
		});
		this.loadOpButton = loadOpButton; */

		// Buttons
		this.aboutButton = document.getElementById("aboutButton");
		this.aboutButton.addEventListener("click", () => {
			this.showModalAbout();
		});
		this.shareButton = document.getElementById("shareButton");
		this.shareButton.addEventListener("click", () => {
			this.showModalShare();
		});
		this.statsButton = document.getElementById("statsButton");
		this.statsButton.addEventListener("click", () => {
			this.showModalStats();
		});

		// Nickname show/hide vehicle && player
		this.toggleNicknameButton = document.getElementById("toggleNickname");
		this.toggleNicknameButton.addEventListener("click", () => {
			this.nicknameEnable = !this.nicknameEnable;
			var text;
			if (this.nicknameEnable) {
				this.toggleNicknameButton.style.opacity = 1;
				text = getLocalizable("shown");
			} else {
				this.toggleNicknameButton.style.opacity = 0.5;
				text = getLocalizable("hidden");
			}
			this.showHint(getLocalizable("nickname") + text);
		});

		// Toggle firelines button
		this.toggleFirelinesButton = document.getElementById("toggleFirelines");
		this.toggleFirelinesButton.addEventListener("click", () => {
			this.firelinesEnabled = !this.firelinesEnabled;

			var text;
			if (this.firelinesEnabled) {
				this.toggleFirelinesButton.style.opacity = 1;
				text = getLocalizable("shown");
			} else {
				this.toggleFirelinesButton.style.opacity = 0.5;
				text = getLocalizable("hidden");
			}

			this.showHint(getLocalizable("line_fire") + text);
		});

		// Change time view
		this.toggleTime = document.getElementById("toggleTime");
		for (const timeValue of ["elapsed","mission","system"]) {
			const option = document.createElement("option");
			option.value = timeValue;
			localizable(option, `time_${timeValue}`, "", "");
			if (timeValue !== "elapsed") {
				option.disabled = true;
			}
			this.toggleTime.appendChild(option);
		}
		this.toggleTime.addEventListener("change", (event) => {
			const value = event.target.value;

			if (value === "system" && !this.systemTime) {
				console.error("system time select, but no system time available");
				return;
			} else if (value === "mission" && (!this.missionDate || !this.missionTimeMultiplier)) {
				console.error("mission time select, but neither mission date nor time multiplier available");
				return;
			}

			this.timeToShow = value;
			this.updateCurrentTime();
			this.updateEndTime();
			this.updateEventTimes();
		});

		// Toggle markers button
		this.toggleMarkersButton = document.getElementById("toggleMapMarker");
		this.toggleMarkersButton.addEventListener("click", () => {
			this.markersEnable = !this.markersEnable;

			var text;
			if (this.markersEnable) {
				this.toggleMarkersButton.style.opacity = 1;
				text = getLocalizable("shown");
			} else {
				this.toggleMarkersButton.style.opacity = 0.5;
				text = getLocalizable("hidden");
			}

			this.showHint(getLocalizable("markers") + text);
		});

		// Setup left panel
		this.leftPanel = document.getElementById("leftPanel");

		// Define group side elements
		this.listWest = document.getElementById("listWest");
		this.listEast = document.getElementById("listEast");
		this.listGuer = document.getElementById("listGuer");
		this.listCiv = document.getElementById("listCiv");

		// Count unit side
		this.sideWest = document.getElementById("sideWest");
		this.sideEast = document.getElementById("sideEast");
		this.sideGuer = document.getElementById("sideGuer");
		this.sideCiv = document.getElementById("sideCiv");
		sideWest.addEventListener("click", () => {
			this.switchSide("WEST");
		});
		sideEast.addEventListener("click", () => {
			this.switchSide("EAST");
		});
		sideGuer.addEventListener("click", () => {
			this.switchSide("GUER");
		});
		sideCiv.addEventListener("click", () => {
			this.switchSide("CIV");
		});

		// Setup right panel
		this.rightPanel = document.getElementById("rightPanel");
		this.eventList = document.getElementById("eventList");
		this.filterHitEventsButton = document.getElementById("filterHitEventsButton");
		this.filterHitEventsButton.addEventListener("click", () => {
			toggleHitEvents();
		});
		this.filterConnectEventsButton = document.getElementById("filterConnectEventsButton");
		this.filterConnectEventsButton.addEventListener("click", () => {
			toggleConnectEvents();
		});
		this.filterEventsInput = document.getElementById("filterEventsInput");

		// Setup filter panel
		this.filterTagGameInput = document.getElementById("filterTagGameInput");
		this.filterGameInput = document.getElementById("filterGameInput");
		this.calendar1 = document.getElementById("calendar1");
		this.calendar2 = document.getElementById("calendar2");
		this.filterSubmit = document.getElementById("filterSubmit");
		this.filterSubmit.addEventListener("click", () => {
			this.setModalOpList();
		});

		// Cursor target box
		this.cursorTargetBox = document.getElementById("cursorTargetBox");

		// Cursor tooltip
		let cursorTooltip = document.createElement("div");
		cursorTooltip.className = "cursorTooltip";
		document.body.appendChild(cursorTooltip);
		this.cursorTooltip = cursorTooltip;

		// Setup bottom panel
		this.bottomPanel = document.getElementById("bottomPanel");
		this.missionCurTime = document.getElementById("missionCurTime");
		this.missionEndTime = document.getElementById("missionEndTime");
		this.frameSlider = document.getElementById("frameSlider");
		this.frameSlider.addEventListener("input", (event) => {
			var val = event.srcElement.value;
			this.setMissionCurTime(val);
		});
		this.playPauseButton = document.getElementById("playPauseButton");

		// Events timeline
		this.eventTimeline = document.getElementById("eventTimeline");

		// Hide/show ui on keypress
		var left_title = document.getElementById("leftPanel").getElementsByClassName("title")[0];
		var right_title = document.getElementById("rightPanel").getElementsByClassName("title")[0];
		left_title.onclick = () => {this.toggleLeftPanel()};
		right_title.onclick = () => {this.toggleRightPanel()};
		mapDiv.addEventListener("keypress", (event) => {
			if (event.charCode === 101) this.toggleLeftPanel();
			else if (event.charCode === 114) this.toggleRightPanel();
			else if (event.charCode === 46) this.showExperimental();
		});


		// Modal
		this.modal = document.getElementById("modal");
		this.modalHeader = document.getElementById("modalHeader");
		this.modalFilter = document.getElementById("modalFilter");
		this.modalBody = document.getElementById("modalBody");
		this.modalButtons = document.getElementById("modalButtons");
		this.showModalOpSelection();

		// Stats
		this.statsDialog = document.getElementById("stats");
		this.statsDialogHeader = document.getElementById("statsHeader");
		this.statsDialogBody = document.getElementById("statsBody");
		this.statsDialogFooter = document.getElementById("statsFooter");

		// Small popup
		this.hint = document.getElementById("hint");

		// Playback speed slider
		this.playbackSpeedSliderContainer = document.getElementById("playbackSpeedSliderContainer");
		this.playbackSpeedSlider = document.getElementById("playbackSpeedSlider");

		this.playbackSpeedVal = document.getElementById("playbackSpeedVal");
		this.playbackSpeedVal.textContent = playbackMultiplier + "x";
		this.playbackSpeedVal.addEventListener("mouseover", () => {
			this.showPlaybackSpeedSlider();
		});
		this.playbackSpeedSliderContainer.addEventListener("mouseleave", () => {
			this.hidePlaybackSpeedSlider();
		});

		this.playbackSpeedSlider.max = maxPlaybackMultipler;
		this.playbackSpeedSlider.min = minPlaybackMultipler;
		this.playbackSpeedSlider.step = playbackMultiplierStep;
		this.playbackSpeedSlider.value = playbackMultiplier;
		this.playbackSpeedSlider.addEventListener("input", () => {
			const container = document.getElementById("container");

			let sliderVal = this.playbackSpeedSlider.value;
			this.playbackSpeedVal.textContent = sliderVal + "x";

			container.classList.remove(`speed-${playbackMultiplier}`);
			playbackMultiplier = +sliderVal;
			container.classList.add(`speed-${playbackMultiplier}`);
		});

		this.frameSliderWidthInPercent = (this.frameSlider.offsetWidth / this.frameSlider.parentElement.offsetWidth) * 100;
	};

	checkAvailableTimes() {
		for (const option of this.toggleTime.options) {
			if (option.value === "system") {
				option.disabled = !this.systemTime;
			} else if (option.value === "mission") {
				option.disabled = !this.missionDate || !this.missionTimeMultiplier;
			}
		}
	}

	getTimeString(frame) {
		let date = new Date(frame * frameCaptureDelay);
		let isUTC = true;
		if (this.timeToShow === "system") {
			date = new Date(this.systemTime.getTime() + (frame * frameCaptureDelay));
			isUTC = false;
		} else if (this.timeToShow === "mission") {
			date = new Date(this.missionDate.getTime() + (frame * frameCaptureDelay * this.missionTimeMultiplier));
			isUTC = false;
		}
		return dateToTimeString(date, isUTC);
	}

	showCursorTooltip(text) {
		let tooltip = this.cursorTooltip;
		tooltip.textContent = text;
		tooltip.className = "cursorTooltip";

		// Attach text to cursor. Remove after timeout
		mapDiv.addEventListener("mousemove", this._moveCursorTooltip);
		setTimeout(() => {
			tooltip.className = "cursorTooltip hidden";

			// Remove listener once opacity transition ended
			tooltip.addEventListener("transitionend", () => {
				mapDiv.removeEventListener("mousemove", this._moveCursorTooltip);
			});
		}, 2500);
		console.log(this.cursorTooltip);
	}

	_moveCursorTooltip(event) {
		ui.cursorTooltip.style.transform = `translate3d(${event.pageX}px, ${event.pageY}px, 0px)`;
	}

	setMissionName(name) {
		this.missionName.textContent = name;
	}

	detectTimes(times) {
		for (const time of times) {
			if (time.frameNum === 0) {
				this.systemTime = new Date(time.systemTimeUTC + "Z");
				this.missionDate = new Date(time.date);
				this.missionTimeMultiplier = time.timeMultiplier;
				this.elapsedTime = time.time;
			}
			if (time.frameNum > 0 && this.missionDate) {
				const missionDate = new Date(time.date);
				const relativeInitialDate = new Date(this.missionDate.getTime() + (time.frameNum * time.timeMultiplier * frameCaptureDelay));
				relativeInitialDate.setSeconds(0);

				if (missionDate.getTime() !== relativeInitialDate.getTime()) {
					this.missionDate = missionDate;
					this.missionTimeMultiplier = time.timeMultiplier;
				}
				break;
			}
		}
	}

	// Set mission time based on given frame
	// Move playback + slider to given frame in time
	setMissionCurTime(f) {
		missionCurDate.setTime(f*frameCaptureDelay);
		this.updateCurrentTime(f);
		this.setFrameSliderVal(f);
		playbackFrame = +f;

		for (const event of gameEvents.getEvents().reverse()) {
			event.update(f);
		}
	}

	updateCurrentTime(f = playbackFrame) {
		this.missionCurTime.textContent = ui.getTimeString(f);
	}

	setMissionEndTime(f) {
		this.updateEndTime(f);
		this.setFrameSliderMax(f);
	}

	updateEndTime(f = this.frameSlider.max) {
		let date = new Date(f*frameCaptureDelay);
		let isUTC = true;
		if (this.systemTime && this.timeToShow === "system") {
			date = new Date(this.systemTime.getTime() + (this.frameSlider.max * frameCaptureDelay));
			isUTC = false;
		} else if (this.timeToShow === "mission") {
			date = new Date(this.missionDate.getTime() + (this.frameSlider.max * frameCaptureDelay * this.missionTimeMultiplier));
			isUTC = false;
		}
		this.missionEndTime.textContent = dateToTimeString(date, isUTC);
	}

	setFrameSliderMax(f) {
		this.frameSlider.max = f;
	};

	setFrameSliderVal(f) {
		this.frameSlider.value = f;
	};

	toggleLeftPanel() {
		if (this.leftPanel.style.display == "none") {
			this.leftPanel.style.display = "initial";
		} else {
			this.leftPanel.style.display = "none";
		}
	};

	updateTitleSide() {
		sideCiv.textContent = "CIV\n\r(" + countCiv + ")";
		sideEast.textContent = "OPFOR\n\r(" + countEast + ")";
		sideGuer.textContent = "IND\n\r(" + countGuer + ")";
		sideWest.textContent = "BLUFOR\n\r(" + countWest + ")";
	};

	switchSide(side) {
		this.currentSide = side;
		this.sideEast.style.backgroundColor = "rgba(255, 183, 38,0.1)";
		this.listEast.style.display = "none";
		this.sideWest.style.backgroundColor = "rgba(255, 183, 38,0.1)";
		this.listWest.style.display = "none";
		this.sideGuer.style.backgroundColor = "rgba(255, 183, 38,0.1)";
		this.listGuer.style.display = "none";
		this.sideCiv.style.backgroundColor = "rgba(255, 183, 38,0.1)";
		this.listCiv.style.display = "none";
		if (side == "CIV") {
			this.sideCiv.style.backgroundColor = "rgba(255, 183, 38,0.3)";
			this.listCiv.style.display = "inline-block";
		} else if (side == "EAST") {
			this.sideEast.style.backgroundColor = "rgba(255, 183, 38,0.3)";
			this.listEast.style.display = "inline-block";
		} else if (side == "WEST") {
			this.sideWest.style.backgroundColor = "rgba(255, 183, 38,0.3)";
			this.listWest.style.display = "inline-block";
		} else if (side == "GUER") {
			this.sideGuer.style.backgroundColor = "rgba(255, 183, 38,0.3)";
			this.listGuer.style.display = "inline-block";
		}
	};

	toggleRightPanel() {
		if (this.rightPanel.style.display == "none") {
			this.rightPanel.style.display = "initial";
		} else {
			this.rightPanel.style.display = "none";
		}
	};

	showModalOpSelection() {
		// Set header/body
		localizable(this.modalHeader, "select_mission");
		localizable(this.modalBody, "list_compilation");

		// Add buttons
/*		var playButton = document.createElement("div");
		playButton.className = "modalButton";
		playButton.textContent = "Play";
		var cancelButton = document.createElement("div");
		cancelButton.className = "modalButton";
		cancelButton.textContent = "Cancel";
		var hideModal = this.hideModal;
		cancelButton.addEventListener("click", function() {
			this.hideModal();
		});

		this.modalButtons.appendChild(cancelButton);
		this.modalButtons.appendChild(playButton);*/

		// Show modal
		this.showModal();
		this.modalFilter.style.display = "inherit";
	};

	setModalOpList() {
		var OpList;
		var n = filterTagGameInput.options.selectedIndex;
		var tag = n != -1 ? filterTagGameInput.options[n].value : "";
		var name = filterGameInput.value;
		var DateNewer = calendar1.value;
		var DateOlder = calendar2.value;

		return fetch(`/api/v1/operations?tag=${tag}&name=${name}&newer=${DateNewer}&older=${DateOlder}`, {
			cache: "no-cache"
		})
			.then((response) => response.json())
			.then((data) => {
				OpList = data;

				// Set select
				if (filterTagGameInput.innerHTML == "") {
					var tags = [];
					var option = document.createElement("option");
					option.value = "";
					option.text = "All";
					filterTagGameInput.appendChild(option);

					OpList.forEach(op => {
						if (!tags.includes(op.tag)) {
							tags.push(op.tag);
							var option = document.createElement("option");
							option.value = op.tag;
							option.text = op.tag;

							filterTagGameInput.appendChild(option);
						}
					})
				}

				// Set body
				var table = document.createElement("table");
				var headerRow = document.createElement("tr");

				var columnNames = ["mission", "map", "data", "durability", "tag"];
				columnNames.forEach(function(name) {
					var th = document.createElement("th");
					localizable(th, name);
					th.className = "medium";
					headerRow.appendChild(th);
				});
				table.appendChild(headerRow);

				OpList.forEach((op) => {
					var row = document.createElement("tr");
					var cell = document.createElement("td");

					var vals = [
						op.mission_name,
						op.world_name,
						dateToLittleEndianString(new Date(op.date)),
						secondsToTimeString(op.mission_duration),
						op.tag
					];
					vals.forEach(function(val) {
						var cell = document.createElement("td");
						cell.textContent = val;
						row.appendChild(cell);
					});

					row.addEventListener("click", () => {
						localizable(this.modalBody, "loading");
						processOp("data/" + op.filename);
					});
					table.insertBefore(row, table.childNodes[1]);
				});
				this.modalBody.textContent = "";
				this.modalBody.appendChild(table);
			});
	};

	makeModalButton(text, func) {
		var button = document.createElement("div");
		button.className = "modalButton";
		button.textContent = text;
		button.addEventListener("click", func);

		return button;
	};

	showModalStats() {
		// localizable(this.statsDialogHeader, "info");

		const units = [];
		for (const entity of entities.getAll()) {
			const isPlayer = entity._positions.some((position) => position.isPlayer > 0);
			if (!isPlayer) continue;

			if (entity instanceof Unit) {
				const unit = units.find((unit) => unit.name === entity._name);
				if (unit) {
					unit.killCount += entity.killCount;
					unit.teamKillCount += entity.teamKillCount;
					if (entity.deathCount > 0) {
						unit.deathCount += entity.deathCount - 1;
					}
				} else {
					units.push({
						name: entity._name,
						killCount: entity.killCount,
						teamKillCount: entity.teamKillCount,
						deathCount: entity.deathCount,
					});
				}
			}
		}
		units.sort((a,b) => {
			if (a.name < b.name) return -1;
			if (a.name > b.name) return 1;
			return 0;
		});

		let content = `
		<table class="stats">
			<tr>
				<th class="name">Name</th>
		`;
		if (!ui.disableKillCount) {
			content += `
				<th class="kills">Kills</th>
				<th class="tkills">TKills</th>
				<th class="deaths">Deaths</th>
			`;
		}
		content += `</tr>`;
		for (const unit of units) {
			content += `
			<tr>
				<td class="name">${unit.name.encodeHTMLEntities()}</td>
			`;
			if (!ui.disableKillCount) {
				content += `
				<td class="kills">${unit.killCount}</td>
				<td class="tkills">${unit.teamKillCount}</td>
				<td class="deaths">${unit.deathCount}</td>
			`;
			}
			content += `</tr>`;
		}
		content += `</table>`;

		this.statsDialogBody.innerHTML = content;

		this.statsDialogFooter.appendChild(this.makeModalButton("Close", () => {
			this.statsDialog.classList.add("closed");
		}));
		this.statsDialog.classList.remove("closed");
	};

	showModalAbout() {
		localizable(this.modalHeader, "info");

		this.modalBody.innerHTML = `
			<img src="images/ocap-logo.png" height="60px" alt="OCAP">
			<h4 style=line-height:0>Operation Capture And Playback</h4>
			<a href="https://github.com/OCAP2/OCAP" target="_blank">GitHub Link</a>
			<br/>
			<br/>
			<span id="keyControl-playPause"></span><br/>
			<span id="keyControl-leftPanel"></span><br/>
			<span id="keyControl-rightPanel"></span><br/>
			<span id="keyControl-experimental"></span><br/>
			<span id="keyControl-lang"></span>
			<select id="switchLang">
				<option value="ru"${current_lang == "ru" ? 'selected/' : ''}>Русский</option>
				<option value="en"${current_lang == "en" ? 'selected/' : ''}>English</option>
				<option value="de"${current_lang == "de" ? 'selected/' : ''}>Deutsch</option>
			</select>`;
		localizable(document.getElementById("keyControl-playPause"), "play-pause");
		localizable(document.getElementById("keyControl-leftPanel"), "show-hide-left-panel");
		localizable(document.getElementById("keyControl-rightPanel"), "show-hide-right-panel");
		localizable(document.getElementById("keyControl-experimental"), "show-experimental");
		localizable(document.getElementById("keyControl-lang"), "language");
		document.getElementById("switchLang").onchange = function(){switchLocalizable(this.value)};
		deleteLocalizable(this.modalBody);
		this.modalButtons.innerHTML = "";
		this.modalButtons.appendChild(this.makeModalButton("Close", function() {
			ui.hideModal();
		}));

		this.showModal();
	};

	showModalShare() {
		this.modal.wasStopped = false;
		if (!playbackPaused) {
			this.modal.wasStopped = true;
			playPause();
		}
		localizable(this.modalHeader, "shared");
		localizable(this.modalBody, "copy_link", `</h2> </center>
		<input readonly="true" type="text" id="ShareLink">`, `<center> <h2 style="color:white">`);

		let text = "http://" + document.location.host + "/?";
		text += "file=" + fileName;
		text += "&frame=" + playbackFrame;
		text += "&zoom=" + map.getZoom();
		text += "&x=" + map.getCenter().lat;
		text += "&y=" + map.getCenter().lng;

		let line = document.getElementById("ShareLink");
		line.value = text;
		line.addEventListener("click", function(event) {
			this.select();
		});

		this.modalButtons.innerHTML = "";
		this.modalButtons.appendChild(this.makeModalButton(getLocalizable("close"), function() {
			ui.hideModal();
			if (ui.modal.wasStopped) {
				playPause();
			}
		}));

		this.showModal();
	};

	showModal() {
		this.modal.style.display = "inherit";
	};

	hideModal() {
		this.modal.style.display = "none";
		this.modalFilter.style.display = "none";
	};

	showPlaybackSpeedSlider() {
		this.playbackSpeedSlider.style.display = "inherit";
	};

	hidePlaybackSpeedSlider() {
		this.playbackSpeedSlider.style.display = "none";
	};

	removeEvent(event) {
		var el = event.getElement();
		el.classList.remove("reveal");

		// Remove element if not already removed
		if (el.parentNode != null) {
			this.eventList.removeChild(el);
		}
	};

	addEvent(event) {
		if (typeof event.updateTime === "function") {
			event.updateTime();
		}
		var el = event.getElement();
		el.classList.add("liEvent");

		// Add element if not already added
		if (el.parentNode == null) {
			this.eventList.insertBefore(el, this.eventList.childNodes[0]);

			// Fade element in if occurred on current frame
			if (event.frameNum != playbackFrame) {
				el.classList.add("reveal");
			} else {
				setTimeout(() => {
					el.classList.add("reveal");
				}, 100);
			}
		}

/*		if (event.type == "hit") {
			if (this.showHitEvents) {
				el.style.display = "inherit";
			} else {
				el.style.display = "none";
			};
		};*/

		this.filterEvent(event);
	}

	updateEventTimes() {
		for (const event of gameEvents.getActiveEvents()) {
			event.updateTime();
		}
	}

	showHint(text) {
		this.hint.textContent = text;
		this.hint.style.display = "inherit";

		setTimeout(() => {
			this.hint.style.display = "none";
		}, 5000);
	};

	addTickToTimeline(frameNum) {
		var frameWidth = this.frameSliderWidthInPercent / endFrame;
		var tick = document.createElement("div");

		tick.className = "eventTimelineTick";
		tick.style.left = (frameNum * frameWidth) + "%"; // We use percent so position of tick maintains even on window resize
		tick.style.width = frameWidth + "%";
		this.eventTimeline.appendChild(tick);
	};

	filterEvent(event) {
		var el = event.getElement();
		var filterText = this.filterEventsInput.value.toLowerCase();

		var isHitEvent = (event.type == "hit");
		var isConnectEvent = (event.type == "connected" || event.type == "disconnected");

		//if (filterText == "") {return};

		//TODO: Use .textContent instead of .innerHTML for increased performance
		if (isHitEvent && !this.showHitEvents) {
			el.style.display = "none";
		} else if (isConnectEvent && !this.showConnectEvents) {
			el.style.display = "none";
		} else if (el.innerHTML.toLowerCase().includes(filterText)) {
			el.style.display = "inherit";
				//console.log("Matches filter (" + filterText + ")");
		} else {
			el.style.display = "none";
		}
	}

	updateCustomize() {
		return fetch("/api/v1/customize")
			.then(response => response.json())
			.then((data) => {
				const container = document.getElementById("container");

				if (data.websiteLogo) {
					const logo = document.createElement("div");
					logo.className = "customize logo"
					logo.style.backgroundImage = `url("${data.websiteLogo}")`;
					logo.style.backgroundSize = data.websiteLogoSize;
					logo.style.width = data.websiteLogoSize;
					logo.style.height = data.websiteLogoSize;

					if (data.websiteURL) {
						const link = document.createElement("a");
						link.target = "_blank";
						link.href = data.websiteURL;
						link.append(logo);
						container.prepend(link);
					} else {
						container.prepend(logo);
					}
				}

				this.disableKillCount = data.disableKillCount;
				// this.useCloudTiles = data.useCloudTiles;
			});
	}

	showExperimental() {
		this.statsButton.classList.remove("hiddenExperimental");
		const container = document.getElementById("container");
		container.classList.add("marker-transition");
	}
}

