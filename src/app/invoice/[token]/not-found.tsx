import { HydratedMain } from "@/components/hydrated-main";
// Customers reach this from an old, replaced or expired link the shop sent.
// It must not point them at the shop's workspace or imply they did something wrong.
export default function NotFound() {
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>This invoice link is no longer active</h1>
      <p>
        It may have expired or been replaced with a newer version. Please
        contact the shop that sent it and ask them to send you a new link.
      </p>
    </HydratedMain>
  );
}
