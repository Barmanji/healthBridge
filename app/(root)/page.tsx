import Link from "next/link";
import { headers } from "next/headers";
import { ModeToggle } from "@/components/mode-toggle";
import { auth } from "@/lib/auth";
import UserButton from "@/modules/auth/components/user-button";

const careSteps = [
  {
    number: "01",
    title: "Start in your own words",
    description:
      "Type or speak naturally. You can switch between the two without losing your place.",
  },
  {
    number: "02",
    title: "Understand the next step",
    description:
      "Get a clear summary and guidance on what kind of care may help, with urgent symptoms surfaced first.",
  },
  {
    number: "03",
    title: "Choose a doctor when you’re ready",
    description:
      "Review a suggested doctor and appointment time. Nothing is booked until you confirm.",
  },
];

export default async function HomePage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const dashboardHref = session?.user.role === "admin"
    ? "/admin/applications"
    : session?.user.role === "doctor"
      ? "/doctor/onboarding"
      : "/patient/dashboard";
  return (
    <>
      <header className="relative z-10 border-b border-[var(--hb-border)]/80 bg-[var(--hb-bg)]/70 backdrop-blur-xl">
        <div className="hb-container flex h-[76px] items-center justify-between">
          <Link href="/" aria-label="Health-Bridge home" className="flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-[var(--hb-brand-700)] text-white shadow-sm">
              <span className="text-xl font-semibold leading-none" aria-hidden="true">+</span>
            </span>
            <span className="text-[17px] font-semibold tracking-[-0.04em] text-[var(--hb-text)]">
              health<span className="text-[var(--hb-brand-700)]">bridge</span>
            </span>
          </Link>

          <nav aria-label="Main navigation" className="hidden items-center gap-8 text-sm font-medium text-[var(--hb-text-muted)] md:flex">
            <a className="hb-link" href="#how-it-works">How it works</a>
            <a className="hb-link" href="#for-doctors">For doctors</a>
            <a className="hb-link" href="#our-promise">Our promise</a>
          </nav>

          <div className="flex items-center gap-2 sm:gap-3">
            <ModeToggle />
            {session ? (
              <>
                <Link className="hb-button-primary inline-flex items-center justify-center px-5 text-sm font-semibold" href={dashboardHref}>My dashboard</Link>
                <UserButton user={{ name: session.user.name, email: session.user.email, image: session.user.image, createdAt: session.user.createdAt }} />
              </>
            ) : (
              <>
                <Link className="hb-link hidden rounded-full px-3 py-2 text-sm font-semibold sm:inline-flex" href="/sign-in">Sign in</Link>
                <Link className="hb-button-primary inline-flex items-center justify-center px-5 text-sm font-semibold" href="/sign-up">Get started <span className="ml-2" aria-hidden="true">→</span></Link>
              </>
            )}
          </div>
        </div>
      </header>

      <section className="relative overflow-hidden pb-20 pt-14 sm:pb-28 sm:pt-20">
        <div className="hb-orb right-[8%] top-16 size-48 bg-[var(--hb-accent-100)]/55" aria-hidden="true" />
        <div className="hb-orb left-[7%] top-72 size-24 bg-[var(--hb-warm-100)]/80" aria-hidden="true" />
        <div className="hb-container relative grid items-center gap-14 lg:grid-cols-[1.02fr_0.98fr] lg:gap-8">
          <div className="relative z-10 max-w-[620px]">
            <div className="mb-7 inline-flex items-center gap-2 rounded-full border border-[var(--hb-border)] bg-[var(--hb-surface)]/75 px-3.5 py-2 text-xs font-semibold text-[var(--hb-brand-700)] shadow-sm">
              <span className="size-2 rounded-full bg-[var(--hb-brand-500)]" aria-hidden="true" />
              Care that starts with being understood
            </div>
            <h1 className="hb-display max-w-[650px] text-[clamp(3rem,6.6vw,5.6rem)] leading-[0.99] text-[var(--hb-text)]">
              Your health, <span className="hb-shine-text">your words.</span>
            </h1>
            <p className="mt-7 max-w-[520px] text-lg leading-[1.75] text-[var(--hb-text-muted)] sm:text-xl">
              Talk or type about what you’re feeling. Get help understanding the next step, in a way that keeps you in control.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              <Link className="hb-button-primary inline-flex items-center justify-center px-6 text-sm font-semibold" href="/sign-up">
                Start a conversation <span className="ml-2" aria-hidden="true">→</span>
              </Link>
              <a className="hb-button-secondary inline-flex items-center justify-center px-6 text-sm font-semibold" href="#how-it-works">
                See how it works
              </a>
            </div>
            <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-[var(--hb-text-muted)]">
              <span className="inline-flex items-center gap-2"><span className="text-[var(--hb-success)]" aria-hidden="true">✓</span> You choose what happens next</span>
              <span className="inline-flex items-center gap-2"><span className="text-[var(--hb-success)]" aria-hidden="true">✓</span> A doctor makes medical decisions</span>
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-[510px] lg:ml-auto">
            <div className="absolute -inset-5 rounded-[36px] bg-gradient-to-br from-[var(--hb-brand-100)]/70 via-transparent to-[var(--hb-accent-100)]/80 blur-xl" aria-hidden="true" />
            <div className="hb-card relative overflow-hidden p-5 sm:p-7">
              <div className="flex items-center justify-between border-b border-[var(--hb-border)] pb-5">
                <div className="flex items-center gap-3">
                  <span className="flex size-10 items-center justify-center rounded-2xl bg-[var(--hb-brand-50)] text-[var(--hb-brand-700)]" aria-hidden="true">✳</span>
                  <div>
                    <p className="text-sm font-semibold">Your care conversation</p>
                    <p className="text-xs text-[var(--hb-text-muted)]">A private place to start</p>
                  </div>
                </div>
                <span className="rounded-full bg-[var(--hb-brand-50)] px-3 py-1 text-xs font-medium text-[var(--hb-brand-700)]">Text or voice</span>
              </div>

              <div className="space-y-5 py-7" aria-label="Example conversation">
                <div className="flex justify-end">
                  <p className="max-w-[82%] rounded-[20px_20px_5px_20px] bg-[var(--hb-brand-50)] px-4 py-3 text-sm leading-relaxed text-[var(--hb-text)]">
                    I haven’t been feeling like myself today.
                  </p>
                </div>
                <div className="flex items-start gap-3">
                  <span className="mt-1 flex size-8 shrink-0 items-center justify-center rounded-xl bg-[var(--hb-bg-subtle)] text-sm text-[var(--hb-brand-700)]" aria-hidden="true">✳</span>
                  <p className="max-w-[86%] rounded-[5px_20px_20px_20px] border border-[var(--hb-border)] bg-[var(--hb-surface)] px-4 py-3 text-sm leading-relaxed text-[var(--hb-text-muted)]">
                    I’m here to listen. What has been bothering you most?
                  </p>
                </div>
              </div>

              <div className="rounded-2xl border border-[var(--hb-border)] bg-[var(--hb-bg)] p-3">
                <div className="flex items-center justify-between gap-3 rounded-xl bg-[var(--hb-surface)] px-4 py-3 shadow-sm">
                  <span className="text-sm text-[var(--hb-text-faint)]">Write a message…</span>
                  <span className="flex size-9 items-center justify-center rounded-full bg-[var(--hb-brand-700)] text-white" aria-label="Voice input example">⌁</span>
                </div>
                <p className="px-1 pt-2 text-[11px] leading-relaxed text-[var(--hb-text-muted)]">Switch between typing and speaking whenever you need.</p>
              </div>
              <p className="mt-4 text-center text-[11px] text-[var(--hb-text-muted)]">Illustrative example · Not medical advice</p>
            </div>

            <div className="hb-card absolute -bottom-7 -left-5 hidden items-center gap-3 px-4 py-3 sm:flex">
              <span className="hb-breathe flex size-10 items-center justify-center rounded-full bg-[var(--hb-brand-50)] text-[var(--hb-brand-700)]" aria-hidden="true">♥</span>
              <div>
                <p className="text-xs font-semibold">You stay in control</p>
                <p className="text-[11px] text-[var(--hb-text-muted)]">Review before you decide</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="border-y border-[var(--hb-border)] bg-[var(--hb-surface)]/55 py-20 sm:py-24">
        <div className="hb-container">
          <div className="mx-auto max-w-[620px] text-center">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--hb-brand-700)]">A clearer path to care</p>
            <h2 className="hb-display mt-4 text-4xl leading-tight sm:text-5xl">Small steps. Human decisions.</h2>
            <p className="mt-4 text-[var(--hb-text-muted)]">Health-Bridge helps you prepare for care, while keeping the important choices with you and your doctor.</p>
          </div>
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {careSteps.map((step) => (
              <article key={step.number} className="rounded-3xl border border-[var(--hb-border)] bg-[var(--hb-surface)] p-6 sm:p-7">
                <p className="text-sm font-semibold text-[var(--hb-brand-700)]">{step.number}</p>
                <h3 className="mt-5 text-lg font-semibold tracking-[-0.02em]">{step.title}</h3>
                <p className="mt-3 text-sm leading-[1.75] text-[var(--hb-text-muted)]">{step.description}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="for-doctors" className="py-20 sm:py-24">
        <div className="hb-container grid gap-8 rounded-[32px] border border-[var(--hb-border)] bg-[var(--hb-bg-subtle)] p-7 sm:p-11 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="max-w-[680px]">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--hb-brand-700)]">For clinicians</p>
            <h2 className="hb-display mt-4 text-3xl leading-tight sm:text-4xl">More context for a more considered conversation.</h2>
            <p className="mt-4 max-w-[600px] text-[var(--hb-text-muted)]">Health-Bridge is designed to help patients share what matters before a visit, so clinicians can focus on listening, assessing, and deciding together.</p>
          </div>
          <Link className="hb-button-secondary inline-flex w-fit items-center justify-center px-6 text-sm font-semibold" href="/sign-up?role=doctor">
            Join as a doctor <span className="ml-2" aria-hidden="true">→</span>
          </Link>
        </div>
      </section>

      <section id="our-promise" className="pb-20 sm:pb-24">
        <div className="hb-container grid gap-8 border-t border-[var(--hb-border)] pt-12 md:grid-cols-[0.8fr_1.2fr]">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-[var(--hb-brand-700)]">Our promise</p>
            <h2 className="hb-display mt-3 text-3xl">Care with your consent.</h2>
          </div>
          <div className="max-w-[650px] text-sm leading-[1.8] text-[var(--hb-text-muted)]">
            <p>Health-Bridge provides triage assistance only. It does not diagnose, replace a licensed clinician, or replace emergency services. If you may be experiencing an emergency, contact local emergency services now.</p>
            <p className="mt-4">Your information is sensitive. We’re building this experience around privacy, clear consent, and human review.</p>
          </div>
        </div>
      </section>

      <footer className="border-t border-[var(--hb-border)] bg-[var(--hb-surface)]/50 py-7">
        <div className="hb-container flex flex-col justify-between gap-3 text-xs text-[var(--hb-text-muted)] sm:flex-row sm:items-center">
          <span>© {new Date().getFullYear()} Health-Bridge</span>
          <span>Healthcare that speaks your language, even when your signal doesn’t.</span>
        </div>
      </footer>
    </>
  );
}
