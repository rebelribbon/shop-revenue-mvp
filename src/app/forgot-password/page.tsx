import { HydratedMain } from "@/components/hydrated-main";
import { ForgotPasswordForm } from "./forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <HydratedMain id="main-content" tabIndex={-1}>
      <h1>Reset password</h1>
      <p className="muted">
        Enter your email and we’ll send password reset instructions.
      </p>
      <ForgotPasswordForm />
    </HydratedMain>
  );
}
