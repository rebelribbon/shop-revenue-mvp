import { notFound } from "next/navigation";
import type { ReactNode } from "react";

/**
 * Historical browser-only sample flows stay available in development for
 * visual regression tests, but must not be public on the live application.
 * The real CRM lives under /app and is backed by shop authentication.
 */
export default function DesktopDemoLayout({
  children,
}: {
  children: ReactNode;
}) {
  if (
    process.env.VERCEL_ENV === "production" ||
    process.env.APP_ENV === "production"
  ) {
    notFound();
  }
  return children;
}
