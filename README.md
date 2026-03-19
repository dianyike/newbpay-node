# Newbpay-node

Node.js / Express 藍新金流串接基底，提供：

- MPG 建單資料產生
- `TradeInfo` / `TradeSha` 驗證與解密
- `NotifyURL` / `ReturnURL` / `CustomerURL` 路由
- `QueryTradeInfo` 查單參數產生與實際查詢
- 結構化 JSON log（支援自訂 logger）
- 19 個自動化測試覆蓋所有關鍵路徑

這個專案目前適合當作：

- 接案專案的藍新金流基底
- 內部可重複使用的 starter kit
- 早期商用版 beta

這個專案目前不應直接宣稱為：

- 完整企業級金流 SDK
- 含資料庫冪等保證的成品
- 含完整監控、補單、SLA 的託管服務

## Features

- 後端建立付款資料，不信任前端金額
- 驗證藍新回傳 `TradeSha`
- 解密 `TradeInfo`
- 支援信用卡、ATM、超商代碼、超商條碼、LINE Pay 開關
- 提供 `QueryTradeInfo` 查單參數與 `queryTradeInfo()` 實際查詢 helper
- 結構化 JSON log，支援自訂 logger 注入
- log 不含 TradeInfo / TradeSha / HashKey 等敏感資料
- 以 factory function 方式建立路由，方便整合方自行加認證與 rate limit

## Requirements

- Node.js 18+  
  建議使用目前 repo 已驗證的 Node.js 22
- 藍新商店代號
- 藍新 `HashKey`
- 藍新 `HashIV`
- 可對外接收藍新回呼的 HTTPS 網址

## Install

作為其他專案的依賴套件安裝：

```bash
npm install github:dianyike/Cash_Flow
```

若要在本 repo 內開發或測試：

```bash
git clone https://github.com/dianyike/Cash_Flow.git
cd Cash_Flow
npm install
cp .env.example .env
```

填入 `.env`：

```env
MERCHANT_ID=your_merchant_id
HASH_KEY=your_hash_key
HASH_IV=your_hash_iv
PORT=3000

# 測試環境
NEWEBPAY_API_URL=https://ccore.newebpay.com/MPG/mpg_gateway
NEWEBPAY_QUERY_URL=https://ccore.newebpay.com/API/QueryTradeInfo

# 正式環境請改成正式網址
# NEWEBPAY_API_URL=https://core.newebpay.com/MPG/mpg_gateway
# NEWEBPAY_QUERY_URL=https://core.newebpay.com/API/QueryTradeInfo

BASE_URL=https://your-domain.example
```

## Quick Start

```js
const express = require('express');
const { createPaymentRoutes } = require('newbpay-node');

const app = express();

const paymentRoutes = createPaymentRoutes(
  {
    async lookupOrder(orderId) {
      // 從你的 DB 查訂單
      // 回傳 { orderNo, amt, itemDesc, email }
      return {
        orderNo: 'ORDER_123',
        amt: 100,
        itemDesc: '測試商品',
        email: 'buyer@example.com',
      };
    },

    async onPaymentSuccess(orderNo, tradeNo, amt, rawResult) {
      // 必須由整合方自行保證：
      // 1. 訂單存在
      // 2. 金額一致
      // 3. tradeNo 不重複
      // 4. 狀態更新具冪等性
    },

    async onPaymentFail(orderNo, message, rawResult) {
      // 可選：記錄付款失敗
    },
  },
  {
    payment: { credit: true, vacc: true, cvs: true, barcode: true },
    // logger: yourCustomLogger,  // 可選：注入自訂 logger（需提供 info/warn/error）
  }
);

app.use(paymentRoutes);
app.listen(3000);
```

## Route Contract

### `POST /payment/create`

前端只傳：

```json
{
  "orderId": "your-order-id"
}
```

後端流程：

1. 呼叫 `lookupOrder(orderId)`
2. 從 DB 取出可信訂單資料
3. 產生 `MerchantID`、`TradeInfo`、`TradeSha`、`Version`

### `POST /payment/notify`

- 藍新 server-to-server 通知
- 這是唯一可信的付款成功來源
- 應以這裡觸發出貨、開通、入帳

### `POST /payment/return`

- 使用者付款後瀏覽器回傳
- 只適合顯示結果
- 不應在這裡當成最終付款成功依據

### `POST /payment/customer`

- ATM / CVS / BARCODE 取號資訊回傳

## What This Package Handles

- 藍新建單欄位組裝
- `TradeInfo` AES 加解密
- `TradeSha` 驗章
- 藍新回呼路由包裝
- `QueryTradeInfo` 查單參數產生與 `queryTradeInfo()` 實際查詢
- 結構化 JSON log（`event`、`orderNo`、`tradeNo`、`amt`、`ts`）
- 自訂 logger 注入（預設輸出至 console）

## What The Integrator Must Handle

- 訂單資料庫
- `tradeNo` 唯一鍵
- 訂單狀態 transaction
- 冪等更新
- 金額比對
- 認證與授權
- rate limit
- 監控與告警（可接收 library 的結構化 log event）
- 補單與人工對帳（可使用 `queryTradeInfo()` 建立自動化流程）

## Suggested DB Schema

最小正式環境至少建議有兩張表。

### `orders`

建議欄位：

- `id` internal order id
- `order_no` 藍新用訂單編號，應設 unique
- `amount`
- `item_desc`
- `email`
- `status`
- `trade_no` 可為 null，付款成功後寫入，應設 unique
- `paid_at`
- `created_at`
- `updated_at`

建議狀態：

- `pending`
- `paid`
- `failed`
- `cancelled`

### `payment_events`

用來保留通知與補單紀錄，方便追查與對帳。

建議欄位：

- `id`
- `order_no`
- `trade_no`
- `event_type`
- `status`
- `payload_digest`
- `message`
- `created_at`

### Schema Notes

- `orders.order_no` 應為 unique
- `orders.trade_no` 應為 unique
- `onPaymentSuccess()` 更新訂單時應包 transaction
- 若收到重複 notify，應先以 `trade_no` 或訂單狀態做冪等判斷

## Production Requirements

正式環境最少要做到：

- `BASE_URL` 必須是 HTTPS
- `NotifyURL` 對外可連通
- `tradeNo` 需落 DB 並設 unique constraint
- `onPaymentSuccess()` 需做金額比對與冪等更新
- 付款成功只以 `NotifyURL` 為準
- `QueryTradeInfo` 需納入補單流程
- `/payment/create` 應加認證與 rate limit
- 金鑰不可寫死、不可進 repo、不可印到 log

## Example

本 repo 含有測試用 example server：

```bash
npm start
```

測試頁面：

```txt
http://localhost:3000
```

說明：

- `example/server.js` 只示範串接方式
- 內含 mock 商品與 mock 訂單資料
- `processedTradeNos` 只是示範用途
- 正式環境必須改成 DB + transaction + unique constraint

## Testing

執行測試：

```bash
npm test
```

目前 19 個測試全部覆蓋：

- `createPayment` 建單與欄位驗證
- `verifyAndDecrypt` 驗章與解密（含尾端 null bytes、PKCS7、控制字元）
- `createQueryData` 查單參數與 CheckValue
- `queryTradeInfo` 實際查詢（mock server）與 HTTP 錯誤處理
- `POST /payment/create` 正常流程、缺少 orderId、驗證錯誤、內部錯誤
- `POST /payment/notify` 成功處理、重送冪等、金額不符拒絕
- 結構化 log 驗證：自訂 logger 收到正確 event、驗章失敗為 error、log 不含敏感資料

## Versioning

本專案採用 [Semantic Versioning](https://semver.org/)。

- `0.x.y`：API 可能在 minor 版本間調整，升級前請看 CHANGELOG
- `1.0.0`：API 穩定，non-breaking changes 只在 patch/minor

目前版本 `0.1.0`，屬 pre-1.0 階段。API 已在生產環境驗證，但保留調整空間。

升版規則：
- **patch**（`0.1.x`）：bug fix、文件修正
- **minor**（`0.x.0`）：新功能、non-breaking API 變更
- **major**（`x.0.0`）：breaking changes（1.0 前在 minor 版本進行）

## Reconciliation SOP（人工對帳）

當 `NotifyURL` 漏接或系統異常時，使用以下流程補單：

### 1. 自動補單

```js
const { queryTradeInfo } = require('newbpay-node');

// 傳入訂單編號與金額
const result = await queryTradeInfo('ORDER_123', 100);

if (result.Status === 'SUCCESS' && result.Result.TradeStatus === '1') {
  // 交易已付款，執行補單邏輯
}
```

### 2. 批次對帳

建議每日排程，查詢所有 `pending` 超過 N 小時的訂單：

```js
// 1. 從 DB 撈出 status = 'pending' 且建立超過 2 小時的訂單
// 2. 逐筆呼叫 queryTradeInfo(orderNo, amt)
// 3. 若藍新端已付款 → 執行 onPaymentSuccess 補單
// 4. 若藍新端已失敗/逾期 → 更新訂單為 failed
// 5. 將查詢結果寫入 payment_events 表
```

### 3. 人工介入時機

| 狀況 | 處理方式 |
|------|----------|
| 本地 `pending`、藍新已付款 | 自動補單 or 管理後台手動觸發 `queryTradeInfo` |
| 本地 `paid`、藍新無紀錄 | 不應發生；檢查是否有偽造 notify |
| 金額不符 | 立即告警，人工核實後處理 |
| 批次對帳筆數異常 | 檢查 NotifyURL 是否正常、藍新端是否有系統公告 |

### 4. 對帳頻率建議

- 營運初期：每小時一次
- 穩定後：每日 1-2 次
- 大促期間：每 30 分鐘一次

## Support Scope（支援範圍）

### 本套件負責

- NewebPay MPG 建單、加解密、驗章
- Express 路由工廠（notify / return / customer）
- QueryTradeInfo 查單
- 結構化 log 輸出

### 本套件不負責

- 資料庫操作與 transaction
- 認證、授權、rate limit
- 監控告警系統
- 退款、請款等進階 API
- 前端 UI

### 維護承諾

- **Bug fix**：確認為套件本身的 bug 後會盡快修復
- **藍新 API 變更**：依官方公告評估影響，必要時發布新版
- **Node.js 版本**：支援 Node.js 18+，跟隨 Node.js LTS 週期
- **Breaking changes**：1.0 前可能在 minor 版本調整，CHANGELOG 會清楚記載

### 問題回報

請至 [GitHub Issues](https://github.com/dianyike/Cash_Flow/issues) 回報，附上：
- Node.js 版本
- 套件版本
- 錯誤訊息與重現步驟

## Recommended Commercial Scope

目前較合理的銷售定位：

- 藍新金流串接基底
- 藍新金流 starter kit
- 專案導入模板

若要宣稱為穩定商用品質，建議先完成 [RELEASE_CHECKLIST.md](./RELEASE_CHECKLIST.md)。
