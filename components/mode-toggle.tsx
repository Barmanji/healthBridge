"use client";

import { useSyncExternalStore } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Moon02Icon, Sun02Icon } from "@hugeicons/core-free-icons";
import { useTheme } from "next-themes";

export function ModeToggle() {
  const { setTheme, theme } = useTheme();
  const mounted = useSyncExternalStore(() => () => {}, () => true, () => false);

  const isDark = mounted && theme === "dark";

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={`Switch to ${isDark ? "light" : "dark"} theme`}
      title={`Switch to ${isDark ? "light" : "dark"} theme`}
      onClick={() => setTheme(isDark ? "light" : "dark")}
      className="relative inline-flex h-10 w-[4.5rem] shrink-0 items-center rounded-full border border-[var(--hb-border-strong)] bg-[var(--hb-bg-subtle)] p-1 shadow-sm transition-colors duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--hb-brand-500)] focus-visible:ring-offset-2"
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-2 flex items-center text-[var(--hb-brand-700)]">
        <HugeiconsIcon icon={Sun02Icon} className="size-4" />
      </span>
      <span aria-hidden="true" className="absolute inset-y-0 right-2 flex items-center text-[var(--hb-brand-700)]">
        <HugeiconsIcon icon={Moon02Icon} className="size-4" />
      </span>
      <span
        aria-hidden="true"
        className={`relative z-10 flex size-7 items-center justify-center rounded-full bg-[var(--hb-surface)] text-[var(--hb-brand-700)] shadow-md transition-transform duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none ${isDark ? "translate-x-8" : "translate-x-0"}`}
      >
        <HugeiconsIcon icon={isDark ? Moon02Icon : Sun02Icon} className="size-4" />
      </span>
    </button>
  );
}
