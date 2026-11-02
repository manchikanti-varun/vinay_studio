"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { defaultPricing, framePrice, frameSizes, servicePrice, type FrameMaterial, type FrameSize, type PricingTable, type ProductCategory } from "@studio/shared";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const collections = [
  { href: "/frames", label: "Frames" },
  { href: "/digital-printing", label: "Digital printing" },
  { href: "/mugs", label: "Personalized mugs" },
  { href: "/photo-restoration", label: "Photo restoration" },
];
const products: Record<ProductCategory, { title: string; category: string; image: string; alt: string; description: string }> = {
  frames: { title: "Photo frame", category: "Frames", image: "/images/studio-hero.webp", alt: "Framed photograph styled in a sunlit home", description: "Choose a print size and frame finish, then position your own photograph in a private preview." },
  printing: { title: "Fine photo print", category: "Digital printing", image: "/images/print-stack.webp", alt: "Fine photo prints arranged on a table", description: "Prepare a favourite photograph as a studio print. Choose a size and preview the crop before adding it to your bag." },
  mugs: { title: "Personalized photo mug", category: "Personalized mugs", image: "/images/custom-mug.webp", alt: "Personalized photograph printed on a mug", description: "Choose a mug finish and see how your photograph sits in the print area." },
  restoration: { title: "Photo restoration", category: "Photo restoration", image: "/images/restoration-before-after.webp", alt: "Vintage portrait before and after restoration", description: "Send a treasured photograph for careful studio restoration. A watermarked preview is prepared for your review." },
};

export function SiteHeader() {
  const [count, setCount] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        await fetch(`${apiBase}/api/v1/guest/session`, { method: "POST", credentials: "include" });
        const response = await fetch(`${apiBase}/api/v1/cart`, { credentials: "include" });
        const data = response.ok ? await response.json() as { items?: unknown[] } : null;
        if (active) setCount(data?.items?.length ?? 0);
      } catch { if (active) setCount(0); }
    })();
    const update = () => {
      void fetch(`${apiBase}/api/v1/cart`, { credentials: "include" }).then((response) => response.ok ? response.json() as Promise<{ items?: unknown[] }> : null).then((data) => { if (active) setCount(data?.items?.length ?? 0); }).catch(() => undefined);
    };
    window.addEventListener("studio-cart-updated", update);
    return () => { active = false; window.removeEventListener("studio-cart-updated", update); };
  }, []);
  return <>
    <div className="announcement">VINAY COLOUR LAB &amp; PHOTO STUDIO <span>✳</span> KUKATPALLY · HYDERABAD</div>
    <header className="site-header">
      <div className="site-header-inner">
        <Link className="wordmark" href="/" aria-label="Vinay Colour Lab home"><span className="mark">v.</span><span>VINAY COLOUR LAB<br/>PHOTO STUDIO</span></Link>
        <button className="site-menu-toggle" aria-label={menuOpen ? "Close navigation" : "Open navigation"} aria-expanded={menuOpen} aria-controls="site-navigation" onClick={() => setMenuOpen((open) => !open)}>{menuOpen ? "×" : "☰"}</button>
        <nav id="site-navigation" className={menuOpen ? "site-navigation is-open" : "site-navigation"} aria-label="Main navigation">
          {collections.map((item) => <Link key={item.href} href={item.href} onClick={() => setMenuOpen(false)}>{item.label}</Link>)}
          <Link href="/about" onClick={() => setMenuOpen(false)}>About</Link>
          <Link href="/contact" onClick={() => setMenuOpen(false)}>Contact</Link>
        </nav>
        <Link className="site-cart-link" href="/cart" aria-label={`Shopping bag, ${count} items`}><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l1 13H4L5 8Z"/><path d="M9 9V6a3 3 0 0 1 6 0v3"/></svg><span>Bag</span><b>{count}</b></Link>
      </div>
    </header>
  </>;
}

export function SiteFooter() {
  return <footer className="site-footer"><div className="site-footer-inner"><Link className="wordmark" href="/"><span className="mark">v.</span><span>VINAY COLOUR LAB<br/>PHOTO STUDIO</span></Link><div className="site-footer-links"><Link href="/about">About</Link><Link href="/faq">FAQs</Link><Link href="/contact">Contact</Link><Link href="/privacy-policy">Privacy</Link><Link href="/terms">Terms</Link></div><div className="site-footer-contact"><span>KUKATPALLY · HYDERABAD</span><a href="tel:+918074784902">+91 80747 84902</a><a href="https://wa.me/918074784902" target="_blank" rel="noreferrer">WhatsApp ↗</a></div></div><div className="site-footer-base">© {new Date().getFullYear()} VINAY COLOUR LAB &amp; PHOTO STUDIO</div></footer>;
}

export function Breadcrumbs({ items }: { items: Array<{ label: string; href?: string }> }) {
  return <nav className="breadcrumbs" aria-label="Breadcrumb"><Link href="/">Home</Link>{items.map((item, index) => <span key={`${item.label}-${index}`} className="breadcrumb-part"><i aria-hidden="true">/</i>{item.href ? <Link href={item.href}>{item.label}</Link> : <span aria-current="page">{item.label}</span>}</span>)}</nav>;
}

export function EditorialPage({ eyebrow, title, intro, children }: { eyebrow: string; title: string; intro: string; children: React.ReactNode }) {
  return <><SiteHeader/><main className="editorial-page"><div className="editorial-page-inner"><Breadcrumbs items={[{ label: title }]}/><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="editorial-page-intro">{intro}</p>{children}</div></main><SiteFooter/></>;
}

export function ProductDetail({ category, slug }: { category: ProductCategory; slug: string }) {
  const [pricing, setPricing] = useState<PricingTable>(defaultPricing);
  const [size, setSize] = useState<FrameSize>(frameSizes.includes(slug as FrameSize) ? slug as FrameSize : "8x12");
  const [material, setMaterial] = useState<FrameMaterial>("glass");
  const [mug, setMug] = useState<"white" | "coloured">(slug.includes("coloured") ? "coloured" : "white");
  const product = products[category];
  useEffect(() => { fetch(`${apiBase}/api/v1/pricing`).then((response) => response.ok ? response.json() as Promise<PricingTable> : Promise.reject()).then(setPricing).catch(() => undefined); }, []);
  const price = useMemo(() => category === "mugs" ? pricing.mugs[mug] : category === "frames" ? framePrice(size, material, pricing) : servicePrice(category as "printing" | "restoration", size, material, pricing), [category, size, material, mug, pricing]);
  const productName = category === "frames" || category === "printing" ? `${size.replace("x", " × ")} in ${product.title}` : category === "mugs" ? `${mug === "white" ? "White" : "Coloured"} photo mug` : "Restore your photo";
  const categoryHref = category === "frames" ? "/frames" : category === "printing" ? "/digital-printing" : category === "mugs" ? "/mugs" : "/photo-restoration";
  const customizeHref = `/?product=${category}&size=${encodeURIComponent(size)}&material=${encodeURIComponent(material)}&mug=${encodeURIComponent(mug)}#customize`;
  return <><SiteHeader/><main className="product-detail-page"><div className="product-detail-inner"><Breadcrumbs items={[{ label: product.category, href: categoryHref }, { label: productName }]}/><div className="product-detail-grid"><div className="product-detail-image"><Image src={product.image} alt={product.alt} fill priority sizes="(max-width: 760px) 100vw, 56vw"/></div><section className="product-detail-copy"><p className="eyebrow">MADE PERSONAL IN KUKATPALLY</p><h1>{productName}</h1><p>{product.description}</p><strong className="product-detail-price">₹{price.toLocaleString("en-IN")}</strong>{category === "mugs" ? <label className="product-option">MUG FINISH<select value={mug} onChange={(event) => setMug(event.target.value as "white" | "coloured")}><option value="white">White mug</option><option value="coloured">Standard coloured mug</option></select></label> : category !== "restoration" && <><label className="product-option">PRINT SIZE<select value={size} onChange={(event) => setSize(event.target.value as FrameSize)}>{frameSizes.map((value) => <option key={value} value={value}>{value.replace("x", " × ")} in</option>)}</select></label>{category === "frames" && <label className="product-option">FRAME FINISH<select value={material} onChange={(event) => setMaterial(event.target.value as FrameMaterial)}><option value="glass">Glass</option><option value="glitter">Glitter</option><option value="non-breakable">Non-breakable</option></select></label>}</>}<Link className="button dark product-customize" href={customizeHref}>Customize with your photo <span>↗</span></Link><p className="product-detail-note">Your original stays separate from the watermarked preview. Add your design to the guest bag when it is ready.</p><ul><li>Studio-calculated pricing</li><li>Photo upload and crop preview</li><li>No account required to prepare your design</li></ul></section></div></div><section className="related-products"><div><p className="eyebrow">KEEP EXPLORING</p><h2>More ways to keep a moment.</h2></div>{collections.filter((item) => item.href !== categoryHref).map((item) => <Link key={item.href} href={item.href}>{item.label} <span>↗</span></Link>)}</section></main><SiteFooter/></>;
}
