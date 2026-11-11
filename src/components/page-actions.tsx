"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

// Enhance the existing control instead of duplicating it: its form, validation,
// disabled/pending state and event handler remain intact. Exactly one control
// receives primary styling. Never place destructive controls in the thumb bar.
const destructive =
  /archive|delete|remove|cancel|void|reverse|refund|exclude|revoke|sign decline|do not contact/i;
function eligible(element: HTMLElement) {
  return (
    element.isConnected &&
    element.getClientRects().length > 0 &&
    !element.closest(
      '[hidden], [inert], details:not([open]), [data-ux-ready="false"]',
    ) &&
    !element.matches(
      '.danger, [data-destructive="true"], [data-ux-utility="true"]',
    ) &&
    !destructive.test(element.textContent?.trim() ?? "")
  );
}
export function PageActions() {
  const pathname = usePathname();
  const [fallback, setFallback] = useState(false);
  useEffect(() => {
    // Public interactive demos own their navigation and controls. Never attach
    // the global floating action or misleading sign-in fallback to a demo.
    if (pathname.startsWith("/demo/")) {
      document.body.style.removeProperty("--primary-space");
      return;
    }
    let selected: HTMLElement | null = null;
    let focusedForm: HTMLFormElement | null = null;
    let frame = 0;
    const choose = () => {
      frame = 0;
      const main =
        document.querySelector("dialog[open]") ??
        document.querySelector("main");
      // Still loading or hydrating: choose nothing yet, and don't flash a
      // fallback button that the real primary would replace a frame later.
      if (
        !main ||
        main.getAttribute("aria-busy") === "true" ||
        main.getAttribute("data-ux-ready") === "false"
      ) {
        selected?.removeAttribute("data-ux-primary");
        setFallback(false);
        return;
      }
      const candidates = (selector: string) =>
        Array.from(main.querySelectorAll<HTMLElement>(selector)).filter(
          eligible,
        );
      if (
        focusedForm &&
        (!focusedForm.isConnected || !main.contains(focusedForm))
      )
        focusedForm = null;
      const context = focusedForm
        ? Array.from(
            focusedForm.querySelectorAll<HTMLElement>(
              'button[type="submit"],button:not([type]),input[type="submit"]',
            ),
          ).find(eligible)
        : null;
      const exitSupport = main.matches("dialog[open]")
        ? null
        : document.querySelector<HTMLElement>("[data-support-view] button");
      const next =
        exitSupport ??
        candidates("[data-stable-primary]")[0] ??
        context ??
        candidates("[data-page-primary]")[0] ??
        candidates(".btn.primary")[0] ??
        candidates('form button[type="submit"],form button:not([type])')[0] ??
        candidates("button")[0] ??
        null;
      if (selected !== next) {
        selected?.removeAttribute("data-ux-primary");
        selected = next;
      }
      selected?.setAttribute("data-ux-primary", "true");
      // Reserve the measured button height, including wrapped labels at narrow widths.
      if (selected)
        document.body.style.setProperty(
          "--primary-space",
          `${Math.ceil(selected.getBoundingClientRect().height / 8) * 8 + 16}px`,
        );
      else document.body.style.removeProperty("--primary-space");
      setFallback(!selected);
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(choose);
    };
    const onFocus = (event: FocusEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.matches(
          "input:not([readonly]),select,textarea:not([readonly])",
        ) &&
        target.closest("main,dialog[open]")
      ) {
        focusedForm = target.closest("form");
        schedule();
      }
    };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["class", "disabled", "hidden", "open", "data-ux-ready"],
    });
    document.addEventListener("focusin", onFocus);
    window.addEventListener("resize", schedule);
    choose();
    return () => {
      observer.disconnect();
      document.removeEventListener("focusin", onFocus);
      window.removeEventListener("resize", schedule);
      cancelAnimationFrame(frame);
      selected?.removeAttribute("data-ux-primary");
      document.body.style.removeProperty("--primary-space");
    };
  }, [pathname]);
  // Demos never get the sign-in fallback; the desktop demo still has its
  // own main button marked above.
  if (
    !fallback ||
    pathname.startsWith("/demo/") ||
    pathname.startsWith("/desktop-demo")
  )
    return null;
  const href =
    pathname === "/admin"
      ? "/admin/release"
      : pathname.startsWith("/admin/")
        ? "/admin"
        : pathname.startsWith("/app")
          ? "/app/work"
          : "/sign-in";
  const label =
    pathname === "/admin"
      ? "Review release readiness"
      : pathname.startsWith("/admin/")
        ? "Back to admin"
        : pathname.startsWith("/app")
          ? "Open work"
          : "Return to sign in";
  return (
    <a
      href={href}
      className="btn"
      data-ux-primary="true"
      data-ux-fallback="true"
    >
      {label}
    </a>
  );
}
