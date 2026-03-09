// =============================================================================
// backend/cnyiotoperation.jsw – link2User 修正
// 文档 §21：请求参数为 MeterID、UserID（不是 MetID、userid），否则平台返回 5003。
// =============================================================================

// ❌ 错误（会 5003）：
// return callCnyIot("link2User", { "MetID": meterId, "userid": String(userId) });

// ✅ 正确（与文档一致）：
export async function link2User(loginid, meterId, userId) {
  return callCnyIot("link2User", {
    MeterID: String(meterId),
    UserID: String(userId)
  });
}
