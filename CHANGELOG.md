# Changelog

All notable changes to this project will be documented in this file.

## [1.0.0] - 2026-03-19

### Added

- Payment route factory for `create`, `notify`, `return`, and `customer`
- `createPayment`, `verifyAndDecrypt`, and `createQueryData`
- Config fail-fast checks for required NewebPay environment variables
- Minimal automated tests with `node:test`
- Release checklist for commercial readiness
- GitHub Actions CI workflow

### Changed

- `/payment/create` now accepts `orderId` and delegates order lookup to the integrator
- QueryTradeInfo `CheckValue` generation aligned to NewebPay spec
- Decryption flow hardened for trailing null bytes, PKCS7 padding, and trailing control bytes
- Error handling now separates validation errors from internal server errors

### Security

- Payment amount is no longer trusted from the client
- Example integration demonstrates `tradeNo` deduplication and pending-order checks
- Config validation enforces key/IV length and HTTPS `BASE_URL` in production
