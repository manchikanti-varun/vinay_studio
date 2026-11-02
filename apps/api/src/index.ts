import "dotenv/config";
import crypto from "node:crypto";
import express from "express";
import cors from "cors";
import helmet from "helmet";
import mongoose, { Types } from "mongoose";
import rateLimit from "express-rate-limit";
import sharp from "sharp";
import { z } from "zod";
import { defaultPricing, framePrice, frameSizes, servicePrice, type FrameMaterial, type FrameSize, type PricingTable } from "@studio/shared";
import { AdminSession, Asset, Cart, Category, CustomizationDocument, GuestSession, Invoice, Order, OrderActivity, Payment, PricingConfiguration, PreviewAsset, Product, ProductTemplate, ProductionJob, RestorationJob, RestorationVersion, Shipment, SiteSettings, User } from "./models";
import { createRazorpayOrder, verifyRazorpayCheckoutSignature, verifyRazorpayWebhook } from "./services/razorpay";
import { R2PrivateAssetStorage } from "./services/r2-storage";
import { renderInvoicePdf } from "./services/invoice-pdf";
import { completeShiprocketShipment, createShiprocketShipment, generateShiprocketLabel, trackShiprocketShipment } from "./services/shiprocket";
import { restoreWithReplicate } from "./services/replicate-restoration";
import { renderProductionImage, renderWatermarkedPreview } from "@studio/image-renderer";

const app = express();
app.use(helmet());
const allowedOrigins = [process.env.STOREFRONT_URL ?? "http://localhost:3000", process.env.ADMIN_URL ?? "http://localhost:3001"];
app.use(cors({ origin: (origin, callback) => callback(null, !origin || allowedOrigins.includes(origin)), credentials: true }));
app.use("/webhooks", express.raw({ type: "application/json", limit: "1mb" }));
app.use(express.json({ limit: "2mb" }));
app.use(rateLimit({ windowMs: 60_000, limit: 120, standardHeaders: "draft-8", legacyHeaders: false }));

app.get("/health", (_req, res) => res.json({ ok: true, service: "studio-api", database: mongoose.connection.readyState === 1 ? "connected" : "disconnected" }));
app.get("/api/v1/catalog", async (_req, res, next) => {
  try {
    const connected = mongoose.connection.readyState === 1;
    const [products, records] = await Promise.all([connected ? Product.find({ active: true }).sort({ displayOrder: 1 }).lean() : [], connected ? Category.find({ active: true }).sort({ displayOrder: 1 }).lean() : []]);
    res.json({ products, categories: records.length ? records : ["frames", "printing", "mugs", "restoration"].map((slug) => ({ slug, name: slug })) });
  } catch (error) { next(error); }
});

async function currentPricing(): Promise<PricingTable> {
  if (mongoose.connection.readyState !== 1) return defaultPricing;
  const configured = await PricingConfiguration.findOne({ key: "default" }).lean() as Record<string, unknown> | null;
  if (!configured) return defaultPricing;
  const asNumbers = <T extends Record<string, number>>(value: unknown, fallback: T): T => {
    const entries = value instanceof Map ? Object.fromEntries(value) : (value && typeof value === "object" ? value as Record<string, number> : {});
    return { ...fallback, ...Object.fromEntries(Object.entries(entries).map(([key, amount]) => [key, Number(amount)])) } as T;
  };
  return {
    frames: asNumbers(configured.framePrices, defaultPricing.frames),
    materialAddons: asNumbers(configured.materialAddons, defaultPricing.materialAddons),
    mugs: asNumbers(configured.mugPrices, defaultPricing.mugs),
    digitalPrintingFee: Number(configured.digitalPrintingFee ?? defaultPricing.digitalPrintingFee),
    restorationFee: Number(configured.restorationFee ?? defaultPricing.restorationFee),
  };
}

app.get("/api/v1/pricing", async (_req, res, next) => {
  try {
    res.json({ ...(await currentPricing()), source: mongoose.connection.readyState === 1 ? "database" : "development-defaults" });
  } catch (error) { next(error); }
});

app.get("/api/v1/shipping/quote", async (_req, res, next) => {
  try {
    const configured = await SiteSettings.findOne({ key: "shipping.defaultPaise", public: true }).lean().exec() as { value?: unknown } | null;
    const amountPaise = Number(configured?.value);
    if (!Number.isSafeInteger(amountPaise) || amountPaise < 0) return res.status(503).json({ error: "shipping_not_configured" });
    return res.json({ currency: "INR", amountPaise });
  } catch (error) { next(error); }
});

const quoteSchema = z.object({ category: z.enum(["frames", "printing", "restoration", "mugs"]), size: z.enum(["8x12", "12x15", "12x18", "16x20"]).optional(), material: z.enum(["glass", "glitter", "non-breakable"]).optional(), mug: z.enum(["white", "coloured"]).optional() });
function getQuote(input: z.infer<typeof quoteSchema>, pricing: PricingTable) {
  if (input.category === "mugs") {
    if (!input.mug) throw new Error("mug_variant_required");
    return { totalPaise: pricing.mugs[input.mug] * 100, breakdown: [{ label: input.mug === "white" ? "White mug" : "Coloured mug", amountPaise: pricing.mugs[input.mug] * 100 }] };
  }
  if (!input.size) throw new Error("size_required");
  const material = (input.material ?? "glass") as FrameMaterial;
  const size = input.size as FrameSize;
  const base = framePrice(size, material, pricing);
  const serviceCategory = input.category === "printing" || input.category === "restoration" ? input.category : null;
  const fee = serviceCategory === "printing" ? pricing.digitalPrintingFee : serviceCategory === "restoration" ? pricing.restorationFee : 0;
  const total = serviceCategory ? servicePrice(serviceCategory, size, material, pricing) : base;
  return { totalPaise: total * 100, breakdown: [...(fee ? [{ label: input.category === "printing" ? "Digital printing" : "Photo restoration", amountPaise: fee * 100 }] : []), { label: `${input.size.replace("x", " × ")} ${material} frame`, amountPaise: base * 100 }] };
}

app.post("/api/v1/pricing/quote", async (req, res, next) => {
  const parsed = quoteSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_configuration", details: parsed.error.flatten() });
  try {
  const input = parsed.data;
  const pricing = await currentPricing();
  try { return res.json({ currency: "INR", ...getQuote(parsed.data, pricing) }); }
  catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "invalid_configuration" }); }
  } catch (error) { next(error); }
});

const SESSION_COOKIE = "studio_guest";
const ADMIN_COOKIE = "studio_admin";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const uploadLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 8, standardHeaders: "draft-8", legacyHeaders: false });
type GuestRequest = express.Request & { guestUserId?: Types.ObjectId };

function cookieValue(req: express.Request, name: string): string | undefined {
  const prefix = `${name}=`;
  const entry = (req.headers.cookie ?? "").split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
  return entry ? decodeURIComponent(entry.slice(prefix.length)) : undefined;
}

function requireSameOrigin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const origin = req.get("origin");
  const expected = process.env.STOREFRONT_URL ?? "http://localhost:3000";
  if (!origin || new URL(origin).origin !== new URL(expected).origin) return res.status(403).json({ error: "origin_not_allowed" });
  next();
}

function requireAdminOrigin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const origin = req.get("origin");
  const expected = process.env.ADMIN_URL ?? "http://localhost:3001";
  if (!origin || new URL(origin).origin !== new URL(expected).origin) return res.status(403).json({ error: "origin_not_allowed" });
  next();
}

type AdminRequest = express.Request & { adminUsername?: string };
const adminLoginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: 8, standardHeaders: "draft-8", legacyHeaders: false, message: { error: "login_rate_limited" } });

async function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: "admin_storage_unavailable" });
  const token = cookieValue(req, ADMIN_COOKIE);
  if (!token || token.length < 40) return res.status(401).json({ error: "admin_session_required" });
  try {
    const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
    const session = await AdminSession.findOneAndUpdate({ tokenHash, expiresAt: { $gt: new Date() } }, { $set: { lastSeenAt: new Date() } }, { new: true }).select("username").lean().exec() as { username: string } | null;
    if (!session) return res.status(401).json({ error: "admin_session_expired" });
    (req as AdminRequest).adminUsername = session.username;
    next();
  } catch (error) { next(error); }
}

app.post("/api/v1/admin/login", requireAdminOrigin, adminLoginLimiter, async (req, res, next) => {
  const schema = z.object({ email: z.string().email().max(254), password: z.string().min(1).max(256) }).strict();
  const input = schema.safeParse(req.body);
  if (!input.success) return res.status(400).json({ error: "invalid_credentials" });
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  const secret = process.env.SESSION_SECRET;
  if (!email || !password || !secret || secret.length < 32) return res.status(503).json({ error: "admin_login_not_configured" });
  const submittedEmail = Buffer.from(input.data.email.trim().toLowerCase());
  const expectedEmail = Buffer.from(email);
  const emailMatches = submittedEmail.length === expectedEmail.length && crypto.timingSafeEqual(submittedEmail, expectedEmail);
  const submittedHash = crypto.scryptSync(input.data.password, secret, 64);
  const expectedHash = crypto.scryptSync(password, secret, 64);
  const passwordMatches = crypto.timingSafeEqual(submittedHash, expectedHash);
  if (!emailMatches || !passwordMatches) return res.status(401).json({ error: "invalid_credentials" });
  try {
    const token = crypto.randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 8 * 60 * 60_000);
    await AdminSession.create({ username: email, tokenHash: crypto.createHash("sha256").update(token).digest("hex"), expiresAt, lastSeenAt: new Date() });
    res.cookie(ADMIN_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", expires: expiresAt });
    return res.json({ authenticated: true, email, expiresAt });
  } catch (error) { next(error); }
});

app.get("/api/v1/admin/session", requireAdmin, (req, res) => res.json({ authenticated: true, email: (req as AdminRequest).adminUsername }));
app.post("/api/v1/admin/logout", requireAdminOrigin, async (req, res, next) => {
  const token = cookieValue(req, ADMIN_COOKIE);
  if (token && mongoose.connection.readyState === 1) {
    try { await AdminSession.deleteOne({ tokenHash: crypto.createHash("sha256").update(token).digest("hex") }); }
    catch (error) { return next(error); }
  }
  res.clearCookie(ADMIN_COOKIE, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/" });
  return res.status(204).end();
});

app.get("/api/v1/admin/overview", requireAdmin, async (_req, res, next) => {
  try {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const month = new Date(); month.setDate(1); month.setHours(0, 0, 0, 0);
    const [ordersToday, paidOrders, pendingOrders, restorationJobs, productionPending, shipped, revenue] = await Promise.all([
      Order.countDocuments({ createdAt: { $gte: today } }), Order.countDocuments({ status: { $nin: ["pending-payment", "cancelled", "refunded"] } }),
      Order.countDocuments({ status: "pending-payment" }), mongoose.model("RestorationJob").countDocuments({ status: { $in: ["uploaded", "processing", "admin-review", "correction", "awaiting-customer"] } }),
      Order.countDocuments({ status: { $in: ["paid", "approved", "production", "quality-check"] } }), Order.countDocuments({ status: "shipped" }),
      Order.aggregate([{ $match: { status: { $nin: ["pending-payment", "cancelled", "refunded"] }, createdAt: { $gte: month } } }, { $group: { _id: null, totalPaise: { $sum: "$totalPaise" } } }]),
    ]);
    return res.json({ ordersToday, paidOrders, pendingPayments: pendingOrders, restorationJobs, productionPending, shipped, revenueThisMonthPaise: revenue[0]?.totalPaise ?? 0, database: "connected" });
  } catch (error) { next(error); }
});

app.get("/api/v1/admin/orders", requireAdmin, async (req, res, next) => {
  const page = Math.max(1, Math.min(100_000, Number(req.query.page) || 1));
  const limit = Math.max(1, Math.min(100, Number(req.query.limit) || 25));
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  const query: Record<string, unknown> = {};
  if (status) query.status = status;
  if (typeof req.query.q === "string" && req.query.q.trim()) query.$or = [{ orderNumber: { $regex: req.query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } }, { email: { $regex: req.query.q.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } }];
  try {
    const [orders, total] = await Promise.all([Order.find(query).select("orderNumber email status items subtotalPaise shippingPaise totalPaise currency createdAt").sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(), Order.countDocuments(query)]);
    const typedOrders = orders as unknown as Array<{ _id: Types.ObjectId } & Record<string, any>>;
    const shipments = await Shipment.find({ orderId: { $in: typedOrders.map((order) => order._id) } }).select("orderId providerShipmentId awb status labelUrl failure").lean().exec() as unknown as Array<{ _id: Types.ObjectId; orderId: Types.ObjectId; providerShipmentId?: string; awb?: string; status?: string; labelUrl?: string; failure?: string }>;
    const byOrder = new Map(shipments.map((shipment) => [shipment.orderId.toString(), shipment]));
    return res.json({ orders: typedOrders.map((order) => { const shipment = byOrder.get(order._id.toString()); return { ...order, shipment: shipment ? { id: shipment.providerShipmentId ? shipment._id.toString() : "", awb: shipment.awb, status: shipment.status, labelUrl: shipment.labelUrl, failure: shipment.failure } : undefined }; }), page, limit, total });
  } catch (error) { next(error); }
});

const transitions: Record<string, string[]> = { "awaiting-approval": ["cancelled"], approved: ["cancelled"], production: ["quality-check"], "quality-check": ["production", "ready-to-ship"], shipped: ["delivered"] };
app.patch("/api/v1/admin/orders/:id/status", requireAdminOrigin, requireAdmin, async (req, res, next) => {
  const id = req.params.id;
  const parsed = z.object({ status: z.string(), note: z.string().trim().max(500).optional() }).strict().safeParse(req.body);
  if (typeof id !== "string" || !Types.ObjectId.isValid(id) || !parsed.success) return res.status(400).json({ error: "invalid_order_update" });
  try {
    const current = await Order.findById(id).select("orderNumber status").lean().exec() as { _id: Types.ObjectId; orderNumber: string; status: string } | null;
    if (!current) return res.status(404).json({ error: "order_not_found" });
    if (!transitions[current.status]?.includes(parsed.data.status)) return res.status(409).json({ error: "invalid_order_transition", from: current.status, to: parsed.data.status });
    const updated = await Order.findOneAndUpdate({ _id: current._id, status: current.status }, { $set: { status: parsed.data.status } }, { new: true }).select("orderNumber status").lean();
    if (!updated) return res.status(409).json({ error: "order_changed_retry" });
    await OrderActivity.create({ orderId: current._id, actorId: undefined, action: "admin-status-update", fromStatus: current.status, toStatus: parsed.data.status, details: { admin: (req as AdminRequest).adminUsername, note: parsed.data.note } });
    return res.json(updated);
  } catch (error) { next(error); }
});

const pricingAdminSchema = z.object({
  frames: z.object({ "8x12": z.number().int().min(0).max(10_000_000), "12x15": z.number().int().min(0).max(10_000_000), "12x18": z.number().int().min(0).max(10_000_000), "16x20": z.number().int().min(0).max(10_000_000) }).strict(),
  materialAddons: z.object({ glass: z.number().int().min(0), glitter: z.number().int().min(0), "non-breakable": z.number().int().min(0) }).strict(),
  mugs: z.object({ white: z.number().int().min(0), coloured: z.number().int().min(0) }).strict(),
  digitalPrintingFee: z.number().int().min(0), restorationFee: z.number().int().min(0),
}).strict();
app.put("/api/v1/admin/pricing", requireAdminOrigin, requireAdmin, async (req, res, next) => {
  const parsed = pricingAdminSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_pricing", details: parsed.error.flatten() });
  try {
    await PricingConfiguration.updateOne({ key: "default" }, { $set: { framePrices: parsed.data.frames, materialAddons: parsed.data.materialAddons, mugPrices: parsed.data.mugs, digitalPrintingFee: parsed.data.digitalPrintingFee, restorationFee: parsed.data.restorationFee, currency: "INR" } }, { upsert: true });
    return res.json({ ...parsed.data, source: "database" });
  } catch (error) { next(error); }
});

const productAdminSchema = z.object({ slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), name: z.string().trim().min(2).max(120), category: z.string().trim().min(2).max(60), description: z.string().trim().max(2000).default(""), active: z.boolean().default(true), displayOrder: z.number().int().min(0).max(100_000).default(0), variants: z.array(z.object({ name: z.string().max(100), sku: z.string().max(100).optional(), pricePaise: z.number().int().min(0), attributes: z.record(z.string(), z.unknown()).optional() }).strict()).max(100).default([]) }).strict();
const categoryAdminSchema = z.object({ slug: z.string().trim().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/), name: z.string().trim().min(2).max(100), description: z.string().trim().max(1000).default(""), active: z.boolean().default(true), displayOrder: z.number().int().min(0).max(100_000).default(0), seo: z.object({ title: z.string().max(150).optional(), description: z.string().max(300).optional() }).optional() }).strict();
app.get("/api/v1/admin/products", requireAdmin, async (_req, res, next) => {
  try { return res.json({ products: await Product.find().sort({ displayOrder: 1, name: 1 }).lean(), categories: await Category.find().sort({ displayOrder: 1 }).lean() }); }
  catch (error) { next(error); }
});
app.post("/api/v1/admin/products", requireAdminOrigin, requireAdmin, async (req, res, next) => {
  const parsed = productAdminSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_product", details: parsed.error.flatten() });
  try { return res.status(201).json(await Product.create(parsed.data)); }
  catch (error) { if ((error as { code?: number }).code === 11000) return res.status(409).json({ error: "product_slug_exists" }); next(error); }
});
app.put("/api/v1/admin/products/:id", requireAdminOrigin, requireAdmin, async (req, res, next) => {
  const id = req.params.id;
  const parsed = productAdminSchema.safeParse(req.body);
  if (typeof id !== "string" || !Types.ObjectId.isValid(id) || !parsed.success) return res.status(400).json({ error: "invalid_product" });
  try {
    const product = await Product.findByIdAndUpdate(id, { $set: parsed.data }, { new: true, runValidators: true }).lean();
    if (!product) return res.status(404).json({ error: "product_not_found" });
    return res.json(product);
  } catch (error) { next(error); }
});
app.delete("/api/v1/admin/products/:id", requireAdminOrigin, requireAdmin, async (req, res, next) => {
  const id = req.params.id;
  if (typeof id !== "string" || !Types.ObjectId.isValid(id)) return res.status(400).json({ error: "invalid_product_id" });
  try {
    const product = await Product.findByIdAndUpdate(id, { $set: { active: false } }, { new: true }).select("_id active").lean().exec() as { _id: Types.ObjectId } | null;
    if (!product) return res.status(404).json({ error: "product_not_found" });
    return res.json({ archived: true, id: product._id });
  } catch (error) { next(error); }
});

app.post("/api/v1/admin/categories", requireAdminOrigin, requireAdmin, async (req, res, next) => {
  const parsed = categoryAdminSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_category", details: parsed.error.flatten() });
  try { return res.status(201).json(await Category.create(parsed.data)); }
  catch (error) { if ((error as { code?: number }).code === 11000) return res.status(409).json({ error: "category_slug_exists" }); next(error); }
});
app.put("/api/v1/admin/categories/:id", requireAdminOrigin, requireAdmin, async (req, res, next) => {
  const id = req.params.id;
  const parsed = categoryAdminSchema.safeParse(req.body);
  if (typeof id !== "string" || !Types.ObjectId.isValid(id) || !parsed.success) return res.status(400).json({ error: "invalid_category" });
  try {
    const category = await Category.findByIdAndUpdate(id, { $set: parsed.data }, { new: true, runValidators: true }).lean().exec();
    if (!category) return res.status(404).json({ error: "category_not_found" });
    return res.json(category);
  } catch (error) { next(error); }
});

app.get("/api/v1/admin/settings", requireAdmin, async (_req, res, next) => {
  try {
    const shipping = await SiteSettings.findOne({ key: "shipping.defaultPaise" }).lean().exec() as { value?: unknown } | null;
    return res.json({ shippingDefaultPaise: Number(shipping?.value ?? NaN) });
  } catch (error) { next(error); }
});
app.put("/api/v1/admin/settings/shipping", requireAdminOrigin, requireAdmin, async (req, res, next) => {
  const parsed = z.object({ amountPaise: z.number().int().min(0).max(1_000_000) }).strict().safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_shipping_price" });
  try {
    await SiteSettings.updateOne({ key: "shipping.defaultPaise" }, { $set: { value: parsed.data.amountPaise, public: true } }, { upsert: true });
    return res.json({ shippingDefaultPaise: parsed.data.amountPaise });
  } catch (error) { next(error); }
});

const templateSchema = z.object({ key: z.string().trim().min(3).max(100).regex(/^[a-z0-9:-]+$/), physicalWidthIn: z.number().positive().max(100).optional(), physicalHeightIn: z.number().positive().max(100).optional(), printableWidthIn: z.number().positive().max(100), printableHeightIn: z.number().positive().max(100), bleedIn: z.number().min(0).max(2).default(0), safeZoneIn: z.number().min(0).max(2).default(0), dpi: z.number().int().min(150).max(1200).default(300), colorProfile: z.string().max(120).optional(), active: z.boolean().default(true) }).strict();
app.get("/api/v1/admin/templates", requireAdmin, async (_req, res, next) => {
  try { return res.json({ templates: await ProductTemplate.find().sort({ key: 1 }).lean() }); }
  catch (error) { next(error); }
});
app.put("/api/v1/admin/templates/:key", requireAdminOrigin, requireAdmin, async (req, res, next) => {
  const key = req.params.key;
  const parsed = templateSchema.safeParse({ ...req.body, key });
  if (typeof key !== "string" || !parsed.success) return res.status(400).json({ error: "invalid_product_template", details: parsed.success ? undefined : parsed.error.flatten() });
  try {
    await ProductTemplate.updateOne({ key }, { $set: parsed.data }, { upsert: true, runValidators: true });
    return res.json(await ProductTemplate.findOne({ key }).lean());
  } catch (error) { next(error); }
});

app.get("/api/v1/admin/production", requireAdmin, async (req, res, next) => {
  const status = typeof req.query.status === "string" ? req.query.status : undefined;
  try {
    const query = status ? { status } : {};
    const jobs = await ProductionJob.find(query).sort({ createdAt: -1 }).limit(100).populate({ path: "orderId", select: "orderNumber status" }).lean();
    return res.json({ jobs });
  } catch (error) { next(error); }
});

app.get("/api/v1/admin/restorations", requireAdmin, async (_req, res, next) => {
  try {
    const jobs = await RestorationJob.find({ status: { $in: ["uploaded", "processing", "admin-review", "correction", "awaiting-customer", "failed"] } }).sort({ createdAt: -1 }).limit(100).populate({ path: "orderId", select: "orderNumber email status" }).lean().exec() as Array<Record<string, any>>;
    const storage = new R2PrivateAssetStorage();
    const results = await Promise.all(jobs.map(async (job) => {
      const original = await Asset.findById(job.originalAssetId).select("storageKey").lean().exec() as { storageKey: string } | null;
      const latest = (job.versions ?? []).at(-1) as { assetId?: Types.ObjectId } | undefined;
      const restored = latest?.assetId ? await Asset.findById(latest.assetId).select("storageKey").lean().exec() as { storageKey: string } | null : null;
      return { ...job, originalPreviewUrl: original ? await storage.createSignedReadUrl(original.storageKey, 300) : undefined, restoredPreviewUrl: restored ? await storage.createSignedReadUrl(restored.storageKey, 300) : undefined };
    }));
    return res.json({ jobs: results });
  } catch (error) { next(error); }
});

app.post("/api/v1/admin/restorations/:id/result", requireAdminOrigin, requireAdmin, uploadLimiter, express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "25mb" }), async (req, res, next) => {
  const id = req.params.id;
  const bytes = req.body;
  if (typeof id !== "string" || !Types.ObjectId.isValid(id) || !Buffer.isBuffer(bytes) || !bytes.length) return res.status(400).json({ error: "restoration_image_required" });
  const type = detectImageType(bytes);
  if (!type || req.get("content-type") !== type.mimeType) return res.status(415).json({ error: "unsupported_image_type" });
  try {
    const job = await RestorationJob.findById(id).lean().exec() as { _id: Types.ObjectId; orderId: Types.ObjectId; customizationId: Types.ObjectId; customerId: Types.ObjectId; originalAssetId: Types.ObjectId; status: string } | null;
    if (!job) return res.status(404).json({ error: "restoration_job_not_found" });
    const allowed = ["uploaded", "admin-review", "correction", "failed"];
    if (!allowed.includes(job.status)) return res.status(409).json({ error: "restoration_job_not_reviewable", status: job.status });
    const metadata = await sharp(bytes, { limitInputPixels: 200_000_000, failOn: "error" }).metadata();
    if (!metadata.width || !metadata.height || !["jpeg", "png", "webp"].includes(metadata.format ?? "")) return res.status(415).json({ error: "image_decode_failed" });
    const assetId = new Types.ObjectId();
    const extension = type.ext;
    const storage = new R2PrivateAssetStorage();
    const key = `restoration/${job._id.toString()}/${assetId.toString()}.${extension}`;
    await storage.put(key, bytes, type.mimeType);
    const asset = await Asset.create({ _id: assetId, ownerId: job.customerId, sourceAssetId: job.originalAssetId, kind: "restoration", storageKey: key, mimeType: type.mimeType, bytes: bytes.length, width: metadata.width, height: metadata.height, checksum: crypto.createHash("sha256").update(bytes).digest("hex"), private: true });
    const previewBytes = await renderWatermarkedPreview(bytes);
    const previewId = new Types.ObjectId();
    const previewKey = `previews/${job.customerId.toString()}/${previewId.toString()}.jpg`;
    await storage.put(previewKey, previewBytes, "image/jpeg");
    await PreviewAsset.create({ _id: previewId, ownerId: job.customerId, sourceAssetId: asset._id, customizationId: job.customizationId, kind: "preview", storageKey: previewKey, mimeType: "image/jpeg", bytes: previewBytes.length, width: Math.min(metadata.width, 1200), height: Math.round(metadata.height * Math.min(1, 1200 / metadata.width)), private: true });
    await RestorationVersion.create({ jobId: job._id, assetId: asset._id, type: "admin", edits: { uploadedByAdmin: true } });
    await RestorationJob.updateOne({ _id: job._id }, { $set: { status: "awaiting-customer" }, $push: { versions: { assetId: asset._id, type: "admin", edits: { uploadedByAdmin: true } } } });
    await OrderActivity.create({ orderId: job.orderId, action: "restoration-preview-ready", details: { jobId: job._id.toString() } });
    return res.status(201).json({ jobId: job._id, status: "awaiting-customer" });
  } catch (error) { next(error); }
});

app.post("/api/v1/admin/restorations/:id/ai", requireAdminOrigin, requireAdmin, async (req, res, next) => {
  const id = req.params.id;
  if (typeof id !== "string" || !Types.ObjectId.isValid(id)) return res.status(400).json({ error: "invalid_restoration_job_id" });
  try {
    const job = await RestorationJob.findById(id).lean().exec() as { _id: Types.ObjectId; orderId: Types.ObjectId; customizationId: Types.ObjectId; customerId: Types.ObjectId; originalAssetId: Types.ObjectId; status: string; aiRestoreConsent?: boolean } | null;
    if (!job) return res.status(404).json({ error: "restoration_job_not_found" });
    if (!job.aiRestoreConsent) return res.status(403).json({ error: "customer_ai_consent_required" });
    if (!["uploaded", "failed"].includes(job.status)) return res.status(409).json({ error: "restoration_job_not_reviewable", status: job.status });
    if (!(process.env.REPLICATE_API_TOKEN ?? (process.env.RESTORATION_PROVIDER === "replicate" ? process.env.RESTORATION_API_KEY : undefined))) return res.status(503).json({ error: "restoration_provider_not_configured" });
    const locked = await RestorationJob.findOneAndUpdate({ _id: job._id, status: job.status }, { $set: { status: "processing", failure: undefined } }, { new: true }).lean();
    if (!locked) return res.status(409).json({ error: "restoration_job_changed_retry" });
    try {
      const original = await Asset.findById(job.originalAssetId).select("storageKey").lean().exec() as { storageKey: string } | null;
      if (!original) throw new Error("original_asset_not_found");
      const storage = new R2PrivateAssetStorage();
      const signedOriginal = await storage.createSignedReadUrl(original.storageKey, 900);
      const restored = await restoreWithReplicate(signedOriginal);
      const type = detectImageType(restored.bytes);
      if (!type) throw new Error("restoration_output_not_supported");
      const metadata = await sharp(restored.bytes, { limitInputPixels: 200_000_000, failOn: "error" }).metadata();
      if (!metadata.width || !metadata.height) throw new Error("restoration_output_invalid");
      const assetId = new Types.ObjectId();
      const assetKey = `restoration/${job._id.toString()}/${assetId.toString()}.${type.ext}`;
      await storage.put(assetKey, restored.bytes, type.mimeType);
      const asset = await Asset.create({ _id: assetId, ownerId: job.customerId, sourceAssetId: job.originalAssetId, kind: "restoration", storageKey: assetKey, mimeType: type.mimeType, bytes: restored.bytes.length, width: metadata.width, height: metadata.height, checksum: crypto.createHash("sha256").update(restored.bytes).digest("hex"), private: true });
      await RestorationVersion.create({ jobId: job._id, assetId: asset._id, type: "ai", edits: { provider: "replicate", model: "tencentarc/gfpgan", predictionId: restored.predictionId } });
      await RestorationJob.updateOne({ _id: job._id }, { $set: { status: "admin-review", provider: "replicate", providerPredictionId: restored.predictionId }, $push: { versions: { assetId: asset._id, type: "ai", edits: { provider: "replicate", model: "tencentarc/gfpgan", predictionId: restored.predictionId } } } });
      await OrderActivity.create({ orderId: job.orderId, action: "ai-restoration-ready-for-review", details: { jobId: job._id.toString() } });
      return res.json({ jobId: job._id, status: "admin-review" });
    } catch (error) {
      await RestorationJob.updateOne({ _id: job._id }, { $set: { status: "failed", failure: error instanceof Error ? error.message.slice(0, 240) : "restoration_failed" } });
      throw error;
    }
  } catch (error) {
    if (error instanceof Error && error.message === "restoration_provider_not_configured") return res.status(503).json({ error: error.message });
    if (error instanceof Error && error.message.startsWith("replicate_")) return res.status(502).json({ error: "restoration_provider_failed", detail: error.message.slice(0, 180) });
    next(error);
  }
});

app.post("/api/v1/admin/restorations/:id/send-for-approval", requireAdminOrigin, requireAdmin, async (req, res, next) => {
  const id = req.params.id;
  if (typeof id !== "string" || !Types.ObjectId.isValid(id)) return res.status(400).json({ error: "invalid_restoration_job_id" });
  try {
    const job = await RestorationJob.findById(id).lean().exec() as { _id: Types.ObjectId; orderId: Types.ObjectId; customizationId: Types.ObjectId; customerId: Types.ObjectId; status: string; versions: Array<{ assetId: Types.ObjectId; type: string }> } | null;
    if (!job) return res.status(404).json({ error: "restoration_job_not_found" });
    if (!["admin-review", "correction"].includes(job.status)) return res.status(409).json({ error: "restoration_not_ready_for_customer", status: job.status });
    const latest = job.versions.at(-1);
    if (!latest || !["ai", "admin"].includes(latest.type)) return res.status(409).json({ error: "restoration_result_missing" });
    const asset = await Asset.findOne({ _id: latest.assetId, ownerId: job.customerId, kind: "restoration" }).select("storageKey mimeType width height bytes").lean().exec() as { storageKey: string; mimeType: string; width: number; height: number; bytes: number } | null;
    if (!asset) return res.status(404).json({ error: "restoration_asset_not_found" });
    const storage = new R2PrivateAssetStorage();
    const original = await storage.get(asset.storageKey);
    const previewBytes = await renderWatermarkedPreview(original.bytes);
    const previewId = new Types.ObjectId();
    const previewKey = `previews/${job.customerId.toString()}/${previewId.toString()}.jpg`;
    await storage.put(previewKey, previewBytes, "image/jpeg");
    await PreviewAsset.create({ _id: previewId, ownerId: job.customerId, sourceAssetId: latest.assetId, customizationId: job.customizationId, kind: "preview", storageKey: previewKey, mimeType: "image/jpeg", bytes: previewBytes.length, width: Math.min(asset.width, 1200), height: Math.round(asset.height * Math.min(1, 1200 / asset.width)), private: true });
    const updated = await RestorationJob.findOneAndUpdate({ _id: job._id, status: job.status }, { $set: { status: "awaiting-customer" } }, { new: true }).lean();
    if (!updated) return res.status(409).json({ error: "restoration_job_changed_retry" });
    await OrderActivity.create({ orderId: job.orderId, action: "restoration-preview-sent-for-approval", details: { jobId: job._id.toString() } });
    return res.json({ jobId: job._id, status: "awaiting-customer" });
  } catch (error) { next(error); }
});

app.post("/api/v1/admin/orders/:id/production", requireAdminOrigin, requireAdmin, async (req, res, next) => {
  const orderId = req.params.id;
  if (typeof orderId !== "string" || !Types.ObjectId.isValid(orderId)) return res.status(400).json({ error: "invalid_order_id" });
  try {
    const order = await Order.findById(orderId).select("_id orderNumber status customerId items").lean().exec() as { _id: Types.ObjectId; orderNumber: string; status: string; customerId: Types.ObjectId; items: Array<Record<string, any>> } | null;
    if (!order) return res.status(404).json({ error: "order_not_found" });
    if (order.status !== "approved" && order.status !== "production") return res.status(409).json({ error: "customer_approval_required" });
    const restorationLines = order.items.filter((item) => item.category === "restoration");
    if (restorationLines.length) {
      const restorationJobs = await RestorationJob.find({ orderId: order._id, status: "approved" }).select("customizationId versions").lean().exec() as unknown as Array<{ customizationId: Types.ObjectId; versions: Array<{ type: string }> }>;
      if (restorationLines.some((line) => !restorationJobs.some((job) => job.customizationId.equals(line.customizationId) && job.versions.some((version) => version.type === "customer-approved")))) return res.status(409).json({ error: "restoration_approval_required" });
    }
    const storage = new R2PrivateAssetStorage();
    const createdJobs = [];
    for (const item of order.items) {
      if (!item._id || !item.sourceAssetId || !item.customizationSnapshot?.transform) return res.status(409).json({ error: "approved_customization_missing" });
      const idempotencyKey = `production:${order._id.toString()}:${item._id.toString()}:v1`;
      let job = await ProductionJob.findOne({ idempotencyKey }).lean().exec() as { _id: Types.ObjectId; status: string; outputAssetId?: Types.ObjectId } | null;
      if (job?.status === "ready" && job.outputAssetId) { createdJobs.push(job); continue; }
      if (!job) {
        const created = await ProductionJob.create({ orderId: order._id, orderItemId: item._id, customizationId: item.customizationId, status: "processing", attempts: 1, idempotencyKey });
        job = { _id: created._id, status: created.status };
      } else {
        await ProductionJob.updateOne({ _id: job._id }, { $set: { status: "processing", failure: undefined }, $inc: { attempts: 1 } });
      }
      let widthPx: number;
      let heightPx: number;
      let dpi = 300;
      const variant = item.variant as { size?: string; mug?: string };
      if (item.category === "mugs") {
        const template = await ProductTemplate.findOne({ key: `mugs:${variant.mug}`, active: true }).lean().exec() as { printableWidthIn: number; printableHeightIn: number; bleedIn: number; dpi: number } | null;
        if (!template) {
          await ProductionJob.updateOne({ _id: job._id }, { $set: { status: "failed", failure: "mug_template_not_configured" } });
          return res.status(409).json({ error: "mug_template_not_configured", templateKey: `mugs:${variant.mug}` });
        }
        dpi = template.dpi;
        widthPx = Math.round((template.printableWidthIn + template.bleedIn * 2) * dpi);
        heightPx = Math.round((template.printableHeightIn + template.bleedIn * 2) * dpi);
      } else {
        const [widthIn, heightIn] = (variant.size ?? "").split("x").map(Number);
        if (!Number.isFinite(widthIn) || !Number.isFinite(heightIn)) return res.status(409).json({ error: "frame_size_missing" });
        widthPx = Math.round(widthIn * dpi); heightPx = Math.round(heightIn * dpi);
      }
      try {
        const sourceKinds = item.category === "restoration" ? ["restoration"] : ["original"];
        const source = await Asset.findOne({ _id: item.sourceAssetId, ownerId: order.customerId, kind: { $in: sourceKinds } }).select("storageKey").lean().exec() as { storageKey: string } | null;
        if (!source) throw new Error("original_asset_not_found");
        const input = await storage.get(source.storageKey);
        const transform = item.customizationSnapshot.transform as { zoom: number; rotation: number; positionX: number; positionY: number };
        const output = await renderProductionImage(input.bytes, { widthPx, heightPx, dpi, fit: "cover", zoom: transform.zoom, rotation: transform.rotation, positionX: transform.positionX, positionY: transform.positionY });
        const checksum = crypto.createHash("sha256").update(output).digest("hex");
        const key = `production/${order.orderNumber}/${item._id.toString()}.png`;
        await storage.put(key, output, "image/png");
        const asset = await Asset.create({ ownerId: order.customerId, kind: "production", storageKey: key, mimeType: "image/png", bytes: output.length, width: widthPx, height: heightPx, checksum, private: true });
        await ProductionJob.updateOne({ _id: job._id }, { $set: { status: "ready", outputAssetId: asset._id, failure: undefined } });
        createdJobs.push({ _id: job._id, status: "ready", outputAssetId: asset._id });
      } catch (error) {
        await ProductionJob.updateOne({ _id: job._id }, { $set: { status: "failed", failure: error instanceof Error ? error.message : "render_failed" } });
        throw error;
      }
    }
    if (order.status === "approved") {
      const updated = await Order.findOneAndUpdate({ _id: order._id, status: "approved" }, { $set: { status: "production" } }, { new: true }).select("_id").lean();
      if (updated) await OrderActivity.create({ orderId: order._id, action: "production-files-generated", fromStatus: "approved", toStatus: "production", details: { jobs: createdJobs.length } });
    }
    return res.json({ orderNumber: order.orderNumber, jobs: createdJobs });
  } catch (error) { next(error); }
});

app.get("/api/v1/admin/production/:id/download", requireAdmin, async (req, res, next) => {
  const id = req.params.id;
  if (typeof id !== "string" || !Types.ObjectId.isValid(id)) return res.status(400).json({ error: "invalid_production_job_id" });
  try {
    const job = await ProductionJob.findOne({ _id: id, status: "ready", outputAssetId: { $exists: true } }).lean().exec() as { outputAssetId: Types.ObjectId } | null;
    if (!job) return res.status(404).json({ error: "production_file_not_ready" });
    const asset = await Asset.findOne({ _id: job.outputAssetId, kind: "production", private: true }).select("storageKey").lean().exec() as { storageKey: string } | null;
    if (!asset) return res.status(404).json({ error: "production_file_not_found" });
    return res.json({ url: await new R2PrivateAssetStorage().createSignedReadUrl(asset.storageKey, 300), expiresIn: 300 });
  } catch (error) { next(error); }
});

async function ensureInvoice(orderId: Types.ObjectId) {
  const order = await Order.findById(orderId).lean().exec() as { _id: Types.ObjectId; orderNumber: string; status: string; customerId: Types.ObjectId; email: string; items: Array<{ title: string; quantity: number; unitPricePaise: number }>; subtotalPaise: number; shippingPaise: number; totalPaise: number; shippingAddress?: Record<string, string> } | null;
  if (!order) throw new Error("order_not_found");
  const payment = await Payment.findOne({ orderId: order._id, status: "captured" }).select("_id").lean();
  if (!payment || ["pending-payment", "cancelled", "refunded"].includes(order.status)) throw new Error("paid_order_required");
  const issuedAt = new Date();
  const year = issuedAt.getFullYear();
  const invoiceNumber = `VCL-${year}-${order.orderNumber.replace(/[^A-Z0-9]/g, "").slice(-12)}`;
  let invoice = await Invoice.findOne({ orderId: order._id }).lean().exec() as { _id: Types.ObjectId; invoiceNumber: string; issuedAt?: Date; assetId?: Types.ObjectId } | null;
  if (!invoice) {
    invoice = await Invoice.findOneAndUpdate({ orderId: order._id }, { $setOnInsert: { orderId: order._id, invoiceNumber, issuedAt, taxSnapshot: { note: "Tax registration and tax details not configured" } } }, { upsert: true, new: true }).lean().exec() as unknown as NonNullable<typeof invoice> | null;
  }
  if (!invoice) throw new Error("invoice_creation_failed");
  const key = `invoices/${order.orderNumber}.pdf`;
  if (!invoice?.assetId) {
    const address = order.shippingAddress ?? {};
    const pdf = renderInvoicePdf({ invoiceNumber: invoice.invoiceNumber, orderNumber: order.orderNumber, issuedAt: invoice.issuedAt ?? issuedAt, customer: { name: address.name ?? "Customer", email: order.email, phone: address.phone ?? "", address: address.line1 ?? "", city: address.city ?? "", state: address.state ?? "", postalCode: address.postalCode ?? "" }, items: order.items, subtotalPaise: order.subtotalPaise, shippingPaise: order.shippingPaise, totalPaise: order.totalPaise });
    const storage = new R2PrivateAssetStorage();
    await storage.put(key, pdf, "application/pdf");
    const asset = await Asset.findOneAndUpdate({ storageKey: key }, { $setOnInsert: { ownerId: order.customerId, kind: "invoice", storageKey: key, mimeType: "application/pdf", bytes: pdf.length, private: true } }, { upsert: true, new: true }).select("_id").lean().exec() as { _id: Types.ObjectId };
    await Invoice.updateOne({ _id: invoice._id, assetId: { $exists: false } }, { $set: { assetId: asset._id } });
    invoice = { ...invoice, assetId: asset._id };
  }
  return { order, invoice, url: await new R2PrivateAssetStorage().createSignedReadUrl(key, 300) };
}

app.get("/api/v1/admin/orders/:id/invoice", requireAdmin, async (req, res, next) => {
  const id = req.params.id;
  if (typeof id !== "string" || !Types.ObjectId.isValid(id)) return res.status(400).json({ error: "invalid_order_id" });
  try { const result = await ensureInvoice(new Types.ObjectId(id)); return res.json({ invoiceNumber: result.invoice.invoiceNumber, url: result.url, expiresIn: 300 }); }
  catch (error) { if (error instanceof Error && error.message === "paid_order_required") return res.status(409).json({ error: error.message }); next(error); }
});

app.post("/api/v1/admin/orders/:id/shipment", requireAdminOrigin, requireAdmin, async (req, res, next) => {
  const id = req.params.id;
  if (typeof id !== "string" || !Types.ObjectId.isValid(id)) return res.status(400).json({ error: "invalid_order_id" });
  try {
    const order = await Order.findById(id).lean().exec() as { _id: Types.ObjectId; orderNumber: string; status: string; email: string; items: Array<{ title: string; quantity: number; unitPricePaise: number }>; subtotalPaise: number; totalPaise: number; shippingAddress?: Record<string, string> } | null;
    if (!order) return res.status(404).json({ error: "order_not_found" });
    if (order.status !== "ready-to-ship") return res.status(409).json({ error: "order_not_ready_to_ship" });
    if (!process.env.SHIPROCKET_EMAIL || !process.env.SHIPROCKET_PASSWORD || !process.env.SHIPROCKET_PICKUP_LOCATION) return res.status(503).json({ error: "shiprocket_not_configured" });
    const prior = await Shipment.findOne({ orderId: order._id }).lean().exec() as { _id: Types.ObjectId; status?: string; awb?: string; providerShipmentId?: string; failure?: string } | null;
    if (prior?.awb) return res.status(409).json({ error: "shipment_already_exists", status: prior.status });
    if (prior && prior.status !== "failed") return res.status(409).json({ error: "shipment_creation_in_progress", status: prior.status });
    if (prior && !prior.providerShipmentId && prior.failure !== "shiprocket_auth_failed") return res.status(409).json({ error: "shipment_requires_provider_reconciliation", status: prior.status, detail: prior.failure });
    const address = order.shippingAddress ?? {};
    for (const key of ["name", "phone", "line1", "city", "state", "postalCode"]) if (!address[key]) return res.status(409).json({ error: "shipping_address_incomplete" });
    const shipment = prior ? await Shipment.findOneAndUpdate({ _id: prior._id, status: "failed" }, { $set: { status: "creating" }, $unset: { failure: 1 } }, { new: true }).lean().exec() as { _id: Types.ObjectId } | null : await Shipment.create({ orderId: order._id, provider: "shiprocket", status: "creating", events: [] });
    if (!shipment) return res.status(409).json({ error: "shipment_state_changed_retry" });
    try {
      let result: { shipmentId: string; awb: string; labelUrl?: string };
      if (prior?.providerShipmentId) result = { shipmentId: prior.providerShipmentId, ...await completeShiprocketShipment(prior.providerShipmentId) };
      else result = await createShiprocketShipment({ orderNumber: order.orderNumber, recipient: { name: address.name!, phone: address.phone!, address: [address.line1, address.line2].filter(Boolean).join(", "), city: address.city!, state: address.state!, postalCode: address.postalCode! }, weightGrams: 0, valuePaise: order.totalPaise, email: order.email, items: order.items, subtotalPaise: order.subtotalPaise }, async (providerShipmentId) => {
        await Shipment.updateOne({ _id: shipment._id }, { $set: { providerShipmentId, status: "provider-order-created" } });
      });
      await Shipment.updateOne({ _id: shipment._id }, { $set: { providerShipmentId: result.shipmentId, awb: result.awb, labelUrl: result.labelUrl, status: "pickup-scheduled" }, $push: { events: { status: "pickup-scheduled", message: "Pickup requested from Shiprocket", occurredAt: new Date() } } });
      await OrderActivity.create({ orderId: order._id, action: "shipment-created", fromStatus: order.status, toStatus: order.status, details: { provider: "shiprocket", awb: result.awb } });
      return res.status(201).json({ shipmentId: shipment._id, awb: result.awb, status: "pickup-scheduled", labelUrl: result.labelUrl });
    } catch (error) {
      await Shipment.updateOne({ _id: shipment._id }, { $set: { status: "failed", failure: error instanceof Error ? error.message.slice(0, 240) : "shiprocket_error" } });
      throw error;
    }
  } catch (error) { if (error instanceof Error && error.message === "shiprocket_not_configured") return res.status(503).json({ error: error.message }); if (error instanceof Error && (error.message.startsWith("shiprocket:") || error.message.startsWith("shiprocket_"))) return res.status(502).json({ error: "shipping_provider_failed", detail: error.message.slice(0, 200) }); next(error); }
});

app.post("/api/v1/admin/shipments/:id/refresh", requireAdminOrigin, requireAdmin, async (req, res, next) => {
  const id = req.params.id;
  if (typeof id !== "string" || !Types.ObjectId.isValid(id)) return res.status(400).json({ error: "invalid_shipment_id" });
  try {
    const shipment = await Shipment.findById(id).lean().exec() as { _id: Types.ObjectId; orderId: Types.ObjectId; providerShipmentId?: string; awb?: string } | null;
    if (!shipment?.providerShipmentId) return res.status(404).json({ error: "shipment_not_found" });
    const events = await trackShiprocketShipment(shipment.providerShipmentId, shipment.awb);
    if (events.length) {
      await Shipment.updateOne({ _id: shipment._id }, { $set: { status: events.at(-1)!.status.toLowerCase().replaceAll(" ", "-") }, $addToSet: { events: { $each: events } } });
      const last = events.at(-1)!.status.toLowerCase();
      const nextStatus = /deliver/.test(last) ? "delivered" : /transit|ship|pickup|out for/.test(last) ? "shipped" : undefined;
      if (nextStatus) {
        const order = await Order.findOneAndUpdate({ _id: shipment.orderId, status: { $in: ["ready-to-ship", "shipped"] } }, { $set: { status: nextStatus } }, { new: true }).select("orderNumber status").lean().exec() as { orderNumber: string; status: string } | null;
        if (order) await OrderActivity.create({ orderId: shipment.orderId, action: "shipment-status-updated", fromStatus: nextStatus === "delivered" ? "shipped" : "ready-to-ship", toStatus: nextStatus, details: { status: events.at(-1)!.status } });
      }
    }
    return res.json({ events });
  } catch (error) { next(error); }
});

app.post("/api/v1/admin/shipments/:id/label", requireAdminOrigin, requireAdmin, async (req, res, next) => {
  const id = req.params.id;
  if (typeof id !== "string" || !Types.ObjectId.isValid(id)) return res.status(400).json({ error: "invalid_shipment_id" });
  try {
    const shipment = await Shipment.findById(id).lean().exec() as { _id: Types.ObjectId; providerShipmentId?: string; awb?: string } | null;
    if (!shipment?.providerShipmentId || !shipment.awb) return res.status(409).json({ error: "shipment_awb_required" });
    const labelUrl = await generateShiprocketLabel(shipment.providerShipmentId);
    await Shipment.updateOne({ _id: shipment._id }, { $set: { labelUrl } });
    return res.json({ labelUrl });
  } catch (error) { next(error); }
});

async function requireGuest(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: "guest_storage_unavailable" });
  const token = cookieValue(req, SESSION_COOKIE);
  if (!token || token.length < 40) return res.status(401).json({ error: "guest_session_required" });
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  const session = await GuestSession.findOne({ tokenHash, expiresAt: { $gt: new Date() } }).select("userId").lean().exec() as { userId: Types.ObjectId } | null;
  if (!session) return res.status(401).json({ error: "guest_session_expired" });
  (req as GuestRequest).guestUserId = session.userId as Types.ObjectId;
  next();
}

app.post("/api/v1/guest/session", async (req, res, next) => {
  if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: "guest_storage_unavailable" });
  const existingToken = cookieValue(req, SESSION_COOKIE);
  if (existingToken && existingToken.length >= 40) {
    try {
      const tokenHash = crypto.createHash("sha256").update(existingToken).digest("hex");
      const existing = await GuestSession.findOneAndUpdate({ tokenHash, expiresAt: { $gt: new Date() } }, { $set: { lastSeenAt: new Date() } }, { new: true }).lean().exec() as { userId: Types.ObjectId; expiresAt: Date } | null;
      if (existing) {
        await Cart.updateOne({ customerId: existing.userId }, { $setOnInsert: { customerId: existing.userId, expiresAt: existing.expiresAt, items: [] } }, { upsert: true });
        return res.json({ guest: true, expiresAt: existing.expiresAt });
      }
    } catch (error) { return next(error); }
  }
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  try {
    const user = await User.create({ guest: true });
    await GuestSession.create({ userId: user._id, tokenHash: crypto.createHash("sha256").update(token).digest("hex"), expiresAt, lastSeenAt: new Date() });
    await Cart.create({ customerId: user._id, expiresAt, items: [] });
    res.cookie(SESSION_COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: expiresAt });
    return res.status(201).json({ guest: true, expiresAt });
  } catch (error) { next(error); }
});

app.get("/api/v1/guest/session", requireGuest, (req, res) => res.json({ guest: true, userId: (req as GuestRequest).guestUserId }));

function detectImageType(bytes: Buffer): { mimeType: string; ext: string } | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mimeType: "image/jpeg", ext: "jpg" };
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { mimeType: "image/png", ext: "png" };
  if (bytes.length >= 12 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP") return { mimeType: "image/webp", ext: "webp" };
  return null;
}

app.post("/api/v1/assets/upload", requireSameOrigin, requireGuest, uploadLimiter, express.raw({ type: ["image/jpeg", "image/png", "image/webp"], limit: "25mb" }), async (req, res, next) => {
  const bytes = req.body;
  if (!Buffer.isBuffer(bytes) || !bytes.length) return res.status(400).json({ error: "photo_required" });
  const type = detectImageType(bytes);
  if (!type || req.get("content-type") !== type.mimeType) return res.status(415).json({ error: "unsupported_image_type" });
  const guestId = (req as GuestRequest).guestUserId!;
  const originalId = new Types.ObjectId();
  const previewId = new Types.ObjectId();
  const originalKey = `originals/${guestId.toString()}/${originalId.toString()}.${type.ext}`;
  const previewKey = `previews/${guestId.toString()}/${previewId.toString()}.jpg`;
  const storage = new R2PrivateAssetStorage();
  try {
    const metadata = await sharp(bytes, { limitInputPixels: 200_000_000, failOn: "error" }).metadata();
    if (metadata.format !== type.ext.replace("jpg", "jpeg") && !(type.ext === "jpg" && metadata.format === "jpeg")) return res.status(415).json({ error: "image_decode_failed" });
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > 200_000_000) return res.status(413).json({ error: "image_dimensions_exceeded" });
    const previewBytes = await renderWatermarkedPreview(bytes);
    const checksum = crypto.createHash("sha256").update(bytes).digest("hex");
    await storage.put(originalKey, bytes, type.mimeType);
    await storage.put(previewKey, previewBytes, "image/jpeg");
    await Asset.create({ _id: originalId, ownerId: guestId, kind: "original", storageKey: originalKey, mimeType: type.mimeType, bytes: bytes.length, width: metadata.width, height: metadata.height, checksum, private: true });
    await PreviewAsset.create({ _id: previewId, ownerId: guestId, kind: "preview", storageKey: previewKey, mimeType: "image/jpeg", bytes: previewBytes.length, width: Math.min(metadata.width, 1200), height: Math.round(metadata.height * Math.min(1, 1200 / metadata.width)), private: true });
    const previewUrl = await storage.createSignedReadUrl(previewKey, 300);
    return res.status(201).json({ assetId: originalId.toString(), previewAssetId: previewId.toString(), previewUrl, expiresIn: 300, width: metadata.width, height: metadata.height, bytes: bytes.length });
  } catch (error) {
    await Promise.allSettled([storage.delete(originalKey), storage.delete(previewKey)]);
    next(error);
  }
});

app.get("/api/v1/assets/:id/preview", requireGuest, async (req, res, next) => {
  const assetParam = req.params.id;
  if (typeof assetParam !== "string" || !Types.ObjectId.isValid(assetParam)) return res.status(404).json({ error: "asset_not_found" });
  try {
    const preview = await PreviewAsset.findOne({ _id: assetParam, ownerId: (req as GuestRequest).guestUserId, kind: "preview" }).lean().exec() as { storageKey: string } | null;
    if (!preview) return res.status(404).json({ error: "asset_not_found" });
    return res.json({ url: await new R2PrivateAssetStorage().createSignedReadUrl(preview.storageKey, 300), expiresIn: 300 });
  } catch (error) { next(error); }
});

const cartItemSchema = quoteSchema.extend({
  sourceAssetId: z.string().regex(/^[a-f\d]{24}$/i),
  aiRestoreConsent: z.boolean().optional().default(false),
  customization: z.object({ zoom: z.number().min(0.25).max(4), rotation: z.number().min(-180).max(180), horizontal: z.number().min(0).max(100), vertical: z.number().min(0).max(100) }).strict(),
}).strict();

app.get("/api/v1/cart", requireGuest, async (req, res, next) => {
  try {
    const cart = await Cart.findOne({ customerId: (req as GuestRequest).guestUserId }).lean().exec() as { items?: unknown[] } | null;
    const items = (cart?.items ?? []) as Array<Record<string, unknown>>;
    const ownerId = (req as GuestRequest).guestUserId!;
    const customizationIds = items.map((item) => item.customizationId).filter((id): id is Types.ObjectId => id instanceof Types.ObjectId);
    const previews = await PreviewAsset.find({ ownerId, customizationId: { $in: customizationIds } }).select("customizationId storageKey").lean().exec() as unknown as Array<{ customizationId: Types.ObjectId; storageKey: string }>;
    const previewByCustomization = new Map(await Promise.all(previews.map(async (preview) => [preview.customizationId.toString(), await new R2PrivateAssetStorage().createSignedReadUrl(preview.storageKey, 300)] as const)));
    return res.json({ currency: "INR", items: items.map((item) => ({ ...item, id: String(item._id), price: Number(item.priceSnapshotPaise ?? 0) / 100, previewUrl: item.customizationId instanceof Types.ObjectId ? previewByCustomization.get(item.customizationId.toString()) : undefined })) });
  } catch (error) { next(error); }
});

app.post("/api/v1/cart/items", requireSameOrigin, requireGuest, async (req, res, next) => {
  const parsed = cartItemSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_cart_item", details: parsed.error.flatten() });
  const guestId = (req as GuestRequest).guestUserId!;
  try {
    const source = await Asset.findOne({ _id: parsed.data.sourceAssetId, ownerId: guestId, kind: "original" }).select("_id").lean().exec() as { _id: Types.ObjectId } | null;
    if (!source) return res.status(404).json({ error: "source_asset_not_found" });
    const { sourceAssetId, customization, ...config } = parsed.data;
    let quote;
    try { quote = getQuote(config, await currentPricing()); }
    catch (error) { return res.status(400).json({ error: error instanceof Error ? error.message : "invalid_configuration" }); }
    const customizationDocument = { version: 1, category: config.category, variant: { size: config.size, material: config.material, mug: config.mug }, transform: { zoom: customization.zoom, rotation: customization.rotation, positionX: customization.horizontal / 100, positionY: customization.vertical / 100 } };
    const customizationRecord = await CustomizationDocument.create({ customerId: guestId, sourceAssetId: source._id, revision: 1, immutable: false, document: customizationDocument });
    const originalAsset = await Asset.findOne({ _id: source._id, ownerId: guestId, kind: "original" }).select("storageKey mimeType").lean().exec() as unknown as { storageKey: string; mimeType: string };
    const original = await new R2PrivateAssetStorage().get(originalAsset.storageKey);
    const landscape = config.category === "mugs";
    const widthPx = landscape ? 1200 : 720;
    const heightPx = landscape ? 500 : Math.round(720 * (Number(config.size?.split("x")[1] ?? 12) / Number(config.size?.split("x")[0] ?? 8)));
    const design = await renderProductionImage(original.bytes, { widthPx, heightPx, dpi: 144, fit: "cover", zoom: customization.zoom, rotation: customization.rotation, positionX: customization.horizontal / 100, positionY: customization.vertical / 100 });
    const previewBytes = await renderWatermarkedPreview(design);
    const previewId = new Types.ObjectId();
    const previewKey = `previews/${guestId.toString()}/${previewId.toString()}.jpg`;
    await new R2PrivateAssetStorage().put(previewKey, previewBytes, "image/jpeg");
    await PreviewAsset.create({ _id: previewId, ownerId: guestId, sourceAssetId: source._id, customizationId: customizationRecord._id, kind: "preview", storageKey: previewKey, mimeType: "image/jpeg", bytes: previewBytes.length, width: Math.min(widthPx, 1200), height: Math.round(heightPx * Math.min(1, 1200 / widthPx)), private: true });
    const previewUrl = await new R2PrivateAssetStorage().createSignedReadUrl(previewKey, 300);
    const item = { _id: new Types.ObjectId(), category: config.category, size: config.size, material: config.material, mug: config.mug, aiRestoreConsent: config.category === "restoration" && parsed.data.aiRestoreConsent, quantity: 1, priceSnapshotPaise: quote.totalPaise, sourceAssetId: source._id, customizationId: customizationRecord._id, createdAt: new Date() };
    await Cart.updateOne({ customerId: guestId }, { $setOnInsert: { customerId: guestId, expiresAt: new Date(Date.now() + SESSION_TTL_MS) }, $push: { items: item } }, { upsert: true });
    const itemResponse = item as typeof item & { _id?: Types.ObjectId };
    return res.status(201).json({ item: { ...itemResponse, id: itemResponse._id?.toString(), price: quote.totalPaise / 100, previewUrl }, quote: { currency: "INR", ...quote } });
  } catch (error) { next(error); }
});

app.delete("/api/v1/cart/items/:id", requireSameOrigin, requireGuest, async (req, res, next) => {
  const itemParam = req.params.id;
  if (typeof itemParam !== "string" || !Types.ObjectId.isValid(itemParam)) return res.status(400).json({ error: "invalid_cart_item_id" });
  try {
    await Cart.updateOne({ customerId: (req as GuestRequest).guestUserId }, { $pull: { items: { _id: new Types.ObjectId(itemParam) } } });
    return res.status(204).end();
  } catch (error) { next(error); }
});

const checkoutSchema = z.object({
  email: z.string().email().max(254),
  name: z.string().trim().min(2).max(120),
  phone: z.string().trim().regex(/^\+?[0-9 ()-]{8,20}$/),
  address: z.object({ line1: z.string().trim().min(4).max(180), line2: z.string().trim().max(180).optional(), city: z.string().trim().min(2).max(100), state: z.string().trim().min(2).max(100), postalCode: z.string().trim().regex(/^[0-9A-Za-z -]{4,12}$/), country: z.string().trim().length(2).default("IN") }).strict(),
}).strict();

app.post("/api/v1/checkout", requireSameOrigin, requireGuest, async (req, res, next) => {
  const parsed = checkoutSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_checkout_details", details: parsed.error.flatten() });
  const checkoutKey = req.get("idempotency-key");
  if (!checkoutKey || !/^[a-f\d-]{36}$/i.test(checkoutKey)) return res.status(400).json({ error: "idempotency_key_required" });
  if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: "checkout_storage_unavailable" });
  const guestId = (req as GuestRequest).guestUserId!;
  try {
    const priorOrder = await Order.findOne({ checkoutKey, customerId: guestId }).lean().exec() as { _id: Types.ObjectId; orderNumber: string; totalPaise: number; paymentId?: Types.ObjectId } | null;
    if (priorOrder?.paymentId) {
      const priorPayment = await Payment.findById(priorOrder.paymentId).lean().exec() as { providerOrderId?: string } | null;
      if (priorPayment?.providerOrderId) return res.status(200).json({ orderNumber: priorOrder.orderNumber, amountPaise: priorOrder.totalPaise, providerOrderId: priorPayment.providerOrderId, keyId: process.env.RAZORPAY_KEY_ID, idempotent: true });
    }
    const cart = await Cart.findOne({ customerId: guestId }).lean().exec() as { items?: Array<Record<string, any>> } | null;
    if (!cart?.items?.length) return res.status(400).json({ error: "cart_empty" });
    if (cart.items.length > 20) return res.status(400).json({ error: "cart_item_limit_exceeded" });
    const shippingSetting = await SiteSettings.findOne({ key: "shipping.defaultPaise" }).lean().exec() as { value?: unknown } | null;
    const shippingPaise = Number(shippingSetting?.value);
    if (!Number.isSafeInteger(shippingPaise) || shippingPaise < 0) return res.status(503).json({ error: "shipping_not_configured" });
    const pricing = await currentPricing();
    const orderItems = [];
    let subtotalPaise = 0;
    for (const item of cart.items) {
      const config = quoteSchema.safeParse({ category: item.category, size: item.size, material: item.material, mug: item.mug });
      if (!config.success || !item.customizationId || !item.sourceAssetId) return res.status(409).json({ error: "cart_item_incomplete" });
      const [asset, customization] = await Promise.all([
        Asset.findOne({ _id: item.sourceAssetId, ownerId: guestId, kind: "original" }).select("_id").lean().exec(),
        CustomizationDocument.findOne({ _id: item.customizationId, customerId: guestId, sourceAssetId: item.sourceAssetId, immutable: false }).select("_id document").lean().exec(),
      ]) as [{ _id: Types.ObjectId } | null, { _id: Types.ObjectId; document: unknown } | null];
      if (!asset || !customization) return res.status(409).json({ error: "cart_asset_unavailable" });
      const quote = getQuote(config.data, pricing);
      const quantity = Number(item.quantity ?? 1);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) return res.status(400).json({ error: "invalid_quantity" });
      subtotalPaise += quote.totalPaise * quantity;
      orderItems.push({ title: config.data.category === "frames" ? "Photo frame" : config.data.category === "printing" ? "Digital printing" : config.data.category === "mugs" ? "Customized mug" : "Photo restoration", category: config.data.category, variant: { size: config.data.size, material: config.data.material, mug: config.data.mug }, aiRestoreConsent: config.data.category === "restoration" && item.aiRestoreConsent === true, quantity, unitPricePaise: quote.totalPaise, customizationId: customization._id, sourceAssetId: asset._id, customizationSnapshot: customization.document });
    }
    const totalPaise = subtotalPaise + shippingPaise;
    if (!Number.isSafeInteger(totalPaise) || totalPaise <= 0 || totalPaise > 10_000_000) return res.status(400).json({ error: "order_amount_out_of_range" });
    let order: { _id: Types.ObjectId; orderNumber: string; totalPaise: number; paymentId?: Types.ObjectId } | null = priorOrder;
    if (!order) {
      const orderNumber = `VCL-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
      try {
        const created = await Order.create({ orderNumber, checkoutKey, customerId: guestId, email: parsed.data.email.toLowerCase(), status: "pending-payment", items: orderItems, subtotalPaise, shippingPaise, totalPaise, currency: "INR", shippingAddress: { name: parsed.data.name, phone: parsed.data.phone, ...parsed.data.address } });
        order = { _id: created._id, orderNumber: created.orderNumber, totalPaise: created.totalPaise, paymentId: created.paymentId as Types.ObjectId | undefined };
      } catch (error) {
        if ((error as { code?: number }).code !== 11000) throw error;
        order = await Order.findOne({ checkoutKey, customerId: guestId }).lean().exec() as typeof priorOrder;
        if (!order) throw error;
      }
    }
    if (!order) return res.status(409).json({ error: "order_creation_failed" });
    if (order.paymentId) {
      const existing = await Payment.findById(order.paymentId).lean().exec() as { providerOrderId?: string } | null;
      if (existing?.providerOrderId) return res.status(200).json({ orderNumber: order.orderNumber, amountPaise: order.totalPaise, providerOrderId: existing.providerOrderId, keyId: process.env.RAZORPAY_KEY_ID, idempotent: true });
    }
    const razorpayOrder = await createRazorpayOrder({ amountPaise: totalPaise, receipt: order.orderNumber, notes: { orderNumber: order.orderNumber } });
    const payment = await Payment.create({ orderId: order._id, provider: "razorpay", providerOrderId: razorpayOrder.id, amountPaise: totalPaise, currency: "INR", status: "created", webhookEventIds: [] });
    await Order.updateOne({ _id: order._id, status: "pending-payment" }, { $set: { paymentId: payment._id } });
    await OrderActivity.create({ orderId: order._id, action: "payment-initialized", toStatus: "pending-payment", actorId: guestId, details: { provider: "razorpay" } });
    return res.status(201).json({ orderNumber: order.orderNumber, amountPaise: totalPaise, providerOrderId: razorpayOrder.id, keyId: razorpayOrder.keyId, idempotent: false });
  } catch (error) {
    if (error instanceof Error && error.message === "razorpay_not_configured") return res.status(503).json({ error: "payments_not_configured" });
    next(error);
  }
});

app.post("/api/v1/payments/verify", requireSameOrigin, requireGuest, async (req, res, next) => {
  const schema = z.object({ orderId: z.string().min(5).max(80), paymentId: z.string().min(5).max(80), signature: z.string().regex(/^[a-f\d]{64}$/i) }).strict();
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "invalid_payment_confirmation" });
  try {
    if (!verifyRazorpayCheckoutSignature(parsed.data)) return res.status(400).json({ error: "invalid_payment_signature" });
    const payment = await Payment.findOne({ provider: "razorpay", providerOrderId: parsed.data.orderId }).lean().exec() as { _id: Types.ObjectId; orderId: Types.ObjectId; providerPaymentId?: string; status: string } | null;
    if (!payment) return res.status(404).json({ error: "payment_not_found" });
    const order = await Order.findOne({ _id: payment.orderId, customerId: (req as GuestRequest).guestUserId }).lean().exec() as { _id: Types.ObjectId; orderNumber: string; status: string } | null;
    if (!order) return res.status(404).json({ error: "order_not_found" });
    // The browser callback proves signature validity only. The order remains unpaid until a signed capture webhook arrives.
    return res.status(202).json({ verified: true, paid: payment.status === "captured" && order.status !== "pending-payment", orderNumber: order.orderNumber, message: "Payment is being confirmed by the payment provider." });
  } catch (error) { next(error); }
});

app.post("/webhooks/razorpay", async (req, res, next) => {
  const signature = req.header("x-razorpay-signature");
  if (!signature || !Buffer.isBuffer(req.body)) return res.status(503).json({ error: "payment_webhook_not_configured" });
  if (!verifyRazorpayWebhook(req.body, signature)) return res.status(400).json({ error: "invalid_signature" });
  if (mongoose.connection.readyState !== 1) return res.status(503).json({ error: "payment_storage_unavailable" });
  const eventId = req.get("x-razorpay-event-id");
  if (!eventId || eventId.length > 150) return res.status(400).json({ error: "event_id_required" });
  try {
    const event = JSON.parse(req.body.toString("utf8")) as { event?: string; payload?: { payment?: { entity?: { id?: string; order_id?: string; amount?: number; currency?: string; status?: string } } } };
    if (event.event !== "payment.captured") return res.status(200).json({ received: true, verified: true, processed: false });
    const captured = event.payload?.payment?.entity;
    if (!captured?.id || !captured.order_id || !Number.isSafeInteger(captured.amount) || captured.currency !== "INR" || captured.status !== "captured") return res.status(400).json({ error: "invalid_capture_event" });
    const payment = await Payment.findOneAndUpdate({ provider: "razorpay", providerOrderId: captured.order_id, amountPaise: captured.amount, currency: "INR", status: "created", webhookEventIds: { $ne: eventId } }, { $set: { providerPaymentId: captured.id, status: "captured", verifiedAt: new Date() }, $addToSet: { webhookEventIds: eventId } }, { new: true }).lean().exec() as { _id: Types.ObjectId; orderId: Types.ObjectId } | null;
    if (!payment) {
      const alreadyProcessed = await Payment.findOneAndUpdate({ provider: "razorpay", providerOrderId: captured.order_id, providerPaymentId: captured.id, amountPaise: captured.amount, status: "captured" }, { $addToSet: { webhookEventIds: eventId } }).select("orderId").lean().exec();
      return res.status(alreadyProcessed ? 200 : 409).json({ received: true, verified: true, processed: Boolean(alreadyProcessed) });
    }
    const order = await Order.findOneAndUpdate({ _id: payment.orderId, status: "pending-payment" }, { $set: { status: "awaiting-approval" } }, { new: true }).select("_id orderNumber customerId items").lean().exec() as { _id: Types.ObjectId; orderNumber: string; customerId: Types.ObjectId; items: Array<{ category: string; sourceAssetId: Types.ObjectId; customizationId: Types.ObjectId; aiRestoreConsent?: boolean }> } | null;
    if (order) {
      await OrderActivity.create({ orderId: order._id, action: "payment-captured", fromStatus: "pending-payment", toStatus: "awaiting-approval", details: { provider: "razorpay", paymentId: captured.id, eventId } });
      await Promise.all(order.items.filter((item) => item.category === "restoration").map((item) => RestorationJob.updateOne({ orderId: order._id, customizationId: item.customizationId }, { $setOnInsert: { orderId: order._id, customizationId: item.customizationId, customerId: order.customerId, originalAssetId: item.sourceAssetId, aiRestoreConsent: item.aiRestoreConsent === true, status: "uploaded", versions: [{ assetId: item.sourceAssetId, type: "original" }] } }, { upsert: true })));
    }
    return res.status(200).json({ received: true, verified: true, processed: Boolean(order) });
  } catch (error) { next(error); }
});

app.get("/api/v1/orders/:orderNumber", requireGuest, async (req, res, next) => {
  const orderNumber = req.params.orderNumber;
  if (typeof orderNumber !== "string" || !/^VCL-[A-Z0-9-]{8,60}$/.test(orderNumber)) return res.status(404).json({ error: "order_not_found" });
  try {
    const order = await Order.findOne({ orderNumber, customerId: (req as GuestRequest).guestUserId }).select("_id orderNumber status items subtotalPaise shippingPaise totalPaise currency createdAt").lean().exec() as { _id: Types.ObjectId; orderNumber: string; status: string; items: Array<Record<string, unknown>>; subtotalPaise: number; shippingPaise: number; totalPaise: number; currency: string; createdAt: Date } | null;
    if (!order) return res.status(404).json({ error: "order_not_found" });
    const activity = await OrderActivity.find({ orderId: order._id }).select("action fromStatus toStatus createdAt").sort({ createdAt: 1 }).limit(100).lean();
    const ownerId = (req as GuestRequest).guestUserId!;
    const customizationIds = order.items.map((item) => item.customizationId).filter((id): id is Types.ObjectId => id instanceof Types.ObjectId);
    const restorationItems = order.items.filter((item) => item.category === "restoration");
    const restorationIds = restorationItems.map((item) => item.customizationId).filter((id): id is Types.ObjectId => id instanceof Types.ObjectId);
    const restorationJobs = restorationIds.length ? await RestorationJob.find({ orderId: order._id, customizationId: { $in: restorationIds } }).select("customizationId status").lean().exec() as unknown as Array<{ customizationId: Types.ObjectId; status: string }> : [];
    const approvalReady = restorationItems.length === 0 || restorationJobs.length === restorationItems.length && restorationJobs.every((job) => job.status === "awaiting-customer");
    const visibleCustomizationIds = approvalReady ? customizationIds : customizationIds.filter((id) => !restorationIds.some((restorationId) => restorationId.equals(id)));
    const previews = await PreviewAsset.find({ ownerId, customizationId: { $in: visibleCustomizationIds } }).select("customizationId storageKey").sort({ createdAt: 1 }).lean().exec() as unknown as Array<{ customizationId: Types.ObjectId; storageKey: string }>;
    const previewByCustomization = new Map(await Promise.all(previews.map(async (preview) => [preview.customizationId.toString(), await new R2PrivateAssetStorage().createSignedReadUrl(preview.storageKey, 300)] as const)));
    const items = order.items.map((item) => ({ title: item.title, category: item.category, quantity: item.quantity, unitPricePaise: item.unitPricePaise, variant: item.variant, previewUrl: item.customizationId instanceof Types.ObjectId ? previewByCustomization.get(item.customizationId.toString()) : undefined }));
    const shipment = await Shipment.findOne({ orderId: order._id }).select("awb status events").lean().exec() as { awb?: string; status?: string; events?: Array<{ status: string; message: string; occurredAt: Date }> } | null;
    return res.json({ ...order, items, activity, shipment: shipment ?? undefined, approvalReady, invoiceAvailable: ["awaiting-approval", "approved", "production", "quality-check", "ready-to-ship", "shipped", "delivered"].includes(order.status) });
  } catch (error) { next(error); }
});

app.get("/api/v1/orders/:orderNumber/invoice", requireGuest, async (req, res, next) => {
  const orderNumber = req.params.orderNumber;
  if (typeof orderNumber !== "string") return res.status(404).json({ error: "order_not_found" });
  try {
    const order = await Order.findOne({ orderNumber, customerId: (req as GuestRequest).guestUserId }).select("_id").lean().exec() as { _id: Types.ObjectId } | null;
    if (!order) return res.status(404).json({ error: "order_not_found" });
    const result = await ensureInvoice(order._id);
    return res.json({ invoiceNumber: result.invoice.invoiceNumber, url: result.url, expiresIn: 300 });
  } catch (error) {
    if (error instanceof Error && error.message === "paid_order_required") return res.status(409).json({ error: "invoice_not_available" });
    next(error);
  }
});

app.post("/api/v1/orders/:orderNumber/approve", requireSameOrigin, requireGuest, async (req, res, next) => {
  const orderNumber = req.params.orderNumber;
  const consent = z.object({ confirmed: z.literal(true) }).strict().safeParse(req.body);
  if (typeof orderNumber !== "string" || !consent.success) return res.status(400).json({ error: "customer_approval_required" });
  try {
    const order = await Order.findOne({ orderNumber, customerId: (req as GuestRequest).guestUserId, status: "awaiting-approval" }).lean().exec() as { _id: Types.ObjectId; orderNumber: string; status: string; items: Array<{ category: string; customizationId?: Types.ObjectId }> } | null;
    if (!order) { const exists = await Order.exists({ orderNumber, customerId: (req as GuestRequest).guestUserId }); return res.status(exists ? 409 : 404).json({ error: exists ? "order_not_awaiting_approval" : "order_not_found" }); }
    for (const item of order.items.filter((line) => line.category === "restoration")) {
      if (!item.customizationId) return res.status(409).json({ error: "restoration_customization_missing" });
      const job = await RestorationJob.findOne({ orderId: order._id, customizationId: item.customizationId, status: "awaiting-customer" }).lean().exec() as { _id: Types.ObjectId; versions: Array<{ assetId: Types.ObjectId; type: string }> } | null;
      const approvedVersion = job?.versions.filter((version) => version.type === "admin" || version.type === "ai").at(-1);
      if (!job || !approvedVersion) return res.status(409).json({ error: "restoration_review_pending" });
      await RestorationJob.updateOne({ _id: job._id, status: "awaiting-customer" }, { $set: { status: "approved" }, $push: { versions: { assetId: approvedVersion.assetId, type: "customer-approved", approvedAt: new Date() } } });
      await RestorationVersion.create({ jobId: job._id, assetId: approvedVersion.assetId, type: "customer-approved", approvedAt: new Date() });
      await Order.updateOne({ _id: order._id, "items.customizationId": item.customizationId }, { $set: { "items.$.sourceAssetId": approvedVersion.assetId } });
    }
    const approvedOrder = await Order.findOneAndUpdate({ _id: order._id, status: "awaiting-approval" }, { $set: { status: "approved" } }, { new: true }).select("_id orderNumber status").lean().exec() as { _id: Types.ObjectId; orderNumber: string; status: string } | null;
    if (!approvedOrder) return res.status(409).json({ error: "order_approval_changed_retry" });
    await OrderActivity.create({ orderId: order._id, action: "customer-approved-design", fromStatus: "awaiting-approval", toStatus: "approved", actorId: (req as GuestRequest).guestUserId });
    return res.json({ orderNumber: order.orderNumber, status: approvedOrder.status });
  } catch (error) { next(error); }
});

app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(JSON.stringify({ level: "error", message: error instanceof Error ? error.message : "unknown_error" }));
  res.status(500).json({ error: "internal_server_error" });
});

const port = Number(process.env.PORT ?? 4000);
async function start() {
  const uri = process.env.MONGODB_URI;
  if (uri) {
    try {
      await mongoose.connect(uri);
      await PricingConfiguration.updateOne({ key: "default" }, { $setOnInsert: {
        framePrices: defaultPricing.frames, materialAddons: defaultPricing.materialAddons, mugPrices: defaultPricing.mugs,
        digitalPrintingFee: defaultPricing.digitalPrintingFee, restorationFee: defaultPricing.restorationFee, currency: "INR",
      } }, { upsert: true });
      const initialCategories = [
        { slug: "frames", name: "Photo Frames", description: "Frames for the photographs you love.", displayOrder: 0 },
        { slug: "printing", name: "Digital Printing", description: "Beautiful prints, made to keep.", displayOrder: 1 },
        { slug: "mugs", name: "Customized Mugs", description: "Personal photo gifts for everyday moments.", displayOrder: 2 },
        { slug: "restoration", name: "Photo Restoration", description: "Careful restoration for treasured photographs.", displayOrder: 3 },
      ];
      await Promise.all(initialCategories.map((category) => Category.updateOne({ slug: category.slug }, { $setOnInsert: { ...category, active: true } }, { upsert: true })));
      if (process.env.SHIPPING_DEFAULT_PAISE && /^\d+$/.test(process.env.SHIPPING_DEFAULT_PAISE)) {
        await SiteSettings.updateOne({ key: "shipping.defaultPaise" }, { $setOnInsert: { value: Number(process.env.SHIPPING_DEFAULT_PAISE), public: true } }, { upsert: true });
      }
      console.log("MongoDB connected");
    }
    catch (error) { console.error("MongoDB connection failed; API starts in read-only defaults mode", error); }
  }
  app.listen(port, () => console.log(`Studio API listening on ${port}; frame sizes: ${frameSizes.join(", ")}`));
}
void start();
