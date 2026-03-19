const crypto = require('crypto');
const config = require('./config');

// --- 欄位驗證 ---

const ORDER_NO_REGEX = /^[a-zA-Z0-9_]+$/;
const ORDER_NO_MAX_LEN = 30;
const ITEM_DESC_MAX_LEN = 50;
const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateOrder(order) {
  const errors = [];

  if (!order.orderNo || typeof order.orderNo !== 'string') {
    errors.push('orderNo 為必填');
  } else {
    if (!ORDER_NO_REGEX.test(order.orderNo)) {
      errors.push('orderNo 只能包含英文、數字、底線');
    }
    if (order.orderNo.length > ORDER_NO_MAX_LEN) {
      errors.push(`orderNo 長度不可超過 ${ORDER_NO_MAX_LEN} 字元`);
    }
  }

  if (!Number.isInteger(order.amt) || order.amt <= 0) {
    errors.push('amt 必須為正整數');
  }

  if (!order.itemDesc || typeof order.itemDesc !== 'string') {
    errors.push('itemDesc 為必填');
  } else if (order.itemDesc.length > ITEM_DESC_MAX_LEN) {
    errors.push(`itemDesc 長度不可超過 ${ITEM_DESC_MAX_LEN} 字元`);
  }

  if (!order.email || !EMAIL_REGEX.test(order.email)) {
    errors.push('email 格式不正確');
  }

  if (errors.length > 0) {
    throw new Error(`訂單欄位驗證失敗: ${errors.join('; ')}`);
  }
}

// --- AES 加解密（藍新 API 規定使用 AES-256-CBC） ---

function encryptTradeInfo(data) {
  const cipher = crypto.createCipheriv(
    'aes-256-cbc',
    Buffer.from(config.hashKey, 'utf8'),
    Buffer.from(config.hashIV, 'utf8')
  );
  let encrypted = cipher.update(data, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
}

function decryptTradeInfo(encryptedData) {
  const decipher = crypto.createDecipheriv(
    'aes-256-cbc',
    Buffer.from(config.hashKey, 'utf8'),
    Buffer.from(config.hashIV, 'utf8')
  );
  decipher.setAutoPadding(false);
  let buf = decipher.update(Buffer.from(encryptedData, 'hex'));
  buf = Buffer.concat([buf, decipher.final()]);

  // 藍新回傳偶爾會同時夾帶尾端 null bytes 與 PKCS7 padding。
  // 先去掉 null bytes，再判斷 PKCS7，最後把尾端控制字元一併清掉。
  buf = stripTrailingNullBytes(buf);
  buf = stripPkcs7Padding(buf);
  buf = stripTrailingControlBytes(buf);

  return JSON.parse(buf.toString('utf8'));
}

function stripTrailingNullBytes(buf) {
  let end = buf.length;
  while (end > 0 && buf[end - 1] === 0) {
    end--;
  }
  return buf.slice(0, end);
}

function stripPkcs7Padding(buf) {
  if (buf.length === 0) {
    return buf;
  }

  const lastByte = buf[buf.length - 1];
  if (lastByte < 1 || lastByte > 16) {
    return buf;
  }

  const padStart = buf.length - lastByte;
  if (padStart < 0) {
    return buf;
  }

  if (!buf.slice(padStart).every((b) => b === lastByte)) {
    return buf;
  }

  return buf.slice(0, padStart);
}

function stripTrailingControlBytes(buf) {
  let end = buf.length;
  while (end > 0 && buf[end - 1] <= 0x20) {
    end--;
  }
  return buf.slice(0, end);
}

// --- SHA-256 雜湊 ---

function createTradeSha(tradeInfo) {
  const shaStr = `HashKey=${config.hashKey}&${tradeInfo}&HashIV=${config.hashIV}`;
  return crypto.createHash('sha256').update(shaStr, 'utf8').digest('hex').toUpperCase();
}

// --- 建立交易 ---

/**
 * 建立交易資料
 * @param {Object} order - 訂單資料（應從後端 DB 取得，不可信任前端傳入的金額）
 * @param {string} order.orderNo - 訂單編號（英數字+底線，最多30字）
 * @param {number} order.amt - 金額（正整數，新台幣）
 * @param {string} order.itemDesc - 商品描述（最多50字）
 * @param {string} order.email - 付款人 email
 * @param {Object} [options] - 付款方式選項
 * @returns {Object} 包含 MerchantID, TradeInfo, TradeSha, Version, PayGateURL
 */
function createPayment(order, options = {}) {
  validateOrder(order);

  const {
    credit = true,
    vacc = true,
    cvs = true,
    barcode = true,
    linePay = false,
  } = options;

  const params = new URLSearchParams();
  params.append('MerchantID', config.merchantId);
  params.append('TimeStamp', Math.floor(Date.now() / 1000).toString());
  params.append('Version', config.version);
  params.append('RespondType', 'JSON');
  params.append('MerchantOrderNo', order.orderNo);
  params.append('Amt', order.amt.toString());
  params.append('ItemDesc', order.itemDesc);
  params.append('Email', order.email);
  params.append('ReturnURL', `${config.baseUrl}/payment/return`);
  params.append('NotifyURL', `${config.baseUrl}/payment/notify`);
  params.append('CustomerURL', `${config.baseUrl}/payment/customer`);

  if (credit) params.append('CREDIT', '1');
  if (vacc) params.append('VACC', '1');
  if (cvs) params.append('CVS', '1');
  if (barcode) params.append('BARCODE', '1');
  if (linePay) params.append('LINEPAY', '1');

  const tradeInfoStr = params.toString();
  const tradeInfo = encryptTradeInfo(tradeInfoStr);
  const tradeSha = createTradeSha(tradeInfo);

  return {
    MerchantID: config.merchantId,
    TradeInfo: tradeInfo,
    TradeSha: tradeSha,
    Version: config.version,
    PayGateURL: config.newebpayApiUrl,
  };
}

// --- 驗證回傳 ---

/**
 * 驗證並解析藍新回傳的資料
 * @param {Object} payload - 藍新 POST 回傳的 body
 * @returns {Object} 解密後的交易結果
 */
function verifyAndDecrypt(payload) {
  const { TradeInfo, TradeSha } = payload;

  if (!TradeInfo || !TradeSha) {
    throw new Error('回傳資料缺少 TradeInfo 或 TradeSha');
  }

  const computedSha = createTradeSha(TradeInfo);
  if (computedSha !== TradeSha) {
    throw new Error('TradeSha 驗證失敗，資料可能被竄改');
  }

  return decryptTradeInfo(TradeInfo);
}

// --- 查詢交易（對帳 / 補單） ---

/**
 * 產生 QueryTradeInfo 的 CheckValue
 * 依官方規格：SHA256("IV={HashIV}&Amt={amt}&MerchantID={id}&MerchantOrderNo={no}&Key={HashKey}")
 * 欄位依字母序排列，夾在 IV= 與 Key= 之間
 */
function createQueryCheckValue(orderNo, amt) {
  const raw = `IV=${config.hashIV}&Amt=${amt}&MerchantID=${config.merchantId}&MerchantOrderNo=${orderNo}&Key=${config.hashKey}`;
  return crypto.createHash('sha256').update(raw, 'utf8').digest('hex').toUpperCase();
}

/**
 * 產生查詢交易所需的 POST 參數
 * @param {string} orderNo - 訂單編號
 * @param {number} amt - 訂單金額
 * @returns {Object} 查詢用的 POST 參數（含 QueryURL）
 */
function createQueryData(orderNo, amt) {
  const timeStamp = Math.floor(Date.now() / 1000).toString();

  return {
    MerchantID: config.merchantId,
    Version: '1.3',
    RespondType: 'JSON',
    CheckValue: createQueryCheckValue(orderNo, amt),
    TimeStamp: timeStamp,
    MerchantOrderNo: orderNo,
    Amt: amt,
    QueryURL: config.newebpayQueryUrl,
  };
}

// --- 實際發送查詢 ---

/**
 * 向藍新 QueryTradeInfo API 發送查詢並回傳解析後的結果
 * @param {string} orderNo - 訂單編號
 * @param {number} amt - 訂單金額
 * @returns {Promise<Object>} 藍新回傳的 JSON 結果
 */
async function queryTradeInfo(orderNo, amt) {
  const { QueryURL, ...params } = createQueryData(orderNo, amt);

  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    body.append(key, String(value));
  }

  const resp = await fetch(QueryURL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!resp.ok) {
    throw new Error(`QueryTradeInfo 請求失敗: HTTP ${resp.status}`);
  }

  const result = await resp.json();
  return result;
}

// --- 信用卡請款 / 退款 / 取消授權 ---

/**
 * 向信用卡 API 發送加密請求（Close / Cancel 共用）
 * PostData_ 使用與 TradeInfo 相同的 AES-256-CBC 加密
 * @param {string} url - API endpoint URL
 * @param {Object} innerParams - 加密前的參數物件
 * @param {string} label - 錯誤訊息用的 API 名稱
 * @returns {Promise<Object>} 藍新回傳的 JSON 結果
 */
async function sendCreditCardRequest(url, innerParams, label) {
  const paramStr = new URLSearchParams(innerParams).toString();
  const postData = encryptTradeInfo(paramStr);

  const body = new URLSearchParams();
  body.append('MerchantID_', config.merchantId);
  body.append('PostData_', postData);

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!resp.ok) {
    throw new Error(`${label} 請求失敗: HTTP ${resp.status}`);
  }

  return resp.json();
}

/**
 * 驗證 tradeNo / orderNo 互斥（必須且只能提供其中一個）
 * @returns {number} IndexType: 1=orderNo, 2=tradeNo
 */
function resolveIndexType(tradeNo, orderNo) {
  if (tradeNo && orderNo) {
    throw new Error('tradeNo 與 orderNo 只能擇一提供，不可同時傳入');
  }
  if (!tradeNo && !orderNo) {
    throw new Error('必須提供 tradeNo 或 orderNo');
  }
  return tradeNo ? 2 : 1;
}

/**
 * 驗證 notifyUrl 格式（若提供，必須為 HTTPS）
 */
function validateNotifyUrl(notifyUrl) {
  if (notifyUrl && !notifyUrl.startsWith('https://')) {
    throw new Error('notifyUrl 必須使用 HTTPS');
  }
}

/**
 * 信用卡請款 / 退款（CreditCard Close API）
 * @param {Object} options
 * @param {string} [options.tradeNo] - 藍新交易編號（與 orderNo 擇一提供）
 * @param {string} [options.orderNo] - 商店訂單編號（與 tradeNo 擇一提供）
 * @param {number} options.amt - 金額（正整數）
 * @param {number} options.closeType - 1=請款, 2=退款
 * @param {boolean} [options.cancel=false] - 是否取消前次請款/退款
 * @param {string} [options.notifyUrl] - 回呼通知 HTTPS 網址（不可接受前端輸入）
 * @returns {Promise<Object>} 藍新回傳的 JSON 結果
 */
async function closeTrade({ tradeNo, orderNo, amt, closeType, cancel = false, notifyUrl } = {}) {
  const indexType = resolveIndexType(tradeNo, orderNo);
  if (!Number.isInteger(amt) || amt <= 0) {
    throw new Error('amt 必須為正整數');
  }
  if (closeType !== 1 && closeType !== 2) {
    throw new Error('closeType 必須為 1（請款）或 2（退款）');
  }
  validateNotifyUrl(notifyUrl);

  const params = {
    RespondType: 'JSON',
    Version: '1.1',
    TimeStamp: Math.floor(Date.now() / 1000).toString(),
    IndexType: indexType.toString(),
    Amt: amt.toString(),
    CloseType: closeType.toString(),
  };

  if (indexType === 2) {
    params.TradeNo = tradeNo;
  } else {
    params.MerchantOrderNo = orderNo;
  }

  if (cancel) {
    params.Cancel = '1';
  }

  if (notifyUrl) {
    params.NotifyURL = notifyUrl;
  }

  return sendCreditCardRequest(config.newebpayCloseUrl, params, 'CreditCard/Close');
}

/**
 * 信用卡取消授權（CreditCard Cancel API）
 * @param {Object} options
 * @param {string} [options.tradeNo] - 藍新交易編號（與 orderNo 擇一提供）
 * @param {string} [options.orderNo] - 商店訂單編號（與 tradeNo 擇一提供）
 * @param {number} options.amt - 原授權金額（正整數）
 * @param {string} [options.notifyUrl] - 回呼通知 HTTPS 網址（不可接受前端輸入）
 * @returns {Promise<Object>} 藍新回傳的 JSON 結果
 */
async function cancelAuth({ tradeNo, orderNo, amt, notifyUrl } = {}) {
  const indexType = resolveIndexType(tradeNo, orderNo);
  if (!Number.isInteger(amt) || amt <= 0) {
    throw new Error('amt 必須為正整數');
  }
  validateNotifyUrl(notifyUrl);

  const params = {
    RespondType: 'JSON',
    Version: '1.0',
    TimeStamp: Math.floor(Date.now() / 1000).toString(),
    IndexType: indexType.toString(),
    Amt: amt.toString(),
  };

  if (indexType === 2) {
    params.TradeNo = tradeNo;
  } else {
    params.MerchantOrderNo = orderNo;
  }

  if (notifyUrl) {
    params.NotifyURL = notifyUrl;
  }

  return sendCreditCardRequest(config.newebpayCancelUrl, params, 'CreditCard/Cancel');
}

module.exports = {
  createPayment,
  verifyAndDecrypt,
  createQueryData,
  queryTradeInfo,
  closeTrade,
  cancelAuth,
  encryptTradeInfo,
  decryptTradeInfo,
  createTradeSha,
};
