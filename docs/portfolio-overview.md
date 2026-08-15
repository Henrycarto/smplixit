# Smplixit

A case file on an adaptive health literacy engine for hospital discharge workflows.

---

## 1. Product thesis

Hospitals discharge patients with instructions written at grade 13 to 16, and a large share of United States adults read health material at or below basic level. The document explaining how to take a blood thinner is written for a reader who is not the patient holding it, and roughly a third of preventable readmissions trace back to that gap. This has gone unsolved not because the problem is subtle but because every available fix is the wrong shape. Hiring people to rewrite discharge summaries by hand does not survive contact with discharge volume. Pre-written patient education leaflets are generic and cannot carry a specific dose on a specific schedule. General purpose language models will happily rewrite a discharge summary and, in the process, drop a medication, round a dose, or soften a contraindication, and no hospital will accept a tool that silently does that even once. The unlock is not the rewriting, which is now commodity capability. It is proving the rewrite did not lose anything, which is what makes the output releasable to a patient and what makes the product buyable by the person who signs off on Medicare compliance.

---

## 2. Architecture

Three services, deployed independently.

**Core** rewrites and measures. It scores the incoming discharge summary with two readability formulas, rewrites it to a target grade, then scores the result again. If the rewrite missed, the measured failure is fed back and it tries again, up to a configured attempt limit. A rewrite that never reaches the target is returned marked for clinician review, never as finished work.

**Poly** translates. It freezes every medication name, dose, and number byte-for-byte before the text goes to the translation engine, then verifies each frozen token survived. Languages the engine does not cover are routed to the hospital's interpreter services with the simplified English attached, rather than being quietly machine translated to a lower standard.

**Guard** decides whether the rewrite is safe to hand to a patient. It extracts every medication from both the source and the rewrite, normalizes clinical shorthand and plain language into the same structure so that `PO BID` and `by mouth two times a day` compare as identical, cross-references each drug against openFDA label data, and reports every difference. One critical finding blocks release.

They are separate services because they fail differently and scale differently. The concrete case: openFDA rate limits at 240 requests per minute per IP. Sharing a process with Core would mean a shift-change burst of rewrites exhausts the openFDA budget and the resulting backpressure stalls the rewrite queue behind it. Separated, Guard queues against its own concurrency limit and Core keeps working. Independent deployment also lets the release pipeline roll Guard first, then Poly, then Core, so Core never runs against a Guard version it does not expect.

---

## 3. Engineering decisions

**SMART on FHIR rather than an application login.** Smplixit holds no clinician credentials. Authentication delegates to the hospital identity provider over OAuth 2.0 with PKCE, so the clinician is already whoever Epic says they are, and this application never becomes a second place a hospital password can leak from. The client is read-only with no write path to the chart, which is the first question an EHR analyst asks and the answer that makes app review short. The cost is that nothing works until a hospital completes vendor registration, and that is accepted: an integration a security team will not approve has no value regardless of how well it runs.

**Async FastAPI throughout.** The workload is almost entirely waiting on somebody else's network. A rewrite holds a connection open for 5 to 40 seconds against the model provider while Guard is making several concurrent openFDA calls and Poly is waiting on a translation endpoint. Under a synchronous model each of those waits occupies a worker, and a 200-bed hospital's shift-change volume would need worker counts that stop being economical. Async keeps a single container serving a large number of concurrent in-flight rewrites at low CPU, which is the correct shape for an I/O-bound service and the reason the Fargate task sizing is modest.

**DeepL over Google Translate.** DeepL is measurably better on medical register in the European languages that dominate United States interpreter demand, but the deciding factor was mechanical, not qualitative. DeepL supports XML tag handling with an ignore list, which lets a dose be wrapped in a tag the engine is instructed to leave untouched and returned verbatim. That turns terminology preservation from a hope into a verifiable property: the exact tokens sent in are checked on the way out, and any that did not survive hold the document. The tradeoff is coverage. DeepL targets 36 languages, so the registry carries a second tier of 30 high-demand languages it does not reach, and those route to human interpreters instead of being silently degraded.

**openFDA as the validation layer rather than a model self-check.** Asking a model to confirm its own rewrite preserved every dose produces a confident answer with no evidential value. openFDA is an authoritative external source, free, and public, so it introduces no PHI exposure. Its role is precision: drug extraction runs three strategies, a curated lexicon, FDA generic stems such as `-pril` and `-statin`, and any token sitting immediately in front of a dose, and openFDA is what confirms a guessed candidate is really a drug before it is allowed to raise a critical finding. A false critical finding on a correct rewrite is the failure that kills clinical alerting systems, because clinicians learn to dismiss the panel. Findings on drugs that could not be verified are downgraded to advisory rather than suppressed, and when openFDA is unreachable the response says so.

---

## 4. The ReadingLevelBadge

The badge shows two numbers and the distance between them: grade 16.4 to grade 5.2, with a bar filled to the proportion of grades removed and a tick marking the target.

It matters because it converts the product's claim into a single measured figure a non-technical buyer can act on. A hospital CFO cannot evaluate a rewrite pipeline, but they can read that a document their staff produced at grade 16 now reads at grade 5, and connect that to a readmission penalty they already have on a spreadsheet. It is the one artifact that carries the entire argument without explanation.

Three details make it defensible rather than decorative. The grade shown is the maximum of two independent formulas, SMOG and Flesch-Kincaid, not their average, because a single blended score can be gamed by chopping sentences while leaving the vocabulary untouched, and requiring both to clear the target forces the rewrite to do both kinds of work. The figure is always the score of the text actually returned, so the badge cannot display a target the document did not earn. And when the target was missed the fill turns amber and the gap to the target tick stays visible, because a badge that stays green on a failed rewrite is a badge that lies to a compliance officer, and one instance of that ends the sale.

---

## 5. Interface design

The reference point is a Bloomberg Terminal or an Epic dashboard, not a software marketing site. The buyer is a hospital CFO or chief medical officer, and the feeling the interface has to produce on first open is that their compliance team already approved it.

That translates into rules the build follows without exception. Borders separate regions instead of shadows, because a floating card wastes the space around it. Corner radius tops out at 3px, since pill buttons read as consumer software. Every numeral is tabular, so a grade dropping from 16.4 to 5.2 can be compared by eye down a column. The type scale starts at 11px because a discharge summary and its rewrite have to sit side by side on a workstation display without either being scrolled. Teal is rationed to three things: the literacy score, primary actions, and active state. A color that appears everywhere signals nothing.

The list of what was deliberately not built is as load-bearing as what was:

- No hero gradients, gradient text, or oversized display type
- No three-column feature grid of icons and one-line descriptions
- No warm cream or near-black backgrounds; the shell is a single deep navy
- No whitespace used as a design gesture
- No pill buttons, no floating cards, no drop shadows as layout
- No "trusted by" logo strip, no testimonial cards, no star ratings
- No mesh gradients or glow effects

The landing page follows from the same logic. It opens on the number, 31 percent, at the largest type size in the product, followed by the specimen showing a real cardiology discharge summary before and after. Below that is a dense specification table of the three services and a four-figure evidence strip. There is no value proposition paragraph and no invitation to imagine anything, because the person evaluating a compliance purchase reads specifications and is put off by being sold to.

Information density is the whole argument. Every element on screen earns its place by serving the discharge workflow, and the two-column split giving the before and after the full height of the viewport is the clearest statement of what the product actually is.

---

## 6. Public and private split

The repository is public except for three files: the prompt pipeline, the grade-level constraint and attempt-selection logic, and the maintained clinical-term rubric.

That boundary follows what is actually differentiated. The FHIR OAuth layer, the openFDA client, drug extraction, the pre and post rewrite comparison, the scoring methodology, and the infrastructure are all public. They are the credibility signal: a reviewer can read the auth flow, check that PKCE is done correctly, check that state comparison is constant-time, and confirm the safety gate fails closed. None of that is a moat, because any competent team can rebuild it from the specifications, and hiding it would only make the work harder to evaluate.

What is worth withholding is the tuning, specifically how the measured failure is phrased back into the next pass to make the loop converge in few attempts while preserving every dose. That is accumulated iteration, not architecture, and it is the part that would transfer directly to a competitor.

The split is implemented so it costs nothing to a reader. Each withheld module has a tracked reference template implementing the same public interface and preserving the same safety posture. A bootstrap script materializes them on install, so a clean clone builds, boots, and passes the full test suite. The templates converge more slowly and say so in their own header. Verified by stashing the tuned modules and running the suite against the templates alone.

---

## 7. Build status

Stated precisely, because the distinction between tested and written matters in this conversation.

### Verified working

- 50 tests passing: 10 on scoring, 14 on terminology protection and the language registry, 26 on drug extraction and the pre/post comparison. All three services lint clean.
- Guard exercised end to end offline. A faithful rewrite passes at 100. The same rewrite with the furosemide dose altered from 40 mg to 4 mg and one warning removed is blocked at 15 with two critical findings, each naming the source and output values.
- Clinical shorthand and plain language normalize to the same structure, which is the property the entire comparison rests on.
- Poly returns 66 languages across two tiers, rejects unsupported targets, and routes a tier-two language to interpreter services rather than translating it.
- Core scores real text with both formulas and returns 503 rather than an empty list when the job history is unreachable, so an outage cannot render as "no records".
- Web console typechecks and builds clean across all 8 routes.
- Clean-clone path verified: templates materialize, tests pass, service boots, rubric falls back to its example seed.
- Repository boundary verified: the three withheld files and all environment files are excluded, every template and the full FHIR and openFDA layer are tracked.

### Written but not exercised

No external credential was used, so every third-party integration is unproven against its live service:

- **No live model call.** The rewrite loop's control flow, retry, and scoring gate are implemented and reviewable, but convergence behaviour against a real model is unmeasured. This is the largest open item.
- **No live DeepL call.** Term protection and survival verification are tested offline against the exact payload structure.
- **No live openFDA call.** Guard is tested against stub label fixtures.
- **No database instance.** The schema and audit writes are defined but have never run against live PostgreSQL.
- **Docker images never built, compose never started, Terraform never validated locally.** CI covers all three.

### Requires EHR credentials to go live

The SMART on FHIR flow is complete code that has never executed against a server, including a vendor sandbox. Going live needs, in order: vendor app registration and a client id, a registered redirect URI matching configuration exactly, hospital scope approval, a server-side session store for the PKCE verifier, and a successful sandbox launch. The first three are hospital and vendor process rather than engineering work, and they are the long pole in any deployment of this kind.

### Known issue

`npm audit` reports advisories covering the whole Next.js 14 and 15 line; only Next 16 is patched. The build stays on 14.2.35 with an override lifting the bundled `postcss` to a patched release, and most remaining advisories concern features this application does not use. That is a mitigation, not a fix. **Migrating to Next 16 is a prerequisite for production PHI handling**, and it is scoped work rather than a version bump: React 19 and the async `params` contract.

---

The honest summary is that the safety argument, which is the hard part and the actual product, is built and tested. The integrations around it are written to specification and waiting on credentials.
