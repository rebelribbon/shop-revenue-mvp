"use client";
import { useEffect, useRef, useState } from "react";
import { stripeBannerSessionAction } from "@/server/actions/payments";
export function StripeNotifications({
  publishableKey,
}: {
  publishableKey: string;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [message, setMessage] = useState("");
  useEffect(() => {
    const element = container.current;
    let disposed = false;
    let logout: (() => Promise<void>) | undefined;
    void import("@stripe/connect-js/pure")
      .then(({ loadConnectAndInitialize }) => {
        if (disposed) return;
        const instance = loadConnectAndInitialize({
          publishableKey,
          fetchClientSecret: async () => {
            const r = await stripeBannerSessionAction();
            if (!r.ok) throw new Error(r.error.message);
            return r.data.clientSecret;
          },
        });
        logout = instance.logout;
        const banner = instance.create("notification-banner");
        banner.setOnLoadError(() => {
          if (!disposed)
            setMessage(
              "Stripe account requirements could not load. Open your Stripe Dashboard to check them.",
            );
        });
        element?.appendChild(banner);
      })
      .catch(() => {
        if (!disposed)
          setMessage(
            "Open your Stripe Dashboard to check account requirements.",
          );
      });
    return () => {
      disposed = true;
      element?.replaceChildren();
      void logout?.().catch(() => {});
    };
  }, [publishableKey]);
  return (
    <section aria-label="Stripe account requirements">
      <div ref={container} />
      {message && <p role="status">{message}</p>}
    </section>
  );
}
