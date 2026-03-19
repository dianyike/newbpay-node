# Newbpay-node

Node.js / Express 藍新金流串接基底，提供：

- MPG 建單資料產生
- `TradeInfo` / `TradeSha` 驗證與解密
- `NotifyURL` / `ReturnURL` / `CustomerURL` 路由
- `QueryTradeInfo` 查單參數產生
- 最小測試覆蓋 `createPayment`、`verifyAndDecrypt`、`createQueryData`、`/payment/create`

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
- 提供 `QueryTradeInfo` 查單參數
- 以 factory function 方式建立路由，方便整合方自行加認證與 rate limit

## Requirements

- Node.js 18+  
  建議使用目前 repo 已驗證的 Node.js 22
- 藍新商店代號
- 藍新 `HashKey`
- 藍新 `HashIV`
- 可對外接收藍新回呼的 HTTPS 網址

## Install

```bash
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
const createPaymentRoutes = require('./src/routes');

const app = express();

const paymentRoutes = createPaymentRoutes({
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
});

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
- `QueryTradeInfo` 查單參數產生

## What The Integrator Must Handle

- 訂單資料庫
- `tradeNo` 唯一鍵
- 訂單狀態 transaction
- 冪等更新
- 金額比對
- 認證與授權
- rate limit
- 監控與告警
- 補單與人工對帳

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

目前已覆蓋：

- `createPayment`
- `verifyAndDecrypt`
- `createQueryData`
- `POST /payment/create`
- 信用卡回傳尾端控制字元解密回歸案例

## Recommended Commercial Scope

目前較合理的銷售定位：

- 藍新金流串接基底
- 藍新金流 starter kit
- 專案導入模板

若要宣稱為穩定商用品質，建議先完成 [RELEASE_CHECKLIST.md](/Users/dianyi/Desktop/studio/Cash_Flow/RELEASE_CHECKLIST.md)。
