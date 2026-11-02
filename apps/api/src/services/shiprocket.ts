import type { ShipmentRequest } from "./providers";

type Json = Record<string, unknown>;
const apiRoot = "https://apiv2.shiprocket.in/v1/external";
let cachedToken: string | null = null;
let tokenExpiresAt = 0;

function config() {
  const email = process.env.SHIPROCKET_EMAIL;
  const password = process.env.SHIPROCKET_PASSWORD;
  const pickup = process.env.SHIPROCKET_PICKUP_LOCATION;
  if (!email || !password || !pickup) throw new Error("shiprocket_not_configured");
  const dimension = (key: string, fallback: number) => {
    const n = Number(process.env[key] ?? fallback);
    if (!Number.isFinite(n) || n <= 0 || n > 200) throw new Error(`invalid_${key.toLowerCase()}`);
    return n;
  };
  return { email, password, pickup, length: dimension("SHIPMENT_LENGTH_CM", 30), breadth: dimension("SHIPMENT_BREADTH_CM", 25), height: dimension("SHIPMENT_HEIGHT_CM", 10), weight: dimension("SHIPMENT_WEIGHT_KG", 1) };
}

async function request(path: string, method: string, body?: Json): Promise<Json> {
  const token = await authToken();
  const response = await fetch(`${apiRoot}${path}`, { method, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Accept: "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(25_000) });
  const result = await response.json().catch(() => ({})) as Json;
  if (!response.ok) {
    const message = typeof result.message === "string" ? result.message : typeof result.error === "string" ? result.error : `Shiprocket request failed (${response.status})`;
    throw new Error(`shiprocket: ${message.slice(0, 240)}`);
  }
  return result;
}

async function authToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  const { email, password } = config();
  const response = await fetch(`${apiRoot}/auth/login`, { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ email, password }), signal: AbortSignal.timeout(20_000) });
  const data = await response.json().catch(() => ({})) as Json;
  if (!response.ok || typeof data.token !== "string") throw new Error("shiprocket_auth_failed");
  cachedToken = data.token;
  tokenExpiresAt = Date.now() + 9 * 24 * 60 * 60_000;
  return cachedToken;
}

export async function createShiprocketShipment(input: ShipmentRequest & { email: string; items: Array<{ title: string; quantity: number; unitPricePaise: number }>; subtotalPaise: number }, onShipmentCreated?: (shipmentId: string) => Promise<void>): Promise<{ shipmentId: string; awb: string; labelUrl?: string }> {
  const cfg = config();
  const recipientName = input.recipient.name.trim().split(/\s+/);
  const body: Json = {
    order_id: input.orderNumber, order_date: new Date().toISOString().slice(0, 10), pickup_location: cfg.pickup,
    billing_customer_name: recipientName[0] || input.recipient.name, billing_last_name: recipientName.slice(1).join(" "),
    billing_address: input.recipient.address, billing_address_2: "", billing_city: input.recipient.city,
    billing_pincode: input.recipient.postalCode, billing_state: input.recipient.state, billing_country: "India",
    billing_email: input.email, billing_phone: input.recipient.phone.replace(/\D/g, ""), shipping_is_billing: true,
    order_items: input.items.map((item, index) => ({ name: item.title.slice(0, 100), sku: `${input.orderNumber}-${index + 1}`.slice(0, 50), units: item.quantity, selling_price: (item.unitPricePaise / 100).toFixed(2), discount: 0, tax: 0, hsn: "" })),
    payment_method: "Prepaid", shipping_charges: 0, sub_total: (input.subtotalPaise / 100).toFixed(2),
    length: cfg.length, breadth: cfg.breadth, height: cfg.height, weight: cfg.weight,
  };
  const created = await request("/orders/create/adhoc", "POST", body);
  const shipmentId = String(created.shipment_id ?? "");
  if (!/^\d+$/.test(shipmentId)) throw new Error("shiprocket_shipment_id_missing");
  await onShipmentCreated?.(shipmentId);
  const final = await completeShiprocketShipment(shipmentId);
  return { shipmentId, ...final };
}

export async function completeShiprocketShipment(shipmentId: string): Promise<{ awb: string; labelUrl?: string }> {
  if (!/^\d+$/.test(shipmentId)) throw new Error("shiprocket_shipment_id_missing");
  const details = await request(`/shipments/${encodeURIComponent(shipmentId)}`, "GET");
  const shipment = details.data && typeof details.data === "object" ? details.data as Json : details;
  let awb = String(shipment.awb ?? "");
  if (!awb || awb === "null" || awb === "undefined") {
    const awbResponse = await request("/courier/assign/awb", "POST", { shipment_id: shipmentId });
    const awbData = (awbResponse.response && typeof awbResponse.response === "object" ? awbResponse.response as Json : awbResponse) as Json;
    awb = String(awbData.awb_code ?? awbResponse.awb_code ?? "");
  }
  if (!awb || awb === "null" || awb === "undefined") throw new Error("shiprocket_awb_missing");
  if (!(Number(shipment.status ?? shipment.status_code) >= 3)) await request("/courier/generate/pickup", "POST", { shipment_id: [Number(shipmentId)] });
  let labelUrl: string | undefined;
  try {
    const label = await request("/courier/generate/label", "POST", { shipment_id: [Number(shipmentId)] });
    labelUrl = typeof label.label_url === "string" ? label.label_url : undefined;
  } catch { /* A label can be generated again from the dashboard after pickup booking. */ }
  return { awb, labelUrl };
}

export async function trackShiprocketShipment(shipmentId: string, awb?: string): Promise<Array<{ status: string; message: string; occurredAt: Date }>> {
  const path = awb ? `/courier/track/awb/${encodeURIComponent(awb)}` : `/courier/track/shipment/${encodeURIComponent(shipmentId)}`;
  const result = await request(path, "GET");
  const tracking = (result.tracking_data && typeof result.tracking_data === "object" ? result.tracking_data : result) as Json;
  const activities = (tracking.shipment_track_activities ?? tracking.track_activities ?? []) as unknown[];
  return activities.flatMap((entry) => {
    if (!entry || typeof entry !== "object") return [];
    const row = entry as Json;
    const at = new Date(String(row.date ?? row.date_time ?? Date.now()));
    return [{ status: String(row.status ?? tracking.shipment_status ?? "in-transit"), message: String(row.activity ?? row.message ?? "Shipment updated"), occurredAt: Number.isNaN(at.getTime()) ? new Date() : at }];
  });
}

export async function generateShiprocketLabel(shipmentId: string): Promise<string> {
  if (!/^\d+$/.test(shipmentId)) throw new Error("shiprocket_shipment_id_missing");
  const response = await request("/courier/generate/label", "POST", { shipment_id: [Number(shipmentId)] });
  if (typeof response.label_url !== "string" || !response.label_url.startsWith("https://")) throw new Error("shiprocket_label_url_missing");
  return response.label_url;
}
