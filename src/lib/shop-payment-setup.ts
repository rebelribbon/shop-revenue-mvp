import { stripeConnectConfigured } from "./stripe-connect";
import { stripeLivemode } from "./stripe";

type Connection = {
  accountId: string | null;
  cardPaymentsStatus: string;
  livemode: boolean;
};

// Only non-secret setup state may be serialized into the owner's workspace.
export function shopPaymentSetup(
  connection: Connection | null,
  readOnly = false,
) {
  const configured = Boolean(
    process.env.STRIPE_SECRET_KEY &&
    process.env.STRIPE_WEBHOOK_SECRET &&
    process.env.PAYMENTS_BASE_URL,
  );
  const connected = Boolean(
    connection?.accountId && connection.cardPaymentsStatus !== "disconnected",
  );
  const matchingMode = !connection || connection.livemode === stripeLivemode();
  return {
    connected,
    active:
      connected && matchingMode && connection?.cardPaymentsStatus === "active",
    available:
      configured && matchingMode && (connected || stripeConnectConfigured()),
    platformPending: !connected && !stripeConnectConfigured(),
    livemode: stripeLivemode(),
    readOnly,
  };
}
