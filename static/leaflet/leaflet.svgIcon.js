
(function (window, document, undefined) {

L.SVGIcon = L.Icon.extend({
    options: {
        iconSize: [24, 24]
    },

    _createIcon: function (name, oldIcon) {
        var src = this._getIconUrl(name);

        if (!src) {
            if (name === 'icon') {
                throw new Error('iconUrl not set in Icon options (see the docs).');
            }
            return null;
        }

        var img;
        if (!oldIcon || oldIcon.tagName !== 'OBJECT') {
            img = this._createImg(src);
        } else {
            img = this._createImg(src, oldIcon);
        }
        this._setIconStyles(img, name);

        return img;
    },

    _setIconStyles: function (img, name) {
        var options = this.options,
            size = L.point(options[name + 'Size']),
            anchor;

        anchor = L.point(options.iconAnchor);

        if (!anchor && size) {
            anchor = size.divideBy(2, true);
        }

        img.className = 'leaflet-marker-' + name + ' ' + options.className;

        img.addEventListener('load', this._onload, true);

        if (anchor) {
            img.style.marginLeft = (-anchor.x) + 'px';
            img.style.marginTop  = (-anchor.y) + 'px';
        }

        if (size) {
            img.style.width  = size.x + 'px';
            img.style.height = size.y + 'px';
        }

        img.options = options;
    },

    _createImg: function (src, el) {
        el = el || document.createElement('object');
        el.type = "image/svg+xml";
        el.data = src;
        return el;
    },

    _getIconUrl: function (name) {
        return this.options[name + 'Url'];
    },

    _onload: function (e) {
        var options = this.options;
        var svgDoc = this.contentDocument;

        if (options.foregroundColor) {
            var paths = svgDoc.getElementsByTagName('path');
            for (var i=paths.length-1; i>=0; i--) {
                var pp = paths[i];
                pp.style.fill = options.foregroundColor;
            }
        }

        if (options.backgroundColor) {
            var circles = svgDoc.getElementsByTagName('circle');
            for (var i=circles.length-1; i>=0; i--) {
                var cc = circles[i];
                cc.style.fill = options.backgroundColor;
            }
        }
    }
});

L.svgIcon = function (options) {
    return new L.SVGIcon(options);
};

}(this, document));

