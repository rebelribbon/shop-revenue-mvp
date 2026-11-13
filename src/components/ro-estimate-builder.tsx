"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { JobInput } from "@/domain/jobs";
import { createJobAction } from "@/server/actions/jobs";
import { useActionHydration } from "./action-hydration";

type Part = JobInput["parts"][number];
type Labor = JobInput["labor"][number];
type Repair = {
  id: string;
  name: string;
  labor: Labor;
  parts: Part[];
};

const dollars = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
const cents = (value: string) => Math.round(Number(value || 0) * 100);
const amount = (value: number | null) => value === null ? "" : String(value / 100);
const partPrefix = (name: string) => name.slice(0, 130) + " · ";

function fromJob(input: JobInput): Repair[] {
  const labor = input.labor.length ? input.labor : [];
  const repairs: Repair[] = labor.map((line, index) => ({
    id: "labor-" + index,
    name: line.description,
    labor: { ...line },
    parts: [],
  }));
  const ungrouped: Part[] = [];
  for (const part of input.parts) {
    const group = repairs.find((repair) =>
      part.description.startsWith(partPrefix(repair.name)),
    );
    if (group) {
      group.parts.push({
        ...part,
        description: part.description.slice(partPrefix(group.name).length),
      });
    } else {
      ungrouped.push(part);
    }
  }
  if (ungrouped.length) {
    if (repairs.length) repairs[0].parts.push(...ungrouped);
    else repairs.push({
      id: "existing-parts",
      name: "Additional work",
      labor: {
        description: "Additional work",
        estimatedHoursHundredths: 0,
        actualHoursHundredths: null,
        sellRateCents: 0,
        costRateCents: 0,
      },
      parts: ungrouped,
    });
  }
  return repairs;
}

function newRepair(index: number, rate: number, cost: number): Repair {
  return {
    id: "new-" + index + "-" + crypto.randomUUID(),
    name: "",
    labor: {
      description: "",
      estimatedHoursHundredths: 100,
      actualHoursHundredths: null,
      sellRateCents: rate,
      costRateCents: cost,
    },
    parts: [],
  };
}

export function RoEstimateBuilder({
  initial,
  laborRateCents = 0,
  laborCostCents = 0,
  partsTaxable = true,
}: {
  initial: JobInput;
  laborRateCents?: number;
  laborCostCents?: number;
  partsTaxable?: boolean;
}) {
  const ready = useActionHydration();
  const router = useRouter();
  const [repairs, setRepairs] = useState<Repair[]>(() => fromJob(initial));
  const [activeIndex, setActiveIndex] = useState(0);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());

  function change(id: string, callback: (repair: Repair) => Repair) {
    setRepairs((current) => current.map((r) => r.id === id ? callback(r) : r));
    setMessage("");
  }
  const total = repairs.reduce((sum, repair) =>
    sum +
    Math.round(repair.labor.estimatedHoursHundredths * repair.labor.sellRateCents / 100) +
    repair.parts.reduce((n, p) => n + Math.round(p.quantity * p.unitPriceCents), 0), 0);
  const valid = repairs.length > 0 && repairs.every((r) =>
    !!r.name.trim() && r.name.length <= 130 &&
    r.labor.estimatedHoursHundredths >= 0 &&
    r.labor.sellRateCents >= 0 &&
    (r.labor.fromInspection ? r.labor.sellRateCents > 0 && r.labor.costRateCents !== null : true) &&
    r.parts.every((p) => !!p.description.trim() && p.quantity > 0 &&
      p.unitPriceCents >= 0 && p.unitCostCents !== null),
  );

  async function save() {
    if (!valid || !ready || pending || !initial.jobId) return;
    setPending(true);
    setMessage("");
    try {
      const saved = await createJobAction({
        ...initial,
        parts: repairs.flatMap((r) =>
          r.parts.map((p) => ({
            ...p,
            description: (partPrefix(r.name) + p.description.trim()).slice(0, 200),
            fromInspection: Boolean(r.labor.fromInspection),
          })),
        ),
        labor: repairs.map((r) => ({
          ...r.labor,
          description: r.name.trim(),
        })),
        clientRequestId: requestId,
      });
      if (!saved.ok) {
        setMessage(saved.error.message);
        return;
      }
      setRequestId(crypto.randomUUID());
      router.push(`/app/jobs?job=${encodeURIComponent(initial.jobId)}&tab=estimate&saved=1#job-estimate`);
      router.refresh();
    } catch {
      setMessage("Could not save the estimate. Your entries are still here.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section className="ro-estimate-builder" data-ux-ready={ready}>
      <header>
        <p className="muted">STEP 1 OF 3 · ADVISOR PRICING</p>
        <h2>Build the estimate</h2>
        <p>One RO, one assigned technician. Price each repair with parts and labor, then review the completed estimate before sending.</p>
        <p className="muted">Repair {Math.min(activeIndex + 1, Math.max(repairs.length, 1))} of {repairs.length || 1}</p>
      </header>

      {repairs.map((repair, index) => index !== activeIndex ? null : (
        <section key={repair.id} className="ro-estimate-repair" aria-label={`Repair ${index + 1}`}>
          <div className="ro-estimate-repair-head">
            <h3>Repair {index + 1}</h3>
            <button type="button" className="btn secondary"
              onClick={() => {
                setRepairs((current) => current.filter((r) => r.id !== repair.id));
                setActiveIndex((current) => Math.max(0, current - (index === repairs.length - 1 ? 1 : 0)));
              }}
              disabled={!ready || pending}>Remove</button>
          </div>
          <label>
            Recommended service
            <input required maxLength={130} value={repair.name}
              onChange={(e) => change(repair.id, (r) => ({ ...r, name: e.target.value }))}
              placeholder="Example: Replace leaking upper radiator hose" />
          </label>

          <fieldset className="ro-estimate-line">
            <legend>Labor</legend>
            <div className="ro-estimate-numbers">
              <label>Hours
                <input type="number" min="0" max="1000" step=".01" inputMode="decimal"
                  value={amount(repair.labor.estimatedHoursHundredths)}
                  onChange={(e) => change(repair.id, (r) => ({
                    ...r, labor: { ...r.labor, estimatedHoursHundredths: cents(e.target.value) },
                  }))} />
              </label>
              <label>Customer rate / hr ($)
                <input type="number" min="0" max="100000" step=".01" inputMode="decimal"
                  value={amount(repair.labor.sellRateCents)}
                  onChange={(e) => change(repair.id, (r) => ({
                    ...r, labor: { ...r.labor, sellRateCents: cents(e.target.value) },
                  }))} />
              </label>
              <label>Shop cost / hr ($)
                <input type="number" min="0" max="100000" step=".01" inputMode="decimal"
                  value={amount(repair.labor.costRateCents)}
                  onChange={(e) => change(repair.id, (r) => ({
                    ...r, labor: { ...r.labor,
                      costRateCents: e.target.value === "" ? null : cents(e.target.value) },
                  }))} placeholder="Required" />
              </label>
            </div>
          </fieldset>

          <fieldset className="ro-estimate-line">
            <legend>Parts</legend>
            {repair.parts.map((part, partIndex) => (
              <div className="ro-estimate-part" key={partIndex}>
                <label>Part
                  <input required maxLength={65} value={part.description}
                    placeholder="Example: Upper radiator hose"
                    onChange={(e) => change(repair.id, (r) => ({
                      ...r,
                      parts: r.parts.map((p, i) => i === partIndex
                        ? { ...p, description: e.target.value } : p),
                    }))} />
                </label>
                <div className="ro-estimate-numbers">
                  <label>Qty
                    <input type="number" min=".01" step=".01" max="10000" inputMode="decimal"
                      value={part.quantity}
                      onChange={(e) => change(repair.id, (r) => ({
                        ...r, parts: r.parts.map((p, i) => i === partIndex
                          ? { ...p, quantity: Number(e.target.value) } : p),
                      }))} />
                  </label>
                  <label>Customer unit price ($)
                    <input type="number" min="0" max="100000" step=".01" inputMode="decimal"
                      value={amount(part.unitPriceCents)}
                      onChange={(e) => change(repair.id, (r) => ({
                        ...r, parts: r.parts.map((p, i) => i === partIndex
                          ? { ...p, unitPriceCents: cents(e.target.value) } : p),
                      }))} />
                  </label>
                  <label>Shop unit cost ($)
                    <input type="number" min="0" max="100000" step=".01" inputMode="decimal"
                      value={amount(part.unitCostCents)}
                      placeholder="Required"
                      onChange={(e) => change(repair.id, (r) => ({
                        ...r, parts: r.parts.map((p, i) => i === partIndex
                          ? { ...p, unitCostCents: e.target.value === "" ? null : cents(e.target.value) } : p),
                      }))} />
                  </label>
                </div>
                <button className="btn secondary" type="button" disabled={!ready || pending}
                  onClick={() => change(repair.id, (r) => ({
                    ...r, parts: r.parts.filter((_, i) => i !== partIndex),
                  }))}>Remove part</button>
              </div>
            ))}
            <button type="button" className="btn secondary" disabled={!ready || pending}
              onClick={() => change(repair.id, (r) => ({
                ...r, parts: [...r.parts, {
                  description: "",
                  quantity: 1,
                  unitCostCents: null,
                  unitPriceCents: 0,
                  taxable: partsTaxable,
                }],
              }))}>+ Add part to this repair</button>
            {!repair.parts.length && <p className="muted">No parts needed? Labor-only work is allowed.</p>}
          </fieldset>
          <p className="ro-estimate-total">Repair subtotal: <strong>{dollars(
            Math.round(repair.labor.estimatedHoursHundredths * repair.labor.sellRateCents / 100) +
            repair.parts.reduce((n, p) => n + Math.round(p.quantity * p.unitPriceCents), 0)
          )}</strong></p>
        </section>
      ))}

      <div className="ro-estimate-repair-nav">
        {activeIndex > 0 && (
          <button type="button" className="btn secondary" disabled={!ready || pending}
            onClick={() => setActiveIndex((i) => i - 1)}>Previous repair</button>
        )}
        {activeIndex < repairs.length - 1 && (
          <button type="button" className="btn primary" disabled={!ready || pending}
            onClick={() => setActiveIndex((i) => i + 1)}>Next repair</button>
        )}
        <button type="button" className="btn secondary" disabled={!ready || pending}
          onClick={() => {
            setRepairs((current) => [
              ...current, newRepair(current.length + 1, laborRateCents, laborCostCents),
            ]);
            setActiveIndex(repairs.length);
          }}>+ Add another repair</button>
      </div>
      {activeIndex === repairs.length - 1 && (
      <section className="ro-estimate-save">
        <p>Customer subtotal (before tax): <strong>{dollars(total)}</strong></p>
        <p className="muted">Save the pricing, then review the customer-facing estimate and documents before sending.</p>
        {!valid && (
          <p className="notice" role="note">Enter each repair name and its prices. For recommended repairs, a labor rate and internal cost are required. Every added part also needs a cost and selling price.</p>
        )}
        <button type="button" className="btn primary"
          disabled={!ready || pending || !valid}
          onClick={() => void save()}>
          {pending ? "Saving…" : "Save and preview estimate"}
        </button>
        <p role="status">{message}</p>
        <Link className="btn secondary" href={`/app/jobs?job=${initial.jobId}`}>Back to RO</Link>
      </section>
      )}
    </section>
  );
}
