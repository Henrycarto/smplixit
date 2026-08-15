import type { Metadata } from "next";
import Link from "next/link";

import { ReadingLevelBadge } from "@/components/core/ReadingLevelBadge";
import { cn } from "@/components/ui/cn";

/**
 * Public case study.
 *
 * The written argument for the product, rendered in the product's own design
 * system rather than as a separate marketing page. The hero uses the real
 * ReadingLevelBadge component, not a picture of it, so the page cannot drift
 * away from what the console actually renders.
 *
 * This is the canonical public version. `docs/portfolio-overview.md` carries
 * the same content for readers inside the repository.
 */

export const metadata: Metadata = {
  title: "Case study",
  description:
    "How Smplixit rewrites discharge summaries to a measured reading grade and proves no medication instruction was lost. Architecture, engineering decisions, and an honest build status.",
};

const SECTIONS = [
  { id: "thesis", label: "Thesis" },
  { id: "architecture", label: "Architecture" },
  { id: "decisions", label: "Decisions" },
  { id: "badge", label: "The badge" },
  { id: "interface", label: "Interface" },
  { id: "split", label: "Repo split" },
  { id: "status", label: "Build status" },
];

const SERVICES = [
  {
    name: "Core",
    role: "Rewrite and measurement",
    detail:
      "Scores the incoming summary with two readability formulas, rewrites to a target grade, then scores the result again. A rewrite that misses is returned marked for clinician review, never as finished work.",
  },
  {
    name: "Poly",
    role: "Translation",
    detail:
      "Freezes every medication name, dose, and number byte-for-byte before translation and verifies each survived. Languages outside machine coverage route to interpreter services rather than being quietly degraded.",
  },
  {
    name: "Guard",
    role: "Medication safety",
    detail:
      "Extracts medications from both sides of the rewrite, normalizes clinical shorthand and plain language into one structure, and cross-references openFDA. One critical finding blocks release.",
  },
];

const GATE = [
  "Both SMOG and Flesch-Kincaid land at or below the target grade.",
  "Guard returned a verdict.",
  "That verdict carries zero critical findings.",
  "No other review reason was recorded.",
];

const REFUSED = [
  "Hero gradients, gradient text, oversized display type",
  "Three-column feature grid of icons and one-line descriptions",
  "Warm cream or near-black backgrounds",
  "Whitespace used as a design gesture",
  "Pill buttons, floating cards, drop shadows as layout",
  "Trusted-by logo strips, testimonial cards, star ratings",
  "Mesh gradients and glow effects",
];

type StatusTone = "ok" | "pending" | "blocked";

const STATUS: Array<{ tone: StatusTone; chip: string; lead: string; body: string }> = [
  {
    tone: "ok",
    chip: "Verified",
    lead: "53 tests passing across three services.",
    body: "13 on scoring, 14 on terminology protection and the language registry, 26 on drug extraction and the pre/post comparison. All three lint clean, on Linux and Python 3.11 rather than only on the development machine.",
  },
  {
    tone: "ok",
    chip: "Verified",
    lead: "Guard exercised end to end.",
    body: "A faithful rewrite passes at 100. The same rewrite with the furosemide dose altered from 40 mg to 4 mg and one warning removed is blocked at 15 with two critical findings, each naming source and output values.",
  },
  {
    tone: "ok",
    chip: "Verified",
    lead: "Shorthand normalizes to plain language.",
    body: "PO BID and “by mouth two times a day” compare as identical, which is the property the entire comparison rests on.",
  },
  {
    tone: "ok",
    chip: "Verified",
    lead: "Outages read as outages.",
    body: "With the database down the dashboard reports a 503, not an empty list, so an outage cannot render as “no records”.",
  },
  {
    tone: "ok",
    chip: "Verified",
    lead: "Images build and infrastructure validates.",
    body: "All three Docker images build from a clean checkout, and the Terraform configuration validates against the AWS provider schema. CI is green across all eight jobs.",
  },
  {
    tone: "pending",
    chip: "Not run",
    lead: "No external credential was used.",
    body: "No live model call, so the rewrite loop's convergence against a real model is unmeasured. This is the largest open item. No live DeepL call. No live openFDA call, Guard is tested against stub fixtures. No database instance. No container has run in ECS and no Terraform plan or apply has touched an AWS account. An image that builds is not an image that runs under a task definition, and a configuration that validates is not one that provisions.",
  },
  {
    tone: "pending",
    chip: "Needs access",
    lead: "The SMART on FHIR flow has never executed against a server.",
    body: "Going live needs vendor app registration and a client id, a registered redirect URI, hospital scope approval, a server-side session store for the PKCE verifier, and a successful sandbox launch. The first three are hospital and vendor process rather than engineering work, and they are the long pole in any deployment of this kind.",
  },
  {
    tone: "blocked",
    chip: "Open",
    lead: "Next.js framework advisories.",
    body: "The published range covers all of Next 14 and 15; only Next 16 is patched. The build stays on 14.2.35 with an override lifting the bundled postcss to a patched release, and most remaining advisories concern features this application does not use. That is a mitigation, not a fix. Migrating is a prerequisite for production PHI handling.",
  },
];

const STACK: Array<[string, string, string]> = [
  ["Console", "Next.js 14 App Router, TypeScript, Tailwind", "Data-dense two-column workspace"],
  ["Services", "FastAPI, async throughout", "I/O-bound by nature"],
  ["Scoring", "textstat, SMOG and Flesch-Kincaid", "Stricter of the two always wins"],
  ["Translation", "DeepL, XML ignore tags", "36 machine targets, 30 interpreter"],
  ["Drug data", "openFDA drug label API", "Cached six hours, public data"],
  ["Database", "PostgreSQL", "Append-only audit trail"],
  ["Auth", "SMART on FHIR, OAuth 2.0 with PKCE", "Epic and Cerner, read only"],
  ["Infra", "AWS ECS Fargate, RDS, S3, Terraform", "Isolated database subnet tier"],
];

export default function CaseStudyPage() {
  return (
    <main className="panel-scroll h-full overflow-auto">
      <div className="mx-auto grid max-w-[1240px] grid-cols-1 gap-10 px-6 py-10 lg:grid-cols-[184px_minmax(0,1fr)] lg:px-10">
        <nav className="hidden lg:block" aria-label="Sections">
          <div className="sticky top-6">
            <span className="label-micro">Case file</span>
            <ol className="mt-3 flex flex-col">
              {SECTIONS.map((section, index) => (
                <li key={section.id}>
                  <a
                    href={`#${section.id}`}
                    className="grid grid-cols-[22px_1fr] gap-2 py-1 text-xs text-slate transition-colors hover:text-accent"
                  >
                    <span className="tabular text-2xs text-slate-dark">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span>{section.label}</span>
                  </a>
                </li>
              ))}
            </ol>
          </div>
        </nav>

        <article className="min-w-0">
          <header>
            <span className="label-micro text-accent">
              Smplixit &middot; Adaptive health literacy engine
            </span>
            <p className="tabular mt-4 text-[clamp(64px,11vw,116px)] font-semibold leading-[0.86] tracking-tight text-white">
              31%
            </p>
            <h1 className="mt-5 max-w-[22ch] text-[clamp(19px,2.4vw,26px)] font-semibold leading-tight tracking-tight text-white">
              of readmissions are caused by patient misunderstanding of discharge
              instructions.
            </h1>
            <p className="mt-4 max-w-[68ch] text-sm leading-relaxed text-slate">
              Smplixit sits inside a hospital&rsquo;s EHR workflow. It takes a clinical
              discharge summary, rewrites it to a measured reading grade, translates it
              into the patient&rsquo;s language, and proves that no medication instruction
              was lost or distorted on the way. Three FastAPI services, a Next.js
              clinician console, SMART on FHIR against Epic and Cerner.
            </p>

            <div className="mt-8 border border-panel-border bg-panel">
              <div className="flex h-7 items-center justify-between border-b border-panel-border bg-panel-muted px-3">
                <span className="label-micro">Specimen, cardiology discharge</span>
                <span className="label-micro">Target grade 6</span>
              </div>
              <div className="px-4 py-4">
                <ReadingLevelBadge from={16.4} to={5.2} target={6} />
              </div>
            </div>
          </header>

          <Section id="thesis" num="01" title="Thesis">
            <P>
              Hospitals discharge patients with instructions written at grade 13 to 16,
              and a large share of United States adults read health material at or below
              basic level. The document explaining how to take a blood thinner is written
              for a reader who is not the patient holding it, and roughly a third of
              preventable readmissions trace back to that gap. Under the CMS Hospital
              Readmissions Reduction Program a hospital can forfeit up to 3% of its base
              Medicare inpatient payments, which makes comprehension one of the few
              readmission drivers a hospital can fix without touching clinical practice.
            </P>
            <P>
              This has gone unsolved not because the problem is subtle but because every
              available fix is the wrong shape. Rewriting by hand does not survive contact
              with discharge volume. Pre-written education leaflets are generic and cannot
              carry a specific dose on a specific schedule. A general purpose language
              model will rewrite a discharge summary and, in the process, drop a
              medication, round a dose, or soften a contraindication, and no hospital will
              accept a tool that silently does that even once. The unlock is not the
              rewriting, which is now commodity capability. It is proving the rewrite did
              not lose anything.
            </P>
          </Section>

          <Section id="architecture" num="02" title="Architecture">
            <P>Three services, deployed independently.</P>

            <div className="mt-5 grid gap-px border border-panel-border bg-panel-border md:grid-cols-3">
              {SERVICES.map((service) => (
                <div key={service.name} className="bg-panel p-4">
                  <h3 className="text-2xs font-semibold uppercase tracking-label text-accent-text">
                    {service.name}
                  </h3>
                  <p className="mt-1 text-2xs uppercase tracking-label text-slate-dark">
                    {service.role}
                  </p>
                  <p className="mt-2 text-xs leading-relaxed text-slate-ink">
                    {service.detail}
                  </p>
                </div>
              ))}
            </div>

            <P className="mt-5">
              They are separate because they fail and scale differently. The concrete
              case: openFDA rate limits at 240 requests per minute per IP. Sharing a
              process with Core would mean a shift-change burst of rewrites exhausts the
              openFDA budget and the backpressure stalls the rewrite queue behind it.
              Separated, Guard queues against its own concurrency limit and Core keeps
              working. Independent deployment also lets the pipeline roll Guard first,
              then Poly, then Core, so Core never runs against a Guard version it does not
              expect.
            </P>

            <div className="mt-5 border border-panel-border bg-panel">
              <div className="flex h-7 items-center border-b border-panel-border bg-panel-muted px-3">
                <span className="label-micro">Release gate, all four must hold</span>
              </div>
              <ol>
                {GATE.map((condition, index) => (
                  <li
                    key={condition}
                    className="grid grid-cols-[28px_1fr] gap-2 border-b border-panel-border px-3 py-2 text-sm text-slate-ink last:border-b-0"
                  >
                    <span className="tabular text-2xs text-accent-text">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span>{condition}</span>
                  </li>
                ))}
              </ol>
              <p className="border-t border-danger/40 bg-danger-muted px-3 py-2 text-xs leading-relaxed text-danger-text">
                Anything else is held for review. If Guard is unreachable the document is
                held, not released: a rewrite that could not be validated is treated the
                same as one that failed validation.
              </p>
            </div>
          </Section>

          <Section id="decisions" num="03" title="Engineering decisions">
            <H3>SMART on FHIR rather than an application login</H3>
            <P>
              Smplixit holds no clinician credentials. Authentication delegates to the
              hospital identity provider over OAuth 2.0 with PKCE, so the clinician is
              already whoever Epic says they are and this application never becomes a
              second place a hospital password can leak from. The client is read-only with
              no write path to the chart, which is the first question an EHR analyst asks.
              The cost is that nothing works until vendor registration completes, and that
              is accepted: an integration a security team will not approve has no value
              regardless of how well it runs.
            </P>

            <H3>Async FastAPI throughout</H3>
            <P>
              The workload is almost entirely waiting on somebody else&rsquo;s network. A
              rewrite holds a connection open for 5 to 40 seconds while Guard makes
              several concurrent openFDA calls and Poly waits on a translation endpoint.
              Under a synchronous model each wait occupies a worker, and shift-change
              volume would need worker counts that stop being economical.
            </P>

            <H3>DeepL over Google Translate</H3>
            <P>
              DeepL is measurably better on medical register in the European languages
              that dominate United States interpreter demand, but the deciding factor was
              mechanical. DeepL supports XML tag handling with an ignore list, which lets
              a dose be wrapped in a tag the engine leaves untouched and returns verbatim.
              That turns terminology preservation from a hope into a verifiable property:
              the exact tokens sent in are checked on the way out, and any that did not
              survive hold the document.
            </P>

            <H3>openFDA as the validation layer</H3>
            <P>
              Asking a model to confirm its own rewrite preserved every dose produces a
              confident answer with no evidential value. openFDA is authoritative, free,
              and public, so it introduces no PHI exposure. Drug extraction runs three
              strategies, a curated lexicon, FDA generic stems such as -pril and -statin,
              and any token sitting immediately in front of a dose. openFDA confirms a
              guessed candidate is really a drug before it can raise a critical finding. A
              false critical finding on a correct rewrite is the failure that kills
              clinical alerting systems, because clinicians learn to dismiss the panel.
            </P>
          </Section>

          <Section id="badge" num="04" title="What the badge signals">
            <P>
              It converts the product&rsquo;s claim into a single measured figure a
              non-technical buyer can act on. A hospital CFO cannot evaluate a rewrite
              pipeline, but they can read that a document their staff produced at grade 16
              now reads at grade 5, and connect that to a readmission penalty already on a
              spreadsheet.
            </P>
            <P>
              Three details make it defensible rather than decorative. The grade shown is
              the maximum of two independent formulas, not their average, because a
              blended score can be gamed by chopping sentences while leaving vocabulary
              untouched. The figure is always the score of the text actually returned, so
              the badge cannot display a target the document did not earn. And when the
              target was missed the fill turns amber and the gap stays visible, because a
              badge that stays green on a failed rewrite is a badge that lies to a
              compliance officer.
            </P>
          </Section>

          <Section id="interface" num="05" title="Interface design">
            <P>
              The reference point is a Bloomberg Terminal or an Epic dashboard, not a
              software marketing site. The buyer is a hospital CFO or chief medical
              officer, and the feeling the interface has to produce on first open is that
              their compliance team already approved it.
            </P>
            <P>
              Borders separate regions instead of shadows, because a floating card wastes
              the space around it. Corner radius tops out at 3px, since pill buttons read
              as consumer software. Every numeral is tabular, so a grade dropping from
              16.4 to 5.2 can be compared by eye down a column. The type scale starts at
              11px because a discharge summary and its rewrite have to sit side by side on
              a workstation display without either being scrolled. Teal is rationed to
              three things: the literacy score, primary actions, and active state.
            </P>

            <p className="mt-5 text-sm font-semibold text-white">Deliberately not built</p>
            <ul className="mt-2 border-l-2 border-panel-strong pl-4">
              {REFUSED.map((item) => (
                <li key={item} className="py-0.5 text-xs text-slate-dark line-through decoration-danger">
                  {item}
                </li>
              ))}
            </ul>
          </Section>

          <Section id="split" num="06" title="Public and private split">
            <P>
              The repository is public except for three files: the prompt pipeline, the
              grade-level constraint logic, and the maintained clinical-term rubric.
            </P>
            <P>
              That boundary follows what is actually differentiated. The FHIR OAuth layer,
              the openFDA client, drug extraction, the pre and post rewrite comparison,
              the scoring methodology, and the infrastructure are all public. They are the
              credibility signal: a reviewer can read the auth flow, check that PKCE is
              done correctly, check that state comparison is constant-time, and confirm
              the safety gate fails closed. None of that is a moat, and hiding it would
              only make the work harder to evaluate.
            </P>
            <P>
              What is worth withholding is the tuning, specifically how a measured failure
              is phrased back into the next pass to make the loop converge while
              preserving every dose. Each withheld module has a tracked reference template
              implementing the same public interface and safety posture, so a clean clone
              builds, boots, and passes the full test suite.
            </P>
          </Section>

          <Section id="status" num="07" title="Build status">
            <P>
              Stated precisely, because the distinction between tested and written matters
              in this conversation.
            </P>

            <div className="mt-5 flex flex-col gap-px border border-panel-border bg-panel-border">
              {STATUS.map((row) => (
                <div
                  key={row.lead}
                  className={cn(
                    "border-l-[3px] bg-panel px-4 py-3",
                    row.tone === "ok" && "border-l-accent",
                    row.tone === "pending" && "border-l-caution",
                    row.tone === "blocked" && "border-l-danger",
                  )}
                >
                  <p className="text-sm leading-relaxed text-slate-ink">
                    <span
                      className={cn(
                        "mr-2 inline-block border px-1.5 py-0.5 align-[1px] text-2xs font-semibold uppercase tracking-label",
                        row.tone === "ok" && "border-accent bg-accent-muted text-accent-text",
                        row.tone === "pending" &&
                          "border-caution bg-caution-muted text-caution-text",
                        row.tone === "blocked" && "border-danger bg-danger-muted text-danger-text",
                      )}
                    >
                      {row.chip}
                    </span>
                    <strong className="font-semibold">{row.lead}</strong>{" "}
                    <span className="text-slate-dark">{row.body}</span>
                  </p>
                </div>
              ))}
            </div>

            <div className="mt-5 border border-accent/40 bg-accent-muted px-4 py-3">
              <p className="text-sm leading-relaxed text-accent-text">
                <strong className="font-semibold">The honest summary.</strong> The safety
                argument, which is the hard part and the actual product, is built and
                tested. The integrations around it are written to specification and waiting
                on credentials.
              </p>
            </div>
          </Section>

          <Section id="stack" num="&mdash;" title="Stack">
            <div className="mt-1 overflow-x-auto border border-panel-border">
              <table className="w-full min-w-[520px] border-collapse bg-panel text-left">
                <thead>
                  <tr className="border-b border-panel-border bg-panel-muted">
                    <th className="px-3 py-1.5 text-2xs font-semibold uppercase tracking-label text-slate-dark">
                      Layer
                    </th>
                    <th className="px-3 py-1.5 text-2xs font-semibold uppercase tracking-label text-slate-dark">
                      Choice
                    </th>
                    <th className="px-3 py-1.5 text-2xs font-semibold uppercase tracking-label text-slate-dark">
                      Note
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {STACK.map(([layer, choice, note]) => (
                    <tr key={layer} className="border-b border-panel-border last:border-b-0">
                      <td className="px-3 py-2 font-mono text-2xs text-slate-ink">{layer}</td>
                      <td className="px-3 py-2 text-xs text-slate-ink">{choice}</td>
                      <td className="px-3 py-2 text-xs text-slate-dark">{note}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <footer className="mt-14 border-t border-shell-border pt-6">
            <p className="max-w-[68ch] text-xs leading-relaxed text-slate-dark">
              Smplixit processes PHI. The reference deployment runs inside the customer
              VPC, encrypts at rest with a customer-managed key, and writes an immutable
              audit row for every rewrite, translation, and validation. The database
              subnet tier has no route to a NAT gateway in either direction.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-3">
              <a
                href="https://github.com/Henrycarto/smplixit"
                className="inline-flex h-8 items-center border border-shell-border px-3 text-xs text-slate transition-colors hover:bg-shell-hover hover:text-white"
              >
                Source on GitHub
              </a>
              <Link
                href="/"
                className="inline-flex h-8 items-center border border-shell-border px-3 text-xs text-slate transition-colors hover:bg-shell-hover hover:text-white"
              >
                Back to overview
              </Link>
            </div>
          </footer>
        </article>
      </div>
    </main>
  );
}

function Section({
  id,
  num,
  title,
  children,
}: {
  id: string;
  num: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mt-14 scroll-mt-6">
      <h2 className="mb-4 grid grid-cols-[30px_1fr] items-baseline gap-2 border-b border-shell-border pb-3 text-[clamp(19px,2.2vw,24px)] font-semibold tracking-tight text-white">
        <span className="tabular text-xs font-medium text-accent">{num}</span>
        <span>{title}</span>
      </h2>
      {children}
    </section>
  );
}

function P({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <p className={cn("mb-4 max-w-[68ch] text-sm leading-relaxed text-slate last:mb-0", className)}>
      {children}
    </p>
  );
}

function H3({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 mt-7 text-sm font-semibold tracking-tight text-white">{children}</h3>
  );
}
