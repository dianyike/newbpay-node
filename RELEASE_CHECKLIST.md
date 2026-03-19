# Release Checklist

這份清單用於把本專案從「可用 beta」推進到「最小可販售版本」。

標記說明：✅ 已完成 | 🔧 整合方責任（library 已提供機制/文件） | ⬜ 待完成（需人工驗證）

## 1. Core Payment Flow

- ✅ 已在藍新測試環境完成信用卡付款成功流程
- ✅ 已在藍新測試環境完成 ATM 取號流程（2026-03-19 驗證）
- ✅ 已在藍新測試環境完成 CVS / BARCODE 流程（2026-03-19 驗證）
- ✅ `NotifyURL` 可由藍新成功觸發並收到 `200 OK`（2026-03-19 驗證）
- ✅ `ReturnURL` 僅用於顯示結果，不承擔付款成功判定
- ✅ `QueryTradeInfo` 已完成查單驗證（`queryTradeInfo()` helper）

## 2. Data Integrity

- 🔧 訂單資料已落正式 DB，不再使用記憶體儲存
- 🔧 `tradeNo` 已建立 unique constraint
- 🔧 訂單狀態更新已包 transaction
- 🔧 `onPaymentSuccess()` 會先比對本地金額與回傳金額（測試已示範做法）
- 🔧 `onPaymentSuccess()` 具冪等性（測試已示範做法）
- 🔧 已拒絕非 `pending` 訂單再次建立付款（example server 已示範）

## 3. Recovery And Reconciliation

- ✅ 已建立 `NotifyURL` 失敗時的補單流程（`queryTradeInfo()` helper）
- ✅ 已建立 `QueryTradeInfo` 對帳流程（`createQueryData()` + `queryTradeInfo()`）
- ✅ 已定義人工對帳 SOP（README Reconciliation SOP 章節）
- ✅ 已定義 notify 重送時的處理規則（冪等測試 + 文件）

## 4. Security

- ✅ 正式環境 `BASE_URL` 為 HTTPS（`config.js` fail-fast 檢查）
- ✅ `MERCHANT_ID`、`HASH_KEY`、`HASH_IV` 由環境變數提供
- ✅ 金鑰未進版控（`.gitignore` 排除 `.env`）
- ✅ log 不會印出完整敏感 payload（結構化 log，測試驗證無洩漏）
- 🔧 `/payment/create` 已加認證（整合方在掛載 router 前加 middleware）
- 🔧 `/payment/create` 已加 rate limit（整合方在掛載 router 前加 middleware）
- ✅ 正式與測試藍新網址切換方式已文件化（README + `.env.example`）

## 5. Testing

- ✅ `npm test` 全綠（19 tests passing）
- ✅ 已補信用卡成功通知整合測試
- ✅ 已補 notify 重送不重複入帳測試
- ✅ 已補金額不符拒絕更新測試
- ✅ 已補查單補單測試
- ✅ 測試已接入 CI（`.github/workflows/ci.yml`）

## 6. Observability

- ✅ 已定義 `info / warn / error` log 等級（結構化 JSON log）
- ✅ 已記錄 `orderNo`、`tradeNo`、處理結果、時間戳
- ✅ 驗章失敗有告警（`payment.notify.error` / `payment.return.verify_failed`）
- ✅ 金額不符有告警（handler 拋錯 → `payment.notify.error`）
- 🔧 notify 持續失敗有告警（整合方依 log event 接告警系統）

## 7. Productization

- ✅ README 已完整描述安裝與整合方式
- ✅ 已清楚標示套件責任範圍與整合方責任
- ✅ 已定義版本策略（semver，pre-1.0，README Versioning 章節）
- ✅ 已提供 TypeScript 型別（`types/index.d.ts`）
- ✅ 已定義支援範圍與維護承諾（README Support Scope 章節）

## 8. Minimum Sellable Gate

在對外販售前，最低限度必須全部完成：

- 🔧 正式 DB + `tradeNo` unique constraint（整合方責任，README 已說明 schema）
- 🔧 transaction + idempotency（整合方責任，測試已示範做法）
- ✅ `QueryTradeInfo` 補單流程
- ✅ 4 個關鍵整合測試
- ✅ README 與上線文件
- ✅ CI 自動測試

## 9. Suggested Release Label

- [x] `v0.x`（目前 `0.1.0`，pre-1.0 semver）