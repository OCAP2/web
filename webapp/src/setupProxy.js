const { createProxyMiddleware } = require('http-proxy-middleware');
const { proxy } = require('../package.json');

module.exports = function(app) {
	app.use(
		['/data'],
		createProxyMiddleware({
			target: proxy,
			changeOrigin: true,
		})
	);
	app.use(
		['/images'],
		createProxyMiddleware({
			target: 'http://localhost:5000',
			changeOrigin: true,
		})
	);
};
