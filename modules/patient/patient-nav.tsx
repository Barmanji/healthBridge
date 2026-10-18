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
  return <nav aria-label="Patient dashboard" className="flex gap-2 overflow-x-auto border-b px-4 py-3 sm:flex-wrap sm:overflow-visible sm:px-8">
    {links.map(([href, label]) => {
      const active = pathname === href || (href !== "/patient/dashboard" && pathname.startsWith(`${href}/`));
      return <Link key={href} href={href} aria-current={active ? "page" : undefined} className={`shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-colors ${active ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>{label}</Link>;
    })}
  </nav>;
}
