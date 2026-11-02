import mongoose, { Schema } from "mongoose";

const options = { timestamps: true, versionKey: false } as const;
const userSchema = new Schema({ email: { type: String, lowercase: true, trim: true, index: true }, phone: { type: String, index: true }, name: String, passwordHash: String, guest: { type: Boolean, default: false }, consentAt: Date }, options);
const roleSchema = new Schema({ name: { type: String, required: true, unique: true }, permissions: [{ type: String }] }, options);
const adminSchema = new Schema({ userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true }, roleId: { type: Schema.Types.ObjectId, ref: "Role", required: true }, active: { type: Boolean, default: true } }, options);
const categorySchema = new Schema({ slug: { type: String, unique: true, required: true }, name: { type: String, required: true }, description: String, imageAssetId: Schema.Types.ObjectId, displayOrder: { type: Number, default: 0 }, active: { type: Boolean, default: true }, seo: Schema.Types.Mixed }, options);
const productVariantSchema = new Schema({ productId: { type: Schema.Types.ObjectId, ref: "Product", required: true, index: true }, sku: { type: String, unique: true, sparse: true }, name: String, pricePaise: { type: Number, min: 0, required: true }, attributes: Schema.Types.Mixed, active: { type: Boolean, default: true } }, options);
const productTemplateSchema = new Schema({ productId: { type: Schema.Types.ObjectId, ref: "Product", index: true }, key: { type: String, required: true, unique: true, index: true }, physicalWidthIn: Number, physicalHeightIn: Number, printableWidthIn: Number, printableHeightIn: Number, bleedIn: Number, safeZoneIn: Number, dpi: { type: Number, default: 300 }, colorProfile: String, mockupAssetId: Schema.Types.ObjectId, active: { type: Boolean, default: true } }, options);
const customizationSchema = new Schema({ customerId: { type: Schema.Types.ObjectId, ref: "User", index: true }, productId: Schema.Types.ObjectId, sourceAssetId: Schema.Types.ObjectId, document: { type: Schema.Types.Mixed, required: true }, revision: { type: Number, default: 1 }, approvedAt: Date, immutable: { type: Boolean, default: false } }, options);
const guestSessionSchema = new Schema({ userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true }, tokenHash: { type: String, required: true, unique: true }, expiresAt: { type: Date, required: true, index: { expires: 0 } }, lastSeenAt: Date }, options);
const adminSessionSchema = new Schema({ username: { type: String, required: true, index: true }, tokenHash: { type: String, required: true, unique: true }, expiresAt: { type: Date, required: true, index: { expires: 0 } }, lastSeenAt: Date }, options);
const cartSchema = new Schema({ customerId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true }, expiresAt: { type: Date, index: { expires: 0 } }, items: [{ category: String, size: String, material: String, mug: String, aiRestoreConsent: { type: Boolean, default: false }, productId: Schema.Types.ObjectId, variantId: Schema.Types.ObjectId, quantity: Number, priceSnapshotPaise: Number, sourceAssetId: Schema.Types.ObjectId, customizationId: Schema.Types.ObjectId, createdAt: Date }] }, options);
const paymentSchema = new Schema({ orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true }, provider: { type: String, required: true }, providerOrderId: { type: String, index: true }, providerPaymentId: { type: String, index: true }, amountPaise: { type: Number, required: true }, currency: { type: String, default: "INR" }, status: { type: String, enum: ["created", "authorized", "captured", "failed", "refunded"], default: "created", index: true }, webhookEventIds: [{ type: String }], verifiedAt: Date }, options);
const invoiceSchema = new Schema({ orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, unique: true }, invoiceNumber: { type: String, required: true, unique: true }, assetId: Schema.Types.ObjectId, issuedAt: Date, taxSnapshot: Schema.Types.Mixed }, options);
const shipmentSchema = new Schema({ orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true }, provider: String, providerShipmentId: String, awb: String, trackingUrl: String, labelUrl: String, labelAssetId: Schema.Types.ObjectId, status: { type: String, index: true }, failure: String, events: [{ status: String, message: String, occurredAt: Date }] }, options);
const productionJobSchema = new Schema({ orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true }, orderItemId: Schema.Types.ObjectId, customizationId: Schema.Types.ObjectId, status: { type: String, enum: ["blocked", "queued", "processing", "ready", "failed"], default: "blocked", index: true }, outputAssetId: Schema.Types.ObjectId, attempts: { type: Number, default: 0 }, idempotencyKey: { type: String, unique: true }, failure: String }, options);
const orderActivitySchema = new Schema({ orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true }, actorId: Schema.Types.ObjectId, action: { type: String, required: true }, fromStatus: String, toStatus: String, details: Schema.Types.Mixed }, options);
const siteSettingsSchema = new Schema({ key: { type: String, required: true, unique: true }, value: Schema.Types.Mixed, public: { type: Boolean, default: false } }, options);
const notificationSchema = new Schema({ recipientId: Schema.Types.ObjectId, channel: { type: String, enum: ["email", "whatsapp"], required: true }, template: { type: String, required: true }, payload: Schema.Types.Mixed, idempotencyKey: { type: String, unique: true }, status: { type: String, default: "queued", index: true }, sentAt: Date, failure: String }, options);
const productSchema = new Schema({
  slug: { type: String, required: true, unique: true, index: true },
  name: { type: String, required: true },
  category: { type: String, required: true, index: true },
  description: { type: String, default: "" },
  active: { type: Boolean, default: true, index: true },
  displayOrder: { type: Number, default: 0 },
  variants: [{ name: String, sku: String, pricePaise: Number, attributes: Schema.Types.Mixed }],
}, options);

const pricingSchema = new Schema({
  key: { type: String, required: true, unique: true },
  framePrices: { type: Map, of: Number, required: true },
  materialAddons: { type: Map, of: Number, required: true },
  mugPrices: { type: Map, of: Number, required: true },
  digitalPrintingFee: { type: Number, required: true },
  restorationFee: { type: Number, required: true },
  currency: { type: String, default: "INR" },
}, options);

const orderSchema = new Schema({
  orderNumber: { type: String, required: true, unique: true, index: true },
  checkoutKey: { type: String, unique: true, sparse: true },
  customerId: { type: Schema.Types.ObjectId, ref: "User", index: true },
  email: { type: String, required: true, index: true },
  status: { type: String, enum: ["pending-payment", "paid", "awaiting-approval", "approved", "production", "quality-check", "ready-to-ship", "shipped", "delivered", "cancelled", "refunded"], default: "pending-payment", index: true },
  items: [{ productId: Schema.Types.ObjectId, title: String, category: String, aiRestoreConsent: { type: Boolean, default: false }, variant: Schema.Types.Mixed, quantity: Number, unitPricePaise: Number, customizationId: Schema.Types.ObjectId, sourceAssetId: Schema.Types.ObjectId, customizationSnapshot: Schema.Types.Mixed }],
  subtotalPaise: { type: Number, required: true }, shippingPaise: { type: Number, default: 0 }, totalPaise: { type: Number, required: true },
  currency: { type: String, default: "INR" }, paymentId: Schema.Types.ObjectId, shippingAddress: Schema.Types.Mixed,
}, options);

const assetSchema = new Schema({
  ownerId: { type: Schema.Types.ObjectId, index: true },
  kind: { type: String, enum: ["original", "restoration", "preview", "approved", "production", "invoice"], required: true },
  storageKey: { type: String, required: true, unique: true }, mimeType: String, bytes: Number, width: Number, height: Number,
  checksum: String, sourceAssetId: { type: Schema.Types.ObjectId, index: true }, customizationId: { type: Schema.Types.ObjectId, index: true }, private: { type: Boolean, default: true }, expiresAt: Date,
}, options);

const restorationSchema = new Schema({
  orderId: { type: Schema.Types.ObjectId, ref: "Order", index: true }, customizationId: { type: Schema.Types.ObjectId, ref: "CustomizationDocument", index: true }, customerId: { type: Schema.Types.ObjectId, index: true }, originalAssetId: { type: Schema.Types.ObjectId, required: true }, aiRestoreConsent: { type: Boolean, default: false }, providerPredictionId: String, failure: String,
  provider: String, providerJobId: String, status: { type: String, enum: ["uploaded", "processing", "ai-completed", "admin-review", "correction", "awaiting-customer", "approved", "revision-requested", "failed"], default: "uploaded", index: true },
  versions: [{ assetId: Schema.Types.ObjectId, type: String, createdBy: Schema.Types.ObjectId, edits: Schema.Types.Mixed, approvedAt: Date }],
}, options);
const restorationVersionSchema = new Schema({ jobId: { type: Schema.Types.ObjectId, ref: "RestorationJob", required: true, index: true }, assetId: { type: Schema.Types.ObjectId, required: true }, type: { type: String, enum: ["original", "ai", "admin", "customer-approved"], required: true }, createdBy: Schema.Types.ObjectId, edits: Schema.Types.Mixed, approvedAt: Date }, options);

export const User = mongoose.models.User ?? mongoose.model("User", userSchema);
export const Role = mongoose.models.Role ?? mongoose.model("Role", roleSchema);
export const Admin = mongoose.models.Admin ?? mongoose.model("Admin", adminSchema);
export const Category = mongoose.models.Category ?? mongoose.model("Category", categorySchema);
export const Product = mongoose.models.Product ?? mongoose.model("Product", productSchema);
export const ProductVariant = mongoose.models.ProductVariant ?? mongoose.model("ProductVariant", productVariantSchema);
export const PricingConfiguration = mongoose.models.PricingConfiguration ?? mongoose.model("PricingConfiguration", pricingSchema);
export const ProductTemplate = mongoose.models.ProductTemplate ?? mongoose.model("ProductTemplate", productTemplateSchema);
export const CustomerUpload = mongoose.models.CustomerUpload ?? mongoose.model("CustomerUpload", assetSchema);
export const CustomizationDocument = mongoose.models.CustomizationDocument ?? mongoose.model("CustomizationDocument", customizationSchema);
export const PreviewAsset = mongoose.models.PreviewAsset ?? mongoose.model("PreviewAsset", assetSchema);
export const Order = mongoose.models.Order ?? mongoose.model("Order", orderSchema);
export const Asset = mongoose.models.Asset ?? mongoose.model("Asset", assetSchema);
export const RestorationJob = mongoose.models.RestorationJob ?? mongoose.model("RestorationJob", restorationSchema);
export const RestorationVersion = mongoose.models.RestorationVersion ?? mongoose.model("RestorationVersion", restorationVersionSchema);
export const Cart = mongoose.models.Cart ?? mongoose.model("Cart", cartSchema);
export const GuestSession = mongoose.models.GuestSession ?? mongoose.model("GuestSession", guestSessionSchema);
export const AdminSession = mongoose.models.AdminSession ?? mongoose.model("AdminSession", adminSessionSchema);
export const CartItem = mongoose.models.CartItem ?? mongoose.model("CartItem", new Schema({ cartId: { type: Schema.Types.ObjectId, ref: "Cart", required: true, index: true }, productId: Schema.Types.ObjectId, variantId: Schema.Types.ObjectId, quantity: { type: Number, min: 1 }, priceSnapshotPaise: { type: Number, required: true }, customizationId: Schema.Types.ObjectId }, options));
export const Payment = mongoose.models.Payment ?? mongoose.model("Payment", paymentSchema);
export const Invoice = mongoose.models.Invoice ?? mongoose.model("Invoice", invoiceSchema);
export const Shipment = mongoose.models.Shipment ?? mongoose.model("Shipment", shipmentSchema);
export const ProductionJob = mongoose.models.ProductionJob ?? mongoose.model("ProductionJob", productionJobSchema);
export const OrderActivity = mongoose.models.OrderActivity ?? mongoose.model("OrderActivity", orderActivitySchema);
export const SiteSettings = mongoose.models.SiteSettings ?? mongoose.model("SiteSettings", siteSettingsSchema);
export const Notification = mongoose.models.Notification ?? mongoose.model("Notification", notificationSchema);
