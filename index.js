const newebpay = require('./src/newebpay');
const createPaymentRoutes = require('./src/routes');

module.exports = {
  createPaymentRoutes,
  createPayment: newebpay.createPayment,
  verifyAndDecrypt: newebpay.verifyAndDecrypt,
  createQueryData: newebpay.createQueryData,
  queryTradeInfo: newebpay.queryTradeInfo,
  encryptTradeInfo: newebpay.encryptTradeInfo,
  decryptTradeInfo: newebpay.decryptTradeInfo,
  createTradeSha: newebpay.createTradeSha,
};
