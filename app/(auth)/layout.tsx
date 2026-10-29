import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-[var(--hb-surface)] px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto flex max-w-5xl items-center justify-between">
        <Link href="/" aria-label="Health-Bridge home" className="flex items-center gap-2.5 font-semibold tracking-tight text-[var(--hb-text)]">
          <Image src="/health-bridge-mark.png" alt="" width={792} height={607} sizes="36px" priority className="h-9 w-auto" />
          Health-Bridge
        </Link>
        <Link href="/" className="text-sm text-muted-foreground hover:text-foreground">Back to home</Link>
      </div>
      <div className="mx-auto mt-10 grid max-w-5xl overflow-hidden rounded-[2rem] border border-[var(--hb-border)] bg-[var(--hb-surface)] shadow-xl shadow-black/5 md:mt-16 md:grid-cols-[0.9fr_1.1fr]">
        <aside className="hidden flex-col justify-between bg-[var(--hb-brand-700)] p-10 text-white md:flex">
          <div>
            <p className="text-sm font-semibold text-white/75">Care that listens</p>
            <h1 className="mt-5 text-4xl font-semibold leading-tight tracking-tight">A clearer path to care, in your language.</h1>
          </div>
          <p className="max-w-xs text-sm leading-relaxed text-white/75">Your information is used to support your care. Doctor accounts are reviewed before they can access patient services.</p>
        </aside>
        <section className="p-6 sm:p-10 lg:p-12">{children}</section>
      </div>
    </main>
  );
}
