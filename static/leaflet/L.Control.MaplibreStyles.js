L.Control.MaplibreStyles = L.Control.extend({
	options: {
		position: 'bottomright'
	},

	_storageKey: 'ocap-maplibre-style',

	initialize: function (maplibreLayer, candidates, opts) {
		L.setOptions(this, opts);
		this._mlLayer = maplibreLayer;
		this._candidates = candidates; // Array of {label, url}
		this._active = -1;
	},

	onAdd: function () {
		var container = L.DomUtil.create('div', 'maplibre-styles leaflet-control');
		L.DomEvent.disableClickPropagation(container);

		// Start hidden until probing completes
		container.style.display = 'none';
		this._container = container;
		this._buttons = [];

		var self = this;

		// Probe each candidate — use GET with an AbortController to avoid
		// browser-console 404 noise from HEAD/fetch (network-level 404 logs
		// cannot be suppressed, but aborting early keeps them minimal).
		console.log('[OCAP] Probing', this._candidates.length, 'style candidates...');
		var probes = this._candidates.map(function (candidate, i) {
			var ctrl = new AbortController();
			return fetch(candidate.url, { method: 'HEAD', signal: ctrl.signal })
				.then(function (res) {
					ctrl.abort(); // we only needed the status
					return { index: i, ok: res.ok };
				})
				.catch(function () { return { index: i, ok: false }; });
		});

		Promise.all(probes).then(function (results) {
			var availableIndices = [];

			results.forEach(function (result) {
				var candidate = self._candidates[result.index];
				var btn = L.DomUtil.create('button', '', container);
				btn.textContent = candidate.label;

				if (result.ok) {
					availableIndices.push(result.index);
					console.log('[OCAP] Style "' + candidate.label + '" available');
					L.DomEvent.on(btn, 'click', function () {
						if (result.index === self._active) return;
						self._setStyle(result.index);
					});
				} else {
					console.log('[OCAP] Style "' + candidate.label + '" not found, hiding button');
					btn.style.display = 'none';
				}

				self._buttons[result.index] = btn;
			});

			// Hide entire control if 1 or fewer styles available
			if (availableIndices.length <= 1) {
				console.log('[OCAP] Style switcher hidden (' + availableIndices.length + ' style available)');
				return;
			}

			container.style.display = '';

			// Resolve saved preference — must be an available index
			var saved = self._loadPreference(availableIndices);
			var activeIdx = saved !== null ? saved : availableIndices[0];

			self._active = activeIdx;
			L.DomUtil.addClass(self._buttons[activeIdx], 'active');

			// Switch to the preferred style if it differs from the initially loaded one
			var glMap = self._mlLayer.getMaplibreMap();
			if (glMap) {
				glMap.setStyle(self._candidates[activeIdx].url);
			}
		});

		return container;
	},

	_setStyle: function (index) {
		var glMap = this._mlLayer.getMaplibreMap();
		if (!glMap) return;

		if (this._active >= 0 && this._buttons[this._active]) {
			L.DomUtil.removeClass(this._buttons[this._active], 'active');
		}
		this._active = index;
		L.DomUtil.addClass(this._buttons[this._active], 'active');

		glMap.setStyle(this._candidates[index].url);
		this._savePreference(index);
	},

	_savePreference: function (index) {
		try { localStorage.setItem(this._storageKey, index); } catch (e) {}
	},

	_loadPreference: function (availableIndices) {
		try {
			var val = localStorage.getItem(this._storageKey);
			if (val !== null) {
				var idx = parseInt(val, 10);
				if (availableIndices.indexOf(idx) !== -1) return idx;
			}
		} catch (e) {}
		return null;
	}
});

L.control.maplibreStyles = function (maplibreLayer, candidates, opts) {
	return new L.Control.MaplibreStyles(maplibreLayer, candidates, opts);
};
