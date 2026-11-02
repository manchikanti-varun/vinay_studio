"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { defaultPricing, framePrice, frameSizes, servicePrice, type FrameMaterial, type FrameSize, type ProductCategory, type PricingTable } from "@studio/shared";

const categories = [
  { id: "frames", number: "01", title: "Photo frames", copy: "Give the everyday a place on your wall.", visual: "frame-art" },
  { id: "printing", number: "02", title: "Fine prints", copy: "Your favourite moments, made tangible.", visual: "print-art" },
  { id: "mugs", number: "03", title: "Photo mugs", copy: "A little reminder with every morning.", visual: "mug-art" },
  { id: "restoration", number: "04", title: "Photo restoration", copy: "Bring a little more life to an old favourite.", visual: "restore-art" },
];
const categoryImages: Record<string, { src: string; alt: string }> = {
  frames: { src: "/images/studio-hero.webp", alt: "Framed family photograph in a sunlit home" },
  printing: { src: "/images/print-stack.webp", alt: "Fine art family photo prints on textured paper" },
  mugs: { src: "/images/custom-mug.webp", alt: "Personalized photo mug in a bright home" },
  restoration: { src: "/images/restoration-before-after.webp", alt: "Vintage portrait before and after careful restoration" },
};
type BagLine = { id: string; category: ProductCategory; aiRestoreConsent?: boolean; size?: string; material?: string; mug?: string; price: number; previewUrl?: string; sourceAssetId?: string; customization?: { zoom: number; rotation: number; horizontal: number; vertical: number }; addedAt?: number };
const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
export default function Home() {
  const [category, setCategory] = useState<ProductCategory>("frames");
  const [size, setSize] = useState<FrameSize>("8x12");
  const [pricing, setPricing] = useState<PricingTable>(defaultPricing);
  const [material, setMaterial] = useState<FrameMaterial>("glass");
  const [mug, setMug] = useState<"white" | "coloured">("white");
  const [aiRestoreConsent, setAiRestoreConsent] = useState(false);
  const [photo, setPhoto] = useState<string | null>(null);
  const [assetId, setAssetId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [adding, setAdding] = useState(false);
  const [bagLines, setBagLines] = useState<BagLine[]>([]);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);
  const [horizontal, setHorizontal] = useState(50);
  const [vertical, setVertical] = useState(50);
  const [toast, setToast] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const price = useMemo(() => category === "mugs" ? pricing.mugs[mug] : category === "frames" ? framePrice(size, material, pricing) : servicePrice(category, size, material, pricing), [category, size, material, mug, pricing]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedCategory = params.get("product");
    if (requestedCategory && ["frames", "printing", "mugs", "restoration"].includes(requestedCategory)) {
      setCategory(requestedCategory as ProductCategory);
      setAiRestoreConsent(false);
    }
    const requestedSize = params.get("size");
    if (requestedSize && frameSizes.includes(requestedSize as FrameSize)) setSize(requestedSize as FrameSize);
    const requestedMaterial = params.get("material");
    if (requestedMaterial && ["glass", "glitter", "non-breakable"].includes(requestedMaterial)) setMaterial(requestedMaterial as FrameMaterial);
    const requestedMug = params.get("mug");
    if (requestedMug === "white" || requestedMug === "coloured") setMug(requestedMug);
  }, []);
  useEffect(() => {
    fetch(`${apiBase}/api/v1/pricing`).then((response) => response.ok ? response.json() as Promise<PricingTable> : Promise.reject()).then((value) => setPricing(value)).catch(() => undefined);
  }, []);
  useEffect(() => {
    if (!assetId) return;
    const refresh = () => void fetch(`${apiBase}/api/v1/assets/${encodeURIComponent(assetId)}/preview`, { credentials: "include" }).then(async (response) => response.ok ? response.json() as Promise<{ url: string }> : Promise.reject()).then((result) => setPhoto(result.url)).catch(() => undefined);
    const timer = window.setInterval(refresh, 240_000);
    return () => window.clearInterval(timer);
  }, [assetId]);

  useEffect(() => {
    if (typeof window !== "undefined") {
      void (async () => {
        try {
          const session = await fetch(`${apiBase}/api/v1/guest/session`, { method: "POST", credentials: "include" });
          if (!session.ok) return;
          const response = await fetch(`${apiBase}/api/v1/cart`, { credentials: "include" });
          if (!response.ok) return;
          const data = await response.json() as { items: BagLine[] };
          setBagLines(data.items);
          const requestedEdit = new URLSearchParams(window.location.search).get("edit");
          const editLine = data.items.find((item) => item.id === requestedEdit);
          if (editLine?.sourceAssetId && editLine.customization) {
            setEditingItemId(editLine.id); setCategory(editLine.category); setSize((editLine.size ?? "8x12") as FrameSize); setMaterial((editLine.material ?? "glass") as FrameMaterial); setMug((editLine.mug ?? "white") as "white" | "coloured"); setAiRestoreConsent(editLine.aiRestoreConsent === true); setAssetId(editLine.sourceAssetId); setPhoto(editLine.previewUrl ?? null); setZoom(editLine.customization.zoom); setRotation(editLine.customization.rotation); setHorizontal(editLine.customization.horizontal); setVertical(editLine.customization.vertical);
            window.setTimeout(() => document.getElementById("customize")?.scrollIntoView({ behavior: "smooth" }), 150);
          }
        } catch { /* API is optional while developing the storefront. */ }
      })();
    }
  }, []);
  useEffect(() => () => { if (photo?.startsWith("blob:")) URL.revokeObjectURL(photo); }, [photo]);

  async function choosePhoto(file?: File) {
    if (!file) return;
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) { setToast("Choose a JPEG, PNG, or WebP image."); return; }
    if (file.size > 25 * 1024 * 1024) { setToast("Choose an image smaller than 25 MB."); return; }
    if (photo?.startsWith("blob:")) URL.revokeObjectURL(photo);
    setPhoto(null);
    setAssetId(null);
    setUploading(true);
    setToast("Preparing a private photo preview…");
    try {
      const session = await fetch(`${apiBase}/api/v1/guest/session`, { method: "POST", credentials: "include" });
      if (!session.ok) throw new Error(session.status === 503 ? "Connect MongoDB to enable secure photo uploads." : "Could not start a secure upload session.");
      const uploaded = await fetch(`${apiBase}/api/v1/assets/upload`, { method: "POST", credentials: "include", headers: { "Content-Type": file.type }, body: file });
      const data = await uploaded.json() as { assetId?: string; previewUrl?: string; error?: string };
      if (!uploaded.ok || !data.assetId || !data.previewUrl) throw new Error(data.error === "r2_not_configured" ? "Private image storage is not configured yet." : data.error ?? "Photo upload failed.");
      setPhoto(data.previewUrl);
      setAssetId(data.assetId);
      setToast("Private photo preview ready. Your original is stored separately.");
    } catch (error) { setToast(error instanceof Error ? error.message : "Photo upload failed."); }
    finally { setUploading(false); }
  }

  async function addToBag() {
    if (!photo || !assetId) { fileRef.current?.click(); return; }
    setAdding(true);
    try {
      const response = await fetch(`${apiBase}/api/v1/cart/items`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ category, size: category === "mugs" ? undefined : size, material: category === "mugs" ? undefined : material, mug: category === "mugs" ? mug : undefined, sourceAssetId: assetId, aiRestoreConsent: category === "restoration" && aiRestoreConsent, customization: { zoom, rotation, horizontal, vertical } }) });
      const data = await response.json() as { item?: BagLine; error?: string };
      if (!response.ok || !data.item) throw new Error(data.error ?? "Could not add this design to your bag.");
      if (editingItemId) {
        const removed = await fetch(`${apiBase}/api/v1/cart/items/${encodeURIComponent(editingItemId)}`, { method: "DELETE", credentials: "include" });
        if (removed.ok) {
          setBagLines((items) => [...items.filter((item) => item.id !== editingItemId), data.item!]);
          setToast("Your bag item has been updated.");
        } else {
          setBagLines((items) => [...items, data.item!]);
          setToast("Updated design added. Remove the previous version from your bag when ready.");
        }
        setEditingItemId(null);
      } else {
        setBagLines((items) => [...items, data.item!]);
        setToast("Added to your bag.");
      }
      window.dispatchEvent(new Event("studio-cart-updated"));
    } catch (error) { setToast(error instanceof Error ? error.message : "Could not add this design."); }
    finally { setAdding(false); }
  }

  return <main>
    <div className="announcement">VINAY COLOUR LAB &amp; PHOTO STUDIO <span>✳</span> KUKATPALLY · HYDERABAD</div>
    <header className={`nav wrap ${mobileNavOpen ? "is-open" : ""}`}>
      <a className="wordmark" href="#top" aria-label="Vinay Colour Lab and Photo Studio home"><span className="mark">v.</span><span>VINAY COLOUR LAB<br/>PHOTO STUDIO</span></a>
      <nav aria-label="Main navigation" id="mobile-navigation"><a href="#shop" onClick={() => setMobileNavOpen(false)}>Shop</a><a href="/frames" onClick={() => setMobileNavOpen(false)}>Frames</a><a href="/digital-printing" onClick={() => setMobileNavOpen(false)}>Digital printing</a><a href="/mugs" onClick={() => setMobileNavOpen(false)}>Personalized mugs</a><a href="/photo-restoration" onClick={() => setMobileNavOpen(false)}>Photo restoration</a><a href="/about" onClick={() => setMobileNavOpen(false)}>About</a><a href="/contact" onClick={() => setMobileNavOpen(false)}>Contact</a></nav>
      <button className="mobile-menu" aria-label={mobileNavOpen ? "Close navigation" : "Open navigation"} aria-expanded={mobileNavOpen} aria-controls="mobile-navigation" onClick={() => setMobileNavOpen((open) => !open)}>{mobileNavOpen ? "×" : "☰"}</button>
      <div className="nav-actions"><a className="bag" href="/cart" aria-label={`Shopping bag, ${bagLines.length} items`}><span aria-hidden="true">▱</span> Bag <b>{bagLines.length}</b></a><a className="button dark nav-create" href="#customize">Create yours <span>↗</span></a></div>
    </header>

    <section className="hero wrap" id="top">
      <div className="hero-copy"><p className="eyebrow"><i/> MADE TO HOLD ONTO</p><h1>Your memories<br/>deserve a <em>place.</em></h1><p className="hero-sub">The photos you love shouldn’t live only on your phone. Turn them into frames, prints, and little everyday keepsakes.</p><a className="button dark" href="#shop">Find your favourite <span>↗</span></a><p className="micro">Made personal, one photograph at a time.</p></div>
      <div className="hero-stage" aria-label="A framed photograph in a sunlit room">
        <Image className="hero-image" src="/images/studio-hero.webp" alt="A family photograph framed above a walnut console" fill priority sizes="100vw" />
        <div className="sun-disc"/><div className="hero-frame"><div className="hero-photo"><span className="hill hill-one"/><span className="hill hill-two"/><span className="person"/></div></div>
        <div className="float-note"><span className="note-star">✳</span><span>Some things<br/>belong on walls.</span></div><span className="stage-caption">A MOMENT, MADE LASTING · NO. 01</span>
      </div>
    </section>

    <section className="trust-strip"><div className="wrap trust-inner"><span>MADE FOR REAL LIFE</span><b>Thoughtful materials</b><b>Personal to you</b><b>Made with care</b><span>✳</span></div></section>

    <section className="section wrap" id="shop"><div className="section-head"><div><p className="eyebrow">THE LITTLE THINGS, MADE PERMANENT</p><h2>Keep what <em>moves you.</em></h2></div><p>Start with a photograph.<br/>We’ll help with the rest.</p></div>
      <div className="category-grid">{categories.map((item) => { const startingPrice = item.id === "mugs" ? pricing.mugs.white : item.id === "frames" ? framePrice("8x12", "glass", pricing) : servicePrice(item.id as "printing" | "restoration", "8x12", "glass", pricing); return <a className="category-card" key={item.id} href={item.id === "printing" ? "/digital-printing" : item.id === "restoration" ? "/photo-restoration" : `/${item.id}`}><div className={`category-visual ${item.visual}`}><Image className={`category-photo ${item.visual}`} src={categoryImages[item.id].src} alt={categoryImages[item.id].alt} fill sizes="(max-width: 600px) 48vw, (max-width: 850px) 44vw, 25vw" />{item.id === "frames" && <div className="mini-frame"><div className="mini-scene"/></div>}{item.id === "printing" && <><div className="print-sheet"><div className="mini-scene"/></div><div className="print-sheet back"/></>}{item.id === "mugs" && <div className="mug-shape"><span/></div>}{item.id === "restoration" && <div className="restore-paper"><span>BEFORE</span><i/><span>AFTER</span></div>}<span className="card-number">{item.number}</span><span className="card-arrow">↗</span></div><div className="category-meta"><div><h3>{item.title}</h3><p>{item.copy}</p><small className="starting-price">From ₹{startingPrice.toLocaleString("en-IN")}{item.id === "frames" ? " · 8 × 12 in" : item.id === "mugs" ? " · White mug" : " · with frame"}</small></div><span className="arrow">↗</span></div></a>; })}</div>
    </section>

    <section className="popular-formats wrap"><div><p className="eyebrow">A GOOD PLACE TO START</p><h2>Popular <em>formats.</em></h2></div><Link href="/frames/8x12"><span>8 × 12 in photo frame</span><b>View details ↗</b></Link><Link href="/digital-printing/8x12"><span>8 × 12 in fine print</span><b>View details ↗</b></Link><Link href="/mugs/white-mug"><span>White photo mug</span><b>View details ↗</b></Link></section>

    <section className="customize-band" id="customize"><div className="wrap custom-grid"><div className="custom-copy"><p className="eyebrow light"><i/> START WITH A PHOTO</p><h2>A little piece<br/>of <em>your world.</em></h2><p>Choose a frame, pick a size, and add the photo you want to keep close. Your original is stored privately and shown here as a separate watermarked preview.</p><div className="steps"><span><b>01</b> Choose a product</span><span><b>02</b> Add a photograph</span><span><b>03</b> Preview and crop</span><span><b>04</b> Add to your bag</span></div></div>
      <div className="builder-card"><div className="builder-top"><span>MAKE IT YOURS</span><span>{category.toUpperCase()} / 001</span></div><div className="builder-preview"><div className={`preview-frame ${category === "mugs" ? "mug-preview-frame" : ""}`}><div className="preview-image" style={{ ...(photo ? { backgroundImage: `url(${photo})` } : {}), backgroundPosition: `${horizontal}% ${vertical}%`, transform: `scale(${zoom}) rotate(${rotation}deg)` }}>{!photo && <div className="placeholder-scene"><i/><b/><span/></div>}</div>{photo && <span className="preview-watermark">PREVIEW · NOT FOR PRINT</span>}</div>{!photo && <button className="upload-prompt" onClick={() => fileRef.current?.click()} disabled={uploading}><span>{uploading ? "…" : "＋"}</span><b>{uploading ? "Uploading privately…" : "Add your photograph"}</b><small>JPEG, PNG or WebP · 25 MB max</small></button>}<input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { void choosePhoto(e.target.files?.[0]); e.currentTarget.value = ""; }}/>{photo && <button className="change-photo" onClick={() => fileRef.current?.click()} disabled={uploading}>{uploading ? "Uploading…" : "Change photograph"}</button>}</div>
        {photo && <div className="editor-controls"><label>ZOOM <input type="range" min="1" max="2.5" step=".05" value={zoom} onChange={(e) => setZoom(Number(e.target.value))}/></label><label>ROTATE <input type="range" min="-15" max="15" value={rotation} onChange={(e) => setRotation(Number(e.target.value))}/></label><label>HORIZONTAL <input type="range" min="0" max="100" value={horizontal} onChange={(e) => setHorizontal(Number(e.target.value))}/></label><label>VERTICAL <input type="range" min="0" max="100" value={vertical} onChange={(e) => setVertical(Number(e.target.value))}/></label></div>}
        <div className="builder-controls"><label>PRODUCT<select value={category} onChange={(e) => { setCategory(e.target.value as ProductCategory); setAiRestoreConsent(false); }}><option value="frames">Photo frame</option><option value="printing">Digital printing</option><option value="mugs">Photo mug</option><option value="restoration">Photo restoration</option></select></label>{category === "mugs" ? <label>MUG TYPE<select value={mug} onChange={(e) => setMug(e.target.value as "white" | "coloured")}><option value="white">White mug</option><option value="coloured">Standard coloured mug</option></select></label> : <><label>FRAME SIZE<select value={size} onChange={(e) => setSize(e.target.value as FrameSize)}>{frameSizes.map((s) => <option key={s} value={s}>{s.replace("x", " × ")} in</option>)}</select></label><label>FRAME FINISH<select value={material} onChange={(e) => setMaterial(e.target.value as FrameMaterial)}><option value="glass">Glass</option><option value="glitter">Glitter + ₹50</option><option value="non-breakable">Non-breakable + ₹50</option></select></label></>}</div>{category === "restoration" && <label className="ai-consent"><input type="checkbox" checked={aiRestoreConsent} onChange={(event) => setAiRestoreConsent(event.target.checked)}/><span><b>Allow AI restoration</b><small>If you opt in, the original photo is sent securely to Replicate for face restoration. The studio reviews every result; your original stays unchanged. Leave unchecked for studio-only/manual restoration.</small></span></label>}<div className="builder-bottom"><div><small>{category === "mugs" ? mug === "white" ? "WHITE MUG" : "COLOURED MUG" : category === "frames" ? "YOUR FRAME" : `${category === "printing" ? "PRINTING" : "RESTORATION"} + FRAME`}</small><strong>₹{price.toLocaleString("en-IN")}</strong></div><button onClick={() => void addToBag()} disabled={adding || uploading} className="button dark">{adding ? "Saving…" : photo ? editingItemId ? "Save changes" : "Add to bag" : "Add a photo to begin"}<span>↗</span></button></div>{toast && <p className="toast" role="status">{toast}</p>}</div>
    </div></section>

    <section className="editorial wrap" id="restoration"><div className="editorial-image"><div className="old-photo"><span className="old-sun"/><span className="old-hill"/><span className="old-person"/></div><span className="photo-label">A MEMORY, KEPT</span></div><div className="editorial-copy"><p className="eyebrow">THE STORIES IN OLD PHOTOGRAPHS</p><h2>Some memories<br/>could use a <em>little care.</em></h2><p>Faded, scratched, or simply precious: give an old photograph room to shine again. We’re building a careful restoration process that keeps your original untouched.</p><a href="#how" className="text-link">Discover restoration <span>↗</span></a></div></section>

    <section className="how-section" id="how"><div className="wrap"><div className="section-head"><div><p className="eyebrow">FROM CAMERA ROLL TO KEEPSAKE</p><h2>Made personal.<br/><em>Made simple.</em></h2></div><p>Your photo. Your choices.<br/>A real thing to hold.</p></div><div className="how-grid"><article><span>01 / SELECT</span><div className="how-icon">⌕</div><h3>Choose what feels right</h3><p>Find a frame, print, or gift that gives your photograph a home.</p></article><article><span>02 / PERSONALIZE</span><div className="how-icon">⌁</div><h3>Make it yours</h3><p>Add your photo and make the little choices that bring it together.</p></article><article><span>03 / KEEP</span><div className="how-icon">♡</div><h3>Keep it close</h3><p>Your approved design becomes something you can live with every day.</p></article></div></div></section>
    <section className="faq-section" id="faq"><div className="wrap faq-grid"><div><p className="eyebrow">A FEW THINGS TO KNOW</p><h2>Good to know<br/><em>before you begin.</em></h2><p>Your photo matters. Here’s how we handle the details.</p><a className="text-link" href="https://wa.me/918074784902?text=Hello%20Vinay%20Colour%20Lab%2C%20I%20have%20a%20photo%20customization%20inquiry." target="_blank" rel="noreferrer">Ask us on WhatsApp <span>↗</span></a></div><div className="faq-list"><details><summary>Which photo files can I upload?</summary><p>JPEG, PNG, and WebP images up to 25 MB are supported.</p></details><details><summary>Will my original photo be changed?</summary><p>Your original is kept separately from the watermarked preview used while you review your design.</p></details><details><summary>Can I review a restoration before it is printed?</summary><p>Yes. The studio prepares a watermarked preview for your review, and production waits for your approval.</p></details></div></div></section>
    <footer id="contact"><div className="wrap footer-main"><a className="wordmark footer-brand" href="#top"><span className="mark">v.</span><span>VINAY COLOUR LAB<br/>PHOTO STUDIO</span></a><p>Vinay Colour Lab and Photo Studio<br/>Kukatpally, Hyderabad</p><div className="footer-links"><a href="#shop">Shop</a><a href="#how">Our process</a><a href="/about">About</a><a href="/faq">FAQs</a><a href="/privacy-policy">Privacy</a><a href="/terms">Terms</a><a href="tel:+918074784902">+91 80747 84902</a><a href="https://wa.me/918074784902" target="_blank" rel="noreferrer">WhatsApp ↗</a><a href="https://www.google.com/maps/search/?api=1&query=Vinay+Colour+Lab+and+Photo+Studio+Kukatpally+Hyderabad" target="_blank" rel="noreferrer">Get directions ↗</a></div><span className="footer-sun">✳</span></div><div className="wrap footer-base"><span>© {new Date().getFullYear()} · VINAY COLOUR LAB &amp; PHOTO STUDIO</span><span>COLONY, REMEDY HOSPITAL LANE · KUKATPALLY · HYDERABAD 500072</span></div></footer>
  </main>;
}
