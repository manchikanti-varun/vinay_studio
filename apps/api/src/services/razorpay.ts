import crypto from "node:crypto";

function credentials() {
  const keyId = process.env.RAZORPAY_KEY_ID;
  const keySecret = process.env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) throw new Error("razorpay_not_configured");
  return { keyId, keySecret };
}

export async function createRazorpayOrder(input: { amountPaise: number; receipt: string; notes?: Record<string, string> }) {
  if (!Number.isSafeInteger(input.amountPaise) || input.amountPaise <= 0) throw new Error("invalid_payment_amount");
  const { keyId, keySecret } = credentials();
  const response = await fetch("https://api.razorpay.com/v1/orders", {
    method: "POST",
    headers: {
      Authorization: `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ amount: input.amountPaise, currency: "INR", receipt: input.receipt, notes: input.notes ?? {} }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error(`razorpay_order_failed_${response.status}`);
  const result = await response.json() as { id: string; amount: number; currency: string; status: string; receipt: string };
  if (!result.id || result.amount !== input.amountPaise || result.currency !== "INR") throw new Error("razorpay_order_mismatch");
  return { ...result, keyId };
}

function equalHexDigest(expected: string, supplied: string): boolean {
  if (!/^[a-f\d]+$/i.test(supplied) || supplied.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(supplied, "hex"));
}

export function verifyRazorpayWebhook(rawBody: Buffer, signature: string): boolean {
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) return false;
  return equalHexDigest(crypto.createHmac("sha256", secret).update(rawBody).digest("hex"), signature);
}

export function verifyRazorpayCheckoutSignature(input: { orderId: string; paymentId: string; signature: string }): boolean {
  const { keySecret } = credentials();
  const expected = crypto.createHmac("sha256", keySecret).update(`${input.orderId}|${input.paymentId}`).digest("hex");
  return equalHexDigest(expected, input.signature);
}
