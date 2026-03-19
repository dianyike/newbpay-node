# Release Checklist

這份清單用於把本專案從「可用 beta」推進到「最小可販售版本」。

## 1. Core Payment Flow

- [ ] 已在藍新測試環境完成信用卡付款成功流程
- [ ] 已在藍新測試環境完成 ATM 取號流程
- [ ] 已在藍新測試環境完成 CVS / BARCODE 流程
- [ ] `NotifyURL` 可由藍新成功觸發並收到 `200 OK`
- [ ] `ReturnURL` 僅用於顯示結果，不承擔付款成功判定
- [ ] `QueryTradeInfo` 已完成查單驗證

## 2. Data Integrity

- [ ] 訂單資料已落正式 DB，不再使用記憶體儲存
- [ ] `tradeNo` 已建立 unique constraint
- [ ] 訂單狀態更新已包 transaction
- [ ] `onPaymentSuccess()` 會先比對本地金額與回傳金額
- [ ] `onPaymentSuccess()` 具冪等性
- [ ] 已拒絕非 `pending` 訂單再次建立付款

## 3. Recovery And Reconciliation

- [ ] 已建立 `NotifyURL` 失敗時的補單流程
- [ ] 已建立 `QueryTradeInfo` 對帳流程
- [ ] 已定義人工對帳 SOP
- [ ] 已定義 notify 重送時的處理規則

## 4. Security

- [ ] 正式環境 `BASE_URL` 為 HTTPS
- [ ] `MERCHANT_ID`、`HASH_KEY`、`HASH_IV` 由環境變數提供
- [ ] 金鑰未進版控
- [ ] log 不會印出完整敏感 payload
- [ ] `/payment/create` 已加認證
- [ ] `/payment/create` 已加 rate limit
- [ ] 正式與測試藍新網址切換方式已文件化

## 5. Testing

- [ ] `npm test` 全綠
- [ ] 已補信用卡成功通知整合測試
- [ ] 已補 notify 重送不重複入帳測試
- [ ] 已補金額不符拒絕更新測試
- [ ] 已補查單補單測試
- [ ] 測試已接入 CI

## 6. Observability

- [ ] 已定義 `info / warn / error` log 等級
- [ ] 已記錄 `orderNo`、`tradeNo`、處理結果、時間戳
- [ ] 驗章失敗有告警
- [ ] 金額不符有告警
- [ ] notify 持續失敗有告警

## 7. Productization

- [ ] README 已完整描述安裝與整合方式
- [ ] 已清楚標示套件責任範圍與整合方責任
- [ ] 已定義版本策略
- [ ] 已決定是否提供 TypeScript 型別
- [ ] 已定義支援範圍與維護承諾

## 8. Minimum Sellable Gate

在對外販售前，最低限度必須全部完成：

- [ ] 正式 DB + `tradeNo` unique constraint
- [ ] transaction + idempotency
- [ ] `QueryTradeInfo` 補單流程
- [ ] 4 個關鍵整合測試
- [ ] README 與上線文件
- [ ] CI 自動測試

## 9. Suggested Release Label

目前若尚未完成以上項目，建議版本標示：

- [ ] `beta`
- [ ] `v0.x`

若全部完成，再考慮標示：

- [ ] `stable`
- [ ] `v1.0.0`
