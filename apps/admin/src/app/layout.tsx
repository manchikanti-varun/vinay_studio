import type { Metadata } from "next";
import "./styles.css";
import "./styles-extra.css";
export const metadata: Metadata = { title: "Studio Desk", description: "Photo studio operations" };
export default function Layout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="en"><body>{children}</body></html>; }
