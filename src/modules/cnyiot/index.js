/**
 * CNYIoT API wrapper (SaaS – per client).
 * Single entry: callCnyIot; token from cnyiotToken.service; apiKey encrypted with CNYIOT_AES_KEY.
 *
 * Programmatic usage:
 *   const cnyiot = require('./src/modules/cnyiot');
 *   const meters = await cnyiot.meter.getMeters(clientId);
 *   const prices = await cnyiot.price.getPrices(clientId);
 */

const { getValidCnyIotToken } = require('./lib/cnyiotToken.service');
const { getCnyIotAuth } = require('./lib/cnyiotCreds');
const { callCnyIot } = require('./wrappers/cnyiotRequest');
const meter = require('./wrappers/meter.wrapper');
const price = require('./wrappers/price.wrapper');
const user = require('./wrappers/user.wrapper');
const sync = require('./wrappers/sync.wrapper');
const cnyiotSubuser = require('./lib/cnyiotSubuser');

module.exports = {
  getValidCnyIotToken,
  getCnyIotAuth,
  callCnyIot,
  meter,
  price,
  user,
  sync,
  cnyiotSubuser
};
