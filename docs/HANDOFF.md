# Handoff

For a developer picking this repository up without the author. The README explains what Smplixit is and how to run it; this document explains what state it is actually in, which parts are load-bearing, and where the work resumes.

Read this first, then `docs/architecture.md`.

---

## What is real and what is scaffolding

The single most useful thing to know on day one is that this repository is not uniformly finished. It is a working system with two deliberately unbuilt edges.

| Area | State | Notes |
| --- | --- | --- |
| Scoring (SMOG, Flesch-Kincaid, dual gate) | Real, tested | `services/core`, the methodology is written up in `docs/literacy-scoring-methodology.md` |
| Medication safety checks | Real, tested | `services/guard`, extraction plus openFDA cross-reference |
| Translation with protected terms | Real, tested | `services/poly`, the freeze-and-verify pass is the interesting part |
| SMART on FHIR OAuth | Real, never run against a live EHR | `packages/fhir-client`. Written to the Epic and Cerner specs, not validated against a sandbox tenant. |
| Clinician console | Real | `apps/web`, Next.js 14 App Router |
| Public showcase | Real, not yet deployed | Same app behind `NEXT_PUBLIC_SHOWCASE=1` |
| Rewrite engine internals | **Template stand-ins** | See "Engine modules" below and in the README |
| AWS deployment | **Never executed** | `.github/workflows/deploy.yml` targets a role and registry that do not exist |
| Terraform | Validates, never applied | `infra/terraform` |

Nothing above is a surprise waiting to be discovered; each is stated in the README too. The point of repeating it here is that a new reader should not assume the green CI badge means the system has been run end to end in a hospital. It has not.

### Engine modules

`services/core/app/engine/prompt_builder.py` and `rewriter.py` are excluded from version control. `npm install` runs `scripts/bootstrap-engine.mjs`, which drops tracked `.template.py` counterparts into place when the real modules are absent.

This means a clean clone builds, boots, and passes CI, but the rewrite quality you observe is the template pipeline, not the tuned one. Templates hold the same public interface and the same safety posture; they converge more slowly, so a low target grade takes more passes. If rewrite output looks weak, check whether you are running templates before you go looking for a bug.

---

## Fifteen minutes to a running system

```bash
git clone https://github.com/Henrycarto/smplixit.git
cd smplixit
npm install                                        # also materializes engine templates
cp .env.example .env                               # OPENAI_API_KEY and DEEPL_API_KEY are the two that matter
docker compose -f infra/docker-compose.yml up --build
npm run dev --workspace @smplixit/web              # second terminal
```

Console at http://localhost:3000, each service's OpenAPI at `:800{1,2,3}/docs`.

Without an OpenAI key, Core cannot rewrite, but the console, the scoring endpoints, and Guard's openFDA lookups all still work. That is the cheapest way to get oriented.

The showcase build is a separate thing and needs no backend at all:

```bash
NEXT_PUBLIC_SHOWCASE=1 npm run dev --workspace @smplixit/web
```

---

## Where to look first

Reading these five files in order gives you the system:

1. `services/core/app/engine/scorer.py` — the two readability formulas and the dual gate. The product's central claim lives here.
2. `services/core/app/routers/simplify.py` — the rewrite job lifecycle, including the call out to Guard.
3. `services/guard/app/engine/` — `drug_extractor.py`, `diff_checker.py`, and `fda_client.py`: extraction, comparison across the rewrite, and the openFDA cross-reference that decides whether a job is releasable.
4. `apps/web/components/core/ReadingLevelBadge.tsx` — the signature UI element. Its comment block explains the design system's reasoning better than the tokens do.
5. `apps/web/app/simplify/` — the console's main workflow.

`docs/architecture.md` has the topology and failure modes. `apps/web/tailwind.config.ts` documents the design system's rules and the reason for each.

---

## Decisions that look arbitrary and are not

Changing any of these without reading the reasoning will quietly break a guarantee the product makes.

**Two readability formulas, not one.** SMOG and Flesch-Kincaid disagree in different directions on clinical text. Both must clear the target. A single formula is gameable by sentence splitting. `docs/literacy-scoring-methodology.md`.

**Fail closed everywhere.** A rewrite that cannot be validated returns `needs_review`, never `completed`. A Guard check that cannot run blocks release rather than passing by default. This is the entire safety posture; it is worth more than throughput.

**Medication tokens are frozen byte-for-byte before translation, then verified after.** Not "translated carefully" — frozen. A drug name that survives translation as a plausible near-miss is the failure mode that hurts a patient.

**Teal is rationed.** It marks the literacy score, primary actions, and active state. Nothing else. The badge turns amber on a missed target because a badge that stays teal on a failed rewrite lies to a compliance officer.

**`deploy.yml` has no `push` trigger.** Deliberate, not an omission. Wiring it before the AWS role and ECR registry exist would leave the Actions tab permanently red, which teaches a team to ignore a failing pipeline. The README's Deployment section lists exactly what to provision to turn it on.

**Pinned to Next 14.2.35 despite open advisories.** The advisory range covers all of 14.x and 15.x; only Next 16 clears it, and that needs React 19 and the async `params` migration. The README's Dependency posture section is honest that this is a mitigation, not a fix.

---

## Things that will bite you

- **Run `npm run typecheck` from the repository root, never `tsc` inside `apps/web`.** The two packages set `noUncheckedIndexedAccess` and the web app does not, so package type errors are invisible from the app directory. The root script is what CI runs.
- **`apps/web/vercel.json` must stay in `apps/web`.** Vercel reads `vercel.json` from the configured Root Directory, which is `apps/web`. A copy at the repository root is silently ignored, and the security headers vanish with it.
- **`next/og` needs `runtime = "edge"` on Windows.** Its Node build resolves a WASM binary through `fileURLToPath`, which throws on a path containing spaces and fails the whole build. Both `app/icon.tsx` and `app/opengraph-image.tsx` carry the edge directive and a comment.
- **The deploy workflow has never run.** Its action versions and AWS steps are untested, so the first dispatch is also its first test. Expect to debug it.
- **Three copies of the case-study content exist**: `apps/web/app/case-study/page.tsx` (canonical), `docs/portfolio-overview.md`, and `docs/portfolio-overview.html`. They can drift. If you change the argument, change the page and treat the docs copies as derived.

---

## Where the work resumes

Ordered by what unblocks the most.

1. **Next 16 migration.** Stated in the README as a prerequisite for any production deployment handling PHI. Scoped work: React 19, async `params` in `app/simplify/[id]/page.tsx`, build verification. Do this before anything else touches production.
2. **Validate SMART on FHIR against a real sandbox.** Epic and Cerner both offer developer tenants. The client is written to spec and has never met a live authorization server, which is the highest-risk untested surface in the repository.
3. **Provision AWS and enable deployment.** `infra/terraform`, then the OIDC provider, then the secrets and variables the README's Deployment table lists, then add the `push` trigger back in the same change.
4. **Broaden the Python test suites.** One test file per service (`test_scorer.py`, `test_guard.py`, `test_protection.py`) covers the core logic but not the job lifecycle or the failure paths. The fail-closed behavior in particular deserves tests, because it is the guarantee most likely to regress silently.
5. **Exercise the deploy workflow against staging** before trusting it: `gh workflow run deploy.yml -f environment=staging`.

---

## Open questions for the author

Things a new maintainer cannot resolve from the repository:

- **There is no LICENSE file.** Without one the code is under exclusive copyright and nobody else may legally use, modify, or redistribute it. This needs deciding before any genuine handoff.
- **Where do the tuned engine modules live**, and does a new maintainer get them? The templates are honest stand-ins, but the tuned pipeline is the product's actual quality.
- **Is there a target hospital or pilot**, or is this a portfolio and reference implementation? The answer changes whether items 1 to 3 above are urgent or theoretical.

---

## Continuous integration

`.github/workflows/ci.yml` runs on every push: the web build (typecheck, lint, build), a service matrix across all three (lint, import check, pytest), a Docker image build per service, and Terraform format-check plus validate. CI bootstraps the engine templates first, which is why a clean clone stays green.

`deploy.yml` is not exercised by CI. See above.
