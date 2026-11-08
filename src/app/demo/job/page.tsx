import Link from "next/link";
import type { Metadata } from "next";
import { DemoJobEditor } from "@/components/demo-job-editor";

export const metadata: Metadata = {
  title: "Interactive job pricing demo | Shop Revenue",
  robots: { index: false, follow: false },
};

export default async function DemoJobPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string }>;
}) {
  const { stage } = await searchParams;
  const initialStage =
    stage === "docs" || stage === "share" || stage === "payment"
      ? stage
      : "setup";
  return (
    <div className="demo-workflow">
      <header className="crm-sample-head">
        <Link href="/demo/crm" className="crm-sample-brand">
          Shop Revenue
        </Link>
        <span className="muted">
          Interactive sample · No login or payment required
        </span>
      </header>
      <DemoJobEditor initialStage={initialStage} />
    </div>
  );
}
