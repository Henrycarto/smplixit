import Link from "next/link";

import { ReadingLevelBadge } from "@/components/core/ReadingLevelBadge";
import { IS_SHOWCASE } from "@/lib/site";

/**
 * Landing page.
 *
 * The thesis is a number, and the number leads. Everything below it is evidence
 * for that number or a specification of what the product does about it. There
 * is no value proposition paragraph, no feature grid, and no call to imagine
 * anything. A hospital CFO evaluating a compliance purchase reads specifications.
 */

const SOURCE_SPECIMEN = `Patient was admitted with acute exacerbation of congestive
heart failure secondary to medication nonadherence. Intravenous
diuresis was initiated with furosemide 40 mg administered twice
daily, with subsequent resolution of peripheral edema.
Anticoagulation was continued with apixaban 5 mg twice daily for
thromboembolic prophylaxis. Patient was discharged in
hemodynamically stable condition with instructions regarding
sodium restriction and daily weight monitoring.`;

const REWRITE_SPECIMEN = `You were in the hospital because your heart failure got worse.
Your body was holding too much fluid.

YOUR MEDICINES:
Furosemide 40 mg, two times a day. This is a water pill.
Apixaban 5 mg, two times a day. This is a blood thinner.

WHAT TO DO AT HOME:
Weigh yourself every morning. Write the number down.
Eat less salt. Do not add salt to your food.

CALL YOUR DOCTOR IF:
You gain 3 pounds in one day.`;

const SERVICES = [
  {
    name: "Core",
    role: "Rewrite and measurement",
    detail:
      "Scores the source with SMOG and Flesch-Kincaid, rewrites to a target grade, then re-measures. A rewrite that misses the target is held, never released.",
  },
  {
    name: "Poly",
    role: "Translation",
    detail:
      "66 languages. Medication names, doses, and numbers are frozen byte-for-byte before translation and verified after it. Languages outside machine coverage route to interpreter services rather than returning an unreviewed document.",
  },
  {
    name: "Guard",
    role: "Medication safety",
    detail:
      "Cross-references every rewrite against openFDA drug label data. One critical finding blocks release regardless of the safety score.",
  },
];

const EVIDENCE = [
  { value: "31%", label: "of readmissions trace to instruction misunderstanding" },
  { value: "3%", label: "of base Medicare payments at risk under the HRRP penalty" },
  { value: "Grade 6", label: "target reading level, versus grade 13 to 16 typical source" },
  { value: "36%", label: "of US adults at basic or below basic health literacy" },
];

export default function LandingPage() {
  return (
    <main className="panel-scroll h-full overflow-auto">
      <section className="border-b border-shell-border">
        <div className="mx-auto grid max-w-[1400px] grid-cols-1 gap-px lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <div className="flex flex-col justify-center px-6 py-10 lg:py-14">
            <span className="label-micro">The readmission problem</span>

            <h1 className="tabular mt-3 text-[5.5rem] font-semibold leading-[0.9] tracking-tight text-white">
              31%
            </h1>

            <p className="mt-4 max-w-xl text-lg leading-snug tracking-tight text-white">
              of readmissions are caused by patient misunderstanding of discharge
              instructions.
            </p>

            <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate">
              Discharge summaries are written at grade 13 to 16. More than a third of
              United States adults read health material at basic level or below. The
              document that tells a patient how to take a blood thinner is written for
              somebody who is not the patient. That gap is measurable, it is fixable,
              and under the CMS Hospital Readmissions Reduction Program it is expensive.
            </p>

            {/* In showcase mode the services are unreachable, so the calls to
                action lead to the case study rather than to a console that
                would render connection errors. */}
            <div className="mt-6 flex items-center gap-2">
              {IS_SHOWCASE ? (
                <>
                  <Link
                    href="/case-study"
                    className="inline-flex h-9 items-center border border-accent bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
                  >
                    Read the case study
                  </Link>
                  <a
                    href="https://github.com/Henrycarto/smplixit"
                    className="inline-flex h-9 items-center border border-shell-border px-4 text-sm text-slate transition-colors hover:bg-shell-hover hover:text-white"
                  >
                    Source on GitHub
                  </a>
                </>
              ) : (
                <>
                  <Link
                    href="/simplify"
                    className="inline-flex h-9 items-center border border-accent bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
                  >
                    Open the console
                  </Link>
                  <Link
                    href="/dashboard"
                    className="inline-flex h-9 items-center border border-shell-border px-4 text-sm text-slate transition-colors hover:bg-shell-hover hover:text-white"
                  >
                    View job history
                  </Link>
                </>
              )}
            </div>
          </div>

          <div className="border-l border-shell-border bg-shell-raised p-6">
            <span className="label-micro">Specimen, cardiology discharge</span>

            <div className="mt-3 border border-panel-border bg-panel px-4 py-3">
              <ReadingLevelBadge from={16.4} to={5.2} target={6} />
            </div>

            <div className="mt-px grid grid-cols-1 gap-px md:grid-cols-2">
              <Specimen label="Source" text={SOURCE_SPECIMEN} tone="clinical" />
              <Specimen label="Patient instructions" text={REWRITE_SPECIMEN} tone="plain" />
            </div>
          </div>
        </div>
      </section>

      <section className="border-b border-shell-border">
        <dl className="mx-auto grid max-w-[1400px] grid-cols-2 divide-x divide-shell-border lg:grid-cols-4">
          {EVIDENCE.map((item) => (
            <div key={item.label} className="px-6 py-5">
              <dt className="tabular text-3xl font-semibold leading-none tracking-tight text-accent">
                {item.value}
              </dt>
              <dd className="mt-2 text-xs leading-snug text-slate">{item.label}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="border-b border-shell-border">
        <div className="mx-auto max-w-[1400px] px-6 py-8">
          <span className="label-micro">System</span>
          <table className="mt-3 w-full border-collapse text-left">
            <thead>
              <tr className="border-b border-shell-border">
                <th className="w-32 py-2 text-2xs font-semibold uppercase tracking-label text-slate-dark">
                  Service
                </th>
                <th className="w-56 py-2 text-2xs font-semibold uppercase tracking-label text-slate-dark">
                  Responsibility
                </th>
                <th className="py-2 text-2xs font-semibold uppercase tracking-label text-slate-dark">
                  Behaviour
                </th>
              </tr>
            </thead>
            <tbody>
              {SERVICES.map((service) => (
                <tr key={service.name} className="border-b border-shell-border align-top">
                  <td className="py-3 pr-4">
                    <span className="text-sm font-semibold tracking-tight text-white">
                      {service.name}
                    </span>
                  </td>
                  <td className="py-3 pr-4 text-sm text-slate">{service.role}</td>
                  <td className="py-3 text-sm leading-snug text-slate">{service.detail}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="mx-auto max-w-[1400px] px-6 py-6">
        <p className="max-w-3xl text-xs leading-relaxed text-slate-dark">
          Smplixit runs inside the hospital VPC and authenticates through SMART on FHIR
          against Epic and Cerner. It reads discharge documentation and writes nothing
          back to the chart. Every rewrite, translation, and validation writes an
          immutable audit row.
        </p>
      </footer>
    </main>
  );
}

function Specimen({
  label,
  text,
  tone,
}: {
  label: string;
  text: string;
  tone: "clinical" | "plain";
}) {
  return (
    <div className="border border-panel-border bg-panel">
      <div className="flex h-7 items-center border-b border-panel-border bg-panel-muted px-3">
        <span className="label-micro">{label}</span>
      </div>
      <pre
        className={
          tone === "clinical"
            ? "panel-scroll max-h-56 overflow-auto whitespace-pre-wrap px-3 py-2 font-mono text-2xs leading-relaxed text-slate-dark"
            : "panel-scroll max-h-56 overflow-auto whitespace-pre-wrap px-3 py-2 font-sans text-xs leading-relaxed text-slate-ink"
        }
      >
        {text}
      </pre>
    </div>
  );
}
