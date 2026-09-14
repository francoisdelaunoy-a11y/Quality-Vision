import { useState, useEffect, useMemo, useRef } from "react";
import { RotateCcw, Play, Check } from "lucide-react";

// ============================================================================
// SIMULATED DATA — single source of truth for the whole cockpit
// ============================================================================

const BLUE = "#0082C3";
const BLUE_DARK = "#005F8F";
const UNIFORM_TOTAL = 184;

const METHODS = {
  lab: { label: "Lab test" },
  inline: { label: "In-line measurement" },
  doc: { label: "Document review" },
  visit: { label: "Unannounced visit" },
};

const FREQ = { frequent: 3, medium: 2, rare: 1 };
const SEV = { severe: 3, minor: 1 };

const COUNTRIES = {
  Italy: { note: "Mature industrial base, short logistics loop, strong regulatory enforcement.", boosts: {} },
  Portugal: { note: "Reliable textile and mold-making ecosystem, moderate audit coverage.", boosts: {} },
  Vietnam: { note: "Fast-growing capacity, frequent subcontracting, variable lab equipment.", boosts: { subcontract: 0.3, visit: 0.2 } },
  China: { note: "Deep supplier tiers, high subcontracting risk, uneven lab capability.", boosts: { subcontract: 0.4, visit: 0.25 } },
  Bangladesh: { note: "Textile-dense, high subcontracting, limited in-house testing.", boosts: { subcontract: 0.5, visit: 0.35, lab: 0.3 } },
};

// Input 1 — history of costs of non-quality events (last three years)
const NQ_COST = {
  low: {
    label: "Low and stable — €18k / €16k / €19k, rework",
    costs: [18, 16, 19], trend: "Stable", type: "In-plant rework",
    score: 12, boosts: { process: 0.15 },
    signal: "Non-quality costs are small and flat. The events stay inside the plant.",
  },
  spike: {
    label: "One spike — €220k recall two years ago, then quiet",
    costs: [220, 24, 20], trend: "Recovered", type: "Recall, then rework",
    score: 40, boosts: { lab: 0.3, final: 0.2 },
    signal: "One recall, then two quiet years. The root cause must be verified as closed.",
  },
  rising: {
    label: "Rising — €42k / €95k / €160k, field returns",
    costs: [42, 95, 160], trend: "Rising", type: "Field returns",
    score: 68, boosts: { final: 0.4, lab: 0.4, inline: 0.3 },
    signal: "Costs have quadrupled in three years and reach the customer. Escapes are not contained at final inspection.",
  },
  degrading: {
    label: "Degrading — €60k / €140k / €310k, field returns and one recall",
    costs: [60, 140, 310], trend: "Degrading", type: "Field returns and recall",
    score: 88, boosts: { final: 0.5, lab: 0.5, inline: 0.4, process: 0.4 },
    signal: "Costs have quintupled, with one recall. Non-quality is now the supplier's dominant cost signal.",
  },
  none: {
    label: "No history — new supplier",
    costs: [], trend: "Unknown", type: "None recorded",
    score: 50, boosts: { doc: 0.3, visit: 0.3 },
    signal: "No non-quality record exists. Absence of data is treated as risk, not as evidence.",
  },
};

// Input 2 — standards already met
const ISO = {
  certified: { label: "ISO 9001 certified", score: 15, boosts: {} },
  expired: { label: "ISO 9001 expired", score: 55, boosts: { doc: 0.4, process: 0.2 } },
  none: { label: "No ISO 9001", score: 80, boosts: { doc: 0.6, process: 0.3 } },
};
const EXTRA_STANDARDS = {
  iso14001: { label: "ISO 14001", relief: 5 },
  iso45001: { label: "ISO 45001", relief: 5 },
  oekotex: { label: "Oeko-Tex 100", relief: 10, families: ["textile"] },
  bsci: { label: "amfori BSCI", relief: 5 },
};

// Input 3a — past Decathlon quality audits (last three, scored /100)
const QUALITY_AUDITS = {
  strong: { label: "Strong — 92 / 90 / 93", scores: [92, 90, 93], findings: ["None", "1 minor", "None"], score: 10, boosts: {}, signal: "Three consistent quality audits, no recurring finding." },
  improving: { label: "Weak but improving — 68 / 74 / 80", scores: [68, 74, 80], findings: ["2 major", "1 major", "2 minor"], score: 40, boosts: { process: 0.3 }, signal: "Quality audits are recovering; the last major finding closed only one cycle ago." },
  worsening: { label: "Worsening — 88 / 79 / 71", scores: [88, 79, 71], findings: ["None", "2 minor, process control", "1 major, final inspection"], score: 78, boosts: { process: 0.6, inline: 0.4, final: 0.5 }, signal: "Quality audit scores fall at each cycle and the last one carries a major finding on the final gate." },
  none: { label: "None — new supplier", scores: [], findings: [], score: 55, boosts: { doc: 0.3, visit: 0.4 }, signal: "No Decathlon quality audit on record." },
};

// Input 3b — past DPR audits (last three, pass / conditional / fail)
const DPR_AUDITS = {
  compliant: { label: "Compliant — passed 3 of 3", results: ["Pass", "Pass", "Pass"], majors: [0, 0, 0], score: 10, boosts: {}, signal: "DPR audits passed three times, no major finding." },
  conditional: { label: "Conditional — 1 major finding open", results: ["Pass", "Conditional", "Conditional"], majors: [0, 1, 1], score: 45, boosts: { doc: 0.3, process: 0.3 }, signal: "DPR conditional twice, the same major finding remains open." },
  worsening: { label: "Worsening — pass, 2 majors, fail", results: ["Pass", "Conditional", "Fail"], majors: [0, 2, 3], score: 82, boosts: { process: 0.5, doc: 0.4, visit: 0.5, subcontract: 0.3 }, signal: "DPR degraded from pass to fail in three cycles; production requirements are no longer held." },
  none: { label: "None — new supplier", results: [], majors: [], score: 55, boosts: { doc: 0.3, visit: 0.4 }, signal: "No DPR audit on record." },
};

// Score composition — weights are displayed to the user
const SCORE_WEIGHTS = { nq: 0.4, standards: 0.2, audits: 0.4 };

// Each product: tech pack cards, review clusters, candidate checkpoint pool.
// Checkpoint sources: tech (card ids), review (cluster ids), tags (supplier signal hooks).
const PRODUCTS = {
  mask: {
    name: "Subea Easybreath full-face snorkel mask",
    short: "Easybreath mask",
    family: "molding",
    familyLabel: "Snorkeling masks",
    context: "Injection molding, ultrasonic welding, silicone overmolding",
    defaults: { country: "Italy", nq: "degrading", iso: "certified", extras: ["iso14001"], qa: "worsening", dpr: "worsening" },
    techPack: [
      { id: "mat", kind: "Material", text: "Polycarbonate lens, silicone skirt, PP frame, TPE strap", conf: 0.96 },
      { id: "proc", kind: "Process", text: "Injection molding, ultrasonic frame weld, lens-to-skirt overmold", conf: 0.93 },
      { id: "weld", kind: "Critical characteristic", text: "Frame weld line integrity, no crack after flex cycles", conf: 0.9 },
      { id: "seal", kind: "Critical characteristic", text: "Lens-to-skirt sealing, no ingress on head form at 1 m", conf: 0.91 },
      { id: "buckle", kind: "Critical characteristic", text: "Strap buckle retention above 80 N", conf: 0.88 },
      { id: "impact", kind: "Critical characteristic", text: "Impact resistance at 1.5 m drop, lens intact", conf: 0.94 },
      { id: "reg", kind: "Regulatory", text: "EN 16805 diving masks, EN 1972 snorkels, CE marking, CO2 rebreathing limit", conf: 0.97 },
    ],
    reviews: [
      { id: "ingress", text: "Water enters around the face seal", freq: "frequent", sev: "severe", maps: ["seal", "mat"], quote: "Fits well on land, but water seeps in along the chin after five minutes." },
      { id: "fog", text: "Lens fogs after a few minutes", freq: "medium", sev: "minor", maps: ["proc", "reg"], quote: "Fogs up unless I keep moving. Fine for a short swim." },
      { id: "crack", text: "Frame cracks after three months", freq: "rare", sev: "severe", maps: ["weld", "mat"], quote: "Hairline crack at the frame joint. Second season, it is done." },
      { id: "strap", text: "Strap buckle slips or pops open", freq: "medium", sev: "minor", maps: ["buckle"], quote: "Buckle loosens on its own while snorkeling." },
    ],
    pool: [
      { id: "m1", label: "Lens-to-skirt ingress test on head form, 1 m, 30 min", method: "lab", base: 5, tech: ["seal"], review: ["ingress"], tags: ["lab", "final"] },
      { id: "m2", label: "Ultrasonic weld parameters logged and within window", method: "inline", base: 5, tech: ["weld", "proc"], review: ["crack"], tags: ["process", "inline"] },
      { id: "m3", label: "Silicone skirt durometer and overmold adhesion per lot", method: "inline", base: 4, tech: ["seal", "mat"], review: ["ingress"], tags: ["process", "inline"] },
      { id: "m4", label: "Frame flex fatigue, 5,000 cycles, no crack at weld", method: "lab", base: 4, tech: ["weld"], review: ["crack"], tags: ["lab", "final"] },
      { id: "m5", label: "Drop test 1.5 m on 10 masks per lot", method: "lab", base: 4, tech: ["impact"], review: [], tags: ["lab", "final"] },
      { id: "m6", label: "Buckle retention above 80 N, sampled hourly", method: "inline", base: 4, tech: ["buckle"], review: ["strap"], tags: ["process", "inline"] },
      { id: "m7", label: "EN 16805 and CO2 rebreathing test report valid for design revision", method: "doc", base: 4, tech: ["reg"], review: [], tags: ["doc"] },
      { id: "m8", label: "Anti-fog coating application and cure log", method: "inline", base: 3, tech: ["proc"], review: ["fog"], tags: ["process"] },
      { id: "m9", label: "Skirt silicone lot traceability to mask lot", method: "doc", base: 3, tech: ["mat"], review: ["ingress", "crack"], tags: ["doc", "subcontract"] },
      { id: "m10", label: "100% ingress check at final station, unannounced observation", method: "visit", base: 4, tech: ["seal"], review: ["ingress"], tags: ["final", "visit"] },
      { id: "m11", label: "Mold temperature and cycle time control charts", method: "inline", base: 3, tech: ["proc"], review: ["crack"], tags: ["process", "inline"] },
      { id: "m12", label: "Strap and buckle sub-assembly source and change control", method: "doc", base: 3, tech: ["buckle"], review: ["strap"], tags: ["doc", "subcontract"] },
      { id: "m13", label: "Corrective actions from last recall closed and verified", method: "doc", base: 3, tech: [], review: [], tags: ["doc", "process", "final"] },
      { id: "m14", label: "Final inspection sampling plan applied (AQL 1.0)", method: "doc", base: 3, tech: [], review: [], tags: ["final", "doc"] },
      { id: "m15", label: "Night shift weld station matches day shift settings", method: "visit", base: 2, tech: ["proc"], review: [], tags: ["visit", "process"] },
      { id: "m16", label: "Regrind ratio limited and recorded", method: "inline", base: 3, tech: ["mat"], review: ["crack"], tags: ["process"] },
      { id: "m17", label: "Calibration of force gauges and ingress rig", method: "doc", base: 2, tech: ["buckle", "seal"], review: [], tags: ["doc", "lab"] },
      { id: "m18", label: "Operator training records for weld and overmold stations", method: "doc", base: 2, tech: ["weld"], review: [], tags: ["doc", "process"] },
      { id: "m19", label: "Carton and drop packaging test", method: "lab", base: 1, tech: [], review: [], tags: ["lab"] },
      { id: "m20", label: "Print and logo adhesion on frame", method: "lab", base: 1, tech: [], review: [], tags: ["lab"] },
    ],
  },

  tshirt: {
    name: "Kalenji Run Dry running T-shirt",
    short: "Run Dry T-shirt",
    family: "textile",
    familyLabel: "Running apparel",
    context: "Cut and sew, flatlock seams, heat-transfer reflective print",
    defaults: { country: "Bangladesh", nq: "rising", iso: "none", extras: ["bsci"], qa: "improving", dpr: "conditional" },
    techPack: [
      { id: "mat", kind: "Material", text: "100% polyester, 110 g/m², moisture-wicking knit", conf: 0.95 },
      { id: "proc", kind: "Process", text: "Cut and sew, flatlock seams, heat-transfer reflective print", conf: 0.9 },
      { id: "seam", kind: "Critical characteristic", text: "Flatlock seam strength above 120 N, no chafing", conf: 0.88 },
      { id: "pill", kind: "Critical characteristic", text: "Pilling resistance grade 4 after 20 washes", conf: 0.9 },
      { id: "wick", kind: "Critical characteristic", text: "Wicking rate above 80 mm in 10 min", conf: 0.87 },
      { id: "print", kind: "Critical characteristic", text: "Reflective print adhesion after 20 washes", conf: 0.89 },
      { id: "reg", kind: "Regulatory", text: "REACH restricted substances, EN ISO 20471 reflectivity for print", conf: 0.96 },
    ],
    reviews: [
      { id: "peel", text: "Reflective logo peels off", freq: "frequent", sev: "minor", maps: ["print", "proc"], quote: "Reflective strip is cracking and peeling after ten washes." },
      { id: "chafe", text: "Seams chafe or open", freq: "medium", sev: "severe", maps: ["seam", "proc"], quote: "Underarm seam opened on a long run. Chafed badly before I noticed." },
      { id: "pills", text: "Pills after a few washes", freq: "medium", sev: "minor", maps: ["pill", "mat"], quote: "Looks worn after a month; little balls all over the back." },
      { id: "odor", text: "Holds odor after one run", freq: "rare", sev: "minor", maps: ["mat"], quote: "Smells after a single session no matter how I wash it." },
    ],
    pool: [
      { id: "t1", label: "Flatlock seam strength and slippage after 5 washes", method: "lab", base: 5, tech: ["seam"], review: ["chafe"], tags: ["lab", "final"] },
      { id: "t2", label: "Stitch density and thread tension checked at line", method: "inline", base: 5, tech: ["seam", "proc"], review: ["chafe"], tags: ["process", "inline"] },
      { id: "t3", label: "Reflective print adhesion after 20 washes", method: "lab", base: 4, tech: ["print"], review: ["peel"], tags: ["lab", "final"] },
      { id: "t4", label: "Heat-press temperature, pressure and dwell logged per lot", method: "inline", base: 4, tech: ["proc", "print"], review: ["peel"], tags: ["process", "inline"] },
      { id: "t5", label: "Pilling test grade 4 after 20 washes", method: "lab", base: 4, tech: ["pill"], review: ["pills"], tags: ["lab"] },
      { id: "t6", label: "REACH test reports for each fabric and print lot", method: "doc", base: 4, tech: ["reg"], review: [], tags: ["doc"] },
      { id: "t7", label: "Sewing subcontractor list and on-site verification", method: "visit", base: 4, tech: ["proc"], review: ["chafe"], tags: ["visit", "subcontract"] },
      { id: "t8", label: "Fabric roll traceability to garment lot", method: "doc", base: 3, tech: ["mat"], review: ["pills"], tags: ["doc", "subcontract"] },
      { id: "t9", label: "Wicking rate on incoming fabric rolls", method: "lab", base: 3, tech: ["wick", "mat"], review: ["odor"], tags: ["lab"] },
      { id: "t10", label: "Final inspection sampling plan applied (AQL 2.5)", method: "doc", base: 3, tech: [], review: [], tags: ["final", "doc"] },
      { id: "t11", label: "In-house lab equipment calibrated and used", method: "visit", base: 3, tech: [], review: [], tags: ["visit", "lab"] },
      { id: "t12", label: "Needle and thread specification match tech pack", method: "doc", base: 3, tech: ["seam"], review: ["chafe"], tags: ["doc", "process"] },
      { id: "t13", label: "Corrective actions on field returns closed and verified", method: "doc", base: 3, tech: [], review: [], tags: ["doc", "process", "final"] },
      { id: "t14", label: "Unannounced production floor walk, night shift", method: "visit", base: 2, tech: ["proc"], review: [], tags: ["visit", "process"] },
      { id: "t15", label: "Fabric GSM and yarn count on incoming rolls", method: "inline", base: 3, tech: ["mat"], review: ["pills"], tags: ["process"] },
      { id: "t16", label: "Reflective film source and change control", method: "doc", base: 3, tech: ["print", "reg"], review: ["peel"], tags: ["doc", "subcontract"] },
      { id: "t17", label: "Antimicrobial finish application log", method: "inline", base: 2, tech: ["mat"], review: ["odor"], tags: ["process"] },
      { id: "t18", label: "Label and care instruction accuracy", method: "doc", base: 1, tech: [], review: [], tags: ["doc"] },
      { id: "t19", label: "Packing and poly bag specification", method: "doc", base: 1, tech: [], review: [], tags: ["doc"] },
      { id: "t20", label: "Operator skill matrix for flatlock stations", method: "doc", base: 2, tech: ["seam"], review: [], tags: ["doc", "process"] },
    ],
  },

  tent: {
    name: "Quechua 2 Seconds Fresh & Black tent",
    short: "2 Seconds tent",
    family: "assembly",
    familyLabel: "Pop-up tents",
    context: "Technical assembly: fiberglass spring frame, taped seams, Fresh & Black coating",
    defaults: { country: "China", nq: "spike", iso: "expired", extras: [], qa: "improving", dpr: "conditional" },
    techPack: [
      { id: "mat", kind: "Material", text: "Fiberglass spring poles, 75D polyester fly with Fresh & Black multilayer coating", conf: 0.94 },
      { id: "proc", kind: "Process", text: "Pole sleeving and hub fixing, seam taping, coating lamination", conf: 0.9 },
      { id: "pole", kind: "Critical characteristic", text: "Pole fold-unfold fatigue, 500 cycles without splinter", conf: 0.89 },
      { id: "water", kind: "Critical characteristic", text: "Hydrostatic head 2,000 mm on fly, 5,000 mm on floor", conf: 0.93 },
      { id: "tape", kind: "Critical characteristic", text: "Seam tape adhesion after 10 setups", conf: 0.86 },
      { id: "dark", kind: "Critical characteristic", text: "Fresh & Black darkness 99% light blocked, ΔT below spec", conf: 0.9 },
      { id: "reg", kind: "Regulatory", text: "Fire retardancy EN 5912, REACH on coatings", conf: 0.95 },
    ],
    reviews: [
      { id: "snap", text: "Pole snapped when folding", freq: "medium", sev: "severe", maps: ["pole", "proc"], quote: "Third time folding it, a pole splintered at the hub." },
      { id: "leaks", text: "Water gets in at the seams", freq: "frequent", sev: "severe", maps: ["tape", "water"], quote: "Seam tape peeled after one summer; rain came straight through." },
      { id: "light", text: "Not as dark as claimed", freq: "medium", sev: "minor", maps: ["dark", "mat"], quote: "Darker than a normal tent, but sunrise still wakes me." },
      { id: "zip", text: "Zipper sticks", freq: "rare", sev: "minor", maps: ["proc"], quote: "Door zip catches on the flap every time." },
    ],
    pool: [
      { id: "c1", label: "Pole fold-unfold fatigue, 500 cycles at hub", method: "lab", base: 5, tech: ["pole"], review: ["snap"], tags: ["lab", "final"] },
      { id: "c2", label: "Seam tape adhesion after setup cycles", method: "lab", base: 5, tech: ["tape"], review: ["leaks"], tags: ["lab", "final"] },
      { id: "c3", label: "Fiberglass pole supplier identity and batch certificate", method: "doc", base: 4, tech: ["mat", "pole"], review: ["snap"], tags: ["doc", "subcontract"] },
      { id: "c4", label: "Hydrostatic head on fly and floor per lot", method: "lab", base: 4, tech: ["water"], review: ["leaks"], tags: ["lab", "final"] },
      { id: "c5", label: "Taping machine temperature and speed logs", method: "inline", base: 4, tech: ["proc", "tape"], review: ["leaks"], tags: ["process", "inline"] },
      { id: "c6", label: "Hub fixing torque and pole seating checked at line", method: "inline", base: 4, tech: ["proc", "pole"], review: ["snap"], tags: ["process", "inline"] },
      { id: "c7", label: "Light transmission and ΔT test on coated fabric lot", method: "lab", base: 4, tech: ["dark"], review: ["light"], tags: ["lab"] },
      { id: "c8", label: "Fire retardancy certificate valid for fabric lot", method: "doc", base: 4, tech: ["reg"], review: [], tags: ["doc"] },
      { id: "c9", label: "Final inspection: full fold and pitch of 5 tents per lot", method: "visit", base: 4, tech: [], review: ["snap", "leaks"], tags: ["final", "visit"] },
      { id: "c10", label: "Unannounced visit to pole subcontractor", method: "visit", base: 3, tech: ["pole"], review: ["snap"], tags: ["visit", "subcontract"] },
      { id: "c11", label: "Coating lamination line settings and lot traceability", method: "inline", base: 3, tech: ["mat", "dark"], review: ["light"], tags: ["process", "subcontract"] },
      { id: "c12", label: "Corrective actions from recall closed and verified", method: "doc", base: 3, tech: [], review: [], tags: ["doc", "process", "final"] },
      { id: "c13", label: "Coating VOC and REACH test report", method: "doc", base: 3, tech: ["reg", "mat"], review: [], tags: ["doc"] },
      { id: "c14", label: "Final inspection sampling plan applied (AQL 1.0)", method: "doc", base: 3, tech: [], review: [], tags: ["final", "doc"] },
      { id: "c15", label: "Lab equipment for hydrostatic test calibrated", method: "doc", base: 2, tech: ["water"], review: [], tags: ["doc", "lab"] },
      { id: "c16", label: "Zipper cycling 5,000 open-close", method: "lab", base: 2, tech: ["proc"], review: ["zip"], tags: ["lab"] },
      { id: "c17", label: "Night shift taping line matches day shift settings", method: "visit", base: 2, tech: ["proc"], review: [], tags: ["visit", "process"] },
      { id: "c18", label: "Operator training on hub fixing", method: "doc", base: 2, tech: ["pole"], review: [], tags: ["doc", "process"] },
      { id: "c19", label: "Guy line and peg strength", method: "lab", base: 1, tech: [], review: [], tags: ["lab"] },
      { id: "c20", label: "Carry bag and packaging spec", method: "doc", base: 1, tech: [], review: [], tags: ["doc"] },
    ],
  },
};

// ============================================================================
// GENERATION ENGINE — deterministic, so every re-run is coherent
// ============================================================================

function riskProfile(p) {
  const nq = NQ_COST[p.nq], iso = ISO[p.iso], qa = QUALITY_AUDITS[p.qa], dpr = DPR_AUDITS[p.dpr];
  const family = PRODUCTS[p.product].family;
  const relief = p.extras.reduce((s, k) => {
    const e = EXTRA_STANDARDS[k];
    return s + (e.families && !e.families.includes(family) ? 0 : e.relief);
  }, 0);
  const standardsScore = Math.max(5, iso.score - relief);
  const auditsScore = Math.round((qa.score + dpr.score) / 2);

  const parts = {
    nq: Math.round(nq.score * SCORE_WEIGHTS.nq),
    standards: Math.round(standardsScore * SCORE_WEIGHTS.standards),
    audits: Math.round(auditsScore * SCORE_WEIGHTS.audits),
  };
  const score = parts.nq + parts.standards + parts.audits;

  const evidenceBad = nq.score >= 60 && qa.score >= 60 && dpr.score >= 60;
  const trap = p.iso === "certified" && evidenceBad;

  const signals = [
    { key: "nq", title: "Non-quality costs", text: nq.signal, sub: nq.score },
    {
      key: "standards", title: "Standards met",
      text: trap
        ? "ISO 9001 certified, yet the cost history and both audit tracks are degrading. The certificate is discounted: it weighs one fifth, the evidence weighs four fifths."
        : iso.label + (p.extras.length ? ", plus " + p.extras.map((k) => EXTRA_STANDARDS[k].label).join(", ") : "") + (p.iso === "certified" ? ". A documented system exists; it is a floor, not a guarantee." : ". Documentation and process discipline cannot be assumed."),
      sub: standardsScore, trap,
    },
    { key: "audits", title: "Past Decathlon audits", text: qa.signal + " " + dpr.signal, sub: auditsScore },
  ];

  const boosts = {};
  for (const src of [COUNTRIES[p.country].boosts, nq.boosts, iso.boosts, qa.boosts, dpr.boosts]) for (const k in src) boosts[k] = Math.max(boosts[k] || 0, src[k]);
  const level = score >= 60 ? "High" : score >= 40 ? "Elevated" : "Moderate";
  return { score, level, parts, signals, boosts, nq, qa, dpr, standardsScore, auditsScore, trap };
}

function tagName(t) {
  return {
    process: "process-control weakness", inline: "in-line control gap", doc: "documentation cannot be assumed",
    visit: "presence required", subcontract: "subcontracting risk", lab: "lab capability doubt", final: "final-gate escapes",
  }[t] || t;
}

function shortTech(t) {
  return t.kind === "Critical characteristic" ? t.text.split(",")[0].toLowerCase() : t.kind.toLowerCase();
}

function generateGrid(product, profile) {
  const p = PRODUCTS[product];
  const reviewById = Object.fromEntries(p.reviews.map((r) => [r.id, r]));
  const techById = Object.fromEntries(p.techPack.map((t) => [t.id, t]));
  const scored = p.pool.map((cp) => {
    let score = cp.base * 10;
    for (const rid of cp.review) { const r = reviewById[rid]; score += FREQ[r.freq] * SEV[r.sev] * 2.2; }
    const hits = [];
    for (const tag of cp.tags) if (profile.boosts[tag]) { score += profile.boosts[tag] * 22; hits.push(tag); }
    const why = [];
    if (cp.tech.length) why.push("tech pack: " + cp.tech.map((t) => shortTech(techById[t])).join(", "));
    if (cp.review.length) why.push("reviews: " + cp.review.map((r) => `"${reviewById[r].text.toLowerCase()}"`).join(", "));
    if (hits.length) why.push("supplier: " + hits.map(tagName).join(", "));
    return { ...cp, score, why: why.join(" — ") || "baseline control point" };
  });
  scored.sort((a, b) => b.score - a.score);
  const n = 12 + Math.min(4, Math.round(profile.score / 22));
  const max = scored[0].score;
  return scored.slice(0, n).map((cp, i) => ({ ...cp, rank: i + 1, weight: Math.round((cp.score / max) * 100), strike: i < 5 }));
}

// ============================================================================
// UI
// ============================================================================

const STAGES = ["Extracting tech pack", "Clustering reviews", "Profiling supplier", "Generating grid"];
const INITIAL = { product: "mask", ...PRODUCTS.mask.defaults };

export default function QualityCockpit() {
  const [params, setParams] = useState(INITIAL);
  const [stage, setStage] = useState(4);
  const [running, setRunning] = useState(false);
  const runId = useRef(0);
  const first = useRef(true);

  const profile = useMemo(() => riskProfile(params), [params]);
  const grid = useMemo(() => generateGrid(params.product, profile), [params.product, profile]);
  const product = PRODUCTS[params.product];

  const run = () => {
    const id = ++runId.current;
    setRunning(true);
    setStage(0);
    [1, 2, 3, 4].forEach((s, i) => setTimeout(() => { if (runId.current === id) { setStage(s); if (s === 4) setRunning(false); } }, 550 * (i + 1)));
  };
  useEffect(() => { if (first.current) { first.current = false; return; } run(); }, [params]);

  const setProduct = (product) => setParams({ product, ...PRODUCTS[product].defaults });
  const reset = () => setParams(INITIAL);
  const techById = Object.fromEntries(product.techPack.map((t) => [t.id, t]));

  return (
    <div className="min-h-screen bg-white text-slate-900" style={{ fontFamily: "Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif" }}>
      <header className="border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 py-5 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-3">
              <span className="inline-block w-7 h-7 rounded-sm" style={{ background: BLUE }} />
              <span className="text-sm text-slate-500">Decathlon · World Quality · Vision 2027</span>
            </div>
            <h1 className="mt-2 text-2xl md:text-3xl font-semibold tracking-tight leading-tight">
              From one grid for everyone to mass precision: surgical quality strikes.
            </h1>
            <p className="mt-1 text-sm text-slate-500">Today, one grid of {UNIFORM_TOTAL} checkpoints for every supplier. Tomorrow, {grid.length} for this one.</p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button onClick={run} disabled={running} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md text-white disabled:opacity-50" style={{ background: BLUE }}>
              <Play size={14} /> Re-run
            </button>
            <button onClick={reset} className="flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border border-slate-200 text-slate-600 hover:bg-slate-50">
              <RotateCcw size={14} /> Reset
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-6">
        <ParamPanel params={params} setParams={setParams} setProduct={setProduct} product={product} />

        {/* Pipeline flow */}
        <div className="mt-6 grid grid-cols-4 gap-2">
          {STAGES.map((s, i) => {
            const done = stage > i, active = running && stage === i;
            return (
              <div key={s} className={`rounded-md px-3 py-2 text-xs border transition-colors ${done ? "border-transparent text-white" : active ? "border-slate-300 bg-slate-50" : "border-slate-200 text-slate-400"}`}
                style={done ? { background: BLUE } : {}}>
                <div className="flex items-center gap-1.5">
                  <span className="font-medium">{["A", "B", "C", "D"][i]}</span>
                  <span className="truncate">{active ? s + "…" : s}</span>
                  {done && <Check size={12} className="ml-auto shrink-0" />}
                  {active && <span className="ml-auto w-2 h-2 rounded-full animate-pulse shrink-0" style={{ background: BLUE }} />}
                </div>
              </div>
            );
          })}
        </div>

        <div className="mt-6 grid md:grid-cols-3 gap-4">
          {/* Stage A */}
          <StageCard letter="A" title="Tech pack intake" sub={product.name} state={stageState(stage, running, 0)}>
            <div className="mb-3 text-xs border-l-2 pl-2 text-slate-600" style={{ borderColor: BLUE }}>
              Source: bill of materials generated by Cognyx. Materials, process and critical characteristics are read directly from the structured BOM.
            </div>
            <div className="space-y-2">
              {product.techPack.map((t) => (
                <div key={t.id} className="text-xs border border-slate-200 rounded-md px-3 py-2">
                  <div className="flex justify-between text-slate-500"><span>{t.kind}</span><span className="tabular-nums">{Math.round(t.conf * 100)}% confidence</span></div>
                  <div className="mt-0.5 text-slate-800">{t.text}</div>
                  <div className="mt-1.5 h-1 bg-slate-100 rounded-sm"><div className="h-1 rounded-sm" style={{ width: `${t.conf * 100}%`, background: BLUE }} /></div>
                </div>
              ))}
            </div>
          </StageCard>

          {/* Stage B */}
          <StageCard letter="B" title="Customer reviews" sub={`${product.familyLabel}, simulated review base`} state={stageState(stage, running, 1)}>
            <div className="space-y-2">
              {product.reviews.map((r) => (
                <div key={r.id} className="text-xs border border-slate-200 rounded-md px-3 py-2">
                  <div className="text-slate-800 font-medium">{r.text}</div>
                  <div className="mt-1 flex gap-2"><Pill>{r.freq}</Pill><Pill dark={r.sev === "severe"}>{r.sev}</Pill></div>
                  <div className="mt-1.5 text-slate-500 italic">“{r.quote}”</div>
                  <div className="mt-1.5 text-slate-500">Implicates: {r.maps.map((m) => shortTech(techById[m])).join(", ")}</div>
                </div>
              ))}
            </div>
          </StageCard>

          {/* Stage C */}
          <StageCard letter="C" title="Supplier profile and quality risk score" sub={`${params.country} · ${product.context}`} state={stageState(stage, running, 2)}>
            <SupplierProfile params={params} profile={profile} />
          </StageCard>
        </div>

        {/* Stage D — hero */}
        <div className="mt-6">
          <StageCard letter="D" title="The tailored grid" sub={`${grid.length} checkpoints instead of ${UNIFORM_TOTAL}, ranked by quality risk score ${profile.score}`} state={stageState(stage, running, 3)} wide hero>
            <div className="hidden md:grid grid-cols-12 gap-3 text-xs text-slate-400 pb-2 border-b border-slate-100" style={{ paddingLeft: 15 }}>
              <div className="col-span-1">Rank</div><div className="col-span-6">Checkpoint and why it is here</div><div className="col-span-2">Method</div><div className="col-span-3 text-right">Weight</div>
            </div>
            <div className="divide-y divide-slate-100">
              {grid.map((cp) => (
                <div key={cp.id} className="py-2.5 grid grid-cols-12 gap-3 items-start" style={cp.strike ? { boxShadow: `inset 3px 0 0 ${BLUE}`, paddingLeft: 12 } : { paddingLeft: 15 }}>
                  <div className="col-span-1 text-sm tabular-nums text-slate-400 pt-0.5">{cp.rank}</div>
                  <div className="col-span-11 md:col-span-6">
                    <div className="text-sm text-slate-900">{cp.label}{cp.strike && <span className="ml-2 text-xs font-medium" style={{ color: BLUE }}>surgical strike</span>}</div>
                    <div className="mt-0.5 text-xs text-slate-500">{cp.why}</div>
                    <div className="mt-1 text-xs text-slate-500 md:hidden">{METHODS[cp.method].label} · weight {cp.weight}</div>
                  </div>
                  <div className="hidden md:block col-span-2 text-xs text-slate-600 pt-0.5">{METHODS[cp.method].label}</div>
                  <div className="hidden md:block col-span-2 pt-1.5"><div className="h-1.5 bg-slate-100 rounded-sm"><div className="h-1.5 rounded-sm" style={{ width: `${cp.weight}%`, background: cp.strike ? BLUE : "#94a3b8" }} /></div></div>
                  <div className="hidden md:block col-span-1 text-xs tabular-nums text-slate-600 pt-0.5 text-right">{cp.weight}</div>
                </div>
              ))}
            </div>
            <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-500">
              <span>{UNIFORM_TOTAL - grid.length} uniform checkpoints not applied to this case</span>
              <span>5 surgical strikes concentrate the audit effort</span>
              <span>Every line traces to a tech pack card, a review cluster or a supplier signal</span>
            </div>
          </StageCard>
        </div>
      </main>

      <footer className="max-w-6xl mx-auto px-6 pb-8 text-xs text-slate-400">
        Vision demo. All suppliers, figures and reviews are simulated and internally consistent; none refer to real partners.
      </footer>
    </div>
  );
}

// ---------------------------------------------------------------- Stage C detail
function SupplierProfile({ params, profile }) {
  const { nq, qa, dpr, parts } = profile;
  const segs = [
    { k: "nq", label: "Non-quality costs", w: SCORE_WEIGHTS.nq, v: parts.nq, color: BLUE_DARK },
    { k: "standards", label: "Standards", w: SCORE_WEIGHTS.standards, v: parts.standards, color: "#7fbfe0" },
    { k: "audits", label: "Decathlon audits", w: SCORE_WEIGHTS.audits, v: parts.audits, color: BLUE },
  ];
  const maxCost = Math.max(1, ...nq.costs);
  return (
    <div className="text-xs">
      <div className="flex items-baseline gap-2">
        <span className="text-3xl font-semibold tabular-nums">{profile.score}</span>
        <span className="text-sm text-slate-600">quality risk score · {profile.level}</span>
      </div>
      <div className="mt-2 flex h-2 rounded-sm overflow-hidden bg-slate-100">
        {segs.map((s) => <div key={s.k} style={{ width: `${s.v}%`, background: s.color }} title={s.label} />)}
      </div>
      <div className="mt-1.5 grid grid-cols-3 gap-2">
        {segs.map((s) => (
          <div key={s.k}>
            <div className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm" style={{ background: s.color }} /><span className="text-slate-600">{s.label}</span></div>
            <div className="text-slate-800 tabular-nums font-medium">+{s.v} <span className="text-slate-400 font-normal">of {Math.round(s.w * 100)}</span></div>
          </div>
        ))}
      </div>

      <div className="mt-3 text-slate-500">{COUNTRIES[params.country].note}</div>

      {/* Input 1 */}
      <Block title="1 · Non-quality cost history" value={`${nq.trend} · ${nq.type}`} contribution={parts.nq}>
        {nq.costs.length > 0 && (
          <div className="mt-1.5 flex gap-2 items-end h-12">
            {nq.costs.map((c, i) => (
              <div key={i} className="flex-1 flex flex-col justify-end items-center">
                <span className="text-slate-600 tabular-nums">€{c}k</span>
                <div className="w-full rounded-sm" style={{ height: `${Math.max(6, (c / maxCost) * 32)}px`, background: BLUE_DARK }} />
                <span className="text-slate-400">Y-{3 - i}</span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-1.5 text-slate-600">{profile.signals[0].text}</div>
      </Block>

      {/* Input 2 */}
      <Block title="2 · Standards met" value={ISO[params.iso].label} contribution={parts.standards} trap={profile.trap}>
        <div className="mt-1 flex flex-wrap gap-1">
          {params.extras.map((k) => <Pill key={k}>{EXTRA_STANDARDS[k].label}</Pill>)}
          {params.extras.length === 0 && <span className="text-slate-400">No additional standard</span>}
        </div>
        <div className={`mt-1.5 ${profile.trap ? "text-slate-900 border-l-2 pl-2" : "text-slate-600"}`} style={profile.trap ? { borderColor: BLUE } : {}}>{profile.signals[1].text}</div>
      </Block>

      {/* Input 3 */}
      <Block title="3 · Past Decathlon audits" value={`Quality ${qa.scores.length ? qa.scores.join(" / ") : "none"} · DPR ${dpr.results.length ? dpr.results.join(" / ") : "none"}`} contribution={parts.audits}>
        <div className="mt-1.5 grid grid-cols-2 gap-2">
          <div>
            <div className="text-slate-500">Quality audits</div>
            {qa.scores.length ? qa.scores.map((s, i) => (
              <div key={i} className="flex justify-between border-b border-slate-100 py-0.5"><span className="tabular-nums font-medium">{s}</span><span className="text-slate-500 truncate ml-2">{qa.findings[i]}</span></div>
            )) : <div className="text-slate-400">No record</div>}
          </div>
          <div>
            <div className="text-slate-500">DPR audits</div>
            {dpr.results.length ? dpr.results.map((r, i) => (
              <div key={i} className="flex justify-between border-b border-slate-100 py-0.5"><span className={`font-medium ${r === "Fail" ? "text-slate-900" : ""}`}>{r}</span><span className="text-slate-500 ml-2">{dpr.majors[i]} major</span></div>
            )) : <div className="text-slate-400">No record</div>}
          </div>
        </div>
        <div className="mt-1.5 text-slate-600">{profile.signals[2].text}</div>
      </Block>
    </div>
  );
}

function Block({ title, value, contribution, trap, children }) {
  return (
    <div className="mt-3 border border-slate-200 rounded-md px-3 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-slate-800">{title}</span>
        <span className="tabular-nums shrink-0" style={{ color: BLUE }}>+{contribution} to score</span>
      </div>
      <div className="text-slate-600">{value}</div>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------- Shared
function stageState(stage, running, i) { return stage > i ? "done" : running && stage === i ? "active" : "waiting"; }

function StageCard({ letter, title, sub, state, children, wide, hero }) {
  return (
    <section className={`rounded-md ${hero ? "border-2" : "border"} ${state === "done" ? "border-slate-200" : "border-slate-200 border-dashed"}`} style={hero && state === "done" ? { borderColor: BLUE } : {}}>
      <div className="px-4 py-3 border-b border-slate-100 flex items-center gap-3">
        <span className="w-6 h-6 rounded-sm text-white text-xs flex items-center justify-center font-medium" style={{ background: state === "done" ? BLUE : "#94a3b8" }}>{letter}</span>
        <div className="min-w-0">
          <div className="text-sm font-medium">{title}</div>
          <div className="text-xs text-slate-500 truncate">{sub}</div>
        </div>
      </div>
      <div className={`p-4 transition-opacity duration-300 ${state === "done" ? "opacity-100" : "opacity-30"} ${wide ? "" : "overflow-y-auto"}`} style={wide ? {} : { maxHeight: 640 }}>
        {state === "waiting" && !wide ? <div className="text-xs text-slate-400">Waiting for the previous stage.</div> : children}
      </div>
    </section>
  );
}

function ParamPanel({ params, setParams, setProduct, product }) {
  const sel = "w-full text-sm border border-slate-200 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2";
  const set = (k) => (e) => setParams({ ...params, [k]: e.target.value });
  const toggleExtra = (k) => setParams({ ...params, extras: params.extras.includes(k) ? params.extras.filter((x) => x !== k) : [...params.extras, k] });
  return (
    <div className="bg-slate-50 border border-slate-200 rounded-md p-4">
      <div className="grid md:grid-cols-3 gap-3">
        <label className="text-xs text-slate-600">Product tech pack
          <select className={sel + " mt-1"} value={params.product} onChange={(e) => setProduct(e.target.value)}>
            {Object.entries(PRODUCTS).map(([k, p]) => <option key={k} value={k}>{p.name}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-600">Supplier country
          <select className={sel + " mt-1"} value={params.country} onChange={set("country")}>
            {Object.keys(COUNTRIES).map((c) => <option key={c}>{c}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-600">Non-quality cost history
          <select className={sel + " mt-1"} value={params.nq} onChange={set("nq")}>
            {Object.entries(NQ_COST).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-600">ISO 9001 status
          <select className={sel + " mt-1"} value={params.iso} onChange={set("iso")}>
            {Object.entries(ISO).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-600">Past quality audits
          <select className={sel + " mt-1"} value={params.qa} onChange={set("qa")}>
            {Object.entries(QUALITY_AUDITS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
        <label className="text-xs text-slate-600">Past DPR audits
          <select className={sel + " mt-1"} value={params.dpr} onChange={set("dpr")}>
            {Object.entries(DPR_AUDITS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-600">
        <span>Other standards met:</span>
        {Object.entries(EXTRA_STANDARDS).map(([k, e]) => {
          const on = params.extras.includes(k);
          const relevant = !e.families || e.families.includes(product.family);
          return (
            <button key={k} onClick={() => toggleExtra(k)} className={`px-2 py-1 rounded-md border ${on ? "text-white border-transparent" : "border-slate-200 bg-white text-slate-600"}`} style={on ? { background: BLUE } : {}} title={relevant ? "" : "Not relevant to this product family: no effect on the score"}>
              {e.label}{!relevant && on ? " (no effect)" : ""}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function Pill({ children, dark }) {
  return <span className={`px-1.5 py-0.5 rounded-sm text-xs ${dark ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-600"}`}>{children}</span>;
}
