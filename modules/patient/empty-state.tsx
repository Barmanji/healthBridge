import Link from "next/link";

export function PatientEmptyState({ eyebrow, title, description, actionLabel, actionHref }: { eyebrow: string; title: string; description: string; actionLabel?: string; actionHref?: string }) {
  return <main className="mx-auto max-w-5xl px-4 py-8 sm:px-8 sm:py-10"><p className="text-sm font-semibold text-primary">{eyebrow}</p><section className="mt-5 rounded-3xl border bg-card px-6 py-12 text-center sm:px-12"><span className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/10 text-2xl text-primary" aria-hidden="true">✳</span><h1 className="mt-5 text-2xl font-semibold tracking-tight">{title}</h1><p className="mx-auto mt-3 max-w-xl leading-relaxed text-muted-foreground">{description}</p>{actionHref && actionLabel && <Link href={actionHref} className="mt-6 inline-flex min-h-11 items-center justify-center rounded-full bg-primary px-5 text-sm font-semibold text-primary-foreground">{actionLabel}</Link>}</section></main>;
}
