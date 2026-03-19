require('dotenv').config();

const config = {
  merchantId: process.env.MERCHANT_ID,
  hashKey: process.env.HASH_KEY,
  hashIV: process.env.HASH_IV,
  port: process.env.PORT || 3000,
  newebpayApiUrl: process.env.NEWEBPAY_API_URL || 'https://ccore.newebpay.com/MPG/mpg_gateway',
  newebpayQueryUrl: process.env.NEWEBPAY_QUERY_URL || 'https://ccore.newebpay.com/API/QueryTradeInfo',
  baseUrl: process.env.BASE_URL || 'http://localhost:3000',
  version: '2.0',
};

// 啟動時驗證必要設定，缺少即終止
const requiredVars = [
  ['merchantId', 'MERCHANT_ID'],
  ['hashKey', 'HASH_KEY'],
  ['hashIV', 'HASH_IV'],
];

for (const [key, envName] of requiredVars) {
  if (!config[key]) {
    throw new Error(`缺少必要環境變數 ${envName}，請檢查 .env 檔案`);
  }
}

if (config.hashKey.length !== 32) {
  throw new Error(`HASH_KEY 長度必須為 32 字元，目前為 ${config.hashKey.length}`);
}

if (config.hashIV.length !== 16) {
  throw new Error(`HASH_IV 長度必須為 16 字元，目前為 ${config.hashIV.length}`);
}

if (process.env.NODE_ENV === 'production' && !config.baseUrl.startsWith('https://')) {
  throw new Error('正式環境的 BASE_URL 必須使用 HTTPS');
}

module.exports = config;
