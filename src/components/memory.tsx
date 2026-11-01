import { ActionForm } from "./action-form";
import {
  addNoteAction,
  editNoteAction,
  deleteNoteAction,
} from "@/server/actions/memory";
import type { listNotes, listReadings } from "@/domain/memory";

export function Notes({
  customerId,
  vehicleId,
  notes,
}: {
  customerId: string;
  vehicleId?: string;
  notes: Awaited<ReturnType<typeof listNotes>>;
}) {
  return (
    <section aria-label="Note entries">
      <h2>Notes</h2>
      <div className="card">
        <ActionForm
          action={addNoteAction}
          hidden={{ customerId, ...(vehicleId ? { vehicleId } : {}) }}
          submitLabel="Add note"
        >
          <label htmlFor="new-note">New note</label>
          <textarea
            id="new-note"
            name="body"
            rows={3}
            required
            maxLength={5000}
          />
        </ActionForm>
      </div>
      {notes.map((n) => (
        <article className="card" key={n.id}>
          <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
            {n.body}
          </p>
          <details>
            <summary>Edit or remove note</summary>
            <ActionForm
              action={editNoteAction}
              hidden={{
                customerId,
                noteId: n.id,
                expectedUpdatedAt: n.updatedAt.toISOString(),
              }}
              submitLabel="Save note"
            >
              <label htmlFor={`note-${n.id}`}>Note text</label>
              <textarea
                id={`note-${n.id}`}
                name="body"
                rows={3}
                defaultValue={n.body}
                required
                maxLength={5000}
              />
            </ActionForm>
            <ActionForm
              action={deleteNoteAction}
              hidden={{
                customerId,
                noteId: n.id,
                expectedUpdatedAt: n.updatedAt.toISOString(),
              }}
              submitLabel="Remove note"
              variant="danger"
              confirm="Remove this note? Its earlier text remains in history."
            />
          </details>
        </article>
      ))}
    </section>
  );
}
export function Readings({
  readings,
}: {
  readings: Awaited<ReturnType<typeof listReadings>>;
}) {
  return (
    <section>
      <h2>Mileage history</h2>
      <div className="card">
        {readings.length ? (
          <ol>
            {readings.map((r) => (
              <li key={r.id}>
                {r.value.toLocaleString()} mi —{" "}
                {r.readOn.toLocaleString("en-US", {
                  timeZone: "America/Chicago",
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </li>
            ))}
          </ol>
        ) : (
          <p className="muted">No mileage recorded yet.</p>
        )}
        <p className="muted">
          Readings are permanent. Correct a mistake by recording a new reading.
        </p>
      </div>
    </section>
  );
}
export function NoteRevision({ data }: { data: unknown }) {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  if (!("text" in d || "before" in d || "after" in d)) return null;
  return (
    <details>
      <summary>View note text</summary>
      {typeof d.text === "string" && (
        <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          {d.text}
        </p>
      )}
      {"before" in d && (
        <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          <strong>Before: </strong>
          {typeof d.before === "string" ? d.before : "Empty"}
        </p>
      )}
      {"after" in d && (
        <p style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>
          <strong>After: </strong>
          {typeof d.after === "string" ? d.after : "Removed"}
        </p>
      )}
    </details>
  );
}
