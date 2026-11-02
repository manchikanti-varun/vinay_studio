import { notFound } from "next/navigation";
import { frameSizes } from "@studio/shared";
import { ProductDetail } from "@/components/storefront";
export default async function FrameProductPage({ params }: { params: Promise<{ slug: string }> }) { const { slug } = await params; if (!frameSizes.includes(slug as typeof frameSizes[number])) notFound(); return <ProductDetail category="frames" slug={slug}/>; }
