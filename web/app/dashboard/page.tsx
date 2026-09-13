"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const RIPPLE_OFFSET = 946684800;
const EXPLORER = "https://devnet.xrpl.org/transactions/";
const toXrp = (d: number) => Number(d || 0) / 1e6;
const fmt = (n: number, dp = 2) =>
  Number(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const epochOf = (x: any) => (x && typeof x === "object" ? x.epoch : x);

type View = "lender" | "creditor" | "timeline";

export default function Dashboard() {
  const [S, setS] = useState<any>(null);
  const [view, setView] = useState<View>("lender");
  const [hc, setHc] = useState<number | null>(null);

  useEffect(() => {
    fetch("/state.json?" + Date.now(), { cache: "no-store" })
      .then((r) => r.json())
      .then(setS)
      .catch(() => setS(null));
  }, []);

  if (!S)
    return (
      <main className="relative flex-1 flex items-center justify-center text-white/60 font-mono text-sm">
        chargement de l’état on-chain…
      </main>
    );

  return (
    <main className="relative flex-1 w-full max-w-6xl mx-auto px-5 py-8">
      <header className="flex items-center justify-between border-b border-white/10 pb-5">
        <Link href="/" className="flex items-center gap-4">
          <Image src="/rival-mark-trim.png" alt="RIVAL" width={403} height={64} className="h-7 w-auto" />
          <span className="hidden sm:block font-mono text-[10px] uppercase tracking-[0.22em] text-white/45 leading-4">
            NAV Facility<br />Closed-vault credit · XRPL
          </span>
        </Link>
        <Link href="/" className="rounded-full border border-white/15 px-4 py-2 font-mono text-[11px] uppercase tracking-[0.14em] text-white/60 hover:text-white hover:border-white/40 transition">
          ← accueil
        </Link>
      </header>

      <nav className="mt-6 flex w-fit rounded-full border border-white/12 bg-white/5 p-1 backdrop-blur-md">
        {(["lender", "creditor", "timeline"] as View[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`rounded-full px-6 py-2 font-mono text-[11px] uppercase tracking-[0.16em] transition ${
              view === v ? "bg-white text-black" : "text-white/55 hover:text-white"
            }`}
          >
            {v === "lender" ? "Prêteur" : v === "creditor" ? "Créancier" : "Chronologie"}
          </button>
        ))}
      </nav>

      <div className="mt-6">
        {view === "lender" && <Lender S={S} />}
        {view === "creditor" && <Creditor S={S} hc={hc} setHc={setHc} />}
        {view === "timeline" && <Timeline S={S} />}
      </div>

      <footer className="mt-10 border-t border-white/10 pt-4 font-mono text-[10px] uppercase tracking-[0.12em] text-white/35 flex justify-between">
        <span>RIVAL — NAV lending on XRPL</span>
        <span>{(S.scenario || "repay").toUpperCase()} · {(S.updatedAt || "").slice(11, 19)}</span>
      </footer>
    </main>
  );
}

function Card({ title, tag, children }: any) {
  return (
    <div className="rounded-2xl border border-white/12 bg-white/[0.055] p-5 backdrop-blur-xl shadow-[0_1px_0_0_rgba(255,255,255,0.06)_inset]">
      <div className="mb-4 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.22em] text-white/45">
        <span>{title}</span>
        {tag && <span className="text-white/30">{tag}</span>}
      </div>
      {children}
    </div>
  );
}
const Big = ({ v, u }: { v: string; u?: string }) => (
  <div className="font-semibold leading-none text-[42px] tracking-tight">
    {v}
    {u && <span className="ml-2 align-baseline text-base font-medium text-white/45">{u}</span>}
  </div>
);
const Row = ({ k, v }: { k: string; v: any }) => (
  <div className="flex items-baseline justify-between border-b border-dashed border-white/10 py-2 last:border-0">
    <span className="font-mono text-[11px] uppercase tracking-wide text-white/45">{k}</span>
    <span className="font-mono text-sm font-bold">{v}</span>
  </div>
);
const Label = ({ children }: any) => (
  <div className="font-mono text-[10px] uppercase tracking-[0.22em] text-white/35">{children}</div>
);

function Lender({ S }: any) {
  const c = S.vaults?.credit || {};
  const f = S.facility || {};
  const shares = Number(S.escrow?.shares || 0);
  const pps = f.ppsDrops || c.ppsDrops || 0;
  const posVal = f.grossXrp ?? toXrp(shares) * pps;
  const net = f.netXrp || posVal;
  const ltv = net ? (f.advancedXrp || 0) / net : 0;
  const phase = S.phase || "subscription";
  const es = S.escrow?.status || "—";
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Position" tag="credit vault">
          <Label>Parts détenues</Label>
          <Big v={fmt(toXrp(shares), 2)} u="M SHARES" />
          <p className="mt-3 font-mono text-[11px] text-white/40">{Number(shares).toLocaleString()} parts</p>
        </Card>
        <Card title="Prix par part">
          <Label>PPS (drops/part)</Label>
          <Big v={fmt(pps, 6)} />
          <p className="mt-3 font-mono text-[11px] text-white/40">Monte quand l’emprunteur rembourse ses intérêts.</p>
        </Card>
        <Card title="Valeur de position">
          <Label>Parts × PPS</Label>
          <Big v={fmt(posVal, 2)} u="XRP" />
          <p className="mt-3 font-mono text-[11px] text-white/40">Retrait : {phase === "redemption" ? <span className="text-emerald-400">ouvert</span> : <span className="text-amber-400">verrouillé</span>}</p>
        </Card>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Phase du vault de crédit">
          <div className="flex gap-1.5">
            {["subscription", "investment", "redemption"].map((p) => (
              <div key={p} className={`flex-1 rounded-md border px-2 py-2 text-center font-mono text-[10px] uppercase tracking-wide ${phase === p ? "border-white bg-white text-black font-bold" : "border-white/12 text-white/35"}`}>{p}</div>
            ))}
          </div>
          <div className="mt-4"><Row k="Gage (escrow)" v={<Status s={es} />} /></div>
          <button disabled className="mt-4 w-full cursor-not-allowed rounded-full border border-white/10 py-3 font-mono text-[12px] uppercase tracking-[0.16em] text-white/30">
            {f.advancedXrp > 0 ? "Facilité active" : "Emprunter contre ma position"}
          </button>
        </Card>
        <Card title="Facilité NAV tirée">
          <Row k="Avancé" v={f.advancedXrp ? fmt(f.advancedXrp, 2) + " XRP" : "—"} />
          <Row k="Décote" v={f.haircut != null ? (f.haircut * 100).toFixed(0) + "%" : "—"} />
          <Row k="LTV" v={(ltv * 100).toFixed(1) + "%"} />
          <Bar frac={ltv} mark={1 - (f.haircut ?? 0.2)} />
        </Card>
      </div>
    </div>
  );
}

function Creditor({ S, hc, setHc }: any) {
  const c = S.vaults?.credit || {};
  const f = S.facility || {};
  const shares = Number(S.escrow?.shares || 0);
  const pps = f.ppsDrops || c.ppsDrops || 0;
  const gross = f.grossXrp ?? toXrp(shares) * pps;
  const loss = toXrp(c.lossUnrealized || 0);
  const net = gross - loss;
  const haircut = hc ?? (f.haircut ?? 0.2);
  const maxAdv = net * (1 - haircut);
  const ltv = net ? (f.advancedXrp || 0) / net : 0;
  const es = S.escrow?.status || "—";
  const ca = epochOf(S.escrow?.cancelAfter);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 md:grid-cols-3">
        <Card title="Valeur du gage"><Label>Parts nanties × PPS</Label><Big v={fmt(gross, 2)} u="XRP" /></Card>
        <Card title="Perte latente"><Label>LossUnrealized</Label><Big v={fmt(loss, 2)} u="XRP" /><p className="mt-3 font-mono text-[11px] text-white/40">Absent du ledger quand nul (F-005).</p></Card>
        <Card title="Statut de l’escrow"><Label>Gage sur les parts du LP</Label><div className="mt-3"><Status s={es} big /></div>{ca && <p className="mt-3 font-mono text-[11px] text-white/40">CancelAfter {new Date((ca + RIPPLE_OFFSET) * 1000).toISOString().slice(11, 19)} UTC</p>}</Card>
      </div>
      <Card title="Dimensionnement de l’avance" tag="décote ajustable">
        <div className="grid gap-8 md:grid-cols-2">
          <div>
            <Row k="Valeur nette" v={fmt(net, 2) + " XRP"} />
            <Row k="Décote" v={(haircut * 100).toFixed(0) + "%"} />
            <input type="range" min={0} max={60} value={Math.round(haircut * 100)} onChange={(e) => setHc(Number(e.target.value) / 100)} className="my-3 w-full accent-white" />
            <Row k="Avance max" v={fmt(maxAdv, 2) + " XRP"} />
            <Row k="Déjà avancé" v={f.advancedXrp ? fmt(f.advancedXrp, 2) + " XRP" : "—"} />
          </div>
          <div>
            <Label>LTV courante</Label>
            <Big v={(ltv * 100).toFixed(1)} u="%" />
            <Bar frac={ltv} mark={1 - haircut} />
            <button disabled={S.scenario !== "default"} className={`mt-5 w-full rounded-full py-3 font-mono text-[12px] uppercase tracking-[0.16em] transition ${S.scenario === "default" ? "border border-red-500 text-red-400 hover:bg-red-500 hover:text-black" : "cursor-not-allowed border border-white/10 text-white/30"}`}>
              Saisir le gage
            </button>
            <p className="mt-3 font-mono text-[11px] text-white/40">Saisie = révélation de la préimage → EscrowFinish.</p>
          </div>
        </div>
      </Card>
    </div>
  );
}

function Timeline({ S }: any) {
  const d = S.dates || {};
  const t0 = epochOf(d.t0), sub = epochOf(d.subscriptionDate), cRed = epochOf(d.creditRedemptionDate), fRed = epochOf(d.fundingRedemptionDate), esc = epochOf(d.escrowCancelAfter), orig = epochOf(d.originate);
  const span = Math.max(cRed, fRed) - t0 || 1;
  const pct = (x: number) => Math.max(0, Math.min(100, ((x - t0) / span) * 100));
  const seg = (from: number, to: number, cls: string, label: string) => (
    <div className={`absolute inset-y-0 flex items-center justify-center border-r border-white/10 font-mono text-[9px] uppercase tracking-wider text-white/45 ${cls}`} style={{ left: from + "%", width: to - from + "%" }}>{label}</div>
  );
  const track = (redeem: number) => (
    <div className="relative h-14 overflow-hidden rounded-lg border border-white/12 bg-white/5">
      {seg(0, pct(sub), "bg-white/[0.03]", "SUBSCRIPTION")}
      {seg(pct(sub), pct(redeem), "bg-white/[0.08]", "INVESTISSEMENT")}
      {seg(pct(redeem), 100, "bg-white/[0.03]", "REDEMPTION")}
    </div>
  );
  return (
    <div className="space-y-4">
      <Card title="Deux cycles orchestrés" tag="crédit · financement">
        <Label>Vault de crédit</Label>
        <div className="relative mt-2">
          {track(cRed)}
          {esc && orig && (
            <div className="absolute -top-3 flex h-4 items-center justify-center rounded border border-amber-400/70 bg-amber-400/20 font-mono text-[9px] text-amber-300" style={{ left: pct(orig) + "%", width: pct(esc) - pct(orig) + "%" }}>ESCROW</div>
          )}
        </div>
        <div className="mt-6"><Label>Vault de financement</Label><div className="mt-2">{track(fRed)}</div></div>
        <p className="mt-4 font-mono text-[11px] leading-relaxed text-white/40">La fenêtre d’escrow (ambre) doit se fermer avant la RedemptionDate du vault de crédit — sinon les parts sont hors du compte du LP au retrait.</p>
      </Card>
      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Les quatre inégalités" tag="ordonnanceur visible">
          {Object.entries(S.inequalities || {}).map(([k, v]) => (
            <div key={k} className="flex items-center gap-3 border-b border-dashed border-white/10 py-2.5 font-mono text-[12px] last:border-0">
              <span className={`h-2 w-2 shrink-0 ${v ? "bg-emerald-400" : "bg-red-500"}`} />
              <span className="text-white/55"><b className="text-white">{k.split(") ")[0]})</b> {k.split(") ")[1] || ""}</span>
            </div>
          ))}
        </Card>
        <Card title="Journal on-chain" tag={`${(S.timeline || []).length} tx`}>
          <div className="max-h-80 space-y-0 overflow-auto">
            {(S.timeline || []).map((e: any, i: number) => (
              <div key={i} className="grid grid-cols-[24px_1fr_auto] items-center gap-3 border-b border-dashed border-white/10 py-2.5 last:border-0">
                <span className="font-mono text-[11px] text-white/30">{String(i + 1).padStart(2, "0")}</span>
                <span className="text-[13px] text-white/85">{e.label}</span>
                {e.hash ? <a href={EXPLORER + e.hash} target="_blank" className="font-mono text-[10px] text-white/40 underline decoration-white/20 hover:text-emerald-400">tx ↗</a> : <span className="text-white/20">—</span>}
              </div>
            ))}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Status({ s, big }: { s: string; big?: boolean }) {
  const color = s === "released" || s === "seized" ? "text-emerald-400 border-emerald-400/40" : s === "active" ? "text-amber-400 border-amber-400/40" : "text-white/50 border-white/15";
  return <span className={`inline-flex items-center gap-2 border px-2.5 py-1 font-mono uppercase tracking-wide ${color} ${big ? "text-[11px]" : "text-[10px]"}`}><span className="h-1.5 w-1.5 rounded-full bg-current" />{s}</span>;
}
function Bar({ frac, mark }: { frac: number; mark: number }) {
  return (
    <div className="relative mt-3 h-3 overflow-hidden rounded border border-white/15 bg-white/5">
      <i className="absolute inset-y-0 left-0 bg-white" style={{ width: Math.min(100, frac * 100) + "%" }} />
      <span className="absolute inset-y-[-3px] w-0.5 bg-amber-400" style={{ left: mark * 100 + "%" }} />
    </div>
  );
}
