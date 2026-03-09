const bukkurequest = require('./bukkurequest');
const { getBukkuCreds } = require('../lib/bukkuCreds');

async function creategoodsreceivednote(req, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'post', endpoint: '/purchases/goods_received_notes', token, subdomain, data: payload });
}

async function listgoodsreceivednotes(req, query = {}) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: '/purchases/goods_received_notes', token, subdomain, params: query });
}

async function readgoodsreceivednote(req, transactionId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: `/purchases/goods_received_notes/${transactionId}`, token, subdomain });
}

async function updategoodsreceivednote(req, transactionId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'put', endpoint: `/purchases/goods_received_notes/${transactionId}`, token, subdomain, data: payload });
}

async function updategoodsreceivednotestatus(req, transactionId, payload) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'patch', endpoint: `/purchases/goods_received_notes/${transactionId}`, token, subdomain, data: payload });
}

async function deletegoodsreceivednote(req, transactionId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'delete', endpoint: `/purchases/goods_received_notes/${transactionId}`, token, subdomain });
}

module.exports = {
  creategoodsreceivednote,
  listgoodsreceivednotes,
  readgoodsreceivednote,
  updategoodsreceivednote,
  updategoodsreceivednotestatus,
  deletegoodsreceivednote
};
