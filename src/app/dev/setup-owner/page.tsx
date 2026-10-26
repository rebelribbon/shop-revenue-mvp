import { redirect } from "next/navigation";
import { OwnerSetupForm } from "./setup-form";

export default function DevOwnerSetupPage() {
  if (process.env.APP_ENV !== "staging") redirect("/sign-in");
  return (
    <main>
      <h1>Set up preview owner account</h1>
      <p className="muted">This page only exists in the preview environment.</p>
      <OwnerSetupForm />
    </main>
  );
}
