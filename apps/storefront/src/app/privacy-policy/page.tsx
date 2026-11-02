import { EditorialPage } from "@/components/storefront";

export default function PrivacyPolicyPage() {
  return <EditorialPage eyebrow="PRIVACY INFORMATION" title="Your photographs stay yours." intro="This page describes the photo-preview behavior currently shown in the design experience. Full legal policy details will be published before online checkout is enabled.">
    <section className="policy-copy"><h2>Photo uploads and previews</h2><p>When you upload a supported image in the editor, the site stores the original separately from the watermarked preview used for review. The preview is intended to help you position and review your design.</p><h2>Guest bag</h2><p>Your bag is associated with the guest browser session. No customer account is required to prepare a design.</p><h2>Questions</h2><p>For questions about an image you have uploaded, contact the studio at <a href="tel:+918074784902">+91 80747 84902</a>.</p></section>
  </EditorialPage>;
}
