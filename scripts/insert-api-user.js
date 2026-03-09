/**
 * 插入一个 API 用户（用于 Wix 等调用）。用法：node scripts/insert-api-user.js <username>
 * Wix 调用时用 token 作为 secret key，请求头：Authorization: Bearer <token>
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const apiUserService = require('../src/modules/api-user/api-user.service');

async function main() {
  const username = process.argv[2] || 'saas_wix';
  const existing = await apiUserService.list();
  if (existing.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    console.error('Username already exists:', username);
    process.exit(1);
  }
  const user = await apiUserService.create({ username });
  console.log('Created api_user:');
  console.log(JSON.stringify({ id: user.id, username: user.username, token: user.token, status: user.status }, null, 2));
  console.log('\nWix 调用时：请求头 Authorization: Bearer', user.token);
  process.exit(0);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
