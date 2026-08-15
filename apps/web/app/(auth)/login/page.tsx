import Link from "next/link";

/**
 * Sign in.
 *
 * There is no username and password field, and that is the product decision,
 * not an omission. Smplixit does not hold clinician credentials. Authentication
 * is SMART on FHIR against the hospital's identity provider, so the clinician
 * is already who Epic says they are and Smplixit never becomes a second place
 * a password can leak from. That is also the answer to the first question in
 * every hospital security review.
 */

const LAUNCH_STEPS = [
  {
    step: "1",
    title: "EHR launch",
    detail:
      "The clinician opens Smplixit from inside a patient chart. Epic or Cerner redirects to the launch endpoint with an issuer and a launch token.",
  },
  {
    step: "2",
    title: "Authorization",
    detail:
      "Smplixit discovers the authorization endpoint, generates a PKCE challenge, and redirects to the hospital identity provider. No credential touches this application.",
  },
  {
    step: "3",
    title: "Context",
    detail:
      "The token response carries the patient, the encounter, and the authenticated clinician. The discharge document loads without anyone typing a medical record number.",
  },
];

export default function LoginPage() {
  const configured = Boolean(process.env.FHIR_CLIENT_ID && process.env.FHIR_ISSUER);
  const issuer = process.env.FHIR_ISSUER ?? "not configured";

  return (
    <main className="panel-scroll h-full overflow-auto">
      <div className="mx-auto grid max-w-[1100px] grid-cols-1 gap-px px-6 py-10 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
        <section className="border border-shell-border bg-shell-raised p-6">
          <span className="label-micro">Authentication</span>
          <h1 className="mt-2 text-xl font-semibold tracking-tight text-white">
            SMART on FHIR
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-slate">
            Smplixit does not store clinician credentials. Access is delegated to the
            hospital identity provider through OAuth 2.0 with PKCE.
          </p>

          <dl className="mt-5 space-y-3 border-t border-shell-border pt-4">
            <Row label="Scopes">
              <span className="font-mono text-2xs">
                launch openid fhirUser patient/Patient.read patient/DocumentReference.read
              </span>
            </Row>
            <Row label="Access">Read only. This application has no write path to the chart.</Row>
            <Row label="Issuer">
              <span className="break-all font-mono text-2xs">{issuer}</span>
            </Row>
          </dl>

          <div className="mt-6">
            {configured ? (
              <Link
                href="/api/fhir/launch"
                className="inline-flex h-9 w-full items-center justify-center border border-accent bg-accent px-4 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
              >
                Launch from EHR
              </Link>
            ) : (
              <div className="border border-caution/50 bg-caution-muted px-3 py-2">
                <span className="text-2xs font-semibold uppercase tracking-label text-caution-text">
                  Not configured
                </span>
                <p className="mt-1 text-xs leading-snug text-caution-text">
                  Set FHIR_CLIENT_ID and FHIR_ISSUER, then register the redirect URI with
                  the EHR vendor. Until then the console runs against pasted text.
                </p>
              </div>
            )}

            <Link
              href="/simplify"
              className="mt-2 inline-flex h-9 w-full items-center justify-center border border-shell-border px-4 text-sm text-slate transition-colors hover:bg-shell-hover hover:text-white"
            >
              Continue without a chart
            </Link>
          </div>
        </section>

        <section className="border border-shell-border border-l-0 bg-shell p-6">
          <span className="label-micro">Launch sequence</span>
          <ol className="mt-3 divide-y divide-shell-border border-y border-shell-border">
            {LAUNCH_STEPS.map((item) => (
              <li key={item.step} className="flex gap-4 py-3">
                <span className="tabular w-6 shrink-0 text-sm font-semibold text-accent">
                  {item.step}
                </span>
                <div>
                  <h2 className="text-sm font-medium tracking-tight text-white">{item.title}</h2>
                  <p className="mt-0.5 text-xs leading-relaxed text-slate">{item.detail}</p>
                </div>
              </li>
            ))}
          </ol>

          <p className="mt-4 text-xs leading-relaxed text-slate-dark">
            Standalone launch is also supported for clinicians who open Smplixit
            directly. In that mode the EHR presents its own patient picker before
            returning context.
          </p>
        </section>
      </div>
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[80px_minmax(0,1fr)] gap-3">
      <dt className="label-micro pt-0.5">{label}</dt>
      <dd className="text-xs leading-relaxed text-slate">{children}</dd>
    </div>
  );
}
