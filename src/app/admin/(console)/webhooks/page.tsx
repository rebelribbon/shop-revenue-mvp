import Link from "next/link";
import { listWebhookEvents } from "@/domain/webhooks";
import { requireInternal } from "@/server/views/admin";

const STATUSES = ["received", "processing", "applied", "ignored", "failed", "dead"];

// I4 Webhook events: filter by provider/status, open to view payload and replay.
export default async function Webhooks({ searchParams }: { searchParams: Promise<{ provider?: string; status?: string }> }) {
  await requireInternal("admin");
  const sp = await searchParams;
  const provider = ["stripe", "twilio", "postmark"].includes(sp.provider ?? "") ? sp.provider : undefined;
  const status = STATUSES.includes(sp.status ?? "") ? sp.status : undefined;
  const events = await listWebhookEvents({ provider, status });
  return (
    <main>
      <h1>Webhook events</h1>
      <form className="row card" method="get">
        <select name="provider" defaultValue={provider ?? ""} aria-label="Provider">
          <option value="">All providers</option><option>stripe</option><option>twilio</option><option>postmark</option>
        </select>
        <select name="status" defaultValue={status ?? ""} aria-label="Status">
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <button className="btn secondary">Filter</button>
      </form>
      <div className="card table-wrap">
        {events.length === 0 ? <p>No events.</p> : (
          <table>
            <thead><tr><th>Received</th><th>Provider</th><th>Type</th><th>Status</th><th>Attempts</th></tr></thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td><Link href={`/admin/webhooks/${e.id}`}>{e.receivedAt.toISOString()}</Link></td>
                  <td>{e.provider}</td>
                  <td>{e.eventType}</td>
                  <td><span className="pill">{e.status}</span></td>
                  <td>{e.attempts}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
