import { notFound } from "next/navigation";
import { ProductDetail } from "@/components/storefront";
export default async function RestorationProductPage({ params }: { params: Promise<{ slug: string }> }) { const { slug } = await params; if (slug !== "restore-your-photo") notFound(); return <ProductDetail category="restoration" slug={slug}/>; }
