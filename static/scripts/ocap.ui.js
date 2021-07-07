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
		this.missionName = null;
		//this.loadOpButton = null;
		this.playPauseButton = null;
		this.playbackSpeedSliderContainer = null;
		this.playbackSpeedSlider = null;
		this.playbackSpeedVal = null;
		this.aboutButton = null;
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
		this.nicknameEnable = true;
		this.filterTypeGameInput = null;
		this.filterGameInput = null;
		this.calendar1 = null;
		this.calendar2 = null;
		this.filterSubmit = null;

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

		// About button
		var aboutButton = document.getElementById("aboutButton");
		aboutButton.addEventListener("click", () => {
			this.showModalAbout();
		});
		this.aboutButton = aboutButton;

		this.shareButton = document.getElementById("shareButton");
		this.shareButton.addEventListener("click", () => {
			this.showModalShare();
		});

		// Nickname show/hide vehicle && player
		var toggleNicknameButton = document.getElementById("toggleNickname");
		toggleNicknameButton.addEventListener("click", () => {
			this.nicknameEnable = !this.nicknameEnable;
			var text;
			if (this.nicknameEnable) {
				toggleNicknameButton.style.opacity = 1;
				text = getLocalizable("shown");
			} else {
				toggleNicknameButton.style.opacity = 0.5;
				text = getLocalizable("hidden");
			}
			this.showHint(getLocalizable("nickname") + text);
		});
		this.toggleNicknameButton = toggleNicknameButton;
		// Toggle firelines button
		var toggleFirelinesButton = document.getElementById("toggleFirelines");
		toggleFirelinesButton.addEventListener("click", () => {
			this.firelinesEnabled = !this.firelinesEnabled;

			var text;
			if (this.firelinesEnabled) {
				toggleFirelinesButton.style.opacity = 1;
				text = getLocalizable("shown");
			} else {
				toggleFirelinesButton.style.opacity = 0.5;
				text = getLocalizable("hidden");
			}

			this.showHint(getLocalizable("line_fire") + text);
		});
		this.toggleFirelinesButton = toggleFirelinesButton;

		// Toggle markers button
		var toggleMarkersButton = document.getElementById("toggleMapMarker");
		toggleMarkersButton.addEventListener("click", () => {
			this.markersEnable = !this.markersEnable;

			var text;
			if (this.markersEnable) {
				toggleMarkersButton.style.opacity = 1;
				text = getLocalizable("shown");
			} else {
				toggleMarkersButton.style.opacity = 0.5;
				text = getLocalizable("hidden");
			}

			this.showHint(getLocalizable("markers") + text);
		});
		this.toggleMarkersButton = toggleMarkersButton;

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
		this.filterTypeGameInput = document.getElementById("filterTypeGameInput");
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
			//console.log(event.charCode);

			switch (event.charCode) {
				case 101: // e
					this.toggleLeftPanel();
					break;
				case 114: // r
					this.toggleRightPanel();
					break;
			}
		});


		// Modal
		this.setModal(
			document.getElementById("modal"),
			document.getElementById("modalHeader"),
			document.getElementById("modalFilter"),
			document.getElementById("modalBody"),
			document.getElementById("modalButtons")
		);
		this.showModalOpSelection();

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
			let sliderVal = this.playbackSpeedSlider.value;
			this.playbackSpeedVal.textContent = sliderVal + "x";
			playbackMultiplier = sliderVal;
		});

		this.frameSliderWidthInPercent = (this.frameSlider.offsetWidth / this.frameSlider.parentElement.offsetWidth) * 100;
	};

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
	};

	_moveCursorTooltip(event) {
		ui.cursorTooltip.style.transform = `translate3d(${event.pageX}px, ${event.pageY}px, 0px)`;
	};

	setMissionName(name) {
		this.missionName.textContent = name;
	};

	// Set mission time based on given frame
	// Move playback + slider to given frame in time
	setMissionCurTime(f) {
		missionCurDate.setTime(f*frameCaptureDelay);
		this.missionCurTime.textContent = dateToTimeString(missionCurDate);
		this.setFrameSliderVal(f);
		playbackFrame = f;
	};

	setMissionEndTime(f) {
		this.missionEndTime.textContent = dateToTimeString(new Date(f*frameCaptureDelay));
		this.setFrameSliderMax(f);
	};

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

	setModal(modal, modalHeader, modalFilter, modalBody, modalButtons) {
		this.modal = modal;
		this.modalHeader = modalHeader;
		this.modalFilter = modalFilter;
		this.modalBody = modalBody;
		this.modalButtons = modalButtons;
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
		var n = filterTypeGameInput.options.selectedIndex;
		var type = filterTypeGameInput.options[n].value;
		var name = filterGameInput.value;
		var DateNewer = calendar1.value;
		var DateOlder = calendar2.value;
		$.ajax({
			url: '/api/v1/operations/get',
			type : "get",
			async : false,
			cache : false,
			data: `type=${type}&name=${name}&newer=${DateNewer}&older=${DateOlder}`,
			success: function(data){
				OpList = data
			}
		});

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
				op.type
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
	};

	makeModalButton(text, func) {
		var button = document.createElement("div");
		button.className = "modalButton";
		button.textContent = text;
		button.addEventListener("click", func);

		return button;
	};

	showModalAbout() {
		localizable(this.modalHeader, "info");

		this.modalBody.innerHTML = `
			<img src="images/ocap-logo.png" height="60px" alt="OCAP">
			<h4 style=line-height:0>${appDesc} (BETA)</h4>
			<h5 style=line-height:0>v${appVersion}</h5>
			Author: MisterGoodson (aka Goodson [3CB]) <br/>
			<a href="https://forums.bistudio.com/forums/topic/194164-ocap-operation-capture-and-playback-aar-system/" target="_blank">BI Forum Post</a><br/>
			<a href="https://github.com/mistergoodson/OCAP" target="_blank">GitHub Link</a>
			<br/>
			<br/>
			Modified: Dell, Zealot, Kurt<br/>
			<a href="https://github.com/Zealot111/OCAP" target="_blank">GitHub Link</a>
			<br/>
			<br/>
			Further Modified: IndigoFox, Zealot<br/>
			<a href="https://github.com/indig0fox/OCAP" target="_blank">GitHub Link</a>
			<br/>
			<br/>
			<span id="keyControl-playPause"></span><br/>
			<span id="keyControl-leftPanel"></span><br/>
			<span id="keyControl-rightPanel"></span><br/>
			<span id="keyControl-lang"></span>
			<select id="switchLang">
				<option value="ru"${current_lang == "ru" ? 'selected/' : ''}>Русский</option>
				<option value="en"${current_lang == "en" ? 'selected/' : ''}>English</option>
				<option value="de"${current_lang == "de" ? 'selected/' : ''}>Deutsch</option>
			</select>`;
		localizable(document.getElementById("keyControl-playPause"), "play-pause");
		localizable(document.getElementById("keyControl-leftPanel"), "show-hide-left-panel");
		localizable(document.getElementById("keyControl-rightPanel"), "show-hide-right-panel");
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

		// Remove element if not already removed
		if (el.parentNode != null) {
			this.eventList.removeChild(el);
		}
	};

	addEvent(event) {
		var el = event.getElement();

		// Add element if not already added
		if (el.parentNode == null) {
			this.eventList.insertBefore(el, this.eventList.childNodes[0]);

			// Fade element in if occured on current frame
			if (event.frameNum != playbackFrame) {
				el.className = "liEvent reveal";
			} else {
				el.className = "liEvent";
				setTimeout(() => {
					el.className = "liEvent reveal";
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
	};

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
	};
}

