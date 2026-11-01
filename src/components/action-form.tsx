"use client";
import { useActionHydration } from "./action-hydration";
// Calls a shop server action with a clientRequestId generated when the form opens
// (Section 10 idempotency). Shows typed errors with the reference ID; keeps input.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition, type ReactNode } from "react";

type ActionError = {
  code: string;
  message: string;
  referenceId: string;
  fields?: Record<string, string>;
  duplicate?: { id: string; name: string };
};
type Result = { ok: true; data: unknown } | { ok: false; error: ActionError };

export function ActionForm(props: {
  action: (input: Record<string, unknown>) => Promise<Result>;
  hidden?: Record<string, string>;
  submitLabel: string;
  pendingLabel?: string;
  confirm?: string;
  // Shown on success unless the action's result carries its own `message`.
  successText?: string;
  variant?: "primary" | "danger" | "secondary";
  children?: ReactNode;
}) {
  const ready = useActionHydration();
  const router = useRouter();
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [pending, start] = useTransition();
  const [message, setMessage] = useState<{
    kind: "ok" | "error";
    text: string;
  } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [duplicate, setDuplicate] = useState<ActionError["duplicate"]>();
  const formRef = useRef<HTMLFormElement>(null);

  async function submit(form: HTMLFormElement, extra?: Record<string, string>) {
    const data = Object.fromEntries(new FormData(form));
    setDuplicate(undefined);
    start(async () => {
      const r = await props.action({
        ...data,
        ...props.hidden,
        ...extra,
        // A different request: the first attempt was rejected as a duplicate.
        clientRequestId: extra ? crypto.randomUUID() : requestId,
      });
      if (r.ok) {
        const to = (r.data as { redirectTo?: unknown } | null)?.redirectTo;
        if (typeof to === "string" && to.startsWith("/"))
          return router.push(to);
        const own = (r.data as { message?: unknown } | null)?.message;
        setMessage({
          kind: "ok",
          text: typeof own === "string" ? own : (props.successText ?? "Saved."),
        });
        setRequestId(crypto.randomUUID());
        form.reset();
        router.refresh();
      } else {
        const fields = r.error.fields
          ? ` ${Object.values(r.error.fields).join(" ")}`
          : "";
        setDuplicate(r.error.duplicate);
        setMessage({
          kind: "error",
          text: r.error.duplicate
            ? r.error.message
            : `${r.error.message}${fields} (reference ${r.error.referenceId})`,
        });
      }
      setConfirming(false);
    });
  }

  return (
    <form
      ref={formRef}
      data-ux-ready={ready}
      className="action-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (props.confirm && !confirming) return setConfirming(true);
        void submit(e.currentTarget);
      }}
    >
      <fieldset className="hydration-fields" disabled={!ready}>
        {props.children}
        {confirming && <p className="confirm">{props.confirm}</p>}
        <button
          data-destructive={props.variant === "danger" ? "true" : undefined}
          className={`btn ${props.variant ?? "secondary"}`}
          type="submit"
          disabled={pending}
        >
          {pending
            ? (props.pendingLabel ?? "Working…")
            : confirming
              ? "Yes, continue"
              : props.submitLabel}
        </button>
        {message && (
          <p
            role="status"
            className={message.kind === "ok" ? "notice ok" : "notice error"}
          >
            {message.text}
          </p>
        )}
        {duplicate && (
          <div className="money-actions">
            <Link
              className="btn primary"
              href={`/app/customers/${duplicate.id}`}
            >
              Open {duplicate.name}
            </Link>
            <button
              type="button"
              className="btn secondary"
              disabled={pending}
              onClick={() =>
                formRef.current &&
                void submit(formRef.current, { allowDuplicate: "true" })
              }
            >
              Add as a separate customer
            </button>
          </div>
        )}
      </fieldset>
    </form>
  );
}
