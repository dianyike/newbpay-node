import { Router } from 'express';

// --- Order ---

export interface Order {
  orderNo: string;
  amt: number;
  itemDesc: string;
  email: string;
}

// --- Payment Options ---

export interface PaymentOptions {
  credit?: boolean;
  vacc?: boolean;
  cvs?: boolean;
  barcode?: boolean;
  linePay?: boolean;
}

// --- Payment Data (createPayment return) ---

export interface PaymentData {
  MerchantID: string;
  TradeInfo: string;
  TradeSha: string;
  Version: string;
  PayGateURL: string;
}

// --- Decrypt Result ---

export interface DecryptResult {
  Status: string;
  Message: string;
  Result: {
    MerchantID: string;
    Amt: number;
    TradeNo: string;
    MerchantOrderNo: string;
    PaymentType: string;
    RespondType: string;
    PayTime: string;
    IP: string;
    EscrowBank: string;
    [key: string]: unknown;
  };
}

// --- Query ---

export interface QueryData {
  MerchantID: string;
  Version: string;
  RespondType: string;
  CheckValue: string;
  TimeStamp: string;
  MerchantOrderNo: string;
  Amt: number;
  QueryURL: string;
}

export interface QueryResult {
  Status: string;
  Message: string;
  Result: Record<string, unknown>;
}

// --- Logger ---

export interface Logger {
  info(data: Record<string, unknown>): void;
  warn(data: Record<string, unknown>): void;
  error(data: Record<string, unknown>): void;
}

// --- Route Handlers ---

export interface PaymentHandlers {
  lookupOrder(orderId: string): Promise<Order | null>;
  onPaymentSuccess(
    orderNo: string,
    tradeNo: string,
    amt: number,
    rawResult: DecryptResult
  ): Promise<void>;
  onPaymentFail?(
    orderNo: string,
    message: string,
    rawResult: DecryptResult
  ): Promise<void>;
}

export interface RouteOptions {
  payment?: PaymentOptions;
  logger?: Logger;
}

// --- Credit Card Close / Cancel ---

// tradeNo 與 orderNo 互斥：必須且只能提供其中一個
export type CloseTradeOptions = {
  amt: number;
  closeType: 1 | 2;
  cancel?: boolean;
  notifyUrl?: string;
} & ({ tradeNo: string; orderNo?: never } | { tradeNo?: never; orderNo: string });

// tradeNo 與 orderNo 互斥：必須且只能提供其中一個
export type CancelAuthOptions = {
  amt: number;
  notifyUrl?: string;
} & ({ tradeNo: string; orderNo?: never } | { tradeNo?: never; orderNo: string });

export interface CreditCardResult {
  Status: string;
  Message: string;
  Result: {
    MerchantID: string;
    Amt: number;
    TradeNo: string;
    MerchantOrderNo: string;
    [key: string]: unknown;
  };
}

// --- Exports ---

export function createPaymentRoutes(
  handlers: PaymentHandlers,
  options?: RouteOptions | PaymentOptions
): Router;

export function createPayment(
  order: Order,
  options?: PaymentOptions
): PaymentData;

export function verifyAndDecrypt(payload: {
  TradeInfo: string;
  TradeSha: string;
}): DecryptResult;

export function createQueryData(orderNo: string, amt: number): QueryData;

export function queryTradeInfo(
  orderNo: string,
  amt: number
): Promise<QueryResult>;

export function closeTrade(options: CloseTradeOptions): Promise<CreditCardResult>;

export function cancelAuth(options: CancelAuthOptions): Promise<CreditCardResult>;

export function encryptTradeInfo(data: string): string;

export function decryptTradeInfo(encryptedData: string): DecryptResult;

export function createTradeSha(tradeInfo: string): string;
