process.env.MERCHANT_ID = 'MS123456789';
process.env.HASH_KEY = '12345678901234567890123456789012';
process.env.HASH_IV = '1234567890123456';
process.env.BASE_URL = 'https://example.test';
process.env.NEWEBPAY_API_URL = 'https://ccore.newebpay.com/MPG/mpg_gateway';
process.env.NEWEBPAY_QUERY_URL = 'https://ccore.newebpay.com/API/QueryTradeInfo';
process.env.NODE_ENV = 'test';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const express = require('express');

const config = require('../src/config');
const {
  createPayment,
  verifyAndDecrypt,
  createQueryData,
  queryTradeInfo,
  closeTrade,
  cancelAuth,
  createTradeSha,
} = require('../src/newebpay');
const createPaymentRoutes = require('../src/routes');

function decryptRequestTradeInfo(tradeInfo) {
  const decipher = crypto.createDecipheriv(
    'aes-256-cbc',
    Buffer.from(config.hashKey, 'utf8'),
    Buffer.from(config.hashIV, 'utf8')
  );
  let decrypted = decipher.update(tradeInfo, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return Object.fromEntries(new URLSearchParams(decrypted).entries());
}

function encryptResponseTradeInfo(data) {
  const cipher = crypto.createCipheriv(
    'aes-256-cbc',
    Buffer.from(config.hashKey, 'utf8'),
    Buffer.from(config.hashIV, 'utf8')
  );
  let encrypted = cipher.update(JSON.stringify(data), 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
}

function encryptResponseTradeInfoWithTrailingNullBytes(data) {
  const plain = Buffer.from(JSON.stringify(data), 'utf8');
  const blockSize = 16;
  const padLen = blockSize - (plain.length % blockSize || blockSize);
  const padded = Buffer.concat([
    plain,
    Buffer.alloc(padLen, padLen),
    Buffer.alloc(blockSize, 0),
  ]);

  const cipher = crypto.createCipheriv(
    'aes-256-cbc',
    Buffer.from(config.hashKey, 'utf8'),
    Buffer.from(config.hashIV, 'utf8')
  );
  cipher.setAutoPadding(false);

  let encrypted = cipher.update(padded, undefined, 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
}

function encryptResponseTradeInfoWithTrailingControlBytes(data, trailingBytes) {
  const plain = Buffer.from(JSON.stringify(data), 'utf8');
  const payload = Buffer.concat([plain, Buffer.from(trailingBytes)]);
  const blockSize = 16;
  const remainder = payload.length % blockSize;
  const padded = remainder === 0
    ? payload
    : Buffer.concat([payload, Buffer.alloc(blockSize - remainder, 0)]);

  const cipher = crypto.createCipheriv(
    'aes-256-cbc',
    Buffer.from(config.hashKey, 'utf8'),
    Buffer.from(config.hashIV, 'utf8')
  );
  cipher.setAutoPadding(false);

  let encrypted = cipher.update(padded, undefined, 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
}

async function withServer(handlers, fn, routeOptions) {
  const app = express();
  app.use(createPaymentRoutes(handlers, routeOptions));

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

  try {
    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    await fn(baseUrl);
  } finally {
    if (!server.listening) {
      return;
    }

    await new Promise((resolve, reject) => {
      server.close((err) => {
        if (!err || err.code === 'ERR_SERVER_NOT_RUNNING') {
          resolve();
          return;
        }
        reject(err);
      });
    });
  }
}

test('createPayment 會建立可驗證的 TradeInfo 與 TradeSha', () => {
  const payment = createPayment(
    {
      orderNo: 'ORDER_123',
      amt: 500,
      itemDesc: 'Test item',
      email: 'buyer@example.com',
    },
    {
      credit: true,
      vacc: false,
      cvs: false,
      barcode: false,
    }
  );

  assert.equal(payment.MerchantID, config.merchantId);
  assert.equal(payment.Version, config.version);
  assert.equal(payment.PayGateURL, config.newebpayApiUrl);
  assert.equal(payment.TradeSha, createTradeSha(payment.TradeInfo));

  const params = decryptRequestTradeInfo(payment.TradeInfo);
  assert.equal(params.MerchantOrderNo, 'ORDER_123');
  assert.equal(params.Amt, '500');
  assert.equal(params.ItemDesc, 'Test item');
  assert.equal(params.Email, 'buyer@example.com');
  assert.equal(params.ReturnURL, `${config.baseUrl}/payment/return`);
  assert.equal(params.NotifyURL, `${config.baseUrl}/payment/notify`);
  assert.equal(params.CustomerURL, `${config.baseUrl}/payment/customer`);
  assert.equal(params.CREDIT, '1');
  assert.equal(params.VACC, undefined);
});

test('createPayment 會拒絕不合法訂單資料', () => {
  assert.throws(
    () => createPayment({
      orderNo: 'bad-order-no',
      amt: 0,
      itemDesc: 'Test item',
      email: 'invalid-email',
    }),
    /訂單欄位驗證失敗/
  );
});

test('verifyAndDecrypt 會驗證 TradeSha 並解密回傳資料', () => {
  const expected = {
    Status: 'SUCCESS',
    Message: '付款成功',
    Result: {
      MerchantOrderNo: 'ORDER_123',
      TradeNo: '240101000001',
      Amt: 500,
    },
  };
  const tradeInfo = encryptResponseTradeInfo(expected);

  const payload = {
    TradeInfo: tradeInfo,
    TradeSha: createTradeSha(tradeInfo),
  };

  assert.deepEqual(verifyAndDecrypt(payload), expected);
});

test('verifyAndDecrypt 可處理藍新尾端 null bytes 與 PKCS7 padding', () => {
  const expected = {
    Status: 'SUCCESS',
    Message: '付款成功',
    Result: {
      MerchantOrderNo: 'ORDER_456',
      TradeNo: '240101000002',
      Amt: 800,
    },
  };
  const tradeInfo = encryptResponseTradeInfoWithTrailingNullBytes(expected);

  const payload = {
    TradeInfo: tradeInfo,
    TradeSha: createTradeSha(tradeInfo),
  };

  assert.deepEqual(verifyAndDecrypt(payload), expected);
});

test('verifyAndDecrypt 可處理信用卡回傳尾端控制字元', () => {
  const expected = {
    Status: 'SUCCESS',
    Message: '付款成功',
    Result: {
      MerchantOrderNo: 'ORDER_CARD_1',
      TradeNo: '240101000003',
      Amt: 1200,
      PaymentType: 'CREDIT',
    },
  };
  const tradeInfo = encryptResponseTradeInfoWithTrailingControlBytes(
    expected,
    [0x04, 0x04, 0x00, 0x00, 0x1f]
  );

  const payload = {
    TradeInfo: tradeInfo,
    TradeSha: createTradeSha(tradeInfo),
  };

  assert.deepEqual(verifyAndDecrypt(payload), expected);
});

test('verifyAndDecrypt 會拒絕被竄改的 TradeSha', () => {
  assert.throws(
    () => verifyAndDecrypt({ TradeInfo: 'abcd', TradeSha: 'BADSHA' }),
    /TradeSha 驗證失敗/
  );
});

test('createQueryData 會依官方規格產生 QueryTradeInfo 參數', () => {
  const queryData = createQueryData('ORDER_123', 500);
  const expectedCheckValue = crypto
    .createHash('sha256')
    .update(
      `IV=${config.hashIV}&Amt=500&MerchantID=${config.merchantId}&MerchantOrderNo=ORDER_123&Key=${config.hashKey}`,
      'utf8'
    )
    .digest('hex')
    .toUpperCase();

  assert.equal(queryData.MerchantID, config.merchantId);
  assert.equal(queryData.Version, '1.3');
  assert.equal(queryData.RespondType, 'JSON');
  assert.equal(queryData.MerchantOrderNo, 'ORDER_123');
  assert.equal(queryData.Amt, 500);
  assert.equal(queryData.CheckValue, expectedCheckValue);
  assert.equal(queryData.QueryURL, config.newebpayQueryUrl);
  assert.match(queryData.TimeStamp, /^\d+$/);
});

test('POST /payment/create 會用 lookupOrder 的資料建立付款內容', async () => {
  let seenOrderId = null;

  await withServer(
    {
      async lookupOrder(orderId) {
        seenOrderId = orderId;
        return {
          orderNo: 'ORDER_DB_1',
          amt: 799,
          itemDesc: 'Server item',
          email: 'db@example.com',
        };
      },
      async onPaymentSuccess() {},
    },
    async (baseUrl) => {
      const resp = await fetch(`${baseUrl}/payment/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: 'order-1' }),
      });
      const json = await resp.json();

      assert.equal(resp.status, 200);
      assert.equal(json.success, true);
      assert.equal(seenOrderId, 'order-1');

      const params = decryptRequestTradeInfo(json.data.TradeInfo);
      assert.equal(params.MerchantOrderNo, 'ORDER_DB_1');
      assert.equal(params.Amt, '799');
      assert.equal(params.ItemDesc, 'Server item');
      assert.equal(params.Email, 'db@example.com');
    }
  );
});

test('POST /payment/create 缺少 orderId 時回 400', async () => {
  await withServer(
    {
      async lookupOrder() {
        return null;
      },
      async onPaymentSuccess() {},
    },
    async (baseUrl) => {
      const resp = await fetch(`${baseUrl}/payment/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      const json = await resp.json();

      assert.equal(resp.status, 400);
      assert.deepEqual(json, { success: false, message: '缺少 orderId' });
    }
  );
});

test('POST /payment/create 對驗證錯誤回 400，對內部錯誤回 500', async () => {
  await withServer(
    {
      async lookupOrder(orderId) {
        if (orderId === 'bad-order') {
          return {
            orderNo: 'INVALID-ORDER-NO',
            amt: 100,
            itemDesc: 'Test item',
            email: 'buyer@example.com',
          };
        }

        throw new Error('db unavailable');
      },
      async onPaymentSuccess() {},
    },
    async (baseUrl) => {
      const badResp = await fetch(`${baseUrl}/payment/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: 'bad-order' }),
      });
      const badJson = await badResp.json();

      assert.equal(badResp.status, 400);
      assert.match(badJson.message, /訂單欄位驗證失敗/);

      const errorResp = await fetch(`${baseUrl}/payment/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: 'db-error' }),
      });
      const errorJson = await errorResp.json();

      assert.equal(errorResp.status, 500);
      assert.deepEqual(errorJson, { success: false, message: '伺服器內部錯誤' });
    }
  );
});

// --- 以下為 Section 8 最小可販售門檻的 4 個關鍵整合測試 ---

function buildNotifyBody(data) {
  const tradeInfo = encryptResponseTradeInfo(data);
  const tradeSha = createTradeSha(tradeInfo);
  return new URLSearchParams({ TradeInfo: tradeInfo, TradeSha: tradeSha }).toString();
}

test('POST /payment/notify 成功時呼叫 onPaymentSuccess 並帶入正確參數', async () => {
  const calls = [];

  await withServer(
    {
      async lookupOrder() { return null; },
      async onPaymentSuccess(orderNo, tradeNo, amt, rawResult) {
        calls.push({ orderNo, tradeNo, amt, rawResult });
      },
    },
    async (baseUrl) => {
      const notifyData = {
        Status: 'SUCCESS',
        Message: '付款成功',
        Result: {
          MerchantOrderNo: 'ORDER_NOTIFY_1',
          TradeNo: '24010100001',
          Amt: 350,
        },
      };

      const resp = await fetch(`${baseUrl}/payment/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: buildNotifyBody(notifyData),
      });

      assert.equal(resp.status, 200);
      assert.equal(await resp.text(), 'OK');
      assert.equal(calls.length, 1);
      assert.equal(calls[0].orderNo, 'ORDER_NOTIFY_1');
      assert.equal(calls[0].tradeNo, '24010100001');
      assert.equal(calls[0].amt, 350);
      assert.equal(calls[0].rawResult.Status, 'SUCCESS');
    }
  );
});

test('POST /payment/notify 重送時 handler 可實現冪等（不重複入帳）', async () => {
  const processedTradeNos = new Set();
  const successCalls = [];

  await withServer(
    {
      async lookupOrder() { return null; },
      async onPaymentSuccess(orderNo, tradeNo, amt) {
        if (processedTradeNos.has(tradeNo)) {
          // 冪等：已處理過的 tradeNo 不再重複入帳
          return;
        }
        processedTradeNos.add(tradeNo);
        successCalls.push({ orderNo, tradeNo, amt });
      },
    },
    async (baseUrl) => {
      const notifyData = {
        Status: 'SUCCESS',
        Message: '付款成功',
        Result: {
          MerchantOrderNo: 'ORDER_IDEMPOTENT',
          TradeNo: '24010100099',
          Amt: 600,
        },
      };
      const body = buildNotifyBody(notifyData);

      // 送兩次相同的 notify
      const resp1 = await fetch(`${baseUrl}/payment/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      const resp2 = await fetch(`${baseUrl}/payment/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });

      assert.equal(resp1.status, 200);
      assert.equal(resp2.status, 200);
      // handler 被呼叫兩次，但只有一筆實際入帳
      assert.equal(successCalls.length, 1);
      assert.equal(successCalls[0].tradeNo, '24010100099');
    }
  );
});

test('POST /payment/notify 金額不符時 handler 拋錯，路由回 400', async () => {
  const DB_AMOUNT = 500;

  await withServer(
    {
      async lookupOrder() { return null; },
      async onPaymentSuccess(orderNo, tradeNo, amt) {
        if (amt !== DB_AMOUNT) {
          throw new Error(`金額不符: 預期 ${DB_AMOUNT}，收到 ${amt}`);
        }
      },
    },
    async (baseUrl) => {
      const notifyData = {
        Status: 'SUCCESS',
        Message: '付款成功',
        Result: {
          MerchantOrderNo: 'ORDER_AMT_MISMATCH',
          TradeNo: '24010100088',
          Amt: 999,
        },
      };

      const resp = await fetch(`${baseUrl}/payment/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: buildNotifyBody(notifyData),
      });

      assert.equal(resp.status, 400);
      assert.equal(await resp.text(), '處理失敗');
    }
  );
});

test('createQueryData 產生的 CheckValue 可用於補單查詢', () => {
  const orderNo = 'ORDER_RECON_1';
  const amt = 1200;

  const queryData = createQueryData(orderNo, amt);

  // 驗證所有必要欄位存在
  assert.equal(queryData.MerchantID, config.merchantId);
  assert.equal(queryData.MerchantOrderNo, orderNo);
  assert.equal(queryData.Amt, amt);
  assert.equal(queryData.Version, '1.3');
  assert.equal(queryData.RespondType, 'JSON');
  assert.ok(queryData.QueryURL);
  assert.match(queryData.TimeStamp, /^\d+$/);

  // 驗證 CheckValue 格式正確（64 字元大寫 hex = SHA256）
  assert.match(queryData.CheckValue, /^[A-F0-9]{64}$/);

  // 驗證 CheckValue 依官方規格可重新計算
  const recomputed = crypto
    .createHash('sha256')
    .update(
      `IV=${config.hashIV}&Amt=${amt}&MerchantID=${config.merchantId}&MerchantOrderNo=${orderNo}&Key=${config.hashKey}`,
      'utf8'
    )
    .digest('hex')
    .toUpperCase();
  assert.equal(queryData.CheckValue, recomputed);
});

test('queryTradeInfo 向藍新查詢 API 發送請求並回傳結果', async () => {
  // 建立 mock server 模擬藍新 QueryTradeInfo endpoint
  const mockApp = express();
  mockApp.use(express.urlencoded({ extended: true }));

  let receivedParams = null;
  mockApp.post('/API/QueryTradeInfo', (req, res) => {
    receivedParams = req.body;
    res.json({
      Status: 'SUCCESS',
      Message: '查詢成功',
      Result: {
        MerchantID: req.body.MerchantID,
        MerchantOrderNo: req.body.MerchantOrderNo,
        Amt: 750,
        TradeNo: '24010100050',
        TradeStatus: '1',
        PaymentType: 'CREDIT',
        PayTime: '2024-01-01 12:00:00',
      },
    });
  });

  const mockServer = await new Promise((resolve) => {
    const instance = mockApp.listen(0, '127.0.0.1', () => resolve(instance));
  });

  try {
    const port = mockServer.address().port;
    // 暫時覆寫 config 的 query URL 指向 mock server
    const originalUrl = config.newebpayQueryUrl;
    config.newebpayQueryUrl = `http://127.0.0.1:${port}/API/QueryTradeInfo`;

    const result = await queryTradeInfo('ORDER_QUERY_1', 750);

    // 還原 config
    config.newebpayQueryUrl = originalUrl;

    // 驗證 mock server 收到正確參數
    assert.equal(receivedParams.MerchantID, config.merchantId);
    assert.equal(receivedParams.MerchantOrderNo, 'ORDER_QUERY_1');
    assert.equal(receivedParams.Amt, '750');
    assert.equal(receivedParams.Version, '1.3');
    assert.equal(receivedParams.RespondType, 'JSON');
    assert.match(receivedParams.CheckValue, /^[A-F0-9]{64}$/);

    // 驗證回傳結果
    assert.equal(result.Status, 'SUCCESS');
    assert.equal(result.Result.MerchantOrderNo, 'ORDER_QUERY_1');
    assert.equal(result.Result.TradeNo, '24010100050');
    assert.equal(result.Result.TradeStatus, '1');
  } finally {
    await new Promise((resolve, reject) => {
      mockServer.close((err) => {
        if (!err || err.code === 'ERR_SERVER_NOT_RUNNING') resolve();
        else reject(err);
      });
    });
  }
});

test('queryTradeInfo 在 HTTP 錯誤時拋出例外', async () => {
  const mockApp = express();
  mockApp.post('/API/QueryTradeInfo', (_req, res) => {
    res.status(500).send('Internal Server Error');
  });

  const mockServer = await new Promise((resolve) => {
    const instance = mockApp.listen(0, '127.0.0.1', () => resolve(instance));
  });

  try {
    const port = mockServer.address().port;
    const originalUrl = config.newebpayQueryUrl;
    config.newebpayQueryUrl = `http://127.0.0.1:${port}/API/QueryTradeInfo`;

    await assert.rejects(
      () => queryTradeInfo('ORDER_FAIL', 100),
      /QueryTradeInfo 請求失敗: HTTP 500/
    );

    config.newebpayQueryUrl = originalUrl;
  } finally {
    await new Promise((resolve, reject) => {
      mockServer.close((err) => {
        if (!err || err.code === 'ERR_SERVER_NOT_RUNNING') resolve();
        else reject(err);
      });
    });
  }
});

// --- Observability: 結構化 log 測試 ---

function createTestLogger() {
  const logs = { info: [], warn: [], error: [] };
  return {
    logs,
    info: (data) => logs.info.push(data),
    warn: (data) => logs.warn.push(data),
    error: (data) => logs.error.push(data),
  };
}

test('自訂 logger 收到結構化 log（notify 成功）', async () => {
  const logger = createTestLogger();

  await withServer(
    {
      async lookupOrder() { return null; },
      async onPaymentSuccess() {},
    },
    async (baseUrl) => {
      const notifyData = {
        Status: 'SUCCESS',
        Message: '付款成功',
        Result: {
          MerchantOrderNo: 'ORDER_LOG_1',
          TradeNo: '24010100070',
          Amt: 200,
        },
      };

      await fetch(`${baseUrl}/payment/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: buildNotifyBody(notifyData),
      });

      assert.equal(logger.logs.info.length, 1);
      const entry = logger.logs.info[0];
      assert.equal(entry.event, 'payment.notify.success');
      assert.equal(entry.orderNo, 'ORDER_LOG_1');
      assert.equal(entry.tradeNo, '24010100070');
      assert.equal(entry.amt, 200);
      assert.ok(entry.ts);
      // 確保不含敏感資料
      assert.equal(entry.TradeInfo, undefined);
      assert.equal(entry.TradeSha, undefined);
      assert.equal(entry.HashKey, undefined);
    },
    { logger }
  );
});

test('自訂 logger 收到結構化 log（驗章失敗為 error）', async () => {
  const logger = createTestLogger();

  await withServer(
    {
      async lookupOrder() { return null; },
      async onPaymentSuccess() {},
    },
    async (baseUrl) => {
      await fetch(`${baseUrl}/payment/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ TradeInfo: 'fake', TradeSha: 'BAD' }).toString(),
      });

      assert.equal(logger.logs.error.length, 1);
      const entry = logger.logs.error[0];
      assert.equal(entry.event, 'payment.notify.error');
      assert.match(entry.message, /TradeSha 驗證失敗/);
      assert.ok(entry.ts);
    },
    { logger }
  );
});

// --- 信用卡請款 / 退款 / 取消授權 ---

test('closeTrade 以 tradeNo 請款成功並帶入正確加密參數', async () => {
  const mockApp = express();
  mockApp.use(express.urlencoded({ extended: true }));

  let receivedBody = null;
  mockApp.post('/API/CreditCard/Close', (req, res) => {
    receivedBody = req.body;
    res.json({
      Status: 'SUCCESS',
      Message: '請款成功',
      Result: {
        MerchantID: config.merchantId,
        Amt: 500,
        TradeNo: '24010100001',
        MerchantOrderNo: 'ORDER_CLOSE_1',
      },
    });
  });

  const mockServer = await new Promise((resolve) => {
    const instance = mockApp.listen(0, '127.0.0.1', () => resolve(instance));
  });

  try {
    const port = mockServer.address().port;
    const originalUrl = config.newebpayCloseUrl;
    config.newebpayCloseUrl = `http://127.0.0.1:${port}/API/CreditCard/Close`;

    const result = await closeTrade({
      tradeNo: '24010100001',
      amt: 500,
      closeType: 1,
    });

    config.newebpayCloseUrl = originalUrl;

    // 驗證外層欄位
    assert.equal(receivedBody.MerchantID_, config.merchantId);

    // 解密 PostData_ 驗證內層參數
    const params = decryptRequestTradeInfo(receivedBody.PostData_);
    assert.equal(params.RespondType, 'JSON');
    assert.equal(params.Version, '1.1');
    assert.equal(params.TradeNo, '24010100001');
    assert.equal(params.IndexType, '2');
    assert.equal(params.Amt, '500');
    assert.equal(params.CloseType, '1');
    assert.match(params.TimeStamp, /^\d+$/);
    assert.equal(params.Cancel, undefined);

    // 驗證回傳結果
    assert.equal(result.Status, 'SUCCESS');
    assert.equal(result.Result.TradeNo, '24010100001');
    assert.equal(result.Result.Amt, 500);
  } finally {
    await new Promise((resolve, reject) => {
      mockServer.close((err) => {
        if (!err || err.code === 'ERR_SERVER_NOT_RUNNING') resolve();
        else reject(err);
      });
    });
  }
});

test('closeTrade 以 orderNo 退款成功（IndexType=1, CloseType=2）', async () => {
  const mockApp = express();
  mockApp.use(express.urlencoded({ extended: true }));

  let receivedBody = null;
  mockApp.post('/API/CreditCard/Close', (req, res) => {
    receivedBody = req.body;
    res.json({
      Status: 'SUCCESS',
      Message: '退款成功',
      Result: {
        MerchantID: config.merchantId,
        Amt: 300,
        TradeNo: '24010100002',
        MerchantOrderNo: 'ORDER_REFUND_1',
      },
    });
  });

  const mockServer = await new Promise((resolve) => {
    const instance = mockApp.listen(0, '127.0.0.1', () => resolve(instance));
  });

  try {
    const port = mockServer.address().port;
    const originalUrl = config.newebpayCloseUrl;
    config.newebpayCloseUrl = `http://127.0.0.1:${port}/API/CreditCard/Close`;

    const result = await closeTrade({
      orderNo: 'ORDER_REFUND_1',
      amt: 300,
      closeType: 2,
    });

    config.newebpayCloseUrl = originalUrl;

    const params = decryptRequestTradeInfo(receivedBody.PostData_);
    assert.equal(params.MerchantOrderNo, 'ORDER_REFUND_1');
    assert.equal(params.IndexType, '1');
    assert.equal(params.CloseType, '2');
    assert.equal(params.TradeNo, undefined);

    assert.equal(result.Status, 'SUCCESS');
    assert.equal(result.Result.MerchantOrderNo, 'ORDER_REFUND_1');
  } finally {
    await new Promise((resolve, reject) => {
      mockServer.close((err) => {
        if (!err || err.code === 'ERR_SERVER_NOT_RUNNING') resolve();
        else reject(err);
      });
    });
  }
});

test('closeTrade 取消請款時帶入 Cancel 參數', async () => {
  const mockApp = express();
  mockApp.use(express.urlencoded({ extended: true }));

  let receivedBody = null;
  mockApp.post('/API/CreditCard/Close', (req, res) => {
    receivedBody = req.body;
    res.json({ Status: 'SUCCESS', Message: '取消請款成功', Result: {} });
  });

  const mockServer = await new Promise((resolve) => {
    const instance = mockApp.listen(0, '127.0.0.1', () => resolve(instance));
  });

  try {
    const port = mockServer.address().port;
    const originalUrl = config.newebpayCloseUrl;
    config.newebpayCloseUrl = `http://127.0.0.1:${port}/API/CreditCard/Close`;

    await closeTrade({
      tradeNo: '24010100003',
      amt: 200,
      closeType: 1,
      cancel: true,
    });

    config.newebpayCloseUrl = originalUrl;

    const params = decryptRequestTradeInfo(receivedBody.PostData_);
    assert.equal(params.Cancel, '1');
    assert.equal(params.CloseType, '1');
  } finally {
    await new Promise((resolve, reject) => {
      mockServer.close((err) => {
        if (!err || err.code === 'ERR_SERVER_NOT_RUNNING') resolve();
        else reject(err);
      });
    });
  }
});

test('closeTrade 缺少必要參數時拋出錯誤', async () => {
  // 未提供 tradeNo 和 orderNo
  await assert.rejects(
    () => closeTrade({ amt: 100, closeType: 1 }),
    /必須提供 tradeNo 或 orderNo/
  );

  // 同時提供 tradeNo 和 orderNo
  await assert.rejects(
    () => closeTrade({ tradeNo: 'T1', orderNo: 'O1', amt: 100, closeType: 1 }),
    /tradeNo 與 orderNo 只能擇一提供/
  );

  // 金額不合法
  await assert.rejects(
    () => closeTrade({ tradeNo: 'T1', amt: -1, closeType: 1 }),
    /amt 必須為正整數/
  );

  // closeType 不合法
  await assert.rejects(
    () => closeTrade({ tradeNo: 'T1', amt: 100, closeType: 3 }),
    /closeType 必須為 1（請款）或 2（退款）/
  );

  // notifyUrl 非 HTTPS
  await assert.rejects(
    () => closeTrade({ tradeNo: 'T1', amt: 100, closeType: 1, notifyUrl: 'http://evil.com/cb' }),
    /notifyUrl 必須使用 HTTPS/
  );
});

test('cancelAuth 同時提供 tradeNo 和 orderNo 時拋出錯誤', async () => {
  await assert.rejects(
    () => cancelAuth({ tradeNo: 'T1', orderNo: 'O1', amt: 100 }),
    /tradeNo 與 orderNo 只能擇一提供/
  );
});

test('cancelAuth notifyUrl 非 HTTPS 時拋出錯誤', async () => {
  await assert.rejects(
    () => cancelAuth({ tradeNo: 'T1', amt: 100, notifyUrl: 'http://example.com/cb' }),
    /notifyUrl 必須使用 HTTPS/
  );
});

test('cancelAuth 取消授權成功並帶入正確參數', async () => {
  const mockApp = express();
  mockApp.use(express.urlencoded({ extended: true }));

  let receivedBody = null;
  mockApp.post('/API/CreditCard/Cancel', (req, res) => {
    receivedBody = req.body;
    res.json({
      Status: 'SUCCESS',
      Message: '取消授權成功',
      Result: {
        MerchantID: config.merchantId,
        Amt: 1000,
        TradeNo: '24010100010',
        MerchantOrderNo: 'ORDER_CANCEL_1',
      },
    });
  });

  const mockServer = await new Promise((resolve) => {
    const instance = mockApp.listen(0, '127.0.0.1', () => resolve(instance));
  });

  try {
    const port = mockServer.address().port;
    const originalUrl = config.newebpayCancelUrl;
    config.newebpayCancelUrl = `http://127.0.0.1:${port}/API/CreditCard/Cancel`;

    const result = await cancelAuth({
      tradeNo: '24010100010',
      amt: 1000,
    });

    config.newebpayCancelUrl = originalUrl;

    assert.equal(receivedBody.MerchantID_, config.merchantId);

    const params = decryptRequestTradeInfo(receivedBody.PostData_);
    assert.equal(params.RespondType, 'JSON');
    assert.equal(params.Version, '1.0');
    assert.equal(params.TradeNo, '24010100010');
    assert.equal(params.IndexType, '2');
    assert.equal(params.Amt, '1000');
    assert.match(params.TimeStamp, /^\d+$/);

    assert.equal(result.Status, 'SUCCESS');
    assert.equal(result.Result.TradeNo, '24010100010');
  } finally {
    await new Promise((resolve, reject) => {
      mockServer.close((err) => {
        if (!err || err.code === 'ERR_SERVER_NOT_RUNNING') resolve();
        else reject(err);
      });
    });
  }
});

test('closeTrade 與 cancelAuth 在 HTTP 錯誤時拋出例外', async () => {
  const mockApp = express();
  mockApp.post('/API/CreditCard/Close', (_req, res) => {
    res.status(500).send('Internal Server Error');
  });
  mockApp.post('/API/CreditCard/Cancel', (_req, res) => {
    res.status(502).send('Bad Gateway');
  });

  const mockServer = await new Promise((resolve) => {
    const instance = mockApp.listen(0, '127.0.0.1', () => resolve(instance));
  });

  try {
    const port = mockServer.address().port;
    const originalCloseUrl = config.newebpayCloseUrl;
    const originalCancelUrl = config.newebpayCancelUrl;
    config.newebpayCloseUrl = `http://127.0.0.1:${port}/API/CreditCard/Close`;
    config.newebpayCancelUrl = `http://127.0.0.1:${port}/API/CreditCard/Cancel`;

    await assert.rejects(
      () => closeTrade({ tradeNo: 'T1', amt: 100, closeType: 1 }),
      /CreditCard\/Close 請求失敗: HTTP 500/
    );

    await assert.rejects(
      () => cancelAuth({ tradeNo: 'T1', amt: 100 }),
      /CreditCard\/Cancel 請求失敗: HTTP 502/
    );

    config.newebpayCloseUrl = originalCloseUrl;
    config.newebpayCancelUrl = originalCancelUrl;
  } finally {
    await new Promise((resolve, reject) => {
      mockServer.close((err) => {
        if (!err || err.code === 'ERR_SERVER_NOT_RUNNING') resolve();
        else reject(err);
      });
    });
  }
});

test('log 不含 TradeInfo、TradeSha、HashKey 等敏感資料', async () => {
  const logger = createTestLogger();

  await withServer(
    {
      async lookupOrder() {
        return { orderNo: 'ORDER_SEC_1', amt: 100, itemDesc: 'Test', email: 'a@b.com' };
      },
      async onPaymentSuccess() {},
    },
    async (baseUrl) => {
      // 觸發 payment.create log
      await fetch(`${baseUrl}/payment/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: 'sec-order' }),
      });

      // 觸發 notify log
      const notifyData = {
        Status: 'SUCCESS',
        Message: '付款成功',
        Result: { MerchantOrderNo: 'ORDER_SEC_1', TradeNo: '24010100071', Amt: 100 },
      };
      await fetch(`${baseUrl}/payment/notify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: buildNotifyBody(notifyData),
      });

      const allLogs = [...logger.logs.info, ...logger.logs.warn, ...logger.logs.error];
      for (const entry of allLogs) {
        const json = JSON.stringify(entry);
        assert.equal(json.includes(config.hashKey), false, 'log 不應包含 HashKey');
        assert.equal(json.includes(config.hashIV), false, 'log 不應包含 HashIV');
        assert.equal(entry.TradeInfo, undefined, 'log 不應包含 TradeInfo');
        assert.equal(entry.TradeSha, undefined, 'log 不應包含 TradeSha');
      }
    },
    { logger }
  );
});
