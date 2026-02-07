L.Control.MaplibreStyles = L.Control.extend({
	options: {
		position: 'bottomright',
		center: [0, 0],  // [lat, lng] for the preview snapshot
		zoom: 12
	},

	_storageKey: 'ocap-maplibre-style',

	initialize: function (maplibreLayer, candidates, opts) {
		L.setOptions(this, opts);
		this._mlLayer = maplibreLayer;
		this._candidates = candidates; // Array of {label, url, iconURL?}
		this._active = -1;
	},

	onAdd: function () {
		var container = L.DomUtil.create('div', 'maplibre-styles leaflet-control closed');
		L.DomEvent.disableClickPropagation(container);
		if (!L.Browser.touch) {
			L.DomEvent.disableScrollPropagation(container);
		}

		// Start hidden until probing completes
		container.style.display = 'none';
		this._container = container;
		this._items = [];

		var self = this;

		// Probe each candidate
		console.log('[OCAP] Probing', this._candidates.length, 'style candidates...');
		var probes = this._candidates.map(function (candidate, i) {
			var ctrl = new AbortController();
			return fetch(candidate.url, { method: 'HEAD', signal: ctrl.signal })
				.then(function (res) {
					ctrl.abort();
					return { index: i, ok: res.ok };
				})
				.catch(function () { return { index: i, ok: false }; });
		});

		Promise.all(probes).then(function (results) {
			var availableIndices = [];

			results.forEach(function (result) {
				var candidate = self._candidates[result.index];
				var item = L.DomUtil.create('div', 'maplibre-style-item', container);
				var img = L.DomUtil.create('img', '', item);
				img.title = candidate.label;
				// 1x1 transparent pixel as placeholder until preview renders
				img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

				if (result.ok) {
					availableIndices.push(result.index);
					console.log('[OCAP] Style "' + candidate.label + '" available');

					if (candidate.iconURL) {
						img.src = candidate.iconURL;
					} else {
						self._renderPreview(candidate.url, function (dataUrl) {
							if (dataUrl) img.src = dataUrl;
						});
					}

					L.DomEvent.on(item, 'click', function () {
						if (self._candidates.length > 2 && L.Browser.mobile &&
							L.DomUtil.hasClass(container, 'closed')) {
							L.DomUtil.removeClass(container, 'closed');
							return;
						}
						if (result.index === self._active) return;
						self._setStyle(result.index);
						L.DomUtil.addClass(container, 'closed');
					});
				} else {
					console.log('[OCAP] Style "' + candidate.label + '" not found, hiding');
					item.style.display = 'none';
				}

				self._items[result.index] = item;
			});

			// Hide entire control if 1 or fewer styles available
			if (availableIndices.length <= 1) {
				console.log('[OCAP] Style switcher hidden (' + availableIndices.length + ' style available)');
				return;
			}

			container.style.display = '';

			// Resolve saved preference
			var saved = self._loadPreference(availableIndices);
			var activeIdx = saved !== null ? saved : availableIndices[0];

			self._active = activeIdx;
			L.DomUtil.addClass(self._items[activeIdx], 'active');

			// Cache available indices for use in _setStyle
			self._availableIndices = availableIndices;

			// Set "alt" on the next available style (shown when collapsed)
			self._updateAlt();

			// Expand/collapse on hover for non-mobile
			if (availableIndices.length > 1 && !L.Browser.mobile) {
				L.DomEvent.on(container, 'mouseenter', function () {
					L.DomUtil.removeClass(container, 'closed');
				});
				L.DomEvent.on(container, 'mouseleave', function () {
					L.DomUtil.addClass(container, 'closed');
				});
			}

			// Switch to the preferred style if it differs from the initially loaded one
			var glMap = self._mlLayer.getMaplibreMap();
			if (glMap) {
				glMap.setStyle(self._candidates[activeIdx].url);
			}
		});

		return container;
	},

	_renderPreview: function (styleUrl, callback) {
		// center is [lat, lng] from Leaflet convention; MapLibre expects [lng, lat]
		var center = [this.options.center[1], this.options.center[0]];
		var zoom = this.options.zoom;

		var div = document.createElement('div');
		div.style.width = '128px';
		div.style.height = '128px';
		div.style.position = 'absolute';
		div.style.left = '-9999px';
		div.style.top = '-9999px';
		div.style.visibility = 'hidden';
		document.body.appendChild(div);

		var miniMap = new maplibregl.Map({
			container: div,
			style: styleUrl,
			center: center,
			zoom: zoom,
			interactive: false,
			attributionControl: false,
			preserveDrawingBuffer: true
		});

		var timeoutId = setTimeout(function () {
			if (div.parentNode) {
				try { miniMap.remove(); } catch (e) {}
				document.body.removeChild(div);
			}
		}, 10000);

		miniMap.once('idle', function () {
			clearTimeout(timeoutId);
			if (!div.parentNode) return;
			try {
				var dataUrl = miniMap.getCanvas().toDataURL();
				callback(dataUrl);
			} catch (e) {
				callback(null);
			}
			miniMap.remove();
			document.body.removeChild(div);
		});
	},

	_setStyle: function (index) {
		var glMap = this._mlLayer.getMaplibreMap();
		if (!glMap) return;

		if (this._active >= 0 && this._items[this._active]) {
			L.DomUtil.removeClass(this._items[this._active], 'active');
		}
		this._active = index;
		L.DomUtil.addClass(this._items[this._active], 'active');

		this._updateAlt();

		glMap.setStyle(this._candidates[index].url);
		this._savePreference(index);
	},

	_updateAlt: function () {
		var availableIndices = this._availableIndices;
		// Remove existing alt
		for (var i = 0; i < this._items.length; i++) {
			if (this._items[i]) {
				L.DomUtil.removeClass(this._items[i], 'alt');
			}
		}
		// Set alt on the next available style after active
		if (availableIndices.length < 2) return;
		var activePos = availableIndices.indexOf(this._active);
		var altPos = (activePos + 1) % availableIndices.length;
		L.DomUtil.addClass(this._items[availableIndices[altPos]], 'alt');
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
