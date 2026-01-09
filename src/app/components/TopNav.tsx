"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

function NavLink({
  href,
  label,
}: {
  href: string;
  label: string;
}) {
  const pathname = usePathname();
  const active = pathname === href;

  return (
    <Link
      href={href}
      className={`rounded-xl border px-3 py-2 text-sm hover:opacity-80 transition ${
        active ? "font-semibold" : "opacity-80"
      }`}
    >
      {label}
    </Link>
  );
}

export default function TopNav() {
  return (
    <header className="w-full border-b">
      <div className="mx-auto max-w-5xl px-6 py-4 flex flex-wrap items-center justify-between gap-3">
        <Link href="/" className="text-sm font-semibold">
          Device Support Cert Prep
        </Link>

        <nav className="flex flex-wrap items-center gap-2">
          <NavLink href="/" label="Home" />
          <NavLink href="/quiz" label="Quiz" />
          <NavLink href="/stats" label="Stats" />
        </nav>
      </div>
    </header>
  );
}
