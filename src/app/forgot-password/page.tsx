import { ForgotPasswordForm } from "./forgot-password-form";

export default function ForgotPasswordPage() {
  return (
    <main id="main-content" tabIndex={-1}>
      <h1>Reset password</h1>
      <p className="muted">Enter your email and we’ll send password reset instructions.</p>
      <ForgotPasswordForm />
    </main>
  );
}

