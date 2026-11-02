import type { Metadata } from "next";
import "./styles.css";
import "./cart.css";
import "./watermark.css";
import "./checkout.css";
import "./design-preview.css";
import "./styles-extra.css";

export const metadata: Metadata = {
  title: "Vinay Colour Lab and Photo Studio | Turn moments into keepsakes",
  description: "Create a frame, print, or personalized gift from the photographs you love.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
