"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useActionHydration } from "./action-hydration";
import { signDocumentAction } from "@/server/actions/documents";
import type { DocumentField } from "@/db/schema/documents";

type Point = { x: number; y: number };

export function SignDocument({
  token,
  fields,
}: {
  token: string;
  fields: DocumentField[];
}) {
  const ready = useActionHydration();
  const router = useRouter();
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Point[][]>([]);
  const drawing = useRef(false);
  const [hasSignature, setHasSignature] = useState(false);
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const point = (e: React.PointerEvent<HTMLCanvasElement>): Point => {
    const r = e.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)),
      y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)),
    };
  };
  const end = () => {
    drawing.current = false;
    strokes.current = strokes.current.filter((s) => s.length >= 2);
    setHasSignature(strokes.current.length > 0);
  };
  return (
    <form
      className="card"
      data-ux-ready={ready}
      onSubmit={(e) => {
        e.preventDefault();
        const data = new FormData(e.currentTarget);
        const values: Record<string, string | boolean> = {};
        for (const f of fields)
          values[f.key] =
            f.type === "checkbox"
              ? data.get(f.key) === "on"
              : String(data.get(f.key) ?? "");
        start(async () => {
          const r = await signDocumentAction({
            token,
            name: String(data.get("name") ?? ""),
            values,
            signature: strokes.current,
          });
          if (r.ok) router.refresh();
          else setMessage(r.message ?? "Couldn’t sign. Please try again.");
        });
      }}
    >
      <h2>Fill in and sign</h2>
      {fields.map((f) =>
        f.type === "checkbox" ? (
          <label key={f.key}>
            <input type="checkbox" name={f.key} required={f.required} />
            {f.label}
            {f.required ? " *" : ""}
          </label>
        ) : (
          <label key={f.key}>
            {f.label}
            {f.required ? " *" : ""}
            <input
              name={f.key}
              type={f.type === "date" ? "date" : "text"}
              required={f.required}
              maxLength={f.type === "initials" ? 6 : 500}
              autoCapitalize={f.type === "initials" ? "characters" : undefined}
            />
          </label>
        ),
      )}
      <label>
        Your full name *
        <input name="name" required maxLength={200} autoComplete="name" />
      </label>
      <p id="doc-signature-help">
        Draw your signature with your finger, pen or mouse.
      </p>
      <canvas
        ref={canvas}
        width={640}
        height={240}
        role="img"
        aria-label="Drawn signature"
        aria-describedby="doc-signature-help"
        style={{
          width: "100%",
          height: 200,
          border: "1px solid currentColor",
          background: "white",
          touchAction: "none",
        }}
        onPointerDown={(e) => {
          if (pending || strokes.current.length >= 20) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          strokes.current = [...strokes.current, [point(e)]];
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const p = point(e),
            last = strokes.current.at(-1);
          if (
            !last ||
            last.length >= 500 ||
            strokes.current.reduce((n, s) => n + s.length, 0) >= 5000
          )
            return;
          const prev = last.at(-1)!,
            ctx = canvas.current?.getContext("2d");
          if (ctx) {
            ctx.strokeStyle = "#111111";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(prev.x * 640, prev.y * 240);
            ctx.lineTo(p.x * 640, p.y * 240);
            ctx.stroke();
          }
          last.push(p);
        }}
        onPointerUp={end}
        onPointerCancel={end}
      />
      <button
        type="button"
        className="btn secondary"
        onClick={() => {
          strokes.current = [];
          setHasSignature(false);
          canvas.current?.getContext("2d")?.clearRect(0, 0, 640, 240);
        }}
      >
        Clear signature
      </button>
      <p className="muted">
        By signing you agree to the document above. Your name, signature,
        entries, date, time and device details are saved with a copy of this
        document.
      </p>
      <button
        className="btn primary"
        disabled={pending || !hasSignature || !ready}
      >
        {pending ? "Signing…" : "Sign document"}
      </button>
      <p role="status">{message}</p>
    </form>
  );
}
