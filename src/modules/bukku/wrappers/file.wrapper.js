const bukkurequest = require('./bukkurequest');
const FormData = require('form-data');
const { getBukkuCreds } = require('../lib/bukkuCreds');

async function upload(req, fileBuffer, filename) {
  const { token, subdomain } = getBukkuCreds(req);
  const form = new FormData();
  form.append('file', fileBuffer, { filename: filename || 'file' });
  return bukkurequest.bukkuUpload({ endpoint: '/files', token, subdomain, formData: form });
}

async function list(req, query = {}) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: '/files', token, subdomain, params: query });
}

async function read(req, fileId) {
  const { token, subdomain } = getBukkuCreds(req);
  return bukkurequest({ method: 'get', endpoint: `/files/${fileId}`, token, subdomain });
}

module.exports = { upload, list, read };
