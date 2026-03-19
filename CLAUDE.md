# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

NewebPay (藍新金流) payment gateway integration module for Node.js. Designed as a reusable library that other projects can import. All payment flows (credit card, ATM, CVS, BARCODE) verified on NewebPay test environment (2026-03-19).

## Commands

```bash
npm start          # Run example server (example/server.js) on PORT from .env
npm test           # Run tests via node --test (19 tests)
```

Local development requires ngrok (or similar tunnel) for NewebPay callbacks, which only accept port 80/443:
```bash
ngrok http 3000    # Then set BASE_URL in .env to the ngrok HTTPS URL
```

Test credit card: `4000-2211-1111-1111`, any future expiry, any 3-digit CVV.

## Architecture

Unified entry point + three-layer design:

**`index.js`** → Package entry point. Re-exports all public APIs from `newebpay.js` and `routes.js`. External consumers use `require('newbpay-node')`.

**`types/index.d.ts`** → TypeScript type definitions for all exported functions and interfaces.

**`src/config.js`** → Loads `.env` via dotenv, validates required credentials at startup (fail-fast). All other modules read config from here.

**`src/newebpay.js`** → Crypto/validation utilities + query helper. Handles AES-256-CBC encrypt/decrypt (NewebPay-mandated, cannot use GCM), SHA-256 signing, order field validation, QueryTradeInfo CheckValue generation, and `queryTradeInfo()` for actual API queries.

**`src/routes.js`** → Exports a **factory function** `createPaymentRoutes(handlers, options)` that returns an Express Router. The caller provides business logic via handlers:
- `lookupOrder(orderId)` — fetch order from DB (frontend only sends orderId, never amount)
- `onPaymentSuccess(orderNo, tradeNo, amt, rawResult)` — must be idempotent, must verify amount matches DB
- `onPaymentFail(orderNo, message, rawResult)` — optional

Options (second parameter):
- `options.payment` — payment method toggles (credit, vacc, cvs, barcode, linePay)
- `options.logger` — custom logger with `info/warn/error` methods (default: structured JSON to console)
- Backward compatible: passing bare `{ credit: true }` still works as legacy paymentOptions

This separation means: `newebpay.js` can be imported standalone for crypto; `routes.js` requires handler injection for any real use.

Current version: `0.1.0` (pre-1.0 semver). TypeScript types included via `types/index.d.ts`.

## Key Design Decisions

- **AES-256-CBC**: Semgrep will always flag this. It's mandated by NewebPay's API spec — suppress, don't change.
- **`setAutoPadding(false)` + manual padding removal**: NewebPay's responses use non-standard padding (null bytes mixed with PKCS7). The `stripTrailingNullBytes` → `stripPkcs7Padding` → `stripTrailingControlBytes` sequence handles this.
- **Amount trust boundary**: `/payment/create` accepts only `orderId`. The amount must come from `lookupOrder()`, never from the frontend.
- **Notify vs Return**: Only `POST /payment/notify` (server-to-server) should trigger business logic. `POST /payment/return` (browser redirect) is display-only.
- **QueryTradeInfo CheckValue**: Uses `SHA256("IV={HashIV}&Amt=...&MerchantID=...&MerchantOrderNo=...&Key={HashKey}")` — different from MPG's TradeInfo/TradeSha pattern.
- **Structured logging**: All route events emit JSON with `event`, `orderNo`, `tradeNo`, `amt`, `ts`. Sensitive data (TradeInfo, TradeSha, HashKey) is never logged. Tests enforce this.

## Environment

Copy `.env.example` to `.env`. Required variables: `MERCHANT_ID`, `HASH_KEY` (32 chars), `HASH_IV` (16 chars), `BASE_URL`. Switch API URLs from `ccore.newebpay.com` (test) to `core.newebpay.com` (production).
