/**
 * SMART on FHIR wiring for the console.
 *
 * The OAuth flow itself lives in @smplixit/fhir-client. This module holds the
 * application-level policy: which scopes to request, where the redirect lands,
 * and how a FHIR patient becomes the context the simplify screen works with.
 *
 * Session storage is deliberately left as an interface rather than an
 * implementation. Where the session lives, an httpOnly cookie, Redis, or the
 * hospital's own session service, is a deployment decision that varies per
 * customer security review. Picking one here would make the wrong choice for
 * somebody.
 */

import {
  DEFAULT_SCOPES,
  FhirClient,
  buildAuthorizeUrl,
  createPkcePair,
  detectVendor,
  exchangeCodeForSession,
  isExpired,
  refreshSession,
  type FhirDocumentReference,
  type FhirPatient,
  type SmartSession,
} from "@smplixit/fhir-client";

export const FHIR_CONFIG = {
  clientId: process.env.FHIR_CLIENT_ID ?? "",
  issuer: process.env.FHIR_ISSUER ?? "",
  redirectUri: process.env.FHIR_REDIRECT_URI ?? "http://localhost:3000/api/fhir/callback",
  scopes: (process.env.FHIR_SCOPES?.split(" ").filter(Boolean) ?? [...DEFAULT_SCOPES]) as string[],
} as const;

export function isFhirConfigured(): boolean {
  return Boolean(FHIR_CONFIG.clientId && FHIR_CONFIG.issuer);
}

/**
 * Cookie holding the pending launch between the redirect and the callback.
 *
 * Defined here rather than in either route module so the two handlers do not
 * import each other. Route modules are build targets, and importing one from
 * another couples their compilation.
 */
export const LAUNCH_COOKIE = "smplixit_launch";

/** The full window in which a pending launch is useful. */
export const LAUNCH_TTL_SECONDS = 300;

/** What the launch handler must persist between the redirect and the callback. */
export interface PendingLaunch {
  codeVerifier: string;
  state: string;
  iss: string;
}

export interface LaunchStore {
  save(launch: PendingLaunch): Promise<void>;
  take(): Promise<PendingLaunch | null>;
}

/**
 * Step one of the launch. Returns the URL to redirect the clinician to, and the
 * values the callback will need to verify the response.
 */
export async function beginLaunch(params: { iss?: string; launch?: string }): Promise<{
  authorizeUrl: string;
  pending: PendingLaunch;
}> {
  const iss = params.iss ?? FHIR_CONFIG.issuer;
  if (!iss) {
    throw new Error("No FHIR issuer. Set FHIR_ISSUER or launch from the EHR with an iss.");
  }
  if (!FHIR_CONFIG.clientId) {
    throw new Error("FHIR_CLIENT_ID is not set. Register the app with the EHR vendor first.");
  }

  const pkce = await createPkcePair();
  const authorizeUrl = await buildAuthorizeUrl({
    clientId: FHIR_CONFIG.clientId,
    redirectUri: FHIR_CONFIG.redirectUri,
    scopes: FHIR_CONFIG.scopes,
    iss,
    launch: params.launch,
    state: pkce.state,
    codeChallenge: pkce.challenge,
    vendor: detectVendor(iss),
  });

  return {
    authorizeUrl,
    pending: { codeVerifier: pkce.verifier, state: pkce.state, iss },
  };
}

/** Step two. Verifies state, exchanges the code, returns a usable session. */
export async function completeLaunch(params: {
  code: string;
  state: string;
  pending: PendingLaunch;
}): Promise<SmartSession> {
  return exchangeCodeForSession({
    code: params.code,
    state: params.state,
    expectedState: params.pending.state,
    codeVerifier: params.pending.codeVerifier,
    clientId: FHIR_CONFIG.clientId,
    redirectUri: FHIR_CONFIG.redirectUri,
    iss: params.pending.iss,
  });
}

/** Refresh transparently when the token is close to expiring. */
export async function ensureFreshSession(session: SmartSession): Promise<SmartSession> {
  if (!isExpired(session)) return session;
  return refreshSession(session, { clientId: FHIR_CONFIG.clientId });
}

/** The context the simplify screen works with. */
export interface PatientContext {
  patientId: string;
  displayName: string;
  birthDate?: string;
  /** BCP 47 code, or null when the chart does not record one. */
  preferredLanguage: string | null;
  encounterId?: string;
}

export async function loadPatientContext(session: SmartSession): Promise<PatientContext> {
  const client = new FhirClient(session);
  const patient: FhirPatient = await client.getPatient();

  return {
    patientId: patient.id,
    displayName: FhirClient.patientDisplayName(patient),
    birthDate: patient.birthDate,
    preferredLanguage: FhirClient.preferredLanguage(patient),
    encounterId: session.encounterId,
  };
}

export interface DischargeDocument {
  id: string;
  title: string;
  date?: string;
  contentType?: string;
}

export async function listDischargeDocuments(
  session: SmartSession,
): Promise<DischargeDocument[]> {
  const client = new FhirClient(session);
  const documents = await client.getDischargeDocuments();

  return documents.map((document: FhirDocumentReference) => ({
    id: document.id,
    title:
      document.description ??
      document.type?.text ??
      document.type?.coding?.[0]?.display ??
      `Document ${document.id}`,
    date: document.date,
    contentType: document.content?.[0]?.attachment?.contentType,
  }));
}

export async function loadDocumentText(
  session: SmartSession,
  documentId: string,
): Promise<string> {
  const client = new FhirClient(session);
  const documents = await client.getDischargeDocuments();
  const target = documents.find((document) => document.id === documentId);
  if (!target) {
    throw new Error(`DocumentReference/${documentId} is not in this patient's discharge set`);
  }
  return client.getDocumentText(target);
}
