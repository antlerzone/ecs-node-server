/**
 * 估算：要达到「平台月收入 100,000 MYR」需要多少 client / room。
 * 计入：定价方案年费、Add-on、租金 1% 平台 markup（Stripe 费率由租户/客户承担，平台只收 1% markup）。
 * 假设：租金约 1000/月（MYR/SGD 同 nominal）、约 30% 客户为 SGD，SGD 换算 MYR ≈ 3.5。
 *
 * 运行：node scripts/calc-rooms-for-100k.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const pool = require('../src/config/db');

const TARGET_MONTHLY_MYR = 100000;
const CREDITS_PER_ROOM_PER_MONTH = 10;

// 收入假设（可改）
const RENT_PER_ROOM_PER_MONTH = 1000;       // 租金约 1000/月（MYR 或 SGD 同 nominal）
const SGD_PERCENT = 0.3;                     // 30% 客户为 SGD
const MYR_PERCENT = 1 - SGD_PERCENT;         // 70% MYR
const SGD_TO_MYR = 3.5;                      // 1 SGD ≈ 3.5 MYR（换算成 MYR 收入）
const PLATFORM_MARKUP_PERCENT = 1;           // 代码：stripe.service.js PLATFORM_MARKUP_PERCENT = 1
const OCCUPANCY_RATE = 0.9;                  // 假设 90% 入住率（有租约的房间才产生租金 markup）
const ADDON_TAKE_RATE = 0.2;                 // 假设 20% 客户有 addon
const ADDON_AVG_YEARLY_MYR = 2000;           // 有 addon 的客户平均年费（credit 等价 MYR）

async function main() {
  console.log('--- 目标：平台月收入 100,000 MYR ---\n');

  // 1) Pricing plans
  const [planRows] = await pool.query(
    'SELECT id, title, sellingprice, corecredit FROM pricingplan ORDER BY sellingprice ASC'
  );
  if (!planRows.length) {
    console.log('pricingplan 表无数据。');
  } else {
    console.log('【定价方案】');
    planRows.forEach((p) => {
      const price = Number(p.sellingprice) || 0;
      const credit = Number(p.corecredit) || 0;
      const roomsSupported = credit >= CREDITS_PER_ROOM_PER_MONTH * 12 ? Math.floor(credit / (CREDITS_PER_ROOM_PER_MONTH * 12)) : 0;
      console.log(`  ${p.title}: 年费 ${price}, core credit ${credit}, 约可支撑 ${roomsSupported} 间 active room/年`);
    });
  }

  // 2) Add-ons（仅展示；收入用上面常数估算）
  const [addonRows] = await pool.query('SELECT id, title, credit_json FROM pricingplanaddon ORDER BY title');
  if (addonRows.length) {
    console.log('\n【Add-on】');
    addonRows.forEach((a) => console.log(`  ${a.title}: ${a.credit_json || '-'}`));
  }

  // 3) 平均每 client 的 active room 数
  const [roomStats] = await pool.query(`
    SELECT client_id, COUNT(*) AS cnt
    FROM roomdetail
    WHERE active = 1
    GROUP BY client_id
  `);
  const clientCount = roomStats.length;
  const totalActiveRooms = roomStats.reduce((s, r) => s + Number(r.cnt || 0), 0);
  const avgRoomsPerClient = clientCount > 0 ? totalActiveRooms / clientCount : 25;

  console.log('\n【当前数据统计】');
  console.log(`  有 active room 的 client 数: ${clientCount}`);
  console.log(`  active room 总数: ${totalActiveRooms}`);
  console.log(`  平均每 client active room 数: ${avgRoomsPerClient.toFixed(1)}`);

  // 4) 综合估算：Plan + Add-on + 1% Markup（租金 1000/月，30% SGD）
  console.log('\n========== 综合估算：月收入 100,000 MYR ==========');
  console.log('假设：租金 ≈ ' + RENT_PER_ROOM_PER_MONTH + '/月，' + (SGD_PERCENT * 100) + '% SGD 客户，SGD→MYR = ' + SGD_TO_MYR + '，入住率 ' + (OCCUPANCY_RATE * 100) + '%');
  console.log('      1% 平台 markup（代码 stripe.service.js）；Add-on ' + (ADDON_TAKE_RATE * 100) + '% 客户、年均 ' + ADDON_AVG_YEARLY_MYR + ' MYR\n');

  const avgPlanYearly = planRows.length
    ? planRows.reduce((s, p) => s + Number(p.sellingprice || 0), 0) / planRows.length
    : 6000;
  const planMonthlyPerClient = avgPlanYearly / 12;
  const addonMonthlyPerClient = ADDON_TAKE_RATE * (ADDON_AVG_YEARLY_MYR / 12);
  // 每间房每月 1% markup，换算 MYR：70% 收 10 MYR，30% 收 10 SGD = 35 MYR
  const markupPerRoomPerMonthMYR =
    MYR_PERCENT * (RENT_PER_ROOM_PER_MONTH * PLATFORM_MARKUP_PERCENT / 100) +
    SGD_PERCENT * (RENT_PER_ROOM_PER_MONTH * PLATFORM_MARKUP_PERCENT / 100) * SGD_TO_MYR;
  const markupPerRoomPerMonthWithOccupancy = markupPerRoomPerMonthMYR * OCCUPANCY_RATE;

  console.log('  每 client 月收入贡献：');
  console.log('    Plan 年费折月: ' + planMonthlyPerClient.toFixed(0) + ' MYR');
  console.log('    Add-on 折月:   ' + addonMonthlyPerClient.toFixed(0) + ' MYR');
  console.log('    小计(每 client): ' + (planMonthlyPerClient + addonMonthlyPerClient).toFixed(0) + ' MYR');
  console.log('  每间房每月 1% markup（折算 MYR，含入住率）: ' + markupPerRoomPerMonthWithOccupancy.toFixed(1) + ' MYR\n');

  const revenuePerClientPerMonth = planMonthlyPerClient + addonMonthlyPerClient + avgRoomsPerClient * markupPerRoomPerMonthWithOccupancy;
  const clientsNeeded = TARGET_MONTHLY_MYR / revenuePerClientPerMonth;
  const roomsNeeded = clientsNeeded * avgRoomsPerClient;

  console.log('  => 所需 client 数 ≈ ' + Math.ceil(clientsNeeded) + '（平均 ' + avgRoomsPerClient.toFixed(0) + ' 间/客户）');
  console.log('  => 所需 room 数   ≈ ' + Math.ceil(roomsNeeded) + ' 间\n');

  const planShare = (planMonthlyPerClient / revenuePerClientPerMonth * 100).toFixed(0);
  const addonShare = (addonMonthlyPerClient / revenuePerClientPerMonth * 100).toFixed(0);
  const markupShare = (100 - planShare - addonShare).toFixed(0);
  console.log('  收入构成（约）：Plan ' + planShare + '% | Add-on ' + addonShare + '% | 1% Markup ' + markupShare + '%\n');

  // 5) 情境 B：屋主租金月收入 100k（参考）
  console.log('--- 参考：屋主租金月收入 100,000（非平台收入）---');
  const [rentRows] = await pool.query(`
    SELECT rental FROM tenancy WHERE rental IS NOT NULL AND rental > 0
  `);
  if (rentRows.length) {
    const avgRental = rentRows.reduce((s, r) => s + Number(r.rental || 0), 0) / rentRows.length;
    console.log('  当前 tenancy 平均月租 ≈ ' + avgRental.toFixed(0) + ' → 屋主月租 100k 需房间数 ≈ ' + Math.ceil(100000 / avgRental) + ' 间');
  } else {
    console.log('  若平均月租 1000，屋主月租 100k 需 ≈ 100 间');
  }

  console.log('\n（公式与假设见 docs/readme/room-count-for-100k.md）');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
