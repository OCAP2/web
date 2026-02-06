L.Control.MaplibreStyles = L.Control.extend({
	options: {
		position: 'bottomright'
	},

	initialize: function (maplibreLayer, styleUrl, opts) {
		L.setOptions(this, opts);
		this._mlLayer = maplibreLayer;

		// Derive variant URLs from the standard.json path
		var base = styleUrl.replace(/\/[^/]+$/, '/');
		this._styles = [
			{ label: 'Topo',      url: base + 'standard.json' },
			{ label: 'Satellite', url: base + 'satellite.json' },
			{ label: 'Hybrid',    url: base + 'hybrid.json' }
		];
		this._active = 0;
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
	}
});

L.control.maplibreStyles = function (maplibreLayer, styleUrl, opts) {
	return new L.Control.MaplibreStyles(maplibreLayer, styleUrl, opts);
};
