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

async function withServer(handlers, fn) {
  const app = express();
  app.use(createPaymentRoutes(handlers));

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
