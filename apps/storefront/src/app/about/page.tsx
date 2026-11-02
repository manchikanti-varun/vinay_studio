import Link from "next/link";
import { EditorialPage } from "@/components/storefront";

export default function AboutPage() {
  return <EditorialPage eyebrow="A LOCAL PHOTO STUDIO" title="A place for the photographs you love." intro="Vinay Colour Lab and Photo Studio is based in Kukatpally, Hyderabad. The studio brings together photo framing, digital printing, personalized mugs, and restoration in one place.">
    <section className="editorial-feature"><div><p className="eyebrow">MADE AROUND YOUR PHOTOGRAPH</p><h2>From a small image<br/>to something <em>lasting.</em></h2><p>Choose a product, make the details your own, and preview the design with your photograph. Your original image stays separate from the watermarked preview.</p><Link className="button dark" href="/#shop">Explore the collections <span>↗</span></Link></div><div className="editorial-feature-image"><img src="/images/studio-hero.webp" alt="Framed photograph displayed in a warm home"/></div></section>
    <section className="value-grid"><article><span>01</span><h3>Personal by design</h3><p>Start with your own photograph and shape the product around it.</p></article><article><span>02</span><h3>Preview before review</h3><p>See a watermarked preview of your selected crop before it leaves the design stage.</p></article><article><span>03</span><h3>Studio based</h3><p>Find us in Kukatpally, Hyderabad, or get in touch with the studio directly.</p></article></section>
  </EditorialPage>;
}
