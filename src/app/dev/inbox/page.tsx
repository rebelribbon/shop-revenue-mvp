import { notFound } from "next/navigation";
import { readDevInbox } from "@/providers/messaging";

export const dynamic = "force-dynamic";

// Local/test only (Section 23): messages sent through the fake messaging adapter.
export default function DevInbox() {
  if (
    !["local", "test"].includes(process.env.APP_ENV ?? "") ||
    (process.env.MESSAGING_PROVIDER ?? "fake") !== "fake"
  )
    notFound();
  const messages = readDevInbox();
  return (
    <main id="main-content" tabIndex={-1}>
      <h1>Dev SMS inbox</h1>
      <p className="muted">
        Fake messaging adapter. Nothing here was sent to a real phone.
      </p>
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>At</th>
              <th>To</th>
              <th>Body</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((m) => (
              <tr key={m.id}>
                <td>{m.at}</td>
                <td>{m.to}</td>
                <td>{m.body}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
