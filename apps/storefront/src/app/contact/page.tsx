import { EditorialPage } from "@/components/storefront";

export default function ContactPage() {
  return <EditorialPage eyebrow="WE’RE HERE TO HELP" title="Talk with the studio." intro="Questions about a photo, a product option, or the design editor? Contact Vinay Colour Lab and Photo Studio in Kukatpally, Hyderabad.">
    <section className="contact-grid"><a className="contact-card" href="tel:+918074784902"><span className="eyebrow">CALL THE STUDIO</span><h2>+91 80747 84902</h2><span>Call ↗</span></a><a className="contact-card" href="https://wa.me/918074784902" target="_blank" rel="noreferrer"><span className="eyebrow">SEND A MESSAGE</span><h2>WhatsApp</h2><span>Chat with us ↗</span></a><a className="contact-card" href="https://www.google.com/maps/search/?api=1&query=Vinay+Colour+Lab+and+Photo+Studio+Kukatpally+Hyderabad" target="_blank" rel="noreferrer"><span className="eyebrow">VISIT</span><h2>Kukatpally</h2><span>Hyderabad · Get directions ↗</span></a></section>
    <p className="contact-note">For the most accurate directions, use the studio’s Google Maps listing.</p>
  </EditorialPage>;
}
