"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { LAST_EPISODE_KEY, readSession } from "@/lib/session";

const tabClass = "rounded px-2 py-1 text-sm";
const activeClass = `${tabClass} font-semibold text-white underline underline-offset-4`;
const idleClass = `${tabClass} text-white/85 hover:text-white`;
const disabledClass = `${tabClass} cursor-not-allowed text-white/65`;

export function Header() {
  const pathname = usePathname();
  const [lastEpisode, setLastEpisode] = useState<string | null>(null);

  useEffect(() => {
    setLastEpisode(readSession<string>(LAST_EPISODE_KEY));
  }, [pathname]);

  const onListening = pathname.startsWith("/listen");
  return (
    <header className="bg-navy">
      <nav
        aria-label="Main"
        className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-3"
      >
        <span className="mr-4 text-lg font-semibold text-white">PaperCast</span>
        <Link
          href="/"
          className={pathname === "/" ? activeClass : idleClass}
          aria-current={pathname === "/" ? "page" : undefined}
        >
          Library
        </Link>
        {onListening ? (
          <span className={activeClass} aria-current="page">
            Listening
          </span>
        ) : lastEpisode ? (
          <Link href={`/listen/${lastEpisode}`} className={idleClass}>
            Listening
          </Link>
        ) : (
          <span
            className={disabledClass}
            aria-disabled="true"
            title="Generate an episode first"
          >
            Listening
          </span>
        )}
        <span
          className={disabledClass}
          aria-disabled="true"
          title="Saved sessions arrive in Phase 2"
        >
          Study
        </span>
      </nav>
    </header>
  );
}
