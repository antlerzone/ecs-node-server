// Compatibility shim:
// Keep `node app.js` working, but use `server.js` as the single real entrypoint.
require('./server');