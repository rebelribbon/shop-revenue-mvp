import Link from "next/link";
export default function NotFound() {
  return (
    <main id="main-content" tabIndex={-1}>
      <h1>That page isn’t available</h1>
      <p>The link may be incorrect or the record may no longer be available.</p>
      <Link className="btn primary" href="/app">
        Return to your workspace
      </Link>
    </main>
  );
}
