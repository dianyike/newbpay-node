const express = require('express');
const { createPayment, verifyAndDecrypt } = require('./newebpay');

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
 * @param {Object} [paymentOptions] - 預設付款方式選項
 * @returns {express.Router}
 */
function createPaymentRoutes(handlers, paymentOptions = {}) {
  if (!handlers || typeof handlers.lookupOrder !== 'function') {
    throw new Error('必須提供 handlers.lookupOrder');
  }
  if (typeof handlers.onPaymentSuccess !== 'function') {
    throw new Error('必須提供 handlers.onPaymentSuccess');
  }

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
      res.json({ success: true, data: paymentData });
    } catch (err) {
      // 欄位驗證錯誤（可預期）回 400 + 訊息；其餘內部錯誤回 500 + generic message
      if (err.message.startsWith('訂單欄位驗證失敗')) {
        res.status(400).json({ success: false, message: err.message });
      } else {
        console.error('[payment/create] 內部錯誤:', err);
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
      } else if (handlers.onPaymentFail) {
        await handlers.onPaymentFail(r.MerchantOrderNo, result.Message, result);
      }

      res.send('OK');
    } catch (err) {
      console.error('[藍新通知] 處理失敗:', err.message);
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
      console.error('[付款回傳] 驗證失敗:', err.message);
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

        res.json(data);
      } else {
        res.json({ success: false, message: result.Message });
      }
    } catch (err) {
      console.error('[取號結果] 驗證失敗:', err.message);
      res.status(400).json({ success: false, message: '驗證失敗' });
    }
  });

  return router;
}

module.exports = createPaymentRoutes;
