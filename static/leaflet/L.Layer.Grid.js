/**
 * L.Layer.Grid - Coordinate grid overlay for Leaflet maps
 * Displays grid lines at zoom-adaptive intervals with coordinate labels
 */
L.Layer = L.Layer || {};

L.Layer.Grid = L.LayerGroup.extend({
	options: {
		// Line styling
		lineColor: 'rgba(255, 255, 255, 0.3)',
		lineWeight: 1,
		// Label styling
		labelFontSize: 10,
		labelColor: '#fff',
		labelBackgroundColor: 'rgba(0, 0, 0, 0.6)',
		// Whether to show labels
		showLabels: true
	},

	initialize: function (options) {
		L.setOptions(this, options);
		L.LayerGroup.prototype.initialize.call(this);
		this._lines = [];
		this._labels = [];
	},

	onAdd: function (map) {
		this._map = map;
		L.LayerGroup.prototype.onAdd.call(this, map);

		// Initial draw
		this._updateGrid();

		// Listen for map events
		map.on('zoomend', this._updateGrid, this);
		map.on('moveend', this._updateGrid, this);
	},

	onRemove: function (map) {
		// Remove event listeners
		map.off('zoomend', this._updateGrid, this);
		map.off('moveend', this._updateGrid, this);

		// Clear all layers
		this._clearGrid();

		L.LayerGroup.prototype.onRemove.call(this, map);
	},

	_clearGrid: function () {
		this.clearLayers();
		this._lines = [];
		this._labels = [];
	},

	/**
	 * Convert lat/lng to Arma coordinates
	 * Inverse of armaToLatLng() from ocap.js
	 */
	_latLngToArma: function (latlng) {
		var pixelCoords = this._map.project(latlng, mapMaxNativeZoom);
		var x = (pixelCoords.x - trim) / multiplier;
		var y = (imageSize - (pixelCoords.y - trim)) / multiplier;
		return [x, y];
	},

	/**
	 * Convert Arma coordinates to lat/lng
	 * Same as armaToLatLng() from ocap.js
	 */
	_armaToLatLng: function (coords) {
		var pixelCoords = [(coords[0] * multiplier) + trim, (imageSize - (coords[1] * multiplier)) + trim];
		return this._map.unproject(pixelCoords, mapMaxNativeZoom);
	},

	/**
	 * Get grid interval based on current zoom level
	 */
	_getGridInterval: function () {
		var zoom = this._map.getZoom();

		if (zoom <= 2) {
			return 5000; // 5km grid
		} else if (zoom <= 4) {
			return 1000; // 1km grid
		} else if (zoom <= 6) {
			return 500;  // 500m grid
		} else {
			return 100;  // 100m grid
		}
	},

	/**
	 * Format coordinate label based on interval
	 */
	_formatLabel: function (value, interval) {
		if (interval >= 1000) {
			// Show in km
			return (value / 1000).toFixed(0);
		} else {
			// Show in meters
			return value.toFixed(0);
		}
	},

	/**
	 * Update the grid based on current view
	 */
	_updateGrid: function () {
		this._clearGrid();

		if (!this._map || !worldObject) return;

		var bounds = this._map.getBounds();
		var interval = this._getGridInterval();

		// Get Arma coordinate bounds from map bounds
		var sw = this._latLngToArma(bounds.getSouthWest());
		var ne = this._latLngToArma(bounds.getNorthEast());

		// Get world size for clamping
		var worldSize = worldObject.worldSize || imageSize / multiplier;

		// Clamp to world bounds
		var minX = Math.max(0, Math.floor(sw[0] / interval) * interval);
		var maxX = Math.min(worldSize, Math.ceil(ne[0] / interval) * interval);
		var minY = Math.max(0, Math.floor(sw[1] / interval) * interval);
		var maxY = Math.min(worldSize, Math.ceil(ne[1] / interval) * interval);

		// Draw vertical lines (constant X)
		for (var x = minX; x <= maxX; x += interval) {
			var start = this._armaToLatLng([x, minY]);
			var end = this._armaToLatLng([x, maxY]);

			var line = L.polyline([start, end], {
				color: this.options.lineColor,
				weight: this.options.lineWeight,
				interactive: false
			});
			this.addLayer(line);
			this._lines.push(line);

			// Add label at bottom
			if (this.options.showLabels) {
				var labelPos = this._armaToLatLng([x, minY]);
				var label = this._createLabel(this._formatLabel(x, interval), labelPos, 'bottom');
				this.addLayer(label);
				this._labels.push(label);
			}
		}

		// Draw horizontal lines (constant Y)
		for (var y = minY; y <= maxY; y += interval) {
			var start = this._armaToLatLng([minX, y]);
			var end = this._armaToLatLng([maxX, y]);

			var line = L.polyline([start, end], {
				color: this.options.lineColor,
				weight: this.options.lineWeight,
				interactive: false
			});
			this.addLayer(line);
			this._lines.push(line);

			// Add label at left edge
			if (this.options.showLabels) {
				var labelPos = this._armaToLatLng([minX, y]);
				var label = this._createLabel(this._formatLabel(y, interval), labelPos, 'left');
				this.addLayer(label);
				this._labels.push(label);
			}
		}
	},

	/**
	 * Create a label marker
	 */
	_createLabel: function (text, position, edge) {
		var className = 'grid-label grid-label-' + edge;

		var icon = L.divIcon({
			className: className,
			html: '<span>' + text + '</span>',
			iconSize: [30, 14],
			iconAnchor: edge === 'left' ? [0, 7] : [15, 0]
		});

		return L.marker(position, {
			icon: icon,
			interactive: false,
			keyboard: false
		});
	}
});

// Factory function
L.layer = L.layer || {};
L.layer.grid = function (options) {
	return new L.Layer.Grid(options);
};
