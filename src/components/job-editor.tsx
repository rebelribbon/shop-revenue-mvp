"use client";
import { useActionHydration } from "./action-hydration";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { isAutomotive } from "@/lib/business-types";
import { createJobAction } from "@/server/actions/jobs";
import { saveCommonJobAction } from "@/server/actions/owner-tools";
import { calculateJob } from "@/domain/job-costing";
import type { JobInput } from "@/domain/jobs";
import type { CatalogPart } from "@/domain/parts";
import { CustomerPicker } from "./customer-picker";
import { RepeatPicker } from "./repeat-picker";
import { updateMediaAction } from "@/server/actions/job-media";
import type { Repeat } from "@/lib/service-plans";
export type JobOptions = {
  customers: { id: string; name: string }[];
  vehicles: {
    id: string;
    customerId: string;
    year: number | null;
    make: string | null;
    model: string | null;
  }[];
  serviceAssets: { id: string; customerId: string; displayName: string }[];
};
export type CommonJobChoice = {
  id: string;
  name: string;
  parts: JobInput["parts"];
  labor: JobInput["labor"];
};
export const money = (c: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    c / 100,
  );
export function JobEditor({
  options,
  initial,
  recommendations = [],
  businessType = "automotive",
  partsTaxableDefault = true,
  laborTaxableDefault = false,
  laborSellRateCents = 0,
  laborCostRateCents = 0,
  commonJobs = [],
  catalog = [],
  canSaveCommon = false,
  today,
  defaultRepeats = false,
  attachMediaId,
}: {
  options: JobOptions;
  initial?: JobInput;
  recommendations?: {
    id: string;
    description: string;
    vehicleId: string | null;
    customerId: string;
    serviceAssetId: string | null;
  }[];
  businessType?: string;
  partsTaxableDefault?: boolean;
  laborTaxableDefault?: boolean;
  laborSellRateCents?: number;
  laborCostRateCents?: number;
  commonJobs?: CommonJobChoice[];
  catalog?: CatalogPart[];
  canSaveCommon?: boolean;
  today: string;
  defaultRepeats?: boolean;
  attachMediaId?: string;
}) {
  const ready = useActionHydration();
  const router = useRouter();
  const [customerId, setCustomer] = useState(initial?.customerId ?? ""),
    [vehicleId, setVehicle] = useState(() => {
      if (initial?.vehicleId) return initial.vehicleId;
      const own = options.vehicles.filter(
        (v) => v.customerId === initial?.customerId,
      );
      return own.length === 1 && !initial?.serviceAssetId ? own[0].id : "";
    }),
    [serviceAssetId, setServiceAsset] = useState(() => {
      if (initial?.serviceAssetId) return initial.serviceAssetId;
      const own = options.serviceAssets.filter(
        (a) => a.customerId === initial?.customerId,
      );
      return own.length === 1 && !initial?.vehicleId ? own[0].id : "";
    }),
    [title, setTitle] = useState(initial?.title ?? ""),
    [warranty, setWarranty] = useState(
      initial?.warrantyMonths ? String(initial.warrantyMonths) : "",
    ),
    [parts, setParts] = useState<JobInput["parts"]>(initial?.parts ?? []),
    [labor, setLabor] = useState<JobInput["labor"]>(initial?.labor ?? []),
    [message, setMessage] = useState(""),
    [pending, setPending] = useState(false),
    [requestId, setRequestId] = useState(() => crypto.randomUUID()),
    [commonId, setCommonId] = useState(""),
    [repeat, setRepeat] = useState<Repeat | null>(
      initial
        ? (initial.repeat ?? null)
        : defaultRepeats
          ? {
              every: "week",
              startOn: today,
              time: null,
              until: { kind: "stopped" },
              billing: "per_visit",
            }
          : null,
    ),
    [showCosts, setShowCosts] = useState(false);
  const auto =
    !!initial?.vehicleId ||
    (!initial?.serviceAssetId && isAutomotive(businessType));
  const matches = recommendations.filter(
    (r) =>
      r.customerId === customerId &&
      (vehicleId
        ? r.vehicleId === vehicleId
        : !!serviceAssetId && r.serviceAssetId === serviceAssetId),
  );
  let totals: ReturnType<typeof calculateJob> | null = null;
  try {
    totals = calculateJob(parts, labor);
  } catch {
    /* An unfinished numeric edit must not crash the page. */
  }
  const valid = !!totals && parts.every((p) => p.quantity > 0);
  const clearLinks = () => {
    setParts((ps) => ps.map((p) => ({ ...p, recommendationId: undefined })));
    setLabor((ls) => ls.map((l) => ({ ...l, recommendationId: undefined })));
  };
  const numberField = (
    label: string,
    value: number | null,
    change: (v: number | null) => void,
    scale = 100,
    optional = false,
  ) => (
    <label>
      {label}
      <input
        type="number"
        min="0"
        max="1000000"
        step={scale === 100 ? "0.01" : "1"}
        required={!optional}
        value={value === null ? "" : value / scale}
        onChange={(e) => {
          if (e.target.value === "") {
            change(optional ? null : 0);
            return;
          }
          const next = Math.round(Number(e.target.value) * scale);
          if (!Number.isSafeInteger(next)) {
            setMessage("Enter a smaller valid number.");
            return;
          }
          change(next);
        }}
      />
    </label>
  );
  const recField = (
    id: string | undefined,
    set: (id: string | undefined) => void,
  ) =>
    matches.length > 0 ? (
      <label>
        Declined-work link
        <select
          value={id ?? ""}
          onChange={(e) => set(e.target.value || undefined)}
        >
          <option value="">Additional work / no recommendation link</option>
          {matches.map((r) => (
            <option key={r.id} value={r.id}>
              {r.description}
            </option>
          ))}
        </select>
      </label>
    ) : null;
  return (
    <form
      data-ux-ready={ready}
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!valid || pending) return;
        setPending(true);
        try {
          const r = await createJobAction({
            ...initial,
            customerId,
            vehicleId: vehicleId || undefined,
            serviceAssetId: serviceAssetId || undefined,
            title,
            repeat,
            warrantyMonths: Number(warranty) > 0 ? Number(warranty) : null,
            parts,
            labor,
            clientRequestId: requestId,
          });
          if (r.ok) {
            setRequestId(crypto.randomUUID());
            if (attachMediaId)
              await updateMediaAction({
                mediaId: attachMediaId,
                jobId: (r.data as { id: string }).id,
                showCustomer: "true",
                clientRequestId: crypto.randomUUID(),
              });
            router.push(
              `/app/jobs?job=${encodeURIComponent((r.data as { id: string }).id)}&saved=1`,
            );
            router.refresh();
          } else setMessage(r.error.message);
        } catch {
          setMessage("Unable to save. Your entries were kept.");
        } finally {
          setPending(false);
        }
      }}
    >
      <fieldset className="hydration-fields" disabled={!ready}>
        <h2>Job details</h2>
        {attachMediaId && (
          <p className="notice" role="note">
            📷 The issue photo will be attached to this job and shown to the
            customer on the estimate.
          </p>
        )}
        {commonJobs.length > 0 && (
          <section>
            <label htmlFor="common-job">Start from a common job</label>
            <select
              id="common-job"
              value={commonId}
              onChange={(e) => setCommonId(e.target.value)}
            >
              <option value="">Choose saved work</option>
              {commonJobs.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn secondary"
              disabled={!commonId}
              onClick={() => {
                if (
                  (parts.length || labor.length) &&
                  !window.confirm(
                    `Replace the current ${auto ? "parts" : "materials"} and labor with this common job?`,
                  )
                )
                  return;
                const c = commonJobs.find((c) => c.id === commonId);
                if (c) {
                  setTitle(c.name);
                  setParts(c.parts.map((p) => ({ ...p })));
                  setLabor(
                    c.labor.map((l) => ({ ...l, actualHoursHundredths: null })),
                  );
                }
              }}
            >
              Use common job
            </button>
          </section>
        )}
        <CustomerPicker
          id="job-customer"
          fixed={!!initial?.customerId}
          options={options.customers}
          value={customerId}
          onChange={(id) => {
            clearLinks();
            setCustomer(id);
            setVehicle("");
            setServiceAsset("");
          }}
        />
        <label htmlFor="job-target">
          {auto ? "Vehicle" : "Property / equipment"}
        </label>
        <select
          id="job-target"
          required
          value={auto ? vehicleId : serviceAssetId}
          onChange={(e) => {
            clearLinks();
            if (auto) setVehicle(e.target.value);
            else setServiceAsset(e.target.value);
          }}
        >
          <option value="">
            {auto ? "Choose vehicle" : "Choose property or equipment"}
          </option>
          {auto
            ? options.vehicles
                .filter((v) => v.customerId === customerId)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {[v.year, v.make, v.model].filter(Boolean).join(" ") ||
                      "Vehicle"}
                  </option>
                ))
            : options.serviceAssets
                .filter((a) => a.customerId === customerId)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.displayName}
                  </option>
                ))}
        </select>
        {customerId &&
          !(auto
            ? options.vehicles.some((v) => v.customerId === customerId)
            : options.serviceAssets.some(
                (a) => a.customerId === customerId,
              )) && (
            <p>
              <Link href={`/app/customers/${customerId}?view=assets`}>
                Add {auto ? "a vehicle" : "a property or equipment"} for this
                customer first
              </Link>
            </p>
          )}
        <label>
          Job name
          <input
            required
            maxLength={200}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label>
          Warranty in months <span className="muted">(optional)</span>
          <input
            inputMode="numeric"
            maxLength={3}
            value={warranty}
            placeholder="12"
            onChange={(e) => setWarranty(e.target.value.replace(/\D/g, ""))}
          />
        </label>
        <RepeatPicker
          value={repeat}
          onChange={setRepeat}
          today={today}
          perVisitCents={totals?.subtotalCents ?? 0}
          profitPerVisitCents={totals?.estimatedGrossProfitCents ?? null}
        />
        <h3>{auto ? "Parts" : "Materials"}</h3>
        {catalog.length > 0 && (
          <datalist id="part-catalog">
            {catalog.map((c) => (
              <option key={c.id} value={c.name}>
                {[
                  c.partNumber && `#${c.partNumber}`,
                  `${c.onHandHundredths / 100} on hand`,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </option>
            ))}
          </datalist>
        )}
        {parts.map((p, i) => (
          <fieldset key={`part-${i}`}>
            <legend>
              {auto ? "Part" : "Material"} {i + 1}
            </legend>
            {recField(p.recommendationId, (id) =>
              setParts(
                parts.map((x, n) =>
                  n === i ? { ...x, recommendationId: id } : x,
                ),
              ),
            )}
            <label>
              Description
              <input
                required
                maxLength={200}
                value={p.description}
                list={catalog.length ? "part-catalog" : undefined}
                onChange={(e) => {
                  const text = e.target.value;
                  const hit = catalog.find(
                    (c) =>
                      c.name.toLowerCase() === text.trim().toLowerCase() ||
                      (c.partNumber &&
                        c.partNumber.toLowerCase() ===
                          text.trim().toLowerCase()),
                  );
                  setParts(
                    parts.map((x, n) =>
                      n !== i
                        ? x
                        : hit
                          ? {
                              ...x,
                              description: hit.name,
                              partItemId: hit.id,
                              unitPriceCents: hit.unitPriceCents,
                              unitCostCents: hit.unitCostCents,
                            }
                          : {
                              ...x,
                              description: text,
                              partItemId: undefined,
                            },
                    ),
                  );
                }}
              />
            </label>
            {p.partItemId &&
              (() => {
                const c = catalog.find((x) => x.id === p.partItemId);
                if (!c) return null;
                const onHand = c.onHandHundredths / 100;
                const low = onHand <= 0;
                return (
                  <p className={low ? "notice" : "muted part-hint"}>
                    From your list · {onHand} on the shelf
                    {low && " — low or out of stock"}
                  </p>
                );
              })()}
            {numberField("Unit selling price", p.unitPriceCents, (v) =>
              setParts(
                parts.map((x, n) =>
                  n === i ? { ...x, unitPriceCents: v ?? 0 } : x,
                ),
              ),
            )}
            <details open={showCosts}>
              <summary>
                {auto ? "Part" : "Material"} costs & quantity
              </summary>
              {numberField("Quantity", Math.round(p.quantity * 100), (v) =>
                setParts(
                  parts.map((x, n) =>
                    n === i ? { ...x, quantity: (v ?? 0) / 100 } : x,
                  ),
                ),
              )}
              {numberField(
                "Unit cost",
                p.unitCostCents,
                (v) =>
                  setParts(
                    parts.map((x, n) =>
                      n === i ? { ...x, unitCostCents: v } : x,
                    ),
                  ),
                100,
                true,
              )}
              <label>
                <input
                  type="checkbox"
                  checked={p.taxable ?? partsTaxableDefault}
                  onChange={(e) =>
                    setParts(
                      parts.map((x, n) =>
                        n === i ? { ...x, taxable: e.target.checked } : x,
                      ),
                    )
                  }
                />
                Taxable item
              </label>
            </details>
            <button
              type="button"
              className="btn secondary"
              onClick={() => setParts(parts.filter((_, n) => n !== i))}
            >
              Remove {auto ? "part" : "material"}
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          className="btn secondary"
          onClick={() =>
            setParts([
              ...parts,
              {
                description: "",
                quantity: 1,
                unitCostCents: null,
                unitPriceCents: 0,
                taxable: partsTaxableDefault,
              },
            ])
          }
        >
          Add {auto ? "part" : "material"}
        </button>
        <h3>Labor</h3>
        {labor.map((l, i) => (
          <fieldset key={`labor-${i}`}>
            <legend>Labor {i + 1}</legend>
            {recField(l.recommendationId, (id) =>
              setLabor(
                labor.map((x, n) =>
                  n === i ? { ...x, recommendationId: id } : x,
                ),
              ),
            )}
            <label>
              Description
              <input
                required
                maxLength={200}
                value={l.description}
                onChange={(e) =>
                  setLabor(
                    labor.map((x, n) =>
                      n === i ? { ...x, description: e.target.value } : x,
                    ),
                  )
                }
              />
            </label>
            {numberField("Quoted hours", l.estimatedHoursHundredths, (v) =>
              setLabor(
                labor.map((x, n) =>
                  n === i ? { ...x, estimatedHoursHundredths: v ?? 0 } : x,
                ),
              ),
            )}
            {numberField("Hourly selling rate", l.sellRateCents, (v) =>
              setLabor(
                labor.map((x, n) =>
                  n === i ? { ...x, sellRateCents: v ?? 0 } : x,
                ),
              ),
            )}
            <details open={showCosts}>
              <summary>Labor time & cost</summary>
              {numberField(
                "Actual hours",
                l.actualHoursHundredths,
                (v) =>
                  setLabor(
                    labor.map((x, n) =>
                      n === i ? { ...x, actualHoursHundredths: v } : x,
                    ),
                  ),
                100,
                true,
              )}
              {numberField(
                "Hourly internal cost",
                l.costRateCents,
                (v) =>
                  setLabor(
                    labor.map((x, n) =>
                      n === i ? { ...x, costRateCents: v } : x,
                    ),
                  ),
                100,
                true,
              )}
              <label>
                <input
                  type="checkbox"
                  checked={l.taxable ?? laborTaxableDefault}
                  onChange={(e) =>
                    setLabor(
                      labor.map((x, n) =>
                        n === i ? { ...x, taxable: e.target.checked } : x,
                      ),
                    )
                  }
                />
                Taxable labor
              </label>
            </details>
            <button
              type="button"
              className="btn secondary"
              onClick={() => setLabor(labor.filter((_, n) => n !== i))}
            >
              Remove labor
            </button>
          </fieldset>
        ))}
        <button
          type="button"
          className="btn secondary"
          onClick={() =>
            setLabor([
              ...labor,
              {
                description: "",
                estimatedHoursHundredths: 100,
                actualHoursHundredths: null,
                sellRateCents: laborSellRateCents,
                costRateCents: laborCostRateCents || null,
                taxable: laborTaxableDefault,
              },
            ])
          }
        >
          Add labor
        </button>
        {totals ? (
          <>
            <p className="money-total" style={{ margin: "0.75rem 0" }}>
              Quoted subtotal: <strong>{money(totals.subtotalCents)}</strong>
              {" · "}
              {totals.estimatedGrossProfitCents === null ? (
                <span className="muted">
                  Gross profit unknown — add costs to see it
                  {totals.missingCosts > 0 &&
                    ` (${totals.missingCosts} ${totals.missingCosts === 1 ? "line" : "lines"} missing)`}
                </span>
              ) : (
                <strong>
                  Gross profit: {money(totals.estimatedGrossProfitCents)}
                  {totals.estimatedMarginBps !== null &&
                    ` (${(totals.estimatedMarginBps / 100).toFixed(1)}%)`}
                </strong>
              )}
            </p>
            <label style={{ display: "block", marginBottom: "0.5rem" }}>
              <input
                type="checkbox"
                checked={showCosts}
                onChange={(e) => setShowCosts(e.target.checked)}
              />{" "}
              Show costs on every line
            </label>
            {showCosts && (
              <p className="muted">
                Estimated cost:{" "}
                {totals.estimatedCostCents === null
                  ? "unknown"
                  : money(totals.estimatedCostCents)}
                {" · "}
                Actual cost:{" "}
                {totals.actualCostCents === null
                  ? "add actual hours"
                  : money(totals.actualCostCents)}
              </p>
            )}
          </>
        ) : (
          <p className="notice error">
            Check negative or unusually large amounts before saving.
          </p>
        )}
        {canSaveCommon && (
          <details>
            <summary>Save as a common job</summary>
            <p>
              Save these parts, prices and labor for next time. Customer details
              are not saved. Up to 25 common jobs.
            </p>
            <button
              type="button"
              className="btn secondary"
              disabled={
                pending ||
                !valid ||
                !title.trim() ||
                (!parts.length && !labor.length)
              }
              onClick={async () => {
                setPending(true);
                try {
                  const r = await saveCommonJobAction({
                    name: title,
                    parts,
                    labor,
                    clientRequestId: crypto.randomUUID(),
                  });
                  setMessage(r.ok ? "Common job saved." : r.error.message);
                  if (r.ok) router.refresh();
                } catch {
                  setMessage("Could not save the common job.");
                } finally {
                  setPending(false);
                }
              }}
            >
              Save common job
            </button>
          </details>
        )}
        <button
          className="btn primary"
          disabled={pending || !valid || (!parts.length && !labor.length)}
        >
          {pending
            ? "Saving…"
            : repeat
              ? "Save repeating job"
              : "Save job sheet"}
        </button>
        <p role="status">{message}</p>
      </fieldset>
    </form>
  );
}
