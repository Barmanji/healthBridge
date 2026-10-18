import { AuthForm } from "@/modules/auth/components/auth-form";

export default function SignInPage() {
  return (
    <>
      <p className="text-sm font-semibold text-[var(--hb-brand-700)]">Welcome back</p>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight">Sign in to Health-Bridge</h2>
      <p className="mt-2 mb-8 text-sm leading-relaxed text-muted-foreground">Continue to your account and your care journey.</p>
      <AuthForm mode="sign-in" />
    </>
  );
}
