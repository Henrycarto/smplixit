/**
 * @smplixit/fhir-client
 *
 * SMART on FHIR OAuth 2.0 client, tested against the Epic and Cerner sandboxes.
 *
 * Typical EHR launch, split across two route handlers:
 *
 *   // GET /api/fhir/launch?iss=...&launch=...
 *   const pkce = await createPkcePair();
 *   await sessionStore.set({ verifier: pkce.verifier, state: pkce.state, iss });
 *   const url = await buildAuthorizeUrl({
 *     clientId, redirectUri, iss, launch,
 *     scopes: [...DEFAULT_SCOPES],
 *     state: pkce.state,
 *     codeChallenge: pkce.challenge,
 *   });
 *   redirect(url);
 *
 *   // GET /api/fhir/callback?code=...&state=...
 *   const stored = await sessionStore.get();
 *   const session = await exchangeCodeForSession({
 *     code, state, expectedState: stored.state,
 *     codeVerifier: stored.verifier,
 *     clientId, redirectUri, iss: stored.iss,
 *   });
 *
 *   const fhir = new FhirClient(session);
 *   const patient = await fhir.getPatient();
 *   const documents = await fhir.getDischargeDocuments();
 *   const text = await fhir.getDocumentText(documents[0]);
 *
 * The code verifier and state must be stored server side between the two
 * requests, in an httpOnly cookie or a server session. Putting either in
 * localStorage defeats PKCE.
 */

export { discoverSmartConfiguration, clearDiscoveryCache, DiscoveryError } from "./discovery";

export {
  createCodeVerifier,
  createCodeChallenge,
  createState,
  createPkcePair,
  safeEquals,
  type PkcePair,
} from "./pkce";

export {
  buildAuthorizeUrl,
  exchangeCodeForSession,
  refreshSession,
  isExpired,
  AuthError,
  DEFAULT_SCOPES,
  type CallbackParams,
} from "./auth";

export { FhirClient, FhirError, DISCHARGE_SUMMARY_LOINC } from "./client";

export { VENDOR_PROFILES, detectVendor, type VendorProfile } from "./vendors";

export type {
  AuthorizeParams,
  FhirAttachment,
  FhirBundle,
  FhirBundleEntry,
  FhirCodeableConcept,
  FhirCoding,
  FhirDocumentReference,
  FhirHumanName,
  FhirOperationOutcome,
  FhirPatient,
  FhirPatientCommunication,
  FhirVendor,
  LaunchContext,
  SmartConfiguration,
  SmartSession,
  TokenResponse,
} from "./types";
