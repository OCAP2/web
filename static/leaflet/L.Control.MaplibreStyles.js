L.Control.MaplibreStyles = L.Control.extend({
	options: {
		position: 'bottomright'
	},

	_storageKey: 'ocap-maplibre-style',

	initialize: function (maplibreLayer, styles, opts) {
		L.setOptions(this, opts);
		this._mlLayer = maplibreLayer;
		this._styles = styles; // Array of {label, url}

		// Restore saved preference
		var saved = this._loadPreference();
		this._active = saved !== null ? saved : 0;
	},

	onAdd: function () {
		var container = L.DomUtil.create('div', 'maplibre-styles leaflet-control');
		L.DomEvent.disableClickPropagation(container);

		var self = this;
		this._buttons = [];

		this._styles.forEach(function (style, i) {
			var btn = L.DomUtil.create('button', '', container);
			btn.textContent = style.label;
			if (i === self._active) {
				L.DomUtil.addClass(btn, 'active');
			}
			L.DomEvent.on(btn, 'click', function () {
				if (i === self._active) return;
				self._setStyle(i);
			});
			self._buttons.push(btn);
		});

		// Hide entire control if only one style available
		if (this._styles.length <= 1) {
			container.style.display = 'none';
		}

		this._container = container;
		return container;
	},

	_setStyle: function (index) {
		var glMap = this._mlLayer.getMaplibreMap();
		if (!glMap) return;

		L.DomUtil.removeClass(this._buttons[this._active], 'active');
		this._active = index;
		L.DomUtil.addClass(this._buttons[this._active], 'active');

		glMap.setStyle(this._styles[index].url);
		this._savePreference(index);
	},

	_savePreference: function (index) {
		try { localStorage.setItem(this._storageKey, index); } catch (e) {}
	},

	_loadPreference: function () {
		try {
			var val = localStorage.getItem(this._storageKey);
			if (val !== null) {
				var idx = parseInt(val, 10);
				if (idx >= 0 && idx < this._styles.length) return idx;
			}
		} catch (e) {}
		return null;
	}
});

L.control.maplibreStyles = function (maplibreLayer, styles, opts) {
	return new L.Control.MaplibreStyles(maplibreLayer, styles, opts);
};
