# Changelog

All notable changes to this project will be documented in this file.

## [0.2.0] - 2026-03-19

### Added

- `closeTrade({ tradeNo, orderNo, amt, closeType, cancel, notifyUrl })`：信用卡請款 / 退款 / 取消請款 / 取消退款（CreditCard Close API）
- `cancelAuth({ tradeNo, orderNo, amt, notifyUrl })`：信用卡取消授權（CreditCard Cancel API）
- TypeScript 型別：`CloseTradeOptions`、`CancelAuthOptions`、`CreditCardResult`
- 8 個新測試覆蓋請款、退款、取消、參數驗證、互斥檢查、notifyUrl HTTPS 限制、HTTP 錯誤處理
- `.env.example` 新增 `NEWEBPAY_CLOSE_URL`、`NEWEBPAY_CANCEL_URL`

### Changed

- `config.js` 新增 `newebpayCloseUrl`、`newebpayCancelUrl` 設定（預設指向測試環境）

### Security

- `tradeNo` / `orderNo` 強制互斥：同時傳入時拋錯，防止攻擊者以外部輸入覆蓋預期交易
- `notifyUrl` 強制 HTTPS：防止回呼被導向至非加密端點造成交易事件外洩
- 正式環境強制所有藍新 API URL 為 HTTPS（Close、Cancel、Query、MPG），防止 MITM 偽造回應

## [0.1.0] - 2026-03-19

### Added

- `index.js` 統一入口，支援 `require('newbpay-node')` 取得所有 API
- TypeScript 型別定義（`types/index.d.ts`）
- README 新增：Versioning 版本策略、Reconciliation SOP 人工對帳流程、Support Scope 支援範圍
- `package.json` 加入 `files`、`exports`、`engines`、`peerDependencies`、`types` 欄位

### Changed

- package name 改為小寫 `newbpay-node`（符合 npm 規範）
- 版本號改為 `0.1.0`（pre-1.0 semver，反映目前 beta 定位）
- `main` 入口從 `src/newebpay.js` 改為 `index.js`

## [0.0.2] - 2026-03-19

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

## [0.0.1] - 2026-03-19

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
