"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  ["/patient/dashboard", "Overview"],
  ["/patient/doctors", "Find doctors"],
  ["/patient/appointments", "Appointments"],
  ["/patient/conversations", "AI conversations"],
  ["/patient/history", "Health history"],
  ["/patient/settings", "Profile & settings"],
] as const;

export function PatientNav() {
  const pathname = usePathname();
  return <aside className="shrink-0 border-b bg-card sm:w-60 sm:border-b-0 sm:border-r" aria-label="Patient sections">
    <nav aria-label="Patient dashboard" className="flex gap-2 overflow-x-auto px-3 py-3 sm:sticky sm:top-16 sm:h-[calc(100dvh-4rem)] sm:flex-col sm:overflow-y-auto sm:py-5">
      {links.map(([href, label]) => {
        const active = pathname === href || (href !== "/patient/dashboard" && pathname.startsWith(`${href}/`));
        return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`shrink-0 rounded-xl px-4 py-3 text-sm font-medium transition-colors sm:w-full ${active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>{label}</Link>;
      })}
    </nav>
  </aside>;
}
