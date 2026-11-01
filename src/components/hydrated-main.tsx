"use client";
import type { ComponentProps } from "react";
import { useActionHydration } from "./action-hydration";

// Server-rendered filters and links need the same protection as client forms.
// This boundary sits inside each resolved page, rather than in a layout that
// can hydrate before a streamed page is ready.
export function HydratedMain({ children, ...props }: ComponentProps<"main">) {
  const ready = useActionHydration();
  return (
    <main {...props} data-ux-ready={ready}>
      {children}
    </main>
  );
}
