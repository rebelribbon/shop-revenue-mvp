"use client";
import "./globals.css";

export default function GlobalError({
  retry,
}: {
  error: unknown;
  retry: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <main id="main-content" tabIndex={-1}>
          <h1>Shop Revenue couldn’t load</h1>
          <p>Please try again. If the problem continues, contact support.</p>
          <button
            className="btn primary"
            data-ux-primary="true"
            onClick={() => retry()}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
