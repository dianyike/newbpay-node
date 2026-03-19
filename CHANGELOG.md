# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0] - 2026-03-19

### Added

- `queryTradeInfo(orderNo, amt)` helper：實際向藍新 QueryTradeInfo API 發送查詢
- 結構化 JSON log：所有路由事件包含 `event`、`orderNo`、`tradeNo`、`amt`、`ts`
- 自訂 logger 注入：`createPaymentRoutes(handlers, { logger })` 支援自訂 logger
- Log 等級分類：info（成功）、warn（驗章失敗/付款失敗）、error（系統錯誤）
- 4 個關鍵整合測試：notify 成功、重送冪等、金額不符拒絕、查單補單
- 3 個 observability 測試：自訂 logger 驗證、驗章失敗級別、敏感資料洩漏檢查
- `queryTradeInfo` 測試：mock server 驗證參數與 HTTP 錯誤處理

### Changed

- `createPaymentRoutes` 第二參數改為 `{ payment, logger }` 物件格式（向後相容舊版 paymentOptions）
- 所有路由 log 改為結構化 JSON 輸出，不再使用裸 `console.error`
- Log 不再包含 TradeInfo / TradeSha / HashKey 等敏感欄位

### Security

- Log 敏感資料洩漏防護：自動化測試確保 log 不含金鑰與加密資料

## [1.0.0] - 2026-03-19

### Added

- Payment route factory for `create`, `notify`, `return`, and `customer`
- `createPayment`, `verifyAndDecrypt`, and `createQueryData`
- Config fail-fast checks for required NewebPay environment variables
- Minimal automated tests with `node:test`
- Release checklist for commercial readiness
- GitHub Actions CI workflow

### Changed

- `/payment/create` now accepts `orderId` and delegates order lookup to the integrator
- QueryTradeInfo `CheckValue` generation aligned to NewebPay spec
- Decryption flow hardened for trailing null bytes, PKCS7 padding, and trailing control bytes
- Error handling now separates validation errors from internal server errors

### Security

- Payment amount is no longer trusted from the client
- Example integration demonstrates `tradeNo` deduplication and pending-order checks
- Config validation enforces key/IV length and HTTPS `BASE_URL` in production
