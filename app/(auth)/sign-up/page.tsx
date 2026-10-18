import { AuthForm } from "@/modules/auth/components/auth-form";

type SignUpPageProps = {
  searchParams: Promise<{ role?: string }>;
};

export default async function SignUpPage({ searchParams }: SignUpPageProps) {
  const { role } = await searchParams;
  const initialRole = role === "doctor" ? "doctor" : "patient";

  return (
    <>
      <p className="text-sm font-semibold text-[var(--hb-brand-700)]">Your care starts here</p>
      <h2 className="mt-2 text-3xl font-semibold tracking-tight">Create your account</h2>
      <p className="mt-2 mb-8 text-sm leading-relaxed text-muted-foreground">Join as a patient or start a doctor application.</p>
      <AuthForm mode="sign-up" initialRole={initialRole} />
    </>
  );
}
