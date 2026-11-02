"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { defaultPricing, framePrice, frameSizes, servicePrice, type FrameMaterial, type FrameSize, type PricingTable, type ProductCategory } from "@studio/shared";

const apiBase = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";
const catalog: Record<"frames" | "printing" | "mugs" | "restoration", { title: string; eyebrow: string; description: string; image: string; alt: string; detail: string; materialLabel: string }> = {
  frames: { title: "Photo frames", eyebrow: "A PLACE FOR YOUR FAVOURITE MOMENTS", description: "Bring a photograph off your camera roll and into the room. Choose a size and finish, then preview your own image before you order.", image: "/images/studio-hero.webp", alt: "Framed family photograph on a sunlit wall", detail: "Available in four print sizes with glass, glitter, and non-breakable finish options.", materialLabel: "FRAME FINISH" },
  printing: { title: "Fine photo prints", eyebrow: "PRINTED WITH CARE IN HYDERABAD", description: "Give a favourite photograph the detail and texture of a real print. Choose a size, see your quote, and prepare a watermarked preview before adding it to your bag.", image: "/images/print-stack.webp", alt: "Fine art photo prints stacked on a walnut table", detail: "Choose from the available studio print sizes and preview your photograph before adding it to your bag.", materialLabel: "PRESENTATION" },
  mugs: { title: "Personalized photo mugs", eyebrow: "A SMALL JOY FOR EVERY MORNING", description: "Make a familiar face part of the daily routine. Pick a mug finish and preview how your photograph sits on the keepsake.", image: "/images/custom-mug.webp", alt: "Personalized photo mug in a bright home", detail: "Choose a white or coloured mug. Your image is fitted to the studio print area.", materialLabel: "MUG FINISH" },
  restoration: { title: "Photo restoration", eyebrow: "KEEP THE OLD STORIES CLOSE", description: "Give a faded or damaged photograph careful attention. The studio prepares a watermarked result for your review before print production begins.", image: "/images/restoration-before-after.webp", alt: "Old portrait shown before and after restoration", detail: "Studio restoration is available with or without optional AI assistance. Your original remains unchanged.", materialLabel: "RESTORATION" },
};

export default function CategoryDetail({ slug }: { slug: string }) {
  const isCategory = Object.hasOwn(catalog, slug);
  const product = isCategory ? catalog[slug as keyof typeof catalog] : null;
  const category = (isCategory ? slug : "frames") as ProductCategory;
  const [pricing, setPricing] = useState<PricingTable>(defaultPricing);
  const [size, setSize] = useState<FrameSize>("8x12");
  const [material, setMaterial] = useState<FrameMaterial>("glass");
  const [mug, setMug] = useState<"white" | "coloured">("white");

  useEffect(() => {
    fetch(`${apiBase}/api/v1/pricing`).then((response) => response.ok ? response.json() as Promise<PricingTable> : Promise.reject()).then(setPricing).catch(() => undefined);
  }, []);

  const price = useMemo(() => category === "mugs" ? pricing.mugs[mug] : category === "frames" ? framePrice(size, material, pricing) : servicePrice(category as "printing" | "restoration", size, material, pricing), [category, size, material, mug, pricing]);
  const editorUrl = `/?product=${encodeURIComponent(category)}#customize`;

  if (!product) return <main className="category-not-found"><p className="eyebrow">VINAY COLOUR LAB &amp; PHOTO STUDIO</p><h1>We couldn’t find that collection.</h1><Link className="button dark" href="/#shop">Back to the shop ↗</Link></main>;

  return <main className="category-page">
    <div className="announcement">VINAY COLOUR LAB &amp; PHOTO STUDIO <span>✳</span> KUKATPALLY · HYDERABAD</div>
    <header className="category-header wrap"><Link className="wordmark" href="/" aria-label="Vinay Colour Lab and Photo Studio home"><span className="mark">v.</span><span>VINAY COLOUR LAB<br/>PHOTO STUDIO</span></Link><nav aria-label="Shop navigation"><Link href="/#shop">All collections</Link><a href="tel:+918074784902">Contact</a></nav><Link className="category-header-cta" href={editorUrl}>Create your photo <span>↗</span></Link></header>
    <section className="category-hero wrap"><div className="category-intro"><p className="eyebrow"><i/> {product.eyebrow}</p><h1>{product.title.split(" ").slice(0,-1).join(" ")} <em>{product.title.split(" ").slice(-1)}</em></h1><p>{product.description}</p><div className="category-price"><small>STARTING AT</small><strong>₹{price.toLocaleString("en-IN")}</strong><span>{category === "frames" ? `${size.replace("x", " × ")} in · ${material.replace("-", " ")}` : category === "mugs" ? `${mug === "white" ? "White" : "Coloured"} mug` : "Includes frame"}</span></div><Link className="button dark category-primary-cta" href={editorUrl}>Customize with your photo <span>↗</span></Link><p className="category-trust">Your watermarked preview is ready before you approve production.</p></div><div className="category-image"><Image src={product.image} alt={product.alt} fill priority sizes="(max-width: 700px) 100vw, 52vw" /></div></section>
    <section className="category-config"><div className="wrap category-config-inner"><div><p className="eyebrow">CHOOSE THE DETAILS</p><h2>Make it <em>yours.</em></h2><p>{product.detail}</p></div><div className="category-options">{category === "mugs" ? <label>{product.materialLabel}<select value={mug} onChange={(event) => setMug(event.target.value as "white" | "coloured")}><option value="white">White mug</option><option value="coloured">Coloured mug</option></select></label> : <><label>PRINT SIZE<select value={size} onChange={(event) => setSize(event.target.value as FrameSize)}>{frameSizes.map((value) => <option key={value} value={value}>{value.replace("x", " × ")} in</option>)}</select></label><label>{product.materialLabel}<select value={material} onChange={(event) => setMaterial(event.target.value as FrameMaterial)}><option value="glass">Glass</option><option value="glitter">Glitter finish</option><option value="non-breakable">Non-breakable finish</option></select></label></>}<Link className="button dark" href={editorUrl}>Continue to photo editor <span>↗</span></Link></div></div></section>
    <section className="category-reassurance wrap"><div><span>01</span><h3>Choose your product</h3><p>Pick the size and finish that suits the photograph.</p></div><div><span>02</span><h3>Preview your design</h3><p>Upload your photo and adjust its position before ordering.</p></div><div><span>03</span><h3>Approve with confidence</h3><p>For restoration orders, production starts after you approve the preview.</p></div></section>
    <footer className="category-footer"><div className="wrap"><Link className="text-link" href="/#shop">← Back to all collections</Link><p>Questions? <a href="https://wa.me/918074784902" target="_blank" rel="noreferrer">Talk with the studio on WhatsApp ↗</a></p></div></footer>
  </main>;
}
