# Quality Vision — quality cockpit

Vision demo: instead of one uniform grid of 184 checkpoints applied to every
supplier, the cockpit generates a **tailored grid** for one product and one
supplier, and marks the five *surgical strikes* that concentrate the audit
effort.

Everything is simulated and self-contained; no supplier, figure or review
refers to a real partner.

## The four stages

| Stage | What it does |
| --- | --- |
| **A — Tech pack intake** | Reads materials, process, critical characteristics and regulatory requirements from the structured bill of materials |
| **B — Customer reviews** | Clusters review themes by frequency and severity, and maps each cluster back to the tech pack cards it implicates |
| **C — Supplier profile** | Scores quality risk from three inputs: non-quality cost history (40%), standards met (20%) and past Decathlon audits — quality and DPR (40%) |
| **D — The tailored grid** | Ranks the candidate checkpoints; every line traces to a tech pack card, a review cluster or a supplier signal |

The grid length follows the risk score: the higher the score, the more
checkpoints are retained.

## Run it

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production bundle in dist/
npm run preview  # serve the built bundle
```

## Deploy

Pushing to `main` builds the site and publishes it through
`.github/workflows/deploy.yml`. Enable it once in
**Settings → Pages → Source → GitHub Actions**; the site is then served at
`https://<user>.github.io/Quality-Vision/`.

The Pages sub-path is applied through the `GITHUB_PAGES` environment variable
(see `vite.config.js`), so local builds keep a plain `/` base.

## Where to change what

| I want to change… | Where in `src/QualityCockpit.jsx` |
| --- | --- |
| products, tech pack cards, review clusters, checkpoint pool | `PRODUCTS` |
| supplier countries and their risk boosts | `COUNTRIES` |
| non-quality cost scenarios | `NQ_COST` |
| standards and the relief they grant | `ISO`, `EXTRA_STANDARDS` |
| past audit scenarios | `QUALITY_AUDITS`, `DPR_AUDITS` |
| the weight of each input in the score | `SCORE_WEIGHTS` |
| how checkpoints are ranked and how many are kept | `generateGrid` |
| the uniform grid size used as the comparison point | `UNIFORM_TOTAL` |

## Stack

React 19, Vite 8, Tailwind CSS 4, lucide-react. No backend, no data leaves the
browser.
