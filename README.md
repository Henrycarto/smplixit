# Smplixit

**31% of readmissions are caused by patient misunderstanding of discharge instructions.**

Smplixit is an adaptive health literacy engine that sits inside a hospital's EHR workflow. It ingests dense clinical discharge summaries and rewrites them into plain-language patient instructions matched to the patient's measured literacy level and native language, then validates that no medication instruction survived the rewrite in a distorted form.

The financial case is direct: under the CMS Hospital Readmissions Reduction Program, a 200-bed hospital can forfeit up to 3% of its base Medicare inpatient payments for excess 30-day readmissions. Discharge instruction comprehension is one of the few readmission drivers a hospital can fix without touching clinical practice.

---

## Three services

| Service | Purpose | Port |
| --- | --- | --- |
| **Smplixit Core** | Scores the source discharge summary with SMOG and Flesch-Kincaid, then rewrites it to a target grade level (default: Grade 6) through a constrained GPT-4o pipeline. | 8001 |
| **Smplixit Poly** | Translates the simplified English output into 50+ languages via DeepL, with medical terminology preserved through a protected-term pass. | 8002 |
| **Smplixit Guard** | Cross-references every rewritten output against openFDA drug label data to prove that no medication name, dosage, route, frequency, or interaction warning was lost or distorted. | 8003 |

Core calls Guard automatically on every rewrite. A rewrite that fails Guard validation is never marked releasable.

---

## Repository layout

```
smplixit/
├── apps/web/            Next.js 14 App Router clinician console
├── services/core/       FastAPI rewrite and scoring engine
├── services/poly/       FastAPI translation microservice
├── services/guard/      FastAPI drug safety scanner
├── packages/
│   ├── fhir-client/     SMART on FHIR OAuth 2.0 client (Epic / Cerner)
│   └── shared-types/    TypeScript contracts shared by web and services
├── infra/
│   ├── terraform/       ECS Fargate, RDS, S3
│   └── docker-compose.yml
└── docs/
```

---

## Local development

Requirements: Docker Desktop, Node 20+, Python 3.11+.

```bash
git clone https://github.com/Henrycarto/smplixit.git
cd smplixit
npm install                # also materializes the engine modules, see below
cp .env.example .env       # fill in the four API keys
docker compose -f infra/docker-compose.yml up --build
```

That brings up PostgreSQL plus all three FastAPI services. In a second terminal:

```bash
npm install
npm run dev --workspace @smplixit/web
```

The console is served at http://localhost:3000.

### Running a service without Docker

```bash
cd services/core
python -m venv venv && source venv/bin/activate   # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8001
```

Each service exposes interactive OpenAPI docs at `/docs` and a liveness probe at `/health`.

---

## Environment variables

| Variable | Consumed by | Notes |
| --- | --- | --- |
| `OPENAI_API_KEY` | core | GPT-4o rewrite pipeline |
| `DEEPL_API_KEY` | poly | Free keys must also set `DEEPL_API_HOST` to the free endpoint |
| `OPENFDA_API_KEY` | guard | Optional. Raises the rate limit from 240/min to 240,000/day |
| `DATABASE_URL` | core | `postgresql+asyncpg://...` |
| `GUARD_SERVICE_URL` | core | Defaults to `http://guard:8003` inside compose |
| `FHIR_CLIENT_ID` / `FHIR_ISSUER` | web | SMART on FHIR launch |

`.env.example` holds the full list with safe defaults.

---

## The rewrite contract

Core will not return a rewrite that violates any of these:

1. Every medication name present in the source is present in the output, spelled identically.
2. Every dosage, route, and frequency is preserved numerically. Guard fails the job on any numeric drift.
3. Every explicit warning ("do not drive", "stop taking if", allergy notes) survives as its own sentence.
4. The output SMOG and Flesch-Kincaid grade both land at or below the target, with a tolerance of 0.5 grades.

If the pipeline cannot satisfy all four within `MAX_REWRITE_ATTEMPTS` passes, the job returns `status: needs_review` and routes to a human. It never silently ships a degraded rewrite.

---

## Testing

```bash
npm run typecheck                        # all workspaces, not just apps/web
npm run lint && npm run build            # web
cd services/core && pytest               # per service
```

Run `npm run typecheck` from the repository root rather than `tsc` inside `apps/web`. The two packages set `noUncheckedIndexedAccess` and the web app does not, so a type error in `packages/` will not surface from the app directory. The root script is what CI runs.

CI covers eight jobs on every push: the web build, a service matrix across all three, a Docker image build for each, and Terraform validate. See `.github/workflows/ci.yml`.

---

## Public showcase (Vercel)

This repository deploys to Vercel as a standalone public page for the project, separate from the hospital deployment. Vercel cannot host the three FastAPI services, so the showcase serves only the two routes that work without a backend: the landing page and `/case-study`.

Showcase mode is a build flag, not a separate build. Set `NEXT_PUBLIC_SHOWCASE=1` and the application:

- Drops `Dashboard` and `Simplify` from the navigation, and repoints the landing page calls to action at the case study and the GitHub source. Nothing visible leads to a screen that would render a connection error.
- Becomes indexable. The console deployment sets `robots: noindex` because it handles PHI; the showcase has no patient data and exists to be found. `/simplify`, `/dashboard`, `/login`, and `/api/` stay disallowed in `robots.txt` regardless.
- Shows a link back to the portfolio in place of `Sign in`.

| Variable | Value | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SHOWCASE` | `1` | Enables showcase mode |
| `NEXT_PUBLIC_SITE_URL` | the deployment origin | Resolves link preview and sitemap URLs |
| `NEXT_PUBLIC_PORTFOLIO_URL` | the portfolio origin | Renders the way back. Unset renders no link rather than a dead one. |

Project settings: root directory `apps/web`, framework Next.js. Install and build stay on the Vercel defaults, which resolve the npm workspace root and so pick up `@smplixit/shared-types` and `@smplixit/fhir-client`. `apps/web/vercel.json` carries the baseline security headers. It sits beside the application rather than at the repository root because Vercel reads `vercel.json` from the configured root directory, and a copy at the repository root would be silently ignored.

Leave `NEXT_PUBLIC_SHOWCASE` unset for any deployment that has the services behind it, and the console behaves normally.

---

## Deployment

`.github/workflows/deploy.yml` is **manual trigger only**. It has no `push` trigger, and that is deliberate rather than an omission.

The workflow assumes an AWS OIDC role and an ECR registry that do not exist yet. Wiring it to `push` before they do would leave the Actions tab permanently red on a job nobody can fix, which is how a team learns to ignore a failing pipeline and then misses the failure that matters.

To enable continuous deployment, in one change:

1. Provision the deploy role and registry (`infra/terraform`, then register the OIDC provider).
2. Configure the repository settings the workflow reads:

   | Kind | Name | Required |
   | --- | --- | --- |
   | Secret | `AWS_DEPLOY_ROLE_ARN` | Yes |
   | Secret | `ENGINE_ARTIFACT_URI` | Optional. Without it the build falls back to the engine templates. |
   | Variable | `CORE_API_URL`, `POLY_API_URL`, `GUARD_API_URL` | Yes |
   | Variable | `WEB_BUCKET`, `CLOUDFRONT_DISTRIBUTION_ID` | Yes |

   The ECR registry is not configured. It comes from the `amazon-ecr-login` step output, so it follows whichever account the role assumes.

3. Add the trigger back to `deploy.yml`:

```yaml
on:
  push:
    branches: [main]
  workflow_dispatch:
    ...
```

Until then, deploy to staging with `gh workflow run deploy.yml -f environment=staging`, which surfaces a real failure rather than a permanent one.

Note that the deploy workflow is not exercised by CI. Its action versions and AWS steps have never run, so the first dispatch is also its first test.

---

## Engine modules

Two modules under `services/core/app/engine/` are not distributed with this repository:

| Module | What it holds |
| --- | --- |
| `prompt_builder.py` | The constrained prompt pipeline and correction phrasing |
| `rewriter.py` | Grade-level constraint logic, attempt selection, convergence tuning |
| `rubrics/plain_language_map.json` | The maintained clinical-term rubric |

Each has a tracked counterpart at reference quality: `prompt_builder.template.py`, `rewriter.template.py`, and `plain_language_map.example.json`. `npm install` runs `scripts/bootstrap-engine.mjs`, which copies a template into place only where the real module is absent. A clean clone therefore builds, boots, and passes CI without them.

The templates implement the same public interface and preserve the same safety posture: never report a grade the measured text does not earn, fail closed when validation cannot run, never return `completed` for a rewrite that missed its target. They converge more slowly than the tuned pipeline, so expect more passes to reach a low target grade.

Everything else is public, including the full FHIR OAuth layer, the openFDA client, drug extraction, the diff checker, and the scoring methodology.

## Dependency posture

`npm audit` reports advisories against Next.js 14. The advisory range covers the entire 14.x and 15.x line, so no 14.x patch release clears them; only Next 16 does, and it requires React 19 and changes the App Router `params` contract.

The repository stays on Next 14.2.35, the latest 14.x patch, with an npm override lifting Next's bundled `postcss` to a patched release. Most of the remaining advisories concern features this application does not use: the Image Optimizer, Pages Router i18n, custom servers, and Server Actions. That is a mitigation, not a fix.

**Migrating to Next 16 is a prerequisite for a production deployment handling PHI.** It is scoped work, not a version bump: React 19, async `params` in `app/simplify/[id]/page.tsx`, and a build verification pass.

## Documentation

- [`docs/architecture.md`](docs/architecture.md) service topology, data flow, failure modes
- [`docs/fhir-integration.md`](docs/fhir-integration.md) SMART on FHIR launch, scopes, Epic and Cerner specifics
- [`docs/literacy-scoring-methodology.md`](docs/literacy-scoring-methodology.md) why SMOG and Flesch-Kincaid, and how the dual gate works

---

## Compliance posture

Smplixit processes PHI. The reference deployment runs entirely inside a customer VPC, encrypts at rest with KMS, encrypts in transit with TLS 1.2+, and writes an immutable audit row for every rewrite, translation, and validation. No PHI is retained by any third-party model provider: the OpenAI integration runs with zero data retention enabled, and DeepL requests use the no-logging enterprise endpoint. See `docs/architecture.md` for the full boundary diagram.
