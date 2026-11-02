import { EditorialPage } from "@/components/storefront";

export default function TermsPage() {
  return <EditorialPage eyebrow="SERVICE INFORMATION" title="Using the design studio." intro="These service notes reflect the current photo-design phase. Complete terms for ordering, payment, and delivery will be published before those services are enabled online.">
    <section className="policy-copy"><h2>Photo design and previews</h2><p>Product options and current prices are shown in the catalog and editor. The preview is watermarked and is for design review; the uploaded original is kept separately.</p><h2>Restoration review</h2><p>Restoration output can require studio review. AI assistance is optional where offered, and the original photograph is not replaced by the preview.</p><h2>Current online flow</h2><p>The current customer journey ends at the guest bag. This site does not accept online payment or arrange delivery in this phase.</p></section>
  </EditorialPage>;
}
