import Link from "next/link";
import { EditorialPage } from "@/components/storefront";

const answers = [
  ["Which photo files can I upload?", "JPEG, PNG, and WebP images up to 25 MB are supported."],
  ["Will my original photo be changed?", "No. The original is kept separately from the watermarked preview used while you review the design."],
  ["Can I adjust how my photo fits?", "The editor lets you adjust zoom, rotation, and photo position before adding the design to your bag."],
  ["Can I request photo restoration?", "Yes. The studio prepares a watermarked result for review. AI assistance is optional for restoration orders."],
  ["Do I need an account to prepare a design?", "No. You can browse products, customize a photo, and use your bag as a guest."],
  ["Can I pay or arrange delivery online?", "Payment and delivery steps are being prepared for a later phase. The current website stops at your bag."],
];

export default function FaqPage() {
  return <EditorialPage eyebrow="A FEW THINGS TO KNOW" title="Questions, answered." intro="Helpful details about choosing a product, preparing a photograph, and using the guest design editor.">
    <section className="faq-page-list">{answers.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</section>
    <p className="faq-contact">Still have a question? <Link href="/contact">Talk with the studio ↗</Link></p>
  </EditorialPage>;
}
