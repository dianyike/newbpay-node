const express = require('express');
const { createPayment, verifyAndDecrypt } = require('./newebpay');

const defaultLogger = {
  info: (data) => console.log(JSON.stringify(data)),
  warn: (data) => console.warn(JSON.stringify(data)),
  error: (data) => console.error(JSON.stringify(data)),
};

/**
 * 建立金流路由（factory function）
 *
 * @param {Object} handlers - 業務邏輯回呼（由整合方實作）
 * @param {Function} handlers.lookupOrder - (orderId) => Promise<{ orderNo, amt, itemDesc, email } | null>
 *   從 DB 查詢訂單，回傳訂單資料（金額由後端決定，不信任前端）
 * @param {Function} handlers.onPaymentSuccess - (orderNo, tradeNo, amt, rawResult) => Promise<void>
 *   付款成功回呼，實作方需自行處理：冪等檢查、金額比對、狀態遷移
 * @param {Function} [handlers.onPaymentFail] - (orderNo, message, rawResult) => Promise<void>
 *   付款失敗回呼
 * @param {Object} [options] - 選項
 * @param {Object} [options.payment] - 預設付款方式選項
 * @param {Object} [options.logger] - 自訂 logger，需提供 info/warn/error 方法
 * @returns {express.Router}
 */
function createPaymentRoutes(handlers, options = {}) {
  if (!handlers || typeof handlers.lookupOrder !== 'function') {
    throw new Error('必須提供 handlers.lookupOrder');
  }
  if (typeof handlers.onPaymentSuccess !== 'function') {
    throw new Error('必須提供 handlers.onPaymentSuccess');
  }

  // 向後相容：第二個參數若無 payment/logger 屬性，視為舊版 paymentOptions
  const isLegacyOptions = options && !options.payment && !options.logger
    && (options.credit !== undefined || options.vacc !== undefined
      || options.cvs !== undefined || options.barcode !== undefined
      || options.linePay !== undefined);
  const paymentOptions = isLegacyOptions ? options : (options.payment || {});
  const log = (isLegacyOptions ? undefined : options.logger) || defaultLogger;

  const router = express.Router();
  router.use(express.urlencoded({ extended: true }));
  router.use(express.json());

  /**
   * POST /payment/create
   * 前端只傳 orderId，金額等資料由後端從 DB 查出
   */
  router.post('/payment/create', async (req, res) => {
    try {
      const { orderId } = req.body;

      if (!orderId) {
        return res.status(400).json({ success: false, message: '缺少 orderId' });
      }

      const order = await handlers.lookupOrder(orderId);
      if (!order) {
        return res.status(404).json({ success: false, message: '訂單不存在' });
      }

      const paymentData = createPayment(order, paymentOptions);
      log.info({
        event: 'payment.create',
        level: 'info',
        orderNo: order.orderNo,
        amt: order.amt,
        ts: new Date().toISOString(),
      });
      res.json({ success: true, data: paymentData });
    } catch (err) {
      if (err.message.startsWith('訂單欄位驗證失敗')) {
        log.warn({
          event: 'payment.create.validation_error',
          level: 'warn',
          message: err.message,
          ts: new Date().toISOString(),
        });
        res.status(400).json({ success: false, message: err.message });
      } else {
        log.error({
          event: 'payment.create.error',
          level: 'error',
          message: err.message,
          ts: new Date().toISOString(),
        });
        res.status(500).json({ success: false, message: '伺服器內部錯誤' });
      }
    }
  });

  /**
   * POST /payment/notify
   * 藍新 server-to-server 通知（唯一可信的付款結果來源）
   * handlers.onPaymentSuccess 需自行實作：
   *   - 訂單是否存在且尚未完成
   *   - 回傳金額是否等於本地訂單金額
   *   - TradeNo 是否已處理過（防重放）
   *   - 狀態更新必須具冪等性
   */
  router.post('/payment/notify', async (req, res) => {
    try {
      const result = verifyAndDecrypt(req.body);
      const r = result.Result;

      if (result.Status === 'SUCCESS') {
        await handlers.onPaymentSuccess(r.MerchantOrderNo, r.TradeNo, r.Amt, result);
        log.info({
          event: 'payment.notify.success',
          level: 'info',
          orderNo: r.MerchantOrderNo,
          tradeNo: r.TradeNo,
          amt: r.Amt,
          ts: new Date().toISOString(),
        });
      } else {
        if (handlers.onPaymentFail) {
          await handlers.onPaymentFail(r.MerchantOrderNo, result.Message, result);
        }
        log.warn({
          event: 'payment.notify.fail',
          level: 'warn',
          orderNo: r.MerchantOrderNo,
          message: result.Message,
          ts: new Date().toISOString(),
        });
      }

      res.send('OK');
    } catch (err) {
      log.error({
        event: 'payment.notify.error',
        level: 'error',
        message: err.message,
        ts: new Date().toISOString(),
      });
      res.status(400).send('處理失敗');
    }
  });

  /**
   * POST /payment/return
   * 使用者瀏覽器導回（僅顯示結果，不觸發業務邏輯）
   */
  router.post('/payment/return', (req, res) => {
    try {
      const result = verifyAndDecrypt(req.body);

      if (result.Status === 'SUCCESS') {
        const r = result.Result;
        log.info({
          event: 'payment.return.success',
          level: 'info',
          orderNo: r.MerchantOrderNo,
          tradeNo: r.TradeNo,
          amt: r.Amt,
          ts: new Date().toISOString(),
        });
        res.json({
          success: true,
          message: '付款成功',
          orderNo: r.MerchantOrderNo,
          amount: r.Amt,
          tradeNo: r.TradeNo,
        });
      } else {
        res.json({ success: false, message: result.Message });
      }
    } catch (err) {
      log.warn({
        event: 'payment.return.verify_failed',
        level: 'warn',
        message: err.message,
        ts: new Date().toISOString(),
      });
      res.status(400).json({ success: false, message: '驗證失敗' });
    }
  });

  /**
   * POST /payment/customer
   * ATM / 超商取號結果
   */
  router.post('/payment/customer', (req, res) => {
    try {
      const result = verifyAndDecrypt(req.body);

      if (result.Status === 'SUCCESS') {
        const r = result.Result;
        const data = {
          success: true,
          orderNo: r.MerchantOrderNo,
          amount: r.Amt,
          paymentType: r.PaymentType,
          expireDate: r.ExpireDate || null,
        };

        if (r.PaymentType === 'VACC') {
          data.bankCode = r.PayBankCode;
          data.account = r.PayerAccount5Code;
        } else if (r.PaymentType === 'CVS') {
          data.codeNo = r.CodeNo;
        } else if (r.PaymentType === 'BARCODE') {
          data.barcode1 = r.Barcode_1;
          data.barcode2 = r.Barcode_2;
          data.barcode3 = r.Barcode_3;
        }

        log.info({
          event: 'payment.customer.success',
          level: 'info',
          orderNo: r.MerchantOrderNo,
          amt: r.Amt,
          paymentType: r.PaymentType,
          ts: new Date().toISOString(),
        });
        res.json(data);
      } else {
        res.json({ success: false, message: result.Message });
      }
    } catch (err) {
      log.warn({
        event: 'payment.customer.verify_failed',
        level: 'warn',
        message: err.message,
        ts: new Date().toISOString(),
      });
      res.status(400).json({ success: false, message: '驗證失敗' });
    }
  });

  return router;
}

module.exports = createPaymentRoutes;
