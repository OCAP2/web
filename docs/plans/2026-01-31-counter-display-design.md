# Counter/Score Display Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Display counter/score values during mission playback for respawn tickets and custom counters.

**Architecture:** Add counter state tracking to ocap.js, parse counter events from both JSON and streaming modes, render scores in top panel next to mission name. Hidden when mission has no counter data.

**Tech Stack:** Vanilla JavaScript, CSS, HTML

---

## Task 1: Add HTML Element

**Files:**
- Modify: `static/index.html:47-48`

**Step 1: Add counterDisplay div after missionName**

In `static/index.html`, after line 47 (`<span id="missionName"...`), add:

```html
<span id="missionName" class="medium"></span>
<div id="counterDisplay" style="display: none;"></div>
```

**Step 2: Verify change**

Open index.html and confirm the element exists after missionName.

**Step 3: Commit**

```bash
git add static/index.html
git commit -m "$(cat <<'EOF'
feat(counter): add counterDisplay element to top panel

Part of OCAP2/OCAP#9 - counter/score display implementation
EOF
)"
```

---

## Task 2: Add CSS Styles

**Files:**
- Modify: `static/style/index.css` (after `#missionName` styles, ~line 87)

**Step 1: Add counter display styles**

After the `#missionName` rule (around line 87), add:

```css
#counterDisplay {
	float: left;
	display: inline-block;
	font-size: 18px;
	margin: 10px 15px;
	padding-left: 15px;
	border-left: 1px solid #666;
	color: #F2F2F2;
}

#counterDisplay .side-score {
	margin: 0 6px;
}

#counterDisplay .separator {
	margin: 0 4px;
	color: #888;
}
```

**Step 2: Verify styles render**

Temporarily remove `style="display: none;"` from index.html, add test content to counterDisplay, and check it appears correctly.

**Step 3: Commit**

```bash
git add static/style/index.css
git commit -m "$(cat <<'EOF'
feat(counter): add CSS styles for counter display

Part of OCAP2/OCAP#9 - counter/score display implementation
EOF
)"
```

---

## Task 3: Add Counter State and Helper Functions

**Files:**
- Modify: `static/scripts/ocap.js:91-92` (after countCiv declaration)

**Step 1: Add counterState object and helper functions**

After line 91 (`var countCiv = 0;`), add:

```javascript
// Counter/score state for respawn tickets and custom counters
var counterState = {
	active: false,           // Whether to show counter UI
	type: null,              // 'respawnTickets' or 'custom'
	sides: [],               // Array of side names being tracked (e.g., ['WEST', 'EAST'])
	events: []               // Sorted list of {frameNum, values} for scrubbing
};

// Side name mapping for respawnTickets (indices: missionNS=0, east=1, west=2, ind=3)
var respawnTicketsSideMap = {
	1: 'EAST',
	2: 'WEST',
	3: 'GUER'
};

// Display labels for sides
var sideDisplayLabels = {
	'WEST': 'BLUFOR',
	'EAST': 'OPFOR',
	'GUER': 'IND',
	'CIV': 'CIV'
};

// CSS classes for side colors
var sideColorClasses = {
	'WEST': 'blufor',
	'EAST': 'opfor',
	'GUER': 'ind',
	'CIV': 'civ'
};

/**
 * Get counter values at a specific frame (for scrubbing support)
 * @param {number} f - Frame number
 * @returns {Object|null} - Values object {WEST: 5, EAST: 3} or null
 */
function getCounterValuesAtFrame(f) {
	let result = null;
	for (const evt of counterState.events) {
		if (evt.frameNum <= f) {
			result = evt.values;
		} else {
			break;
		}
	}
	return result;
}

/**
 * Update the counter display UI for the given frame
 * @param {number} f - Frame number
 */
function updateCounterDisplay(f) {
	const display = document.getElementById('counterDisplay');
	if (!display) return;

	if (!counterState.active || counterState.sides.length === 0) {
		display.style.display = 'none';
		return;
	}

	const values = getCounterValuesAtFrame(f);
	if (!values) {
		display.style.display = 'none';
		return;
	}

	// Build display content: "BLUFOR 5 : 3 OPFOR"
	let html = '';
	counterState.sides.forEach((side, index) => {
		if (index > 0) {
			html += '<span class="separator">:</span>';
		}
		const label = sideDisplayLabels[side] || side;
		const colorClass = sideColorClasses[side] || '';
		const value = values[side] !== undefined ? values[side] : '?';
		html += `<span class="side-score ${colorClass}">${label} ${value}</span>`;
	});

	display.innerHTML = html;
	display.style.display = 'inline-block';
}

/**
 * Reset counter state (call when loading new operation)
 */
function resetCounterState() {
	counterState.active = false;
	counterState.type = null;
	counterState.sides = [];
	counterState.events = [];
	const display = document.getElementById('counterDisplay');
	if (display) {
		display.style.display = 'none';
		display.innerHTML = '';
	}
}

/**
 * Process a counter event and update state
 * @param {number} frameNum - Frame number
 * @param {string} type - Event type (respawnTickets, counterInit, counterSet)
 * @param {Array} data - Event data
 */
function processCounterEvent(frameNum, type, data) {
	if (type === 'counterInit') {
		// Custom counter initialization - data is array of sides
		// Only use custom counter if not already using one
		if (counterState.type !== 'custom') {
			counterState.active = true;
			counterState.type = 'custom';
			counterState.sides = data.map(side => {
				// Normalize side names (handle both "west" and "WEST")
				if (typeof side === 'string') {
					return side.toUpperCase();
				}
				return side;
			});
			counterState.events = [];
		}
	} else if (type === 'counterSet') {
		// Custom counter update - data is array of values matching sides order
		if (counterState.type === 'custom' && counterState.sides.length > 0) {
			const values = {};
			counterState.sides.forEach((side, index) => {
				values[side] = data[index] !== undefined ? data[index] : 0;
			});
			counterState.events.push({ frameNum, values });
		}
	} else if (type === 'respawnTickets') {
		// BIS respawn tickets - data is [missionNS, east, west, ind]
		// Only use if no custom counter is active
		if (counterState.type !== 'custom') {
			// Check if any tickets are actually used (not all -1)
			const hasValidTickets = data.some((val, idx) => idx > 0 && val >= 0);
			if (hasValidTickets) {
				if (!counterState.active) {
					counterState.active = true;
					counterState.type = 'respawnTickets';
					// Determine which sides have valid tickets
					counterState.sides = [];
					[1, 2, 3].forEach(idx => {
						if (data[idx] >= 0 && respawnTicketsSideMap[idx]) {
							counterState.sides.push(respawnTicketsSideMap[idx]);
						}
					});
				}
				// Add event with values
				const values = {};
				counterState.sides.forEach(side => {
					const idx = Object.keys(respawnTicketsSideMap).find(k => respawnTicketsSideMap[k] === side);
					if (idx !== undefined) {
						values[side] = data[idx];
					}
				});
				counterState.events.push({ frameNum, values });
			}
		}
	}
}
```

**Step 2: Verify no syntax errors**

Open browser dev tools, ensure no JavaScript errors on page load.

**Step 3: Commit**

```bash
git add static/scripts/ocap.js
git commit -m "$(cat <<'EOF'
feat(counter): add counter state and helper functions

Adds counterState object, getCounterValuesAtFrame(), updateCounterDisplay(),
resetCounterState(), and processCounterEvent() functions.

Part of OCAP2/OCAP#9 - counter/score display implementation
EOF
)"
```

---

## Task 4: Add Counter Event Parsing (JSON Mode)

**Files:**
- Modify: `static/scripts/ocap.js:1205-1208` (inside event switch statement)

**Step 1: Add counter event cases to JSON mode switch**

In the switch statement at line 1118, before the closing `}` of the switch (around line 1208), add these cases:

```javascript
				case (type == "generalEvent"):
					gameEvent = new generalEvent(frameNum, type, eventJSON[2]);
					break;
				case (type === "respawnTickets"):
					processCounterEvent(frameNum, type, eventJSON[2]);
					break;
				case (type === "counterInit"):
					processCounterEvent(frameNum, type, eventJSON[2]);
					break;
				case (type === "counterSet"):
					processCounterEvent(frameNum, type, eventJSON[2]);
					break;
			}
```

**Step 2: Add resetCounterState call at start of loadOperation**

Find `function loadOperation` (around line 989) and add `resetCounterState();` near the beginning after the existing variable resets. Look for where `markers = [];` is set and add after it:

```javascript
			markers = [];
			resetCounterState();
```

**Step 3: Verify by checking console**

Load a mission with respawnTickets events, check console for any errors.

**Step 4: Commit**

```bash
git add static/scripts/ocap.js
git commit -m "$(cat <<'EOF'
feat(counter): parse counter events in JSON mode

Handles respawnTickets, counterInit, and counterSet events during
JSON mission loading.

Part of OCAP2/OCAP#9 - counter/score display implementation
EOF
)"
```

---

## Task 5: Add Counter Event Parsing (Streaming Mode)

**Files:**
- Modify: `static/scripts/ocap.js:1738-1745` (inside streaming mode event switch)

**Step 1: Add counter event cases to streaming mode switch**

In the streaming mode event switch (around line 1717), before the closing `}`, add:

```javascript
			case 'respawnTickets':
				processCounterEvent(evt.frameNum, evt.type, JSON.parse(evt.message));
				break;
			case 'counterInit':
				processCounterEvent(evt.frameNum, evt.type, JSON.parse(evt.message));
				break;
			case 'counterSet':
				processCounterEvent(evt.frameNum, evt.type, JSON.parse(evt.message));
				break;
		}
```

**Step 2: Add resetCounterState call in loadStreamingOperation**

Find `async function loadStreamingOperation` (around line 1596) and add `resetCounterState();` near the beginning, similar to JSON mode.

**Step 3: Commit**

```bash
git add static/scripts/ocap.js
git commit -m "$(cat <<'EOF'
feat(counter): parse counter events in streaming mode

Handles respawnTickets, counterInit, and counterSet events from
manifest in streaming playback mode.

Part of OCAP2/OCAP#9 - counter/score display implementation
EOF
)"
```

---

## Task 6: Call updateCounterDisplay in Playback Loops

**Files:**
- Modify: `static/scripts/ocap.js:1420` (JSON playback loop)
- Modify: `static/scripts/ocap.js:1943` (streaming playback loop)

**Step 1: Add updateCounterDisplay call in JSON playback loop**

In `startPlaybackLoop` function, after line 1420 (`ui.setMissionCurTime(playbackFrame);`), add:

```javascript
				ui.setMissionCurTime(playbackFrame);
				updateCounterDisplay(playbackFrame);
```

**Step 2: Add updateCounterDisplay call in streaming playback loop**

In `startStreamingPlaybackLoop` function, after line 1943 (`ui.setMissionCurTime(playbackFrame);`), add:

```javascript
				ui.setMissionCurTime(playbackFrame);
				updateCounterDisplay(playbackFrame);
```

**Step 3: Commit**

```bash
git add static/scripts/ocap.js
git commit -m "$(cat <<'EOF'
feat(counter): update counter display during playback

Calls updateCounterDisplay() in both JSON and streaming playback loops.

Part of OCAP2/OCAP#9 - counter/score display implementation
EOF
)"
```

---

## Task 7: Call updateCounterDisplay on Scrubbing

**Files:**
- Modify: `static/scripts/ocap.ui.js:406-407`

**Step 1: Add updateCounterDisplay call in setMissionCurTime**

In `ocap.ui.js`, in the `setMissionCurTime` method (around line 398), after the event updates, add:

```javascript
		for (const event of gameEvents.getEvents().reverse()) {
			event.update(f);
		}

		// Update counter display when scrubbing
		if (typeof updateCounterDisplay === 'function') {
			updateCounterDisplay(f);
		}
	}
```

**Step 2: Commit**

```bash
git add static/scripts/ocap.ui.js
git commit -m "$(cat <<'EOF'
feat(counter): update counter display on timeline scrubbing

Calls updateCounterDisplay() when user scrubs the timeline slider.

Part of OCAP2/OCAP#9 - counter/score display implementation
EOF
)"
```

---

## Task 8: Test and Verify

**Step 1: Test with existing mission data**

Load the mission at `data/2026_01_21__22_58_AntistasiPulau.json.gz.gz` which has respawnTickets events (all -1, so counter should remain hidden).

**Step 2: Verify counter is hidden for missions without valid counters**

Confirm the counterDisplay element remains hidden (display: none).

**Step 3: Test scrubbing**

Use the timeline slider to jump to different frames, verify no errors in console.

**Step 4: Final commit**

```bash
git add -A
git commit -m "$(cat <<'EOF'
feat(counter): complete counter/score display implementation

Implements OCAP2/OCAP#9 - displays respawn tickets and custom counters
during mission playback. Hidden when mission doesn't use counters.

Features:
- Supports respawnTickets (BIS native system)
- Supports counterInit/counterSet (custom counters)
- Updates during playback and scrubbing
- Works in both JSON and streaming modes
EOF
)"
```

---

## Summary

| Task | Description | Files |
|------|-------------|-------|
| 1 | Add HTML element | index.html |
| 2 | Add CSS styles | index.css |
| 3 | Add counter state and functions | ocap.js |
| 4 | Parse events (JSON mode) | ocap.js |
| 5 | Parse events (streaming mode) | ocap.js |
| 6 | Update in playback loops | ocap.js |
| 7 | Update on scrubbing | ocap.ui.js |
| 8 | Test and verify | - |
