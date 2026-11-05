"use client";
import { useActionHydration } from "./action-hydration";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { signEstimateAction } from "@/server/actions/estimates";
import type { EstimateSnapshot } from "@/db/schema/m3";
import type { LineDecision, SignatureStrokes } from "@/lib/estimate-decisions";
import { estimateTotals } from "@/lib/estimate-tax";

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );

export function EstimateSignature({
  token,
  snapshot: s,
}: {
  token: string;
  snapshot: EstimateSnapshot;
}) {
  const [choices, setChoices] = useState<
    Record<string, LineDecision["decision"]>
  >({});
  const [signature, setSignature] = useState<SignatureStrokes>([]);
  const [typedName, setTypedName] = useState("");
  const [useTyped, setUseTyped] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [limitWarning, setLimitWarning] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const signatureRef = useRef<SignatureStrokes>([]);
  const ready = useActionHydration();
  const router = useRouter();
  const approved = s.lines.filter((l) => choices[l.id] === "approve");
  const totals = estimateTotals(approved, s.taxBps);
  const fullTotals = estimateTotals(s.lines, s.taxBps);
  const complete = s.lines.every((l) => choices[l.id] !== undefined);
  const drawnValid = signature.some((stroke) => stroke.length >= 2);
  const typedValid = typedName.trim().length >= 2;
  const validSignature = useTyped ? typedValid : drawnValid;
  const totalPoints = signature.reduce((n, st) => n + st.length, 0);

  if (!s.authorizationPolicy)
    return (
      <p className="notice">
        This estimate needs to be reissued with an approved authorization
        policy. Contact the shop.
      </p>
    );

  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)),
      y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)),
    };
  };

  const checkLimits = (strokes: SignatureStrokes) => {
    const pts = strokes.reduce((n, st) => n + st.length, 0);
    if (strokes.length >= 20)
      setLimitWarning(
        "Signature has too many strokes. Clear and try a simpler signature, or type your name.",
      );
    else if (pts >= 4500)
      setLimitWarning(
        "Signature is getting large. Clear and try a simpler one, or type your name.",
      );
    else setLimitWarning("");
  };

  return (
    <form
      data-ux-ready={ready}
      className="card"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!complete || !validSignature || pending) return;
        const f = new FormData(e.currentTarget);
        setPending(true);
        try {
          const sigToSend = useTyped
            ? [[{ x: 0.1, y: 0.5 }, { x: 0.9, y: 0.5 }]]
            : signature;
          const r = await signEstimateAction({
            token,
            name: useTyped ? typedName.trim() : f.get("name"),
            decisions: s.lines.map((l) => ({
              id: l.id,
              decision: choices[l.id],
            })),
            signature: sigToSend,
            consent: f.get("consent") === "on",
          });
          if (r.ok) {
            setMessage("Your decision was recorded.");
            router.refresh();
          } else setMessage(r.message ?? "Unable to record decision.");
        } finally {
          setPending(false);
        }
      }}
    >
      <fieldset className="hydration-fields" disabled={!ready}>
        <h2>Authorize work</h2>
        <p>
          Choose Approve or Decline for every item. Nothing is selected for you.
        </p>
        {s.lines.map((l) => (
          <fieldset key={l.id}>
            <legend>{l.description}</legend>
            <label>
              <input
                type="radio"
                name={`decision-${l.id}`}
                value="approve"
                required
                checked={choices[l.id] === "approve"}
                onChange={() => setChoices({ ...choices, [l.id]: "approve" })}
              />
              Approve {l.description}
            </label>
            <label>
              <input
                type="radio"
                name={`decision-${l.id}`}
                value="decline"
                required
                checked={choices[l.id] === "decline"}
                onChange={() => setChoices({ ...choices, [l.id]: "decline" })}
              />
              Decline {l.description}
            </label>
          </fieldset>
        ))}
        <p>
          Approving{" "}
          <strong>
            {approved.length} of {s.lines.length} items · {money(totals.totalCents)} of{" "}
            {money(fullTotals.totalCents)}
          </strong>{" "}
          (including tax)
        </p>
        <label>
          Your full name
          <input name="name" required maxLength={200} autoComplete="name" />
        </label>
        <p id="signature-help">
          Draw your signature below using your finger, pen, or mouse. Contact
          the shop if you need assistance signing.
        </p>
        {!useTyped && (
          <>
            <canvas
              ref={canvas}
              width={640}
              height={240}
              role="img"
              aria-label="Drawn signature"
              aria-describedby="signature-help"
              style={{
                width: "100%",
                height: 240,
                border: "1px solid currentColor",
                background: "white",
                touchAction: "none",
              }}
              onPointerDown={(e) => {
                if (pending || signatureRef.current.length >= 20) {
                  setLimitWarning(
                    "Too many strokes. Clear the signature or type your name instead.",
                  );
                  return;
                }
                const p = point(e);
                e.currentTarget.setPointerCapture(e.pointerId);
                drawing.current = true;
                signatureRef.current = [...signatureRef.current, [p]];
                setSignature(signatureRef.current);
                checkLimits(signatureRef.current);
              }}
              onPointerMove={(e) => {
                if (!drawing.current) return;
                const p = point(e),
                  strokes = signatureRef.current,
                  last = strokes.at(-1);
                if (
                  !last ||
                  last.length >= 500 ||
                  strokes.reduce((n, s) => n + s.length, 0) >= 5000
                ) {
                  setLimitWarning(
                    "Signature is too large. Clear it or type your name instead.",
                  );
                  return;
                }
                const previous = last.at(-1)!,
                  ctx = canvas.current?.getContext("2d");
                if (ctx) {
                  ctx.strokeStyle = "#111111";
                  ctx.lineWidth = 2;
                  ctx.beginPath();
                  ctx.moveTo(previous.x * 640, previous.y * 240);
                  ctx.lineTo(p.x * 640, p.y * 240);
                  ctx.stroke();
                }
                signatureRef.current = [...strokes.slice(0, -1), [...last, p]];
                setSignature(signatureRef.current);
                checkLimits(signatureRef.current);
              }}
              onPointerUp={() => {
                drawing.current = false;
                signatureRef.current = signatureRef.current.filter(
                  (stroke) => stroke.length >= 2,
                );
                setSignature(signatureRef.current);
              }}
              onPointerCancel={() => {
                drawing.current = false;
                signatureRef.current = signatureRef.current.filter(
                  (stroke) => stroke.length >= 2,
                );
                setSignature(signatureRef.current);
              }}
            />
            {limitWarning && <p className="notice">{limitWarning}</p>}
            <p className="muted">
              Strokes: {signature.length}/20 · Points: {totalPoints}/5000
            </p>
          </>
        )}
        <button
          type="button"
          className="btn secondary"
          disabled={pending}
          onClick={() => {
            signatureRef.current = [];
            setSignature([]);
            setLimitWarning("");
            canvas.current?.getContext("2d")?.clearRect(0, 0, 640, 240);
          }}
        >
          Clear signature
        </button>
        <label style={{ display: "block", marginTop: "0.75rem" }}>
          <input
            type="checkbox"
            checked={useTyped}
            onChange={(e) => setUseTyped(e.target.checked)}
          />{" "}
          Type my name instead of drawing
        </label>
        {useTyped && (
          <label>
            Type your full name as your signature
            <input
              value={typedName}
              onChange={(e) => setTypedName(e.target.value)}
              maxLength={200}
              required={useTyped}
              placeholder="Your full name"
            />
          </label>
        )}
        <p className="muted">
          Authorization policy version {s.authorizationPolicy.version}
        </p>
        <label>
          <input name="consent" type="checkbox" required />
          {s.authorizationPolicy.body}
        </label>
        <button
          className="btn primary"
          disabled={pending || !complete || !validSignature}
        >
          {pending
            ? "Recording…"
            : approved.length
              ? "Sign authorization"
              : "Sign decline"}
        </button>
        {!complete && <p>Decide every item to continue.</p>}
        <p role="status">{message}</p>
      </fieldset>
    </form>
  );
}
