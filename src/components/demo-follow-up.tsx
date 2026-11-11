"use client";

import Link from "next/link";
import { useState } from "react";
import type { DemoCustomer } from "@/lib/demo-customers";
import {
  CONTACT_TASK_KINDS,
  contactTaskAction,
  contactTaskLabels,
  type ContactKind,
} from "@/lib/task-action";
import { addLocalDays, formatDateOnly } from "@/lib/timezone";
import { RecordSection } from "./record-section";

export function DemoFollowUp({
  customer,
  today,
}: {
  customer: DemoCustomer;
  today: string;
}) {
  const [method, setMethod] = useState<ContactKind>("call");
  const [dueOn, setDueOn] = useState(today);
  const [saved, setSaved] = useState(false);
  const [result, setResult] = useState("");
  const [done, setDone] = useState(false);
  const action = contactTaskAction(method, {
    phone: `+1${customer.contact.replace(/\D/g, "")}`,
    email: customer.email,
    textAllowed: true,
  });
  return (
    <RecordSection title={saved ? "Sample follow-up" : "Add a follow-up"}>
      <p>
        {customer.name} · RO #{customer.roNumber} · {customer.asset}
      </p>
      {!saved ? (
        <form
          className="demo-customer-form"
          onSubmit={(event) => {
            event.preventDefault();
            setSaved(true);
          }}
        >
          <label>
            How will you follow up?
            <select
              value={method}
              onChange={(event) => setMethod(event.target.value as ContactKind)}
            >
              {CONTACT_TASK_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {contactTaskLabels[kind]}
                </option>
              ))}
            </select>
          </label>
          <label>
            Due date
            <input
              type="date"
              required
              value={dueOn}
              onChange={(event) => setDueOn(event.target.value)}
            />
          </label>
          <button className="btn primary" type="submit">
            Save follow-up
          </button>
        </form>
      ) : (
        <>
          <p role="status">
            {result || "Follow-up scheduled in this preview."}
          </p>
          {!done && (
            <>
              <p className="muted">Due {formatDateOnly(dueOn)}</p>
              <div className="task-actions sample-task-actions">
                {action && (
                  <a className="btn secondary" href={action.href}>
                    {action.label}
                  </a>
                )}
                {method === "call" ? (
                  <>
                    <button
                      className="btn secondary"
                      type="button"
                      onClick={() => {
                        setDone(true);
                        setResult(
                          "Reached customer. Call recorded in this preview.",
                        );
                      }}
                    >
                      Reached
                    </button>
                    <button
                      className="btn secondary"
                      type="button"
                      onClick={() => {
                        setDueOn(addLocalDays(today, 1));
                        setResult("No answer recorded. Follow up tomorrow.");
                      }}
                    >
                      No answer · try tomorrow
                    </button>
                  </>
                ) : (
                  <button
                    className="btn secondary"
                    type="button"
                    onClick={() => {
                      setDone(true);
                      setResult("Follow-up completed in this preview.");
                    }}
                  >
                    Done
                  </button>
                )}
              </div>
              {method === "call" && (
                <details className="task-outcome-note">
                  <summary>Reached with a note</summary>
                  <form
                    className="demo-customer-form"
                    onSubmit={(event) => {
                      event.preventDefault();
                      const note = String(
                        new FormData(event.currentTarget).get("note") ?? "",
                      ).trim();
                      setDone(true);
                      setResult(
                        note
                          ? `Reached customer — ${note}`
                          : "Reached customer. Call recorded in this preview.",
                      );
                    }}
                  >
                    <label>
                      Call note
                      <textarea name="note" maxLength={300} rows={2} />
                    </label>
                    <button type="submit" className="btn secondary">
                      Save call outcome
                    </button>
                  </form>
                </details>
              )}
            </>
          )}
        </>
      )}
      <Link href={`/demo/job?customer=${customer.id}`}>Back to RO</Link>
    </RecordSection>
  );
}
