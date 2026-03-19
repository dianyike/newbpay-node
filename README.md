# newbpay-node

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)
[![Version](https://img.shields.io/badge/version-0.2.0-orange.svg)](./CHANGELOG.md)

藍新金流（NewebPay）Node.js / Express 整合模組。提供 MPG 建單、交易驗證解密、回呼路由、查單 API 等完整付款流程所需功能。

## 目錄

- [功能特色](#功能特色)
- [系統需求](#系統需求)
- [安裝](#安裝)
- [環境設定](#環境設定)
- [快速開始](#快速開始)
- [API 參考](#api-參考)
- [路由規格](#路由規格)
- [TypeScript 支援](#typescript-支援)
- [整合方責任](#整合方責任)
- [建議資料庫結構](#建議資料庫結構)
- [對帳與補單](#對帳與補單)
- [正式環境檢查清單](#正式環境檢查清單)
- [測試](#測試)
- [範例](#範例)
- [版本策略](#版本策略)
- [問題回報](#問題回報)
- [授權](#授權)

## 功能特色

- **MPG 建單** — 自動組裝藍新所需欄位，產生 `TradeInfo` / `TradeSha`
- **交易驗證與解密** — AES-256-CBC 加解密、SHA-256 驗章
- **Express 路由工廠** — 透過 `createPaymentRoutes()` 注入業務邏輯，快速建立 notify / return / customer 路由
- **QueryTradeInfo 查單** — 產生查單參數與實際 API 查詢
- **多種付款方式** — 信用卡、ATM 轉帳、超商代碼、超商條碼、LINE Pay（可個別開關）
- **結構化 JSON 日誌** — 所有事件包含 `event`、`orderNo`、`tradeNo`、`amt`、`ts`，支援自訂 logger 注入
- **安全設計** — 金額僅從後端資料庫取得，日誌不含敏感資料，設定檔啟動時 fail-fast 驗證
- **TypeScript 型別定義** — 內建 `.d.ts`，IDE 自動補全

## 系統需求

| 項目 | 要求 |
|------|------|
| Node.js | >= 18（建議 22 LTS） |
| Express | >= 4.0（peer dependency） |
| 藍新商店代號 | 測試或正式環境皆可 |
| HashKey / HashIV | 由藍新後台取得 |
| HTTPS 網址 | 供藍新回呼使用 |

## 安裝

作為專案依賴安裝：

```bash
npm install github:dianyike/Cash_Flow
```

本地開發：

```bash
git clone https://github.com/dianyike/Cash_Flow.git
cd Cash_Flow
npm install
cp .env.example .env   # 填入你的藍新金鑰
```

## 環境設定

將 `.env.example` 複製為 `.env`，填入以下必要變數：

```env
MERCHANT_ID=your_merchant_id
HASH_KEY=your_32_char_hash_key
HASH_IV=your_16_char_hash_iv
PORT=3000
BASE_URL=https://your-domain.example

# 測試環境
NEWEBPAY_API_URL=https://ccore.newebpay.com/MPG/mpg_gateway
NEWEBPAY_QUERY_URL=https://ccore.newebpay.com/API/QueryTradeInfo

# 正式環境
# NEWEBPAY_API_URL=https://core.newebpay.com/MPG/mpg_gateway
# NEWEBPAY_QUERY_URL=https://core.newebpay.com/API/QueryTradeInfo
```

> **注意**：`HashKey` 必須為 32 字元、`HashIV` 必須為 16 字元。正式環境 `BASE_URL` 必須為 HTTPS。

## 快速開始

```js
const express = require('express');
const { createPaymentRoutes } = require('newbpay-node');

const app = express();

const paymentRoutes = createPaymentRoutes(
  {
    // 從資料庫查詢訂單（必要）
    async lookupOrder(orderId) {
      return {
        orderNo: 'ORDER_123',
        amt: 100,
        itemDesc: '測試商品',
        email: 'buyer@example.com',
      };
    },

    // 付款成功回呼（必要）— 須自行保證冪等性
    async onPaymentSuccess(orderNo, tradeNo, amt, rawResult) {
      // 1. 驗證訂單存在且金額一致
      // 2. 檢查 tradeNo 不重複
      // 3. 更新訂單狀態（需包 transaction）
    },

    // 付款失敗回呼（選用）
    async onPaymentFail(orderNo, message, rawResult) {
      // 記錄失敗原因
    },
  },
  {
    payment: { credit: true, vacc: true, cvs: true, barcode: true },
    // logger: yourCustomLogger,  // 選用：注入自訂 logger（需提供 info/warn/error 方法）
  }
);

app.use(paymentRoutes);
app.listen(3000);
```

## API 參考

### `createPaymentRoutes(handlers, options?)`

建立 Express Router，包含完整付款流程路由。

| 參數 | 型別 | 說明 |
|------|------|------|
| `handlers.lookupOrder` | `(orderId: string) => Promise<Order>` | 從 DB 查詢訂單 |
| `handlers.onPaymentSuccess` | `(orderNo, tradeNo, amt, rawResult) => Promise<void>` | 付款成功處理（須冪等） |
| `handlers.onPaymentFail` | `(orderNo, message, rawResult) => Promise<void>` | 付款失敗處理（選用） |
| `options.payment` | `PaymentOptions` | 付款方式開關 |
| `options.logger` | `Logger` | 自訂 logger（需有 `info` / `warn` / `error`） |

### `createPayment(order, options?)`

產生藍新 MPG 建單所需資料。

```js
const { createPayment } = require('newbpay-node');

const paymentData = createPayment(
  { orderNo: 'ORDER_123', amt: 100, itemDesc: '商品', email: 'test@example.com' },
  { credit: true }
);
// => { MerchantID, TradeInfo, TradeSha, Version, PayGateURL }
```

### `verifyAndDecrypt(payload)`

驗證 `TradeSha` 並解密 `TradeInfo`。驗章失敗時拋出錯誤。

```js
const { verifyAndDecrypt } = require('newbpay-node');

const result = verifyAndDecrypt({ TradeInfo: '...', TradeSha: '...' });
// => { Status, Message, Result: { MerchantID, Amt, TradeNo, ... } }
```

### `queryTradeInfo(orderNo, amt)`

向藍新 QueryTradeInfo API 查詢交易狀態。

```js
const { queryTradeInfo } = require('newbpay-node');

const result = await queryTradeInfo('ORDER_123', 100);
if (result.Status === 'SUCCESS' && result.Result.TradeStatus === '1') {
  // 交易已付款
}
```

### `closeTrade(options)`

信用卡請款 / 退款。透過藍新 CreditCard Close API 操作。

```js
const { closeTrade } = require('newbpay-node');

// 請款（closeType: 1）
await closeTrade({ tradeNo: '24010100001', amt: 500, closeType: 1 });

// 退款（closeType: 2）
await closeTrade({ tradeNo: '24010100001', amt: 500, closeType: 2 });

// 取消請款
await closeTrade({ tradeNo: '24010100001', amt: 500, closeType: 1, cancel: true });

// 取消退款
await closeTrade({ tradeNo: '24010100001', amt: 500, closeType: 2, cancel: true });
```

| 參數 | 型別 | 說明 |
|------|------|------|
| `tradeNo` | `string` | 藍新交易編號（與 `orderNo` **二擇一**，不可同時提供） |
| `orderNo` | `string` | 商店訂單編號（與 `tradeNo` **二擇一**，不可同時提供） |
| `amt` | `number` | 金額（正整數） |
| `closeType` | `1 \| 2` | `1` = 請款、`2` = 退款 |
| `cancel` | `boolean` | 是否取消前次操作（預設 `false`） |
| `notifyUrl` | `string` | 回呼通知網址（選用，必須為 HTTPS） |

> **安全注意**：`notifyUrl` 決定藍新將交易結果回呼至何處，**絕對不可接受前端或使用者輸入**。建議只使用硬編碼的後端 URL。

### `cancelAuth(options)`

信用卡取消授權。在請款前取消，釋放持卡人的信用額度。

```js
const { cancelAuth } = require('newbpay-node');

await cancelAuth({ tradeNo: '24010100001', amt: 500 });
```

| 參數 | 型別 | 說明 |
|------|------|------|
| `tradeNo` | `string` | 藍新交易編號（與 `orderNo` **二擇一**，不可同時提供） |
| `orderNo` | `string` | 商店訂單編號（與 `tradeNo` **二擇一**，不可同時提供） |
| `amt` | `number` | 原授權金額（正整數） |
| `notifyUrl` | `string` | 回呼通知網址（選用，必須為 HTTPS） |

### `createQueryData(orderNo, amt)`

僅產生查單參數（不發送請求），供自行組裝 HTTP 請求使用。

### 低階 API

| 函式 | 說明 |
|------|------|
| `encryptTradeInfo(data)` | AES-256-CBC 加密 |
| `decryptTradeInfo(encrypted)` | AES-256-CBC 解密 |
| `createTradeSha(tradeInfo)` | SHA-256 雜湊產生 TradeSha |

## 路由規格

### `POST /payment/create`

前端請求：

```json
{ "orderId": "your-order-id" }
```

後端透過 `lookupOrder()` 取得訂單資料，回傳 `MerchantID`、`TradeInfo`、`TradeSha`、`Version` 供前端送出表單至藍新。

> **安全設計**：金額由後端 DB 決定，前端無法篡改。

### `POST /payment/notify`

藍新 server-to-server 通知。**這是唯一可信的付款成功來源**，應在此觸發出貨、開通、入帳等業務邏輯。

### `POST /payment/return`

使用者付款後的瀏覽器導回。僅適合顯示結果頁面，**不應作為付款成功依據**。

### `POST /payment/customer`

ATM / 超商代碼 / 超商條碼的取號資訊回傳。

## TypeScript 支援

本套件內建 TypeScript 型別定義（`types/index.d.ts`），無需額外安裝 `@types`。

```ts
import { createPaymentRoutes, PaymentHandlers, RouteOptions } from 'newbpay-node';
```

主要型別：

| 型別 | 說明 |
|------|------|
| `Order` | 訂單資料（`orderNo`, `amt`, `itemDesc`, `email`） |
| `PaymentOptions` | 付款方式開關 |
| `PaymentData` | `createPayment` 回傳值 |
| `DecryptResult` | 解密後交易結果 |
| `QueryData` | 查單參數 |
| `QueryResult` | 查單回傳結果 |
| `CloseTradeOptions` | `closeTrade` 參數 |
| `CancelAuthOptions` | `cancelAuth` 參數 |
| `CreditCardResult` | `closeTrade` / `cancelAuth` 回傳值 |
| `PaymentHandlers` | 路由 handler 介面 |
| `RouteOptions` | 路由選項（付款方式 + logger） |
| `Logger` | 自訂 logger 介面 |

## 整合方責任

本套件處理藍新金流的加解密、驗章與路由，但以下部分需由整合方自行實作：

| 類別 | 項目 |
|------|------|
| **資料層** | 訂單資料庫、`tradeNo` 唯一鍵、狀態更新 transaction、冪等處理 |
| **安全性** | API 認證與授權、rate limit |
| **營運** | 監控告警、補單排程、人工對帳 |
| **其他** | 退款 / 請款等進階 API、前端 UI |

## 建議資料庫結構

### orders 表

| 欄位 | 說明 |
|------|------|
| `id` | 內部主鍵 |
| `order_no` | 藍新用訂單編號（UNIQUE） |
| `amount` | 訂單金額 |
| `item_desc` | 商品描述 |
| `email` | 付款人 email |
| `status` | `pending` / `paid` / `failed` / `cancelled` |
| `trade_no` | 藍新交易編號，付款成功後寫入（UNIQUE） |
| `paid_at` | 付款時間 |
| `created_at` / `updated_at` | 時間戳記 |

### payment_events 表

用於保留通知與補單紀錄，方便追查與對帳。

| 欄位 | 說明 |
|------|------|
| `id` | 主鍵 |
| `order_no` | 訂單編號 |
| `trade_no` | 交易編號 |
| `event_type` | 事件類型 |
| `status` | 狀態 |
| `payload_digest` | payload 摘要 |
| `message` | 訊息 |
| `created_at` | 時間戳記 |

> **重要**：`onPaymentSuccess()` 更新訂單時應包 transaction。收到重複 notify 時，以 `trade_no` 或訂單狀態做冪等判斷。

## 對帳與補單

### 自動補單

當 `NotifyURL` 漏接或系統異常時，使用 `queryTradeInfo` 查詢交易狀態：

```js
const { queryTradeInfo } = require('newbpay-node');

const result = await queryTradeInfo('ORDER_123', 100);
if (result.Status === 'SUCCESS' && result.Result.TradeStatus === '1') {
  // 交易已付款，執行補單邏輯
}
```

### 批次對帳

建議每日排程，查詢所有 `pending` 超過 N 小時的訂單：

1. 從 DB 撈出 `status = 'pending'` 且建立超過 2 小時的訂單
2. 逐筆呼叫 `queryTradeInfo(orderNo, amt)`
3. 藍新端已付款 → 執行 `onPaymentSuccess` 補單
4. 藍新端已失敗 / 逾期 → 更新訂單為 `failed`
5. 將查詢結果寫入 `payment_events` 表

### 異常處理

| 狀況 | 處理方式 |
|------|----------|
| 本地 `pending`、藍新已付款 | 自動補單或管理後台手動觸發 `queryTradeInfo` |
| 本地 `paid`、藍新無紀錄 | 不應發生，檢查是否有偽造 notify |
| 金額不符 | 立即告警，人工核實後處理 |
| 批次對帳筆數異常 | 檢查 NotifyURL 是否正常、藍新是否有系統公告 |

### 對帳頻率建議

| 階段 | 頻率 |
|------|------|
| 營運初期 | 每小時一次 |
| 穩定期 | 每日 1–2 次 |
| 大促期間 | 每 30 分鐘一次 |

## 正式環境檢查清單

- [ ] `BASE_URL` 為 HTTPS
- [ ] `NotifyURL` 對外可連通
- [ ] `tradeNo` 已落 DB 並設 UNIQUE constraint
- [ ] `onPaymentSuccess()` 含金額比對與冪等更新
- [ ] 付款成功僅以 `NotifyURL` 為準
- [ ] `QueryTradeInfo` 已納入補單流程
- [ ] `/payment/create` 加上認證與 rate limit
- [ ] 金鑰不寫死、不進版控、不印到日誌

## 測試

```bash
npm test
```

共 27 個測試，覆蓋以下範圍：

| 類別 | 測試項目 |
|------|----------|
| 加解密 | `createPayment` 建單與欄位驗證 |
| 驗章 | `verifyAndDecrypt` 驗章與解密（含非標準 padding 處理） |
| 查單 | `createQueryData` 參數與 CheckValue、`queryTradeInfo` 實際查詢與錯誤處理 |
| 請款/退款 | `closeTrade` 請款/退款/取消、IndexType 切換、參數驗證、`cancelAuth` 取消授權 |
| 路由 | `/payment/create` 正常 / 缺 orderId / 驗證錯誤 / 內部錯誤 |
| 通知 | `/payment/notify` 成功 / 重送冪等 / 金額不符拒絕 |
| 日誌 | 自訂 logger 驗證、驗章失敗為 error 級別、日誌不含敏感資料 |

測試信用卡號：`4000-2211-1111-1111`（任意未來到期日、任意 3 碼 CVV）。

## 範例

本 repo 包含測試用範例伺服器：

```bash
npm start   # 啟動 example/server.js
```

開啟 `http://localhost:3000` 即可測試。本地開發需搭配 ngrok 取得 HTTPS 網址供藍新回呼：

```bash
ngrok http 3000
# 將取得的 HTTPS URL 填入 .env 的 BASE_URL
```

> **注意**：範例伺服器僅供展示串接方式，使用記憶體內 mock 資料。正式環境務必改為資料庫 + transaction + unique constraint。

## 版本策略

本專案遵循 [Semantic Versioning](https://semver.org/)。

| 版本範圍 | 說明 |
|----------|------|
| `0.x.y`（目前） | Pre-1.0 階段，API 可能在 minor 版本間調整 |
| `1.0.0` | API 穩定，breaking changes 僅在 major 版本 |

升版規則：

- **patch**（`0.1.x`）：bug fix、文件修正
- **minor**（`0.x.0`）：新功能、non-breaking API 變更
- **major**（`x.0.0`）：breaking changes（1.0 前可能在 minor 進行）

詳見 [CHANGELOG.md](./CHANGELOG.md)。

## 問題回報

請至 [GitHub Issues](https://github.com/dianyike/Cash_Flow/issues) 回報，並附上：

- Node.js 版本
- 套件版本
- 錯誤訊息與重現步驟

## 授權

[MIT License](./LICENSE)
