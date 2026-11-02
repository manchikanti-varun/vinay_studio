"use client";

import { FormEvent, useEffect, useState } from "react";
import "./orders.css";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
type OrderResult = { orderNumber: string; status: string; totalPaise: number; currency: string; createdAt: string; invoiceAvailable?: boolean; approvalReady?: boolean; items: Array<{ title: string; category?: string; quantity: number; previewUrl?: string }>; activity: Array<{ action: string; fromStatus?: string; toStatus?: string; createdAt: string }> };

export default function OrdersPage() {
  const [orderNumber, setOrderNumber] = useState("");
  const [order, setOrder] = useState<OrderResult | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [approving, setApproving] = useState(false);

  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("order");
    if (value) { setOrderNumber(value); void lookupByNumber(value); }
  }, []);

  async function lookupByNumber(value: string) {
    setLoading(true); setError("");
    try {
      const session = await fetch(`${apiBase}/api/v1/guest/session`, { method: "POST", credentials: "include" });
      if (!session.ok) throw new Error("Order details are temporarily unavailable.");
      const response = await fetch(`${apiBase}/api/v1/orders/${encodeURIComponent(value.trim())}`, { credentials: "include" });
      const data = await response.json() as OrderResult & { error?: string };
      if (!response.ok) throw new Error(data.error === "order_not_found" ? "We couldn’t find that order in this browser session." : data.error ?? "Could not look up the order.");
      setOrder(data);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not look up the order."); }
    finally { setLoading(false); }
  }

  async function lookup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOrder(null);
    await lookupByNumber(orderNumber);
  }

  async function downloadInvoice() {
    if (!order) return;
    setError("");
    try {
      const response = await fetch(`${apiBase}/api/v1/orders/${encodeURIComponent(order.orderNumber)}/invoice`, { credentials: "include" });
      const data = await response.json() as { url?: string; error?: string };
      if (!response.ok || !data.url) throw new Error(data.error ?? "Invoice is not available yet.");
      const link = document.createElement("a"); link.href = data.url; link.target = "_blank"; link.rel = "noopener noreferrer"; link.click();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not open the invoice."); }
  }

  async function approveDesign() {
    if (!order) return;
    setApproving(true); setError("");
    try {
      const response = await fetch(`${apiBase}/api/v1/orders/${encodeURIComponent(order.orderNumber)}/approve`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ confirmed: true }) });
      const data = await response.json() as { error?: string };
      if (!response.ok) throw new Error(data.error ?? "Could not approve the design.");
      await lookupByNumber(order.orderNumber);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not approve the design."); }
    finally { setApproving(false); }
  }

  return <main className="orders-page"><header><a className="orders-brand" href="/">← <span>VINAY COLOUR LAB &amp; PHOTO STUDIO</span></a><a href="/#shop">Back to shop ↗</a></header><section className="orders-card"><p className="eyebrow">YOUR PHOTO KEEPSAKES</p><h1>Keep an eye<br/>on your <em>order.</em></h1><p className="orders-intro">Enter the order number from your confirmation. For privacy, order details are available only in the guest browser session used to place it.</p><form onSubmit={lookup}><label>ORDER NUMBER<input value={orderNumber} onChange={(event) => setOrderNumber(event.target.value.toUpperCase())} placeholder="VCL-…" required minLength={8} maxLength={64}/></label><button className="button dark" type="submit" disabled={loading}>{loading ? "Looking up…" : "Find my order"} <span>↗</span></button></form>{error && <p className="order-error" role="alert">{error}</p>}{order && <section className="order-result"><div><span className="eyebrow">{order.orderNumber}</span><b>{order.status.replaceAll("-", " ")}</b></div><p>Placed {new Date(order.createdAt).toLocaleDateString("en-IN", { dateStyle: "long" })} · ₹{(order.totalPaise / 100).toLocaleString("en-IN")}</p>{order.invoiceAvailable && <button className="invoice-download" onClick={() => void downloadInvoice()}>Download invoice PDF ↗</button>}<div className="order-designs">{order.items.map((item, index) => <article key={`${item.title}-${index}`}>{item.previewUrl ? <img src={item.previewUrl} alt={`Watermarked preview of ${item.title}`} /> : <span>✳</span>}<div><b>{item.quantity} × {item.title}</b><small>{item.previewUrl ? order.status === "awaiting-approval" ? "Watermarked preview · review before production" : "Approved design preview" : item.category === "restoration" ? "The studio is preparing your restored preview" : "Design preview unavailable"}</small></div></article>)}</div>{order.status === "awaiting-approval" && !order.approvalReady && <div className="approval-box"><p>The studio is preparing your restored photograph. Your watermarked review preview will appear here before production starts.</p></div>}{order.status === "awaiting-approval" && order.approvalReady && <div className="approval-box"><p>Review the watermarked preview above. Approving this design allows the studio to begin production.</p><button className="button dark" disabled={approving} onClick={() => void approveDesign()}>{approving ? "Saving approval…" : "I approve this design ↗"}</button></div>}<div className="order-activity">{order.activity.map((event, index) => <article key={`${event.action}-${index}`}><i/><div><b>{event.action.replaceAll("-", " ")}</b><small>{new Date(event.createdAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}</small></div></article>)}</div></section>}</section><footer><span>VINAY COLOUR LAB · KUKATPALLY, HYDERABAD</span><a href="tel:+918074784902">+91 80747 84902</a></footer></main>;
}
