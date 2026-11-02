"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Breadcrumbs, SiteFooter, SiteHeader } from "@/components/storefront";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
type CartItem = { id: string; category: string; size?: string; material?: string; mug?: string; quantity?: number; price: number; previewUrl?: string; aiRestoreConsent?: boolean; sourceAssetId?: string; customization?: { zoom: number; rotation: number; horizontal: number; vertical: number } };
const categoryNames: Record<string, string> = { frames: "Photo frame", printing: "Digital print", mugs: "Photo mug", restoration: "Photo restoration" };

export default function CartPage() {
  const [items, setItems] = useState<CartItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState("");
  useEffect(() => {
    void (async () => {
      try {
        const session = await fetch(`${apiBase}/api/v1/guest/session`, { method: "POST", credentials: "include" });
        if (!session.ok) throw new Error("Your guest bag is temporarily unavailable. Please try again in a moment.");
        const response = await fetch(`${apiBase}/api/v1/cart`, { credentials: "include" });
        const data = await response.json() as { items?: CartItem[]; error?: string };
        if (!response.ok) throw new Error(data.error ?? "Could not load your bag.");
        setItems(data.items ?? []);
      } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load your bag."); }
      finally { setLoading(false); }
    })();
  }, []);
  async function removeItem(id: string) {
    setRemoving(id); setError("");
    try {
      const response = await fetch(`${apiBase}/api/v1/cart/items/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include" });
      if (!response.ok) throw new Error("Could not remove this design. Please try again.");
      setItems((current) => current.filter((item) => item.id !== id));
      window.dispatchEvent(new Event("studio-cart-updated"));
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not remove this design."); }
    finally { setRemoving(""); }
  }
  const subtotal = items.reduce((total, item) => total + item.price * (item.quantity ?? 1), 0);
  return <><SiteHeader/><main className="cart-page"><div className="cart-page-inner"><Breadcrumbs items={[{ label: "Your bag" }]}/><p className="eyebrow">A MOMENT, MADE PERSONAL</p><h1>Your bag<span> · {items.length}</span></h1><p className="cart-page-intro">Review your photo choices and make any last adjustments before you continue.</p>{error && <p className="cart-error" role="alert">{error}</p>}{loading ? <div className="cart-loading" aria-live="polite">Loading your bag…</div> : items.length ? <div className="cart-layout"><section className="cart-items-list" aria-label="Items in your bag">{items.map((item) => <article className="cart-item" key={item.id}><div className="cart-item-image">{item.previewUrl ? <img src={item.previewUrl} alt={`Watermarked preview of ${categoryNames[item.category] ?? "photo product"}`}/> : <span>✳</span>}</div><div className="cart-item-info"><p className="eyebrow">{categoryNames[item.category] ?? "Photo product"}</p><h2>{item.category === "mugs" ? `${item.mug === "coloured" ? "Standard coloured" : "White"} photo mug` : item.category === "restoration" ? "Photo restoration" : `${item.size?.replace("x", " × ") ?? "8 × 12"} in ${categoryNames[item.category] ?? "print"}`}</h2><p>{item.material ? `${item.material.replaceAll("-", " ")} finish · ` : ""}{item.category === "restoration" ? item.aiRestoreConsent ? "AI assistance allowed" : "Studio-only restoration" : "Watermarked preview included"}</p><strong>₹{item.price.toLocaleString("en-IN")}</strong></div><div className="cart-item-actions"><Link href={`/?product=${encodeURIComponent(item.category)}&edit=${encodeURIComponent(item.id)}#customize`}>Edit design ↗</Link><button disabled={removing === item.id} onClick={() => void removeItem(item.id)}>{removing === item.id ? "Removing…" : "Remove"}</button></div></article>)}</section><aside className="cart-summary"><p className="eyebrow">BAG SUMMARY</p><div><span>Items</span><b>{items.length}</b></div><div><span>Subtotal</span><b>₹{subtotal.toLocaleString("en-IN")}</b></div><p>Price shown for your selected products. Any final order details will be confirmed in a later checkout phase.</p><button className="cart-next-step" disabled>Guest checkout will be available in a later phase</button><Link className="text-link" href="/#shop">Continue shopping <span>↗</span></Link></aside></div> : <section className="cart-empty"><span>✳</span><h2>Your bag is waiting for a memory.</h2><p>Choose a frame, print, mug, or restoration service, then add your photo design here.</p><Link className="button dark" href="/#shop">Explore the collections <span>↗</span></Link></section>}</div></main><SiteFooter/></>;
}
