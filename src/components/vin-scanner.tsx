"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { extractVin } from "@/lib/vin";

type Detector = {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
};
type DetectorCtor = new (opts: { formats: string[] }) => Detector;

const noop = () => () => {};

// "Scan VIN" with the phone camera, where the browser can read barcodes
// (Chrome on Android). Hidden everywhere else, so nobody sees a dead button.
export function VinScanner({ onVin }: { onVin: (vin: string) => void }) {
  const supported = useSyncExternalStore(
    noop,
    () => "BarcodeDetector" in window && !!navigator.mediaDevices?.getUserMedia,
    () => false,
  );
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const video = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    if (!open) return;
    let stream: MediaStream | null = null;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    (async () => {
      try {
        const Ctor = (window as unknown as { BarcodeDetector: DetectorCtor })
          .BarcodeDetector;
        const detector = new Ctor({
          formats: ["code_39", "code_128", "data_matrix", "qr_code"],
        });
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
        });
        if (!video.current || stopped) return;
        video.current.srcObject = stream;
        // Don't wait on play(): scanning starts as soon as frames arrive.
        video.current.play().catch(() => undefined);
        const tick = async () => {
          if (stopped || !video.current) return;
          try {
            const codes = await detector.detect(video.current);
            for (const c of codes) {
              const vin = extractVin(c.rawValue);
              if (vin) {
                onVin(vin);
                setOpen(false);
                return;
              }
            }
          } catch {
            // Keep trying: a frame can fail while the camera focuses.
          }
          timer = setTimeout(tick, 250);
        };
        tick();
      } catch {
        setMessage(
          "Couldn’t open the camera. Allow camera access, or type the VIN.",
        );
        setOpen(false);
      }
    })();
    return () => {
      stopped = true;
      clearTimeout(timer);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [open, onVin]);

  if (!supported) return null;
  return (
    <>
      <button
        type="button"
        className="btn secondary"
        onClick={() => {
          setMessage("");
          setOpen(true);
        }}
      >
        📷 Scan VIN
      </button>
      {message && (
        <p className="muted" role="status">
          {message}
        </p>
      )}
      {open && (
        <div
          className="vin-scan"
          role="dialog"
          aria-modal="true"
          aria-label="Scan the VIN barcode"
        >
          <video ref={video} playsInline muted />
          <p>Point at the VIN barcode on the door jamb or windshield.</p>
          <button
            type="button"
            className="btn secondary"
            onClick={() => setOpen(false)}
          >
            Cancel
          </button>
        </div>
      )}
    </>
  );
}
