import Image from "next/image";
import Link from "next/link";
import { ModeToggle } from "@/components/mode-toggle";
import UserButton from "@/modules/auth/components/user-button";

interface NavUser {
  id: string;
  name: string;
  email: string;
  image?: string | null;
  createdAt: Date;
}

export const Navbar = ({ user }: { user: NavUser | null }) => {
  return (
    <nav aria-label="Main navigation" className="mx-auto mt-4 w-full max-w-5xl px-4">
      <div className="flex items-center justify-between rounded-2xl border border-border bg-card px-5 py-3 shadow-sm">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-xl" aria-hidden="true"><Image src="/1.png" alt="" width={32} height={32} className="size-8 scale-[1.7]" /></span>
          <span>health<span className="text-primary">bridge</span></span>
        </Link>

        <div className="flex items-center gap-3">
          <ModeToggle />
          {user ? (
            <UserButton user={user} />
          ) : (
            <>
              <Link href="/sign-in" className="rounded-full px-3 py-2 text-sm font-medium hover:bg-muted">Sign in</Link>
              <Link href="/sign-up" className="rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">Create account</Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
};
