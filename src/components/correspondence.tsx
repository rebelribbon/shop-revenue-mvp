"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";
import { recordCorrespondenceAction } from "@/server/actions/correspondence";
import {
  channelLabels,
  correspondenceChannels,
  outcomeLabels,
  outcomesFor,
  type CorrespondenceChannel,
  type CorrespondenceOutcome,
  type CorrespondenceTarget,
} from "@/lib/correspondence";

type Entry = CorrespondenceTarget & {
  channel?: CorrespondenceChannel;
  purpose?: string;
  prompt?: boolean;
  openingFailed?: boolean;
};
const ContactLog = createContext<
  ((entry: Entry, opened?: boolean) => void) | null
>(null);
export const useContactLog = () => useContext(ContactLog);

export function CorrespondenceProvider({ children }: { children: ReactNode }) {
  const [entry, setEntry] = useState<(Entry & { id: string }) | null>(null);
  const start = (target: Entry, opened = false) => {
    const id = crypto.randomUUID();
    if (target.prompt !== false) setEntry({ ...target, id });
    if (opened && target.channel) {
      const { customerId, jobId, documentId, documentKind, channel } = target;
      const input = {
        customerId,
        jobId,
        documentId,
        documentKind,
        channel,
        outcome: "opened",
        clientRequestId: id,
      };
      // Keep the native link's tap gesture. Reuse the same request ID if the
      // first request is interrupted while switching apps.
      const save = () => recordCorrespondenceAction(input).catch(() => null);
      void save().then(async (result) => {
        const saved = result ?? (await save());
        if (!saved?.ok)
          setEntry((current) =>
            current?.id === id ? { ...current, openingFailed: true } : current,
          );
      });
    }
  };
  return (
    <ContactLog.Provider value={start}>
      {children}
      {entry && (
        <CorrespondenceDialog
          key={entry.id}
          entry={entry}
          close={() => setEntry(null)}
        />
      )}
    </ContactLog.Provider>
  );
}

function CorrespondenceDialog({
  entry,
  close,
}: {
  entry: Entry;
  close: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const [channel, setChannel] = useState(entry.channel ?? "text");
  const [outcome, setOutcome] = useState<CorrespondenceOutcome>(
    outcomesFor(channel)[0],
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [requestId] = useState(() => crypto.randomUUID());
  useEffect(() => {
    if (!dialog.current?.open) dialog.current?.showModal();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="quick-find correspondence-dialog"
      aria-labelledby="correspondence-heading"
      onClose={close}
      onCancel={(event) => {
        if (pending) event.preventDefault();
      }}
    >
      <h2 id="correspondence-heading">Log customer contact</h2>
      <p>
        Record what happened, including messages or replies on your personal
        phone.
      </p>
      {entry.openingFailed && (
        <p role="status">
          The shortcut click could not be saved. You can still log what
          happened.
        </p>
      )}
      <form
        onSubmit={async (event) => {
          event.preventDefault();
          const summary = String(
            new FormData(event.currentTarget).get("summary") ?? "",
          );
          const { customerId, jobId, documentId, documentKind } = entry;
          setPending(true);
          setError("");
          try {
            const result = await recordCorrespondenceAction({
              customerId,
              jobId,
              documentId,
              documentKind,
              channel,
              outcome,
              summary,
              clientRequestId: requestId,
            });
            if (result.ok) {
              close();
              router.refresh();
            } else setError(result.error.message);
          } catch {
            setError("Could not save the entry. Try again.");
          } finally {
            setPending(false);
          }
        }}
      >
        <label htmlFor="contact-channel">Contact method</label>
        <select
          id="contact-channel"
          value={channel}
          onChange={(event) => {
            const value = event.target.value as CorrespondenceChannel;
            setChannel(value);
            setOutcome(outcomesFor(value)[0]);
          }}
        >
          {correspondenceChannels.map((value) => (
            <option key={value} value={value}>
              {channelLabels[value]}
            </option>
          ))}
        </select>
        <label htmlFor="contact-outcome">What happened?</label>
        <select
          id="contact-outcome"
          value={outcome}
          onChange={(event) =>
            setOutcome(event.target.value as CorrespondenceOutcome)
          }
        >
          {outcomesFor(channel).map((value) => (
            <option key={value} value={value}>
              {outcomeLabels[value]}
            </option>
          ))}
        </select>
        <label htmlFor="contact-summary">
          Short summary{outcome === "no_answer" ? " (optional)" : ""}
        </label>
        <textarea
          id="contact-summary"
          name="summary"
          rows={3}
          maxLength={1000}
          required={outcome !== "no_answer"}
          placeholder={entry.purpose || "What did you or the customer say?"}
        />
        {error && <p role="alert">{error}</p>}
        <div className="job-follow-up-shortcuts">
          <button
            type="submit"
            className="btn primary"
            data-page-primary
            disabled={pending}
          >
            {pending ? "Saving…" : "Save to history"}
          </button>
          <button
            type="button"
            className="btn secondary"
            disabled={pending}
            onClick={() => dialog.current?.close()}
          >
            Close
          </button>
        </div>
      </form>
    </dialog>
  );
}

export function ContactLaunchLink({
  contact,
  channel,
  purpose,
  prompt,
  ...props
}: ComponentProps<"a"> & {
  contact?: CorrespondenceTarget;
  channel: CorrespondenceChannel;
  purpose?: string;
  prompt?: boolean;
}) {
  const log = useContactLog();
  return (
    <a
      {...props}
      onClick={(event) => {
        props.onClick?.(event);
        if (!event.defaultPrevented && props.href && contact)
          log?.({ ...contact, channel, purpose, prompt }, true);
      }}
    />
  );
}

export function LogContactButton({ target }: { target: CorrespondenceTarget }) {
  const log = useContactLog();
  if (!log) return null;
  return (
    <button type="button" className="btn secondary" onClick={() => log(target)}>
      Log contact
    </button>
  );
}
