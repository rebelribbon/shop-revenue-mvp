import type { Metadata, Viewport } from "next";
import "./globals.css";
import { PageActions } from "@/components/page-actions";

export const metadata: Metadata = {
  title: "Shop Revenue",
  description: "Find and recover the money your shop is owed.",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        <a className="skip-link" href="#main-content">
          Skip to content
        </a>
        {children}
        <PageActions />
      </body>
    </html>
  );
}
