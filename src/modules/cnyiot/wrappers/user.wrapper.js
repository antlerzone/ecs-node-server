/**
 * CNYIoT 租客（User）API wrapper。
 * 每个 client 可创建一个「子账号」租客（uI=subdomain）用于分组，该 client 的电表都 link 到该 UserID。
 * 文档 §10 getUsers, §12 addUser, §13 editUser, §21 link2User, §22 link2MetersList, §23 link2Meter, §2 editPsw, §3 rstPsw
 */

const { callCnyIot } = require('./cnyiotRequest');

/** §10 获取租客列表。默认母账号 token。opts.returnPayloads=true 时返回 { result, requestPayload, responsePayload }. */
async function getUsers(clientId, opts = {}) {
  return callCnyIot({
    clientId,
    method: 'getUsers',
    body: {},
    returnPayloads: !!opts.returnPayloads
  });
}

/**
 * §12 新增租客。uI=登入名（建议用 subdomain），uN=昵称，tel=电话；可选 psw 若接口支持。
 * opts.returnPayloads=true 时返回 { result, requestPayload, responsePayload }。
 */
async function addUser(clientId, payload, opts = {}) {
  const body = {
    uN: payload.uN || payload.loginName,
    uI: payload.uI || payload.loginName,
    tel: payload.tel || ''
  };
  if (payload.psw != null && String(payload.psw).trim() !== '') body.psw = String(payload.psw).trim();
  return callCnyIot({
    clientId,
    method: 'addUser',
    body,
    returnPayloads: !!opts.returnPayloads
  });
}

/** §13 编辑租客。id=Station_index，uN/uI/tel */
async function editUser(clientId, payload) {
  return callCnyIot({
    clientId,
    method: 'editUser',
    body: {
      id: String(payload.id),
      uN: payload.uN,
      uI: payload.uI,
      tel: payload.tel || ''
    }
  });
}

/** §21 电表绑定租客。UserID=0 表示解绑。默认母账号（addMeter 后绑定）。 */
async function link2User(clientId, meterId, userId) {
  return callCnyIot({
    clientId,
    method: 'link2User',
    body: {
      MeterID: String(meterId),
      UserID: String(userId ?? 0)
    }
  });
}

/** §22 获取某租客已绑定及未绑定的设备列表 */
async function link2MetersList(clientId, userId) {
  return callCnyIot({
    clientId,
    method: 'link2MetersList',
    body: { userid: String(userId) }
  });
}

/** §23 租客绑定/解绑电表。s=要绑到该租客的表号数组，us=要解绑的表号数组 */
async function link2Meter(clientId, payload) {
  return callCnyIot({
    clientId,
    method: 'link2Meter',
    body: {
      uI: String(payload.uI),
      s: payload.s || [],
      us: payload.us || []
    }
  });
}

/** §2 修改密码（当前登入的房东改自己的密码）。opsw 旧密码，npsw/npsw2 新密码 */
async function editPsw(clientId, payload) {
  return callCnyIot({
    clientId,
    method: 'editPsw',
    body: {
      loginid: payload.loginid,
      opsw: payload.opsw,
      npsw: payload.npsw,
      npsw2: payload.npsw2
    }
  });
}

/** §5 修改登入信息。na=昵称，te=电话，ps=登入密码。母账号；可带 uI=租客 Station_index。 */
async function editLogin(clientId, payload) {
  const body = {};
  if (payload.na != null && String(payload.na).trim() !== '') body.na = String(payload.na).trim();
  if (payload.te != null && String(payload.te).trim() !== '') body.te = String(payload.te).trim();
  if (payload.ps != null && String(payload.ps).trim() !== '') body.ps = String(payload.ps).trim();
  if (payload.uI != null) body.uI = String(payload.uI);
  if (payload.id != null) body.id = String(payload.id);
  return callCnyIot({
    clientId,
    method: 'editLogin',
    body
  });
}

/** §3 重置密码（房东重置租客密码）。uI=租客 id（Station_index） */
async function rstPsw(clientId, userId) {
  return callCnyIot({
    clientId,
    method: 'rstPsw',
    body: { uI: String(userId) }
  });
}

module.exports = {
  getUsers,
  addUser,
  editUser,
  editLogin,
  link2User,
  link2MetersList,
  link2Meter,
  editPsw,
  rstPsw
};
