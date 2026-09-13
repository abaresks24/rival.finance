"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import SpecularButton from "@/components/SpecularButton";
import SpotlightCard from "@/components/SpotlightCard";

const toXrp = (d: any) => Number(d || 0) / 1e6;
const fmt = (n: number, dp = 2) =>
  Number(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });

type Vault = {
  name: string;
  asset: string;
  kind: string;
  tvlXrp: number;
  pps: number;
  status: string;
  accent: string;
};

export default function Home() {
  const router = useRouter();
  const [vaults, setVaults] = useState<Vault[]>([]);

  useEffect(() => {
    fetch("/state.json?" + Date.now(), { cache: "no-store" })
      .then((r) => r.json())
      .then((S) => {
        const c = S.vaults?.credit || {};
        const f = S.vaults?.funding || {};
        setVaults([
          {
            name: "Credit Vault",
            asset: "XRP",
            kind: "Closed-ended",
            tvlXrp: c.assetsTotalXrp ?? toXrp(c.assetsTotal),
            pps: c.ppsDrops ?? 1,
            status: S.phase || "investment",
            accent: "rgba(255,255,255,0.16)",
          },
          {
            name: "Funding Vault",
            asset: "XRP",
            kind: "Closed-ended",
            tvlXrp: f.assetsTotalXrp ?? toXrp(f.assetsTotal),
            pps: f.ppsDrops ?? 1,
            status: S.phase || "investment",
            accent: "rgba(79,227,162,0.16)",
          },
        ]);
      })
      .catch(() => setVaults([]));
  }, []);

  return (
    <div className="relative flex-1">
      {/* ---- nav ---- */}
      <nav className="sticky top-0 z-40 flex items-center justify-between border-b border-white/8 px-6 py-4 backdrop-blur-md">
        <Image src="/rival-mark-trim.png" alt="RIVAL" width={403} height={64} priority className="h-6 w-auto" />
        <div className="flex items-center gap-6">
          <a href="https://github.com/abaresks24/rival.finance" target="_blank" rel="noopener" className="font-mono text-[12px] uppercase tracking-[0.14em] text-white/55 hover:text-white transition">
            Docs
          </a>
          <SpecularButton radius={4} size="sm" baseColor="#3a3a3a" lineColor="#ffffff" textColor="#ffffff" onClick={() => router.push("/dashboard")}>
            Launch app
          </SpecularButton>
        </div>
      </nav>

      {/* ---- hero ---- */}
      <section className="relative flex min-h-[78vh] flex-col items-center justify-center px-6 text-center">
        <Image src="/rival-mark-trim.png" alt="RIVAL" width={403} height={64} priority className="w-[min(340px,62vw)] h-auto" />
        <h1 className="mt-6 max-w-[18ch] text-balance font-semibold leading-[1.05] tracking-[-0.02em] text-[clamp(32px,5.4vw,60px)]">
          Empruntez contre vos parts de vault.
        </h1>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-4">
          <SpecularButton radius={4} baseColor="#4a4a4a" lineColor="#ffffff" textColor="#000000" tint="#ffffff" tintOpacity={1} onClick={() => router.push("/dashboard")}>
            Launch app
          </SpecularButton>
          <SpecularButton radius={4} baseColor="#2a2a2a" lineColor="#ffffff" textColor="#f5f5f5" onClick={() => window.open("https://github.com/abaresks24/rival.finance", "_blank")}>
            Read the docs
          </SpecularButton>
        </div>
      </section>

      {/* ---- vaults ---- */}
      <section className="mx-auto max-w-6xl px-6 py-16">
        <div className="mb-8 flex items-end justify-between border-b border-white/8 pb-4">
          <div>
            <div className="eyebrow">Vaults</div>
            <h2 className="mt-2 text-2xl font-semibold tracking-tight">Available vaults</h2>
          </div>
          <span className="font-mono text-[11px] uppercase tracking-[0.14em] text-white/35">
            {vaults.length} live
          </span>
        </div>

        <div className="grid gap-4 md:grid-cols-3">
          {vaults.map((v) => (
            <SpotlightCard key={v.name} className="rival-vault" spotlightColor={v.accent}>
              <button onClick={() => router.push("/dashboard")} className="block w-full cursor-pointer p-6 text-left">
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-lg font-semibold">{v.name}</div>
                    <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-white/40">
                      {v.asset} · {v.kind}
                    </div>
                  </div>
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: "#4fe3a2" }} />
                </div>
                <div className="mt-6 grid grid-cols-2 gap-y-4">
                  <Metric k="TVL" v={`${fmt(v.tvlXrp, 0)} XRP`} />
                  <Metric k="PPS" v={fmt(v.pps, 4)} />
                  <Metric k="Statut" v={v.status} />
                  <Metric k="Réseau" v="XRPL" />
                </div>
                <div className="mt-6 border-t border-white/8 pt-4 font-mono text-[12px] uppercase tracking-[0.14em] text-white/70 group-hover:text-white">
                  Ouvrir →
                </div>
              </button>
            </SpotlightCard>
          ))}

          {/* deploy card */}
          <SpotlightCard className="rival-vault" spotlightColor="rgba(255,255,255,0.08)">
            <div className="flex h-full flex-col justify-between p-6">
              <div>
                <div className="text-lg font-semibold text-white/70">Votre vault</div>
                <div className="mt-1 font-mono text-[11px] uppercase tracking-[0.12em] text-white/35">
                  Closed · open-ended
                </div>
              </div>
              <p className="mt-6 text-sm leading-relaxed text-white/45">
                Déployez un vault et une facilité NAV à partir de primitives natives XRPL. Sans smart contract.
              </p>
              <div className="mt-6 border-t border-white/8 pt-4 font-mono text-[12px] uppercase tracking-[0.14em] text-white/30">
                Bientôt
              </div>
            </div>
          </SpotlightCard>
        </div>
      </section>

      {/* ---- how it works ---- */}
      <section className="grid-lines border-y border-white/8">
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="eyebrow">Mécanisme</div>
          <h2 className="mt-2 text-2xl font-semibold tracking-tight">Trois étapes, aucun smart contract</h2>
          <div className="mt-8 grid gap-4 md:grid-cols-3">
            {[
              { n: "01", t: "Nantir", d: "Vos parts de vault fermé sont bloquées dans un escrow natif, conditionné par une préimage." },
              { n: "02", t: "Emprunter", d: "Un second vault avance des liquidités contre le gage, dimensionnées par une décote." },
              { n: "03", t: "Régler", d: "Remboursement → l'escrow expire et rend les parts. Défaut → saisie par révélation de la préimage." },
            ].map((s) => (
              <div key={s.n} className="glass rounded-md p-6">
                <div className="font-mono text-[12px] text-white/35">{s.n}</div>
                <div className="mt-3 text-lg font-semibold">{s.t}</div>
                <p className="mt-2 text-sm leading-relaxed text-white/50">{s.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ---- cta ---- */}
      <section className="px-6 py-20 text-center">
        <h2 className="mx-auto max-w-[20ch] text-balance text-3xl font-semibold tracking-tight">
          Prêt à financer une position illiquide ?
        </h2>
        <div className="mt-8 flex justify-center">
          <SpecularButton radius={4} baseColor="#4a4a4a" lineColor="#ffffff" textColor="#000000" tint="#ffffff" tintOpacity={1} onClick={() => router.push("/dashboard")}>
            Launch app
          </SpecularButton>
        </div>
      </section>

      <footer className="flex items-center justify-between border-t border-white/8 px-6 py-6 font-mono text-[11px] uppercase tracking-[0.12em] text-white/30">
        <span>RIVAL</span>
        <a href="https://github.com/abaresks24/rival.finance" target="_blank" rel="noopener" className="hover:text-white/60">GitHub</a>
      </footer>
    </div>
  );
}

function Metric({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/35">{k}</div>
      <div className="mt-1 font-mono text-sm font-semibold">{v}</div>
    </div>
  );
}
