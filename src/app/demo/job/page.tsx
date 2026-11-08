import Link from "next/link";
import type { Metadata } from "next";
import { DemoJobEditor } from "@/components/demo-job-editor";
import { demoCustomers } from "@/lib/demo-customers";

export const metadata: Metadata = {
  title: "Interactive RO pricing demo | Shop Revenue",
  robots: { index: false, follow: false },
};

export default async function DemoJobPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; customer?: string }>;
}) {
  const { stage, customer } = await searchParams;
  const record =
    demoCustomers.find((c) => c.id === customer) ?? demoCustomers[0];
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
      <DemoJobEditor
        key={record.id}
        initialStage={initialStage}
        customerRecord={record}
      />
    </div>
  );
}
