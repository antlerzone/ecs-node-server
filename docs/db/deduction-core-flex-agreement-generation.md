# Deduction 服务、Core/Flex Credit、合约生成与签署时机

## 1) Node 里有没有 deduction 相关服务？

**有。** 在 **`src/modules/billing/deduction.service.js`**：

- **deductAddonCredit(emailOrSystem, { amount, title, addons, system })**  
  - 扣「addon 折算」的 credit：先扣 **core**（按过期日顺序），不够再扣 **flex**；更新 clientdetail.credit、pricingplandetail，写 creditlogs。  
  - 路由：`POST /api/billing/deduction/addon`（Billing 页 / 手动扣 addon 时用）。

- **deductPricingPlanAddonCredit({ clientId, amount, title, addons, staffId })**  
  - 定价方案完成时系统扣 addon 折算（如 completetopup 后扣 addon prorate）。  
  - 路由：`POST /api/billing/deduction/pricing-plan-addon`。

**和协议相关的扣费**：`src/modules/agreement/owner-agreement.service.js` 里只有 **TODO**（`// 后期可在此 deduct credit`），目前**没有**在生成/保存业主协议时调 deduction。

---

## 2) Core credit 和 Flex credit 分别是什么？

- **Core credit**  
  - **来源**：定价方案充值（pricing plan topup）到账后写入，对应 pricingplan.corecredit。  
  - **存储**：clientdetail.credit 里 `{ type: 'core', amount, expired }`，有过期日。  
  - **扣减顺序**：deduction 时**先扣 core**（按 expired 从早到晚），扣完或不够再扣 flex。

- **Flex credit**  
  - **来源**：普通充值（normal topup，creditlogs）到账后写入。  
  - **存储**：clientdetail.credit 里 `{ type: 'flex', amount }`，**无过期**。  
  - **扣减**：在 core 用完后才扣 flex。

文档对应：`docs/readme/index.md` 里 completetopup = CORE 到账（applyCoreCredit），completeNormalTopup = FLEX 到账（applyFlexCredit）。

---

## 3) 有没有「先生成合约再让两方 signing」？合约几时生成、几时返回？

当前有两条不同的合约流程，生成与返回时机不一样。

### A) Owner Setting 邀请业主（owner_operator）

- **何时生成合约行**：在 **Owner Setting 保存邀请**时（saveOwnerInvitation）：  
  - 插入 **agreement** 行（agreementtemplate_id、owner_id、property_id、client_id、mode=owner_operator、status=pending），  
  - **此时不生成 PDF/HTML**，没有「合约文件」。
- **何时「生成」合约内容并返回**：  
  - **业主在 Owner Portal 点开该协议**时，前端调 **getAgreementTemplate** + **getOwnerAgreementContext**，  
  - 后端按 template + 变量拼出 **HTML**，返回给前端在 #htmlagreement 里渲染。  
- **结论**：是**先有 agreement 行、后按需生成合约内容**；合约内容在**业主打开准备签**时才生成并返回，不是先生成好再给两方签。

### B) Tenancy / 请求 PDF 流程（requestPdfGeneration）

- **何时生成**：  
  - 先 **INSERT agreement** 行（status=pending，pdf_generating=1），  
  - 再调 Node **generatePdfFromTemplate** 生成 PDF；  
  - 生成完成后 **finalizeAgreementPdf** 把 url 写回 agreement、status 改为 completed、pdf_generating=0。
- **何时返回**：  
  - requestPdfGeneration 同步生成后直接返回 **pdfUrl**（及 agreementId），并写库。  
- **结论**：这里是**先生成合约（PDF）并落库、再可供签署/使用**；返回时机是 PDF 生成完成时（同步则当场返回，异步则 callback 后）。

### 小结

| 流程 | 何时生成 agreement 行 | 何时生成合约内容 | 何时返回给前端 |
|------|------------------------|------------------|----------------|
| Owner Setting 邀请（owner_operator） | 保存邀请时 INSERT | 业主在 Portal **打开**该协议时按 template 生成 HTML | 打开时 getAgreementTemplate + getOwnerAgreementContext 返回 HTML/变量 |
| Tenancy / PDF（requestPdfGeneration） | 请求 PDF 时 INSERT | Node 生成 PDF，同步写 url | 接口直接返回 pdfUrl |

所以：  
- **没有**统一的「先生成合约再让两方 signing」：Owner 流程是**打开时现生成 HTML**；PDF 流程是**先生成 PDF 再可用**。  
- 若你要的「先生成合约」指的是**先有可下载/可看的文件再签**，目前只有 **PDF 流程**符合；Owner 流程是**先有 agreement 行，签前才生成并返回 HTML**。
