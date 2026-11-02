import CategoryDetail from "./view";

export default async function ShopCategoryPage({ params }: { params: Promise<{ category: string }> }) {
  const { category } = await params;
  return <CategoryDetail slug={category} />;
}
