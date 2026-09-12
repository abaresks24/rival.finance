// RIVAL NAV — view layer. Reads state.json emitted by scripts/lifecycle.mjs.
const RIPPLE_OFFSET = 946684800;
const EXPLORER_TX = "https://devnet.xrpl.org/transactions/";
const toXrp = (d) => Number(d || 0) / 1e6;
const fmt = (n, dp = 2) => Number(n).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
const epochOf = (x) => (x && typeof x === "object" ? x.epoch : x);

// Fallback so the DA renders even without a served state.json (file://).
const SAMPLE_STATE = {
  brand: "RIVAL", scenario: "repay", network: "XRPL Devnet", explorerTx: EXPLORER_TX,
  phase: "investment", done: false,
  accounts: { LP: "rLP…", GERANT_NAV: "rNAV…" },
  dates: {
    t0: 800000000,
    subscriptionDate: { epoch: 800000110, iso: "" },
    escrowCancelAfter: { epoch: 800000420, iso: "" },
    creditRedemptionDate: { epoch: 800000455, iso: "" },
    fundingRedemptionDate: { epoch: 800000355, iso: "" },
    originate: 800000115, paymentInterval: 60,
  },
  inequalities: {
    "(1) lastRealPayment < creditRedemption": true,
    "(2) lastFacilityPayment < fundingRedemption": true,
    "(3) facilityMaturity < escrowCancelAfter": true,
    "(4) escrowCancelAfter < creditRedemption": true,
  },
  vaults: {
    credit: { kind: "credit", vaultID: "…", shareMPTID: "…", assetsTotal: "42000000", sharesTotal: "40000000", ppsDrops: 1.05, assetsTotalXrp: 42, lossUnrealized: "0" },
    funding: { kind: "funding", vaultID: "…", assetsTotal: "30000000", sharesTotal: "30000000", ppsDrops: 1.0, assetsTotalXrp: 30, lossUnrealized: "0" },
  },
  escrow: { status: "active", shares: "40000000", cancelAfter: { epoch: 800000420, iso: "" } },
  facility: { haircut: 0.2, ppsDrops: 1.05, grossXrp: 42, netXrp: 42, maxAdvanceXrp: 33.6, advancedXrp: 14 },
  timeline: [
    { id: "credit_vault", label: "Credit vault created", hash: null },
    { id: "facility", label: "NAV facility 14 XRP drawn by LP", hash: null },
  ],
  updatedAt: new Date().toISOString(),
};

let S = SAMPLE_STATE;
let hcOverride = null;

async function load() {
  try {
    const r = await fetch("state.json?" + Date.now(), { cache: "no-store" });
    if (r.ok) { S = await r.json(); document.getElementById("c-state").textContent = S.done ? "COMPLETE" : "LIVE"; }
  } catch (e) { document.getElementById("c-state").textContent = "SAMPLE"; }
  render();
}

function currentChainTime() {
  // Best proxy: latest timeline event time, mapped to ripple epoch via dates.t0.
  // We approximate progress from phase + escrow status when no clock is available.
  const d = S.dates || {};
  const t0 = epochOf(d.t0);
  const red = epochOf(d.creditRedemptionDate);
  if (!t0 || !red) return { t: 0, t0: 0, red: 1 };
  // derive an approximate "now" from how far the timeline has progressed
  const order = ["credit_vault", "funding_vault", "lp_deposit", "lpnav_deposit", "credit_broker", "funding_broker", "investment", "real_loan", "pledge", "facility", "real_pay1", "fac_pay1", "real_pay2", "fac_pay2", "release", "withdraw", "seize", "recover"];
  const done = new Set((S.timeline || []).map((e) => e.id));
  let frac = 0.15;
  for (let i = 0; i < order.length; i++) if (done.has(order[i])) frac = (i + 1) / order.length;
  if (S.done) frac = 1;
  return { t: t0 + frac * (red - t0), t0, red };
}

function setPhasePills() {
  const phase = S.phase || "subscription";
  document.querySelectorAll(".phase-pill").forEach((p) => {
    p.classList.toggle("on", p.dataset.phase === phase);
  });
}

function renderLender() {
  const c = S.vaults?.credit || {};
  const f = S.facility || {};
  const shares = Number(S.escrow?.shares || 0);
  // Use the facility-time PPS (frozen at draw); the live vault is drained post-redeem.
  const ppsShown = f.ppsDrops || c.ppsDrops || 0;
  document.getElementById("l-shares").innerHTML = fmt(toXrp(shares), 2) + '<span class="u">M SHARES</span>';
  document.getElementById("l-shares-note").textContent = `${Number(shares).toLocaleString()} parts · vault ${short(c.vaultID)}`;
  document.getElementById("l-pps").textContent = fmt(ppsShown, 6);

  const { t, t0, red } = currentChainTime();
  const day = Math.max(1, Math.min(365, Math.round(((t - t0) / (red - t0)) * 365)));
  document.getElementById("l-day").innerHTML = day + '<span class="u">/ 365</span>';
  document.getElementById("l-day-bar").style.width = (day / 365 * 100) + "%";

  setPhasePills();
  const phase = S.phase || "subscription";
  const withdrawable = phase === "redemption";
  document.getElementById("l-withdraw").innerHTML = withdrawable
    ? '<span style="color:var(--safe)">ouvert</span>'
    : '<span style="color:var(--warn)">verrouillé</span>';
  const posVal = f.grossXrp != null ? f.grossXrp : toXrp(shares) * ppsShown;
  document.getElementById("l-value").textContent = fmt(posVal, 2) + " XRP";

  const borrow = document.getElementById("l-borrow");
  const hint = document.getElementById("l-borrow-hint");
  const canBorrow = phase === "investment" && !(f.advancedXrp > 0);
  borrow.disabled = !canBorrow;
  hint.className = "status " + (f.advancedXrp > 0 ? "safe" : canBorrow ? "warn" : "idle");
  hint.textContent = f.advancedXrp > 0 ? "facilité active" : canBorrow ? "disponible" : "hors phase investissement";

  document.getElementById("l-adv").textContent = f.advancedXrp ? fmt(f.advancedXrp, 2) + " XRP" : "—";
  document.getElementById("l-hc").textContent = f.haircut != null ? (f.haircut * 100).toFixed(0) + "%" : "—";
  const net = f.netXrp || posVal;
  const ltv = net ? (f.advancedXrp || 0) / net : 0;
  document.getElementById("l-ltv").textContent = (ltv * 100).toFixed(1) + "%";
  document.getElementById("l-ltv-bar").style.width = Math.min(100, ltv * 100) + "%";
  document.getElementById("l-ltv-mark").style.left = (1 - (f.haircut ?? 0.2)) * 100 + "%";

  const es = S.escrow?.status || "—";
  document.getElementById("l-escrow-status").innerHTML = statusPill(es);
  document.getElementById("l-escrow-note").textContent = escrowNote(es);
}

function renderCreditor() {
  const c = S.vaults?.credit || {};
  const f = S.facility || {};
  const shares = Number(S.escrow?.shares || 0);
  const pps = c.ppsDrops || f.ppsDrops || 0;
  const gross = toXrp(shares) * pps;
  const loss = toXrp(c.lossUnrealized || 0);
  document.getElementById("cr-gross").innerHTML = fmt(gross, 2) + '<span class="u">XRP</span>';
  document.getElementById("cr-shares-note").textContent = `${Number(shares).toLocaleString()} parts × PPS ${fmt(pps, 4)}`;
  document.getElementById("cr-loss").innerHTML = fmt(loss, 2) + '<span class="u">XRP</span>';

  const es = S.escrow?.status || "—";
  const crE = document.getElementById("cr-escrow");
  crE.className = "status " + statusClass(es);
  crE.textContent = es;
  const ca = epochOf(S.escrow?.cancelAfter);
  document.getElementById("cr-cancel").textContent = ca ? "CancelAfter " + new Date((ca + RIPPLE_OFFSET) * 1000).toISOString().slice(11, 19) + " UTC" : "";

  const hc = hcOverride != null ? hcOverride : (f.haircut ?? 0.2);
  const net = gross - loss;
  const maxAdv = net * (1 - hc);
  document.getElementById("cr-net").textContent = fmt(net, 2) + " XRP";
  document.getElementById("cr-hc").textContent = (hc * 100).toFixed(0) + "%";
  document.getElementById("cr-maxadv").textContent = fmt(maxAdv, 2) + " XRP";
  document.getElementById("cr-adv").textContent = f.advancedXrp ? fmt(f.advancedXrp, 2) + " XRP" : "—";
  const ltv = net ? (f.advancedXrp || 0) / net : 0;
  document.getElementById("cr-ltv").innerHTML = (ltv * 100).toFixed(1) + '<span class="u">%</span>';
  document.getElementById("cr-ltv-bar").style.width = Math.min(100, ltv * 100) + "%";
  document.getElementById("cr-ltv-mark").style.left = (1 - hc) * 100 + "%";

  const seize = document.getElementById("cr-seize");
  const sh = document.getElementById("cr-seize-hint");
  const seized = es === "seized";
  const defaulted = S.scenario === "default";
  seize.disabled = !defaulted || seized;
  sh.className = "status " + (seized ? "danger" : defaulted ? "warn" : "idle");
  sh.textContent = seized ? "gage saisi" : defaulted ? "échéance impayée" : "prêt performant";
}

function renderTimeline() {
  const d = S.dates || {};
  const t0 = epochOf(d.t0);
  const sub = epochOf(d.subscriptionDate);
  const cRed = epochOf(d.creditRedemptionDate);
  const fRed = epochOf(d.fundingRedemptionDate);
  const esc = epochOf(d.escrowCancelAfter);
  const orig = epochOf(d.originate);
  const span = Math.max(cRed, fRed) - t0 || 1;
  const pct = (x) => Math.max(0, Math.min(100, ((x - t0) / span) * 100));

  // credit track
  const ct = document.getElementById("tl-credit");
  ct.innerHTML = seg("sub", 0, pct(sub), "SUBSCRIPTION") + seg("inv", pct(sub), pct(cRed), "INVESTISSEMENT") + seg("red", pct(cRed), 100, "REDEMPTION");
  if (esc && orig) {
    const e = document.createElement("div");
    e.className = "tl-escrow"; e.style.left = pct(orig) + "%"; e.style.width = (pct(esc) - pct(orig)) + "%";
    e.textContent = "ESCROW"; ct.appendChild(e);
    ct.appendChild(marker(pct(esc), "cancel"));
  }
  // funding track
  const ft = document.getElementById("tl-funding");
  ft.innerHTML = seg("sub", 0, pct(sub), "SUBSCRIPTION") + seg("inv", pct(sub), pct(fRed), "INVESTISSEMENT") + seg("red", pct(fRed), 100, "REDEMPTION");

  // inequalities
  const il = document.getElementById("ineq-list");
  il.innerHTML = "";
  Object.entries(S.inequalities || {}).forEach(([k, v]) => {
    const row = document.createElement("div"); row.className = "ineq";
    row.innerHTML = `<span class="dot ${v ? "ok" : "no"}"></span><span class="t"><b>${k.split(") ")[0]})</b> ${k.split(") ")[1] || ""}</span>`;
    il.appendChild(row);
  });

  // feed
  const feed = document.getElementById("feed");
  const evs = S.timeline || [];
  document.getElementById("tl-count").textContent = evs.length + " tx";
  feed.innerHTML = "";
  evs.forEach((e, i) => {
    const row = document.createElement("div"); row.className = "ev" + (e.hash ? "" : " pending");
    row.innerHTML = `<span class="n">${String(i + 1).padStart(2, "0")}</span><span class="l">${e.label}</span>` +
      (e.hash ? `<a href="${EXPLORER_TX}${e.hash}" target="_blank">tx ↗</a>` : `<span class="n">—</span>`);
    feed.appendChild(row);
  });
}

function seg(cls, from, to, label) {
  return `<div class="tl-seg ${cls}" style="left:${from}%;width:${to - from}%">${label}</div>`;
}
function marker(left, id) {
  const m = document.createElement("div"); m.className = "tl-marker"; m.style.left = left + "%";
  m.innerHTML = `<span>escrow cancel</span>`; return m;
}
function short(s) { return s && s.length > 12 ? s.slice(0, 6) + "…" + s.slice(-4) : s || "—"; }
function statusClass(es) { return es === "released" || es === "seized" ? "safe" : es === "active" ? "warn" : es && es.includes("fail") ? "danger" : "idle"; }
function statusPill(es) { return `<span class="status ${statusClass(es)}">${es}</span>`; }
function escrowNote(es) {
  if (es === "active") return "Parts verrouillées. Remboursement → expiration → EscrowCancel rend les parts.";
  if (es === "released") return "Parts rendues au LP après expiration de l'escrow.";
  if (es === "seized") return "Défaut : le créancier a révélé la préimage et saisi les parts.";
  return "";
}

function render() {
  document.getElementById("c-scenario").textContent = (S.scenario || "—").toUpperCase();
  document.getElementById("c-net").textContent = S.network || "XRPL Devnet";
  document.getElementById("f-updated").textContent = "updated " + (S.updatedAt || "").slice(11, 19);
  renderLender(); renderCreditor(); renderTimeline();
}

// tabs
document.querySelectorAll("nav.tabs button").forEach((b) => {
  b.addEventListener("click", () => {
    document.querySelectorAll("nav.tabs button").forEach((x) => x.classList.remove("active"));
    b.classList.add("active");
    document.querySelectorAll(".view").forEach((v) => v.classList.add("hidden"));
    document.getElementById("view-" + b.dataset.view).classList.remove("hidden");
  });
});
// haircut slider
document.getElementById("cr-hc-range").addEventListener("input", (e) => {
  hcOverride = Number(e.target.value) / 100; renderCreditor();
});

// deep-link a view via #creditor / #timeline (used for demo screenshots)
function applyHash() {
  const v = (location.hash || "").replace("#", "");
  if (["lender", "creditor", "timeline"].includes(v)) {
    document.querySelector(`nav.tabs button[data-view="${v}"]`)?.click();
  }
}
window.addEventListener("hashchange", applyHash);

load().then(applyHash);
setInterval(load, 5000); // live refresh while the lifecycle runs
