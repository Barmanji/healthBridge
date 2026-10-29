import Image from "next/image";
import { cn } from "cn";

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "HB";
  const first = parts[0]?.[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1]?.[0] ?? "" : "";
  return `${first}${last}`.toUpperCase();
}

/**
 * Square-ish profile photo with an initials fallback. Plain `Image` without the
 * optimizer, because patient avatars are served from an authenticated route that
 * the image optimizer cannot reach.
 */
export function ProfilePhoto({ src, name, className, sizes = "96px" }: {
  src: string | null | undefined;
  name: string;
  className?: string;
  sizes?: string;
}) {
  return <span className={cn("relative flex shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-primary/10 font-semibold text-primary", className ?? "size-16 text-xl")}>
    {src
      ? <Image src={src} alt={`${name} profile photo`} fill unoptimized sizes={sizes} className="object-cover" />
      : <span aria-hidden="true">{initialsOf(name)}</span>}
  </span>;
}
