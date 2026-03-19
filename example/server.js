const path = require('path');
const express = require('express');
const helmet = require('helmet');
const config = require('../src/config');
const createPaymentRoutes = require('../src/routes');

const app = express();

// 安全性 headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      formAction: ["'self'", "https://ccore.newebpay.com", "https://core.newebpay.com"],
    },
  },
}));

app.use(express.json());

// --- 模擬商品目錄（正式環境由 DB 管理，金額不可由前端決定） ---
const products = new Map([
  ['PROD_A', { name: '測試商品 A', price: 100 }],
  ['PROD_B', { name: '測試商品 B', price: 500 }],
  ['PROD_C', { name: '測試商品 C', price: 1000 }],
]);

// --- 模擬訂單資料庫 ---
const orders = new Map();
// 已處理過的 TradeNo（正式環境應存 DB 並加 unique constraint）
const processedTradeNos = new Set();

// 取得商品列表
app.get('/products', (req, res) => {
  const list = [];
  for (const [id, p] of products) {
    list.push({ productId: id, name: p.name, price: p.price });
  }
  res.json(list);
});

// 建立訂單：前端只傳 productId，金額由後端從商品目錄查出
app.post('/order/create', (req, res) => {
  const { productId, email } = req.body;

  const product = products.get(productId);
  if (!product) {
    return res.status(400).json({ success: false, message: '商品不存在' });
  }

  const orderId = 'ORD' + Date.now();
  const orderNo = 'PAY' + Date.now();

  orders.set(orderId, {
    orderId,
    orderNo,
    amt: product.price,         // 金額來自商品目錄，非前端
    itemDesc: product.name,
    email: email || 'test@example.com',
    status: 'pending',          // pending → paid / failed
    tradeNo: null,
    paidAt: null,
  });

  res.json({ success: true, orderId, orderNo, amt: product.price, itemDesc: product.name });
});

// --- 掛載金流路由 ---
const paymentRoutes = createPaymentRoutes({
  async lookupOrder(orderId) {
    const order = orders.get(orderId);
    if (!order) return null;

    // 已完成或已失敗的訂單不可再建立付款
    if (order.status !== 'pending') return null;

    return {
      orderNo: order.orderNo,
      amt: order.amt,
      itemDesc: order.itemDesc,
      email: order.email,
    };
  },

  async onPaymentSuccess(orderNo, tradeNo, amt, rawResult) {
    // 找到對應訂單
    let order = null;
    for (const o of orders.values()) {
      if (o.orderNo === orderNo) { order = o; break; }
    }

    if (!order) {
      console.error(`[付款成功] 找不到訂單 ${orderNo}`);
      return;
    }

    // TradeNo 去重：防止同一筆藍新交易重複處理
    if (processedTradeNos.has(tradeNo)) {
      console.log(`[付款成功] TradeNo ${tradeNo} 已處理過，跳過`);
      return;
    }

    // 冪等：訂單已完成就跳過
    if (order.status === 'paid') {
      console.log(`[付款成功] 訂單 ${orderNo} 已完成，跳過重複通知`);
      return;
    }

    // 金額比對
    if (order.amt !== amt) {
      console.error(`[付款成功] 訂單 ${orderNo} 金額不符！本地=${order.amt}, 回傳=${amt}`);
      return;
    }

    // 標記 TradeNo 已處理
    processedTradeNos.add(tradeNo);

    // 更新訂單狀態
    order.status = 'paid';
    order.tradeNo = tradeNo;
    order.paidAt = new Date().toISOString();
    console.log(`[付款成功] 訂單 ${orderNo} 已完成付款，交易序號 ${tradeNo}`);
  },

  async onPaymentFail(orderNo, message) {
    for (const o of orders.values()) {
      if (o.orderNo === orderNo) {
        o.status = 'failed';
        console.log(`[付款失敗] 訂單 ${orderNo}: ${message}`);
        return;
      }
    }
  },
});

app.use(paymentRoutes);

// 靜態檔案（測試頁面）
app.use(express.static(path.join(__dirname, 'public')));

app.listen(config.port, () => {
  console.log(`藍新金流測試 server 啟動: http://localhost:${config.port}`);
});
