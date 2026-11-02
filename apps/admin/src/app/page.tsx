"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import "./styles.css";
import "./styles-extra.css";
import "./operations.css";

const API = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
type Tab = "Overview" | "Orders" | "Products" | "Pricing" | "Production" | "Restoration" | "Shipping";
type Pricing = { frames: Record<string, number>; materialAddons: { glass: number; glitter: number; "non-breakable": number }; mugs: { white: number; coloured: number }; digitalPrintingFee: number; restorationFee: number };
type Product = { _id: string; slug: string; name: string; category: string; description: string; active: boolean; displayOrder: number; variants: Array<{ name: string; pricePaise: number }> };
type Category = { _id: string; slug: string; name: string; description?: string; active: boolean };
type Order = { _id: string; orderNumber: string; email: string; status: string; items: Array<{ title: string; quantity: number }>; totalPaise: number; createdAt: string; shipment?: { id: string; awb?: string; status?: string; labelUrl?: string; failure?: string } };
type Overview = { ordersToday: number; paidOrders: number; pendingPayments: number; restorationJobs: number; productionPending: number; shipped: number; revenueThisMonthPaise: number };
type ProductionJob = { _id: string; status: string; attempts: number; failure?: string; outputAssetId?: string; orderId?: { orderNumber: string }; createdAt: string };
type RestorationJob = { _id: string; status: string; aiRestoreConsent?: boolean; originalPreviewUrl?: string; restoredPreviewUrl?: string; orderId?: { orderNumber: string; email: string }; versions?: unknown[] };
const emptyPricing: Pricing = { frames: { "8x12": 449, "12x15": 849, "12x18": 999, "16x20": 1699 }, materialAddons: { glass: 0, glitter: 50, "non-breakable": 50 }, mugs: { white: 299, coloured: 499 }, digitalPrintingFee: 299, restorationFee: 299 };

async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API}${path}`, { ...init, credentials: "include", headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), ...init.headers } });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string; detail?: string };
    throw new Error(body.detail ? `${body.error ?? "request_failed"}: ${body.detail}` : body.error ?? `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export default function AdminHome() {
  const [authenticated, setAuthenticated] = useState(false);
  const [checking, setChecking] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [tab, setTab] = useState<Tab>("Overview");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [overview, setOverview] = useState<Overview | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [productionJobs, setProductionJobs] = useState<ProductionJob[]>([]);
  const [restorations, setRestorations] = useState<RestorationJob[]>([]);
  const [orderFilter, setOrderFilter] = useState("");
  const [pricing, setPricing] = useState<Pricing>(emptyPricing);
  const [shippingPaise, setShippingPaise] = useState<number | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [productForm, setProductForm] = useState({ name: "", slug: "", category: "frames", description: "" });
  const [categoryForm, setCategoryForm] = useState({ name: "", slug: "", description: "" });

  const refresh = useCallback(async () => {
    setError("");
    try {
      const [stats, price, orderData, productData, settings, productionData, restorationData] = await Promise.all([
        api<Overview>("/api/v1/admin/overview"), api<Pricing>("/api/v1/pricing"),
        api<{ orders: Order[] }>(`/api/v1/admin/orders?limit=50${orderFilter ? `&status=${encodeURIComponent(orderFilter)}` : ""}`),
        api<{ products: Product[]; categories: Category[] }>("/api/v1/admin/products"), api<{ shippingDefaultPaise: number }>("/api/v1/admin/settings"), api<{ jobs: ProductionJob[] }>("/api/v1/admin/production"), api<{ jobs: RestorationJob[] }>("/api/v1/admin/restorations"),
      ]);
      setOverview(stats); setPricing(price); setOrders(orderData.orders); setProducts(productData.products); setCategories(productData.categories); setShippingPaise(Number.isFinite(settings.shippingDefaultPaise) ? settings.shippingDefaultPaise : null); setProductionJobs(productionData.jobs); setRestorations(restorationData.jobs);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load studio data."); }
  }, [orderFilter]);

  useEffect(() => {
    let active = true;
    void api<{ authenticated: boolean }>("/api/v1/admin/session").then(() => { if (active) { setAuthenticated(true); void refresh(); } }).catch(() => undefined).finally(() => { if (active) setChecking(false); });
    return () => { active = false; };
  }, [refresh]);

  async function login(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api("/api/v1/admin/login", { method: "POST", body: JSON.stringify({ email, password }) }); setAuthenticated(true); setPassword(""); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message === "invalid_credentials" ? "Email or password doesnâ€™t match." : reason.message : "Could not sign in."); }
    finally { setBusy(false); }
  }

  async function logout() { await api("/api/v1/admin/logout", { method: "POST" }).catch(() => undefined); setAuthenticated(false); setOverview(null); }
  async function savePricing() {
    setBusy(true); setError("");
    try { await api("/api/v1/admin/pricing", { method: "PUT", body: JSON.stringify(pricing) }); setNotice("Pricing saved to the studio database."); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save pricing."); }
    finally { setBusy(false); }
  }
  async function saveShipping(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try { const result = await api<{ shippingDefaultPaise: number }>("/api/v1/admin/settings/shipping", { method: "PUT", body: JSON.stringify({ amountPaise: shippingPaise ?? 0 }) }); setShippingPaise(result.shippingDefaultPaise); setNotice("Shipping price saved."); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save shipping."); }
    finally { setBusy(false); }
  }
  async function createProduct(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api("/api/v1/admin/products", { method: "POST", body: JSON.stringify({ ...productForm, active: true, displayOrder: products.length, variants: [] }) }); setProductForm({ name: "", slug: "", category: categories[0]?.slug ?? "frames", description: "" }); setNotice("Product added to the catalog."); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add product."); }
    finally { setBusy(false); }
  }
  async function createCategory(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError("");
    try { await api("/api/v1/admin/categories", { method: "POST", body: JSON.stringify({ ...categoryForm, active: true, displayOrder: categories.length }) }); setCategoryForm({ name: "", slug: "", description: "" }); setNotice("Category added."); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not add category."); }
    finally { setBusy(false); }
  }
  async function archiveProduct(id: string) {
    setBusy(true); setError("");
    try { await api(`/api/v1/admin/products/${id}`, { method: "DELETE" }); setNotice("Product archived."); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not archive product."); }
    finally { setBusy(false); }
  }
  async function moveOrder(order: Order, status: string) {
    setBusy(true); setError("");
    try { await api(`/api/v1/admin/orders/${order._id}/status`, { method: "PATCH", body: JSON.stringify({ status }) }); setNotice(`${order.orderNumber} moved to ${status.replaceAll("-", " ")}.`); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not update order."); }
    finally { setBusy(false); }
  }
  async function generateFiles(order: Order) {
    setBusy(true); setError("");
    try { const result = await api<{ jobs: ProductionJob[] }>(`/api/v1/admin/orders/${order._id}/production`, { method: "POST", body: JSON.stringify({}) }); setProductionJobs((items) => [...result.jobs as ProductionJob[], ...items]); setNotice(`Production files generated for ${order.orderNumber}.`); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message === "mug_template_not_configured" ? "Set the mug printable dimensions in Production before generating this order." : reason.message === "restoration_approval_required" ? "Restoration work must be completed and approved before print production." : reason.message : "Could not generate production files."); }
    finally { setBusy(false); }
  }
  async function downloadFile(job: ProductionJob) {
    try { const result = await api<{ url: string }>(`/api/v1/admin/production/${job._id}/download`); const link = document.createElement("a"); link.href = result.url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.click(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not open production file."); }
  }
  async function downloadInvoice(order: Order) {
    try { const result = await api<{ url: string }>(`/api/v1/admin/orders/${order._id}/invoice`); const link = document.createElement("a"); link.href = result.url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.click(); }
    catch (reason) { setError(reason instanceof Error ? reason.message === "paid_order_required" ? "An invoice is available after payment is captured." : reason.message : "Could not create invoice."); }
  }
  async function generateLabel(order: Order) {
    if (!order.shipment) return;
    setBusy(true); setError("");
    try { const result = await api<{ labelUrl: string }>(`/api/v1/admin/shipments/${order.shipment.id}/label`, { method: "POST", body: JSON.stringify({}) }); const link = document.createElement("a"); link.href = result.labelUrl; link.target = "_blank"; link.rel = "noopener noreferrer"; link.click(); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not generate the shipping label."); }
    finally { setBusy(false); }
  }
  async function refreshShipment(order: Order) {
    if (!order.shipment) return;
    setBusy(true); setError("");
    try { await api(`/api/v1/admin/shipments/${order.shipment.id}/refresh`, { method: "POST", body: JSON.stringify({}) }); setNotice(`Latest carrier events loaded for ${order.orderNumber}.`); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not refresh tracking."); }
    finally { setBusy(false); }
  }
  async function createShipment(order: Order) {
    setBusy(true); setError("");
    try { await api(`/api/v1/admin/orders/${order._id}/shipment`, { method: "POST", body: JSON.stringify({}) }); setNotice(`Shiprocket pickup created for ${order.orderNumber}.`); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message === "shiprocket_not_configured" ? "Set the Shiprocket API user, password, and pickup location in the API environment." : reason.message : "Could not create the shipment."); }
    finally { setBusy(false); }
  }
  async function runAiRestoration(job: RestorationJob) {
    setBusy(true); setError("");
    try { await api(`/api/v1/admin/restorations/${job._id}/ai`, { method: "POST", body: JSON.stringify({}) }); setNotice("AI result created for studio review. Check likeness and artifacts before sending it to the customer."); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message === "restoration_provider_not_configured" ? "Set REPLICATE_API_TOKEN on the API server." : reason.message === "customer_ai_consent_required" ? "This customer did not opt in to third-party AI processing; use manual studio restoration." : reason.message : "AI restoration failed."); }
    finally { setBusy(false); }
  }
  async function sendRestorationForApproval(job: RestorationJob) {
    setBusy(true); setError("");
    try { await api(`/api/v1/admin/restorations/${job._id}/send-for-approval`, { method: "POST", body: JSON.stringify({}) }); setNotice("Watermarked restoration preview sent to the customer."); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Could not send preview for approval."); }
    finally { setBusy(false); }
  }
  async function uploadRestoration(job: RestorationJob, file?: File) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 25 * 1024 * 1024) { setError("Choose a JPEG, PNG, or WebP image under 25 MB."); return; }
    setBusy(true); setError("");
    try {
      const response = await fetch(`${API}/api/v1/admin/restorations/${job._id}/result`, { method: "POST", credentials: "include", headers: { "Content-Type": file.type }, body: file });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not save the restored photograph.");
      setNotice(`Watermarked restoration preview sent to ${job.orderId?.orderNumber ?? "the customer"} for approval.`); await refresh();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not upload the restoration."); }
    finally { setBusy(false); }
  }
  async function saveMugTemplate(event: FormEvent<HTMLFormElement>, key: string) {
    event.preventDefault(); const form = new FormData(event.currentTarget); setBusy(true); setError("");
    try {
      await api(`/api/v1/admin/templates/${key}`, { method: "PUT", body: JSON.stringify({ printableWidthIn: Number(form.get("width")), printableHeightIn: Number(form.get("height")), bleedIn: Number(form.get("bleed")), safeZoneIn: Number(form.get("safe")), dpi: Number(form.get("dpi")), active: true }) });
      setNotice(`${key.replace(":", " ")} production dimensions saved.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save product dimensions."); }
    finally { setBusy(false); }
  }

  if (checking) return <main className="admin-login"><p className="panel-kicker">VINAY COLOUR LAB</p><h1>Opening your studio deskâ€¦</h1></main>;
  if (!authenticated) return <main className="admin-login"><a className="brand login-brand" href="http://localhost:3000"><span>v.</span><div>VINAY COLOUR LAB<br/>PHOTO STUDIO</div></a><section><p className="panel-kicker">PRIVATE WORKSPACE</p><h1>Welcome<br/>back.</h1><p>Sign in to manage your studio orders, catalog, and pricing.</p><form onSubmit={login}><label>Email<input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)}/></label><label>Password<input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)}/></label><button className="login-submit" disabled={busy}>{busy ? "Signing inâ€¦" : "Sign in to Studio Desk â†—"}</button>{error && <p className="form-error" role="alert">{error === "admin_login_not_configured" ? "Set ADMIN_EMAIL and ADMIN_PASSWORD in the API environment to enable admin sign-in." : error}</p>}</form></section><footer>STUDIO DESK Â· ADMIN ACCESS</footer></main>;

  const money = (paise: number) => `â‚¹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
  const nextStatus: Record<string, string> = { approved: "production", production: "quality-check", "quality-check": "ready-to-ship", shipped: "delivered" };

  return <div className="admin-shell"><aside className="sidebar"><a className="brand" href="#overview"><span>v.</span><div>VINAY COLOUR LAB<br/>PHOTO STUDIO <small>STUDIO DESK</small></div></a><div className="side-label">WORKSPACE</div><nav>{(["Overview", "Orders", "Products", "Pricing", "Production", "Restoration", "Shipping"] as Tab[]).map((item, i) => <button key={item} className={item === tab ? "active" : ""} onClick={() => setTab(item)}><i>{["⌂", "▤", "◇", "₹", "▣", "✳", "↗"][i]}</i>{item}</button>)}</nav><div className="side-bottom"><div className="avatar">V</div><span>Studio admin<small>Authorized workspace</small></span><button className="logout-button" onClick={() => void logout()}>Exit</button></div></aside>
    <main className="admin-main"><header><div><span className="breadcrumb">STUDIO DESK /</span><span className="current"> {tab.toUpperCase()}</span></div><div className="header-actions"><span className="api-indicator connected"><i/> AUTHENTICATED</span><button className="refresh-button" onClick={() => void refresh()}>Refresh</button></div></header>
      <section className="dash-content"><div className="greeting"><div><p className="today">{new Intl.DateTimeFormat("en-IN", { weekday: "long", month: "long", day: "numeric" }).format(new Date()).toUpperCase()}</p><h1>{tab === "Overview" ? "A good day to make." : tab}</h1><p className="subhead">Vinay Colour Lab and Photo Studio Â· Kukatpally, Hyderabad</p></div><a className="view-store" href="http://localhost:3000" target="_blank" rel="noreferrer">View storefront â†—</a></div>
      {error && <div className="admin-alert" role="alert">{error}</div>}{notice && <div className="admin-notice" role="status">{notice}<button onClick={() => setNotice("")}>Ã—</button></div>}
      {tab === "Overview" && <><div className="stats-grid">{[["ORDERS TODAY", String(overview?.ordersToday ?? "â€”"), "New orders"], ["REVENUE THIS MONTH", overview ? money(overview.revenueThisMonthPaise) : "â€”", "Verified payments"], ["NEEDS YOUR EYE", overview ? String(overview.pendingPayments + overview.restorationJobs) : "â€”", "Payments and restorations"], ["PRODUCTION QUEUE", String(overview?.productionPending ?? "â€”"), "Paid and approved"]].map(([title, value, note]) => <article key={title}><span>{title}</span><strong>{value}</strong><small>{note}</small></article>)}</div><div className="dashboard-grid"><section className="panel workflow"><div className="panel-head"><div><span className="panel-kicker">LATEST ORDERS</span><h2>Where things stand</h2></div><button onClick={() => setTab("Orders")}>View orders â†—</button></div>{orders.length ? <div className="table-wrap"><table><thead><tr><th>ORDER</th><th>STATUS</th><th>TOTAL</th></tr></thead><tbody>{orders.slice(0, 6).map((order) => <tr key={order._id}><td><b>{order.orderNumber}</b><small>{order.email}</small></td><td><span className="status-pill">{order.status.replaceAll("-", " ")}</span></td><td>{money(order.totalPaise)}</td></tr>)}</tbody></table></div> : <div className="empty-orders"><div className="empty-symbol">âœ³</div><h3>Your first order will show up here.</h3><p>Paid orders appear here after the payment provider verifies them.</p></div>}</section><section className="panel connection"><span className="panel-kicker">TODAY AT A GLANCE</span><h2>Studio activity</h2><div><i/><span>Awaiting payment</span><b>{overview?.pendingPayments ?? 0}</b></div><div><i/><span>Restoration review</span><b>{overview?.restorationJobs ?? 0}</b></div><div><i/><span>Ready to ship</span><b>{overview?.shipped ?? 0}</b></div><div><i/><span>Shop catalog items</span><b>{products.filter((product) => product.active).length}</b></div></section></div></>}
      {tab === "Orders" && <section className="panel operations-panel"><div className="panel-head"><div><span className="panel-kicker">CUSTOMER ORDERS</span><h2>Order queue</h2></div><select className="filter-select" value={orderFilter} onChange={(e) => setOrderFilter(e.target.value)}><option value="">All statuses</option>{["pending-payment", "awaiting-approval", "approved", "production", "quality-check", "ready-to-ship", "shipped", "delivered", "cancelled"].map((status) => <option key={status} value={status}>{status.replaceAll("-", " ")}</option>)}</select></div><div className="table-wrap"><table><thead><tr><th>ORDER / CUSTOMER</th><th>ITEMS</th><th>STATUS</th><th>TOTAL</th><th>NEXT</th></tr></thead><tbody>{orders.map((order) => { const action = nextStatus[order.status]; return <tr key={order._id}><td><b>{order.orderNumber}</b><small>{order.email}<br/>{new Date(order.createdAt).toLocaleDateString("en-IN")}</small></td><td>{order.items.map((item) => `${item.quantity} Ã— ${item.title}`).join(", ")}</td><td><span className="status-pill">{order.status.replaceAll("-", " ")}</span></td><td>{money(order.totalPaise)}</td><td>{action ? <button className="table-action" disabled={busy} onClick={() => void moveOrder(order, action)}>Mark {action.replaceAll("-", " ")}</button> : order.status === "approved" ? <button className="table-action" disabled={busy} onClick={() => void generateFiles(order)}>Generate files</button> : order.status === "ready-to-ship" && !order.shipment ? <button className="table-action" disabled={busy} onClick={() => void createShipment(order)}>Create shipment</button> : order.shipment ? <><span className="waiting-label">{order.shipment.awb ?? order.shipment.failure ?? order.shipment.status}</span>{order.shipment.status === "failed" && <button className="table-action" disabled={busy} onClick={() => void createShipment(order)}>Retry / resume</button>}{order.shipment.id && order.shipment.status !== "failed" && <button className="table-action" disabled={busy} onClick={() => void refreshShipment(order)}>Refresh tracking</button>}{order.shipment.labelUrl ? <a className="table-action" href={order.shipment.labelUrl} target="_blank" rel="noreferrer">Label PDF</a> : order.shipment.id && order.shipment.status !== "failed" && <button className="table-action" disabled={busy} onClick={() => void generateLabel(order)}>Generate label</button>}</> : order.status === "awaiting-approval" ? <span className="waiting-label">Customer approval</span> : <span className="waiting-label">—</span>}{order.status !== "pending-payment" && order.status !== "cancelled" && order.status !== "refunded" && <button className="table-action" onClick={() => void downloadInvoice(order)}>Invoice</button>}</td></tr>; })}</tbody></table>{orders.length === 0 && <p className="table-empty">No orders match this filter.</p>}</div></section>}
      {tab === "Restoration" && <section className="panel operations-panel"><div className="panel-head"><div><span className="panel-kicker">RESTORATION WORKBENCH</span><h2>Prepare a restored preview</h2></div><span className="status-pill">{restorations.filter((job) => job.status === "uploaded" || job.status === "admin-review" || job.status === "correction").length} need review</span></div><p className="panel-copy">Download the original privately, restore it in your preferred editor or AI tool, then upload the result. Customers see a watermarked preview and must approve it before print production.</p><div className="restoration-grid">{restorations.map((job) => <article className="panel restore-card" key={job._id}><div className="restore-images">{job.originalPreviewUrl && <figure><a href={job.originalPreviewUrl} target="_blank" rel="noreferrer"><img src={job.originalPreviewUrl} alt="Private original photo"/></a><figcaption>ORIGINAL · <a href={job.originalPreviewUrl} download>Open full size ↗</a></figcaption></figure>}{job.restoredPreviewUrl && <figure><img src={job.restoredPreviewUrl} alt="Current restoration preview"/><figcaption>RESTORED PREVIEW</figcaption></figure>}</div><p><b>{job.orderId?.orderNumber ?? "Restoration order"}</b><small>{job.orderId?.email} · {job.status.replaceAll("-", " ")}</small></p>{job.aiRestoreConsent && job.status === "uploaded" && <button className="small-save" disabled={busy} onClick={() => void runAiRestoration(job)}>Run AI restoration</button>}{job.status === "admin-review" && <button className="small-save" disabled={busy} onClick={() => void sendRestorationForApproval(job)}>Send watermarked preview for approval</button>}{job.status !== "awaiting-customer" && job.status !== "approved" && <label className="restore-upload">Upload restored image<input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy} onChange={(event) => { void uploadRestoration(job, event.currentTarget.files?.[0]); event.currentTarget.value = ""; }}/></label>}{job.status === "awaiting-customer" && <span className="waiting-label">Waiting for customer approval</span>}</article>)}{restorations.length === 0 && <p className="table-empty">Paid restoration orders will appear here for studio review.</p>}</div></section>}
      {tab === "Production" && <div className="production-layout"><section className="panel operations-panel"><div className="panel-head"><div><span className="panel-kicker">PRINT QUEUE</span><h2>Production files</h2></div><span className="status-pill">{productionJobs.filter((job) => job.status === "ready").length} ready</span></div><p className="panel-copy">Only customer approved and paid designs can be rendered. Download links are private and expire.</p><div className="table-wrap"><table><thead><tr><th>ORDER</th><th>STATUS</th><th>ATTEMPTS</th><th>CREATED</th><th/></tr></thead><tbody>{productionJobs.map((job) => <tr key={job._id}><td><b>{job.orderId?.orderNumber ?? "Studio order"}</b><small>{job.failure ?? job.outputAssetId ?? ""}</small></td><td><span className="status-pill">{job.status}</span></td><td>{job.attempts}</td><td>{new Date(job.createdAt).toLocaleDateString("en-IN")}</td><td>{job.status === "ready" && <button className="table-action" onClick={() => void downloadFile(job)}>Download PNG</button>}</td></tr>)}</tbody></table>{productionJobs.length === 0 && <p className="table-empty">Approved orders will appear here after print files are generated.</p>}</div></section><section className="panel form-panel"><span className="panel-kicker">MUG PRINT CONFIGURATION</span><h2>Printable wrap area</h2><p className="panel-copy">Enter dimensions from your mug and heat press supplier. These values determine the final 300 DPI image size.</p>{([ ["White mug", "mugs:white"], ["Coloured mug", "mugs:coloured"] ] as const).map(([label, key]) => <form className="template-form" key={key} onSubmit={(event) => void saveMugTemplate(event, key)}><h3>{label}</h3><div className="template-grid"><label>Width Â· in<input name="width" type="number" min="1" max="15" step=".01" defaultValue="8.5" required/></label><label>Height Â· in<input name="height" type="number" min="1" max="15" step=".01" defaultValue="3.5" required/></label><label>Bleed Â· in<input name="bleed" type="number" min="0" max="1" step=".01" defaultValue=".1" required/></label><label>Safe zone Â· in<input name="safe" type="number" min="0" max="1" step=".01" defaultValue=".15" required/></label><label>DPI<input name="dpi" type="number" min="150" max="1200" step="1" defaultValue="300" required/></label></div><button className="small-save" disabled={busy}>Save {label.toLowerCase()} size</button></form>)}</section></div>}
      {tab === "Products" && <div className="catalog-layout"><section className="panel operations-panel"><div className="panel-head"><div><span className="panel-kicker">LIVE CATALOG</span><h2>Products</h2></div><span className="status-pill">{products.filter((item) => item.active).length} active</span></div><div className="table-wrap"><table><thead><tr><th>PRODUCT</th><th>CATEGORY</th><th>VARIANTS</th><th>STATUS</th><th/></tr></thead><tbody>{products.map((item) => <tr key={item._id}><td><b>{item.name}</b><small>/{item.slug}</small></td><td>{item.category}</td><td>{item.variants.length}</td><td>{item.active ? "Active" : "Archived"}</td><td>{item.active && <button className="table-action danger" disabled={busy} onClick={() => void archiveProduct(item._id)}>Archive</button>}</td></tr>)}</tbody></table>{products.length === 0 && <p className="table-empty">Add your first product below.</p>}</div></section><section className="panel form-panel"><span className="panel-kicker">ADD TO CATALOG</span><h2>New product</h2><form onSubmit={createProduct}><label>Product name<input required minLength={2} value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value, slug: e.target.value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") })}/></label><label>Slug<input required pattern="[a-z0-9]+(-[a-z0-9]+)*" value={productForm.slug} onChange={(e) => setProductForm({ ...productForm, slug: e.target.value })}/></label><label>Category<select value={productForm.category} onChange={(e) => setProductForm({ ...productForm, category: e.target.value })}>{categories.map((item) => <option key={item._id} value={item.slug}>{item.name}</option>)}{categories.length === 0 && <option value="frames">Photo frames</option>}</select></label><label>Description<textarea rows={3} value={productForm.description} onChange={(e) => setProductForm({ ...productForm, description: e.target.value })}/></label><button className="save-button" disabled={busy}>Add product <span>â†—</span></button></form><div className="new-category"><h3>Add a category</h3><form onSubmit={createCategory}><label>Name<input required value={categoryForm.name} onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value, slug: e.target.value.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") })}/></label><label>Slug<input required value={categoryForm.slug} onChange={(e) => setCategoryForm({ ...categoryForm, slug: e.target.value })}/></label><label>Description<input value={categoryForm.description} onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })}/></label><button className="small-save" disabled={busy}>Create category</button></form></div></section></div>}
      {tab === "Pricing" && <section className="panel form-panel pricing-panel"><div className="panel-head"><div><span className="panel-kicker">SERVER-CALCULATED PRICES</span><h2>Product pricing</h2></div><span className="status-pill">Database-backed</span></div><p className="panel-copy">These amounts are used by the customer quote and checkout calculations.</p><div className="pricing-admin-grid"><div><h3>Frame base prices Â· â‚¹</h3>{Object.entries(pricing.frames).map(([size, value]) => <label className="price-edit" key={size}><span>{size.replace("x", " Ã— ")} in</span><input type="number" min="0" value={value} onChange={(e) => setPricing({ ...pricing, frames: { ...pricing.frames, [size]: Number(e.target.value) } })}/></label>)}</div><div><h3>Frame finish additions Â· â‚¹</h3>{Object.entries(pricing.materialAddons).map(([name, value]) => <label className="price-edit" key={name}><span>{name}</span><input type="number" min="0" value={value} onChange={(e) => setPricing({ ...pricing, materialAddons: { ...pricing.materialAddons, [name]: Number(e.target.value) } })}/></label>)}<h3>Mugs Â· â‚¹</h3>{Object.entries(pricing.mugs).map(([name, value]) => <label className="price-edit" key={name}><span>{name}</span><input type="number" min="0" value={value} onChange={(e) => setPricing({ ...pricing, mugs: { ...pricing.mugs, [name]: Number(e.target.value) } })}/></label>)}</div><div><h3>Service fees Â· â‚¹</h3><label className="price-edit"><span>Digital printing</span><input type="number" min="0" value={pricing.digitalPrintingFee} onChange={(e) => setPricing({ ...pricing, digitalPrintingFee: Number(e.target.value) })}/></label><label className="price-edit"><span>Photo restoration</span><input type="number" min="0" value={pricing.restorationFee} onChange={(e) => setPricing({ ...pricing, restorationFee: Number(e.target.value) })}/></label><button className="save-button" disabled={busy} onClick={() => void savePricing()}>Save pricing <span>â†—</span></button></div></div></section>}
      {tab === "Shipping" && <section className="panel form-panel shipping-panel"><span className="panel-kicker">CHECKOUT CONFIGURATION</span><h2>Default shipping price</h2><p className="panel-copy">Shown separately before payment. Set a flat starting rate while carrier-specific rates are not configured.</p><form onSubmit={(event) => void saveShipping(event)}><label>Shipping Â· â‚¹<input type="number" min="0" step="0.01" required value={shippingPaise === null ? "" : (shippingPaise / 100).toFixed(2)} onChange={(event) => setShippingPaise(Math.round(Number(event.target.value) * 100))}/></label><button className="save-button" disabled={busy}>Save shipping price <span>â†—</span></button></form><p className="setup-hint">Configure Shiprocket credentials and pickup location to create labels and update shipment tracking from the order queue.</p></section>}
      <footer className="admin-footer"><span>STUDIO DESK Â· PRIVATE ADMIN WORKSPACE</span><span>VINAY COLOUR LAB Â· KUKATPALLY, HYDERABAD</span></footer></section></main></div>;
}
