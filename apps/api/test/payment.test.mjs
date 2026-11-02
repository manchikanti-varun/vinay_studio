import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifyRazorpayCheckoutSignature, verifyRazorpayWebhook } from "../dist/services/razorpay.js";

test("webhook verification accepts the exact raw-body HMAC", () => {
  process.env.RAZORPAY_WEBHOOK_SECRET = "test-webhook-secret";
  const body = Buffer.from('{"event":"payment.captured"}');
  const signature = crypto.createHmac("sha256", process.env.RAZORPAY_WEBHOOK_SECRET).update(body).digest("hex");
  assert.equal(verifyRazorpayWebhook(body, signature), true);
  assert.equal(verifyRazorpayWebhook(Buffer.from('{"event":"payment.failed"}'), signature), false);
  assert.equal(verifyRazorpayWebhook(body, "00"), false);
});

test("browser callback signatures bind both provider order and payment IDs", () => {
  process.env.RAZORPAY_KEY_ID = "test-key";
  process.env.RAZORPAY_KEY_SECRET = "test-payment-secret";
  const orderId = "order_123";
  const paymentId = "pay_456";
  const signature = crypto.createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(`${orderId}|${paymentId}`).digest("hex");
  assert.equal(verifyRazorpayCheckoutSignature({ orderId, paymentId, signature }), true);
  assert.equal(verifyRazorpayCheckoutSignature({ orderId, paymentId: "pay_other", signature }), false);
});
