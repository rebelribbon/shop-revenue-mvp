import { notFound } from "next/navigation";
import { ActionForm } from "@/components/action-form";
import { getWebhookEvent } from "@/domain/webhooks";
import { replayWebhookAction } from "@/server/actions/admin";
import { requireInternal } from "@/server/views/admin";

export default async function WebhookDetail({ params }: { params: Promise<{ id: string }> }) {
  await requireInternal("admin");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const e = await getWebhookEvent(id);
  if (!e) notFound();
  return (
    <main id="main-content" tabIndex={-1}>
      <h1>{e.provider} · {e.eventType}</h1>
      <div className="card">
        <p>Status <span className="pill">{e.status}</span> · attempts {e.attempts} · provider event {e.providerEventId}</p>
        {e.lastError && <p className="notice error">Last error: {e.lastError}</p>}
        {e.nextAttemptAt && <p className="muted">Next attempt {e.nextAttemptAt.toISOString()}</p>}
        {e.status !== "received" && e.status !== "processing" && (
          <ActionForm action={replayWebhookAction} hidden={{ eventId: e.id }} submitLabel="Replay"
            confirm={e.status === "applied" ? "This event was already applied; replaying is a no-op." : "Re-queue this event for processing?"}
            successText="Queued. Refresh to see the result." />
        )}
      </div>
      <h2>Payload</h2>
      <pre>{JSON.stringify(e.payload, null, 2)}</pre>
    </main>
  );
}

