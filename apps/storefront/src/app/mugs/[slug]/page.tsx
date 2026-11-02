import { notFound } from "next/navigation";
import { ProductDetail } from "@/components/storefront";
export default async function MugProductPage({ params }: { params: Promise<{ slug: string }> }) { const { slug } = await params; if (!['white-mug', 'standard-coloured-mug'].includes(slug)) notFound(); return <ProductDetail category="mugs" slug={slug}/>; }
