"use client";

import Image from "next/image";
import Link from "next/link";

export default function Home() {
  return (
    <main className="relative flex-1 flex flex-col items-center justify-center px-6 overflow-hidden">
      <div className="relative flex flex-col items-center text-center">
        <Image
          src="/rival-mark-trim.png"
          alt="RIVAL"
          width={403}
          height={64}
          priority
          className="w-[min(360px,64vw)] h-auto select-none"
        />

        <h1 className="mt-2 max-w-[16ch] text-balance font-semibold leading-[1.08] tracking-[-0.02em] text-[clamp(30px,5vw,58px)]">
          Nantissez vos parts de vault fermé.
          <br className="hidden sm:block" /> Empruntez contre elles.
        </h1>

        <div className="mt-11 flex items-center gap-3">
          <Link
            href="/dashboard"
            className="rounded-full bg-white px-8 py-3.5 text-[13px] font-semibold uppercase tracking-[0.14em] text-black transition-colors hover:bg-neutral-200"
          >
            Launch app
          </Link>
          <a
            href="https://github.com/abaresks24/rival.finance"
            target="_blank"
            rel="noopener"
            className="rounded-full border border-white/25 px-8 py-3.5 text-[13px] font-semibold uppercase tracking-[0.14em] text-white/90 transition-colors hover:border-white/60 hover:text-white"
          >
            Docs
          </a>
        </div>
      </div>
    </main>
  );
}
