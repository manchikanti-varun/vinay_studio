import { notFound, redirect } from "next/navigation";
export default async function CustomizeProductPage({ params }: { params: Promise<{ productId: string }> }) { const { productId } = await params; if (!['frames', 'printing', 'mugs', 'restoration'].includes(productId)) notFound(); redirect(`/?product=${encodeURIComponent(productId)}#customize`); }
