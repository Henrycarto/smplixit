/**
 * SMART on FHIR and FHIR R4 types, narrowed to what Smplixit reads.
 *
 * Deliberately not a full FHIR type library. A complete R4 model is roughly
 * 30,000 lines of generated types, and importing one would make every build
 * slower to serve fields nobody touches. Smplixit reads a patient, a list of
 * document references, and the binary behind the discharge summary. That is
 * the whole surface, so that is what is modeled.
 */

export type FhirVendor = "epic" | "cerner" | "generic";

/** Response shape of `.well-known/smart-configuration`. */
export interface SmartConfiguration {
  authorization_endpoint: string;
  token_endpoint: string;
  introspection_endpoint?: string;
  revocation_endpoint?: string;
  capabilities?: string[];
  code_challenge_methods_supported?: string[];
  scopes_supported?: string[];
  grant_types_supported?: string[];
}

export interface LaunchContext {
  /** The FHIR base URL the EHR handed us on launch. */
  iss: string;
  /** Opaque launch token, present for EHR launch and absent for standalone. */
  launch?: string;
}

export interface AuthorizeParams {
  clientId: string;
  redirectUri: string;
  scopes: string[];
  iss: string;
  launch?: string;
  /** Opaque value echoed back. Compare on callback or the flow is forgeable. */
  state: string;
  /** S256 challenge derived from the verifier. Required by SMART v2. */
  codeChallenge: string;
  /** Vendor-specific extras, for example Epic's `aud` handling. */
  vendor?: FhirVendor;
}

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer" | string;
  expires_in: number;
  scope: string;
  refresh_token?: string;
  id_token?: string;
  /** Context the EHR hands back. Present when the matching scope was granted. */
  patient?: string;
  encounter?: string;
  fhirUser?: string;
  need_patient_banner?: boolean;
  smart_style_url?: string;
}

export interface SmartSession {
  accessToken: string;
  refreshToken?: string;
  /** Epoch milliseconds. Compare against Date.now(), not against expires_in. */
  expiresAt: number;
  scope: string;
  serverUrl: string;
  patientId?: string;
  encounterId?: string;
  fhirUser?: string;
  idToken?: string;
}

/* ------------------------------------------------------------ FHIR R4 */

export interface FhirCoding {
  system?: string;
  code?: string;
  display?: string;
}

export interface FhirCodeableConcept {
  coding?: FhirCoding[];
  text?: string;
}

export interface FhirHumanName {
  use?: string;
  text?: string;
  family?: string;
  given?: string[];
  prefix?: string[];
}

export interface FhirPatientCommunication {
  language: FhirCodeableConcept;
  /** The flag that decides which language Poly targets. */
  preferred?: boolean;
}

export interface FhirPatient {
  resourceType: "Patient";
  id: string;
  name?: FhirHumanName[];
  birthDate?: string;
  gender?: string;
  communication?: FhirPatientCommunication[];
  identifier?: Array<{ system?: string; value?: string }>;
}

export interface FhirAttachment {
  contentType?: string;
  data?: string;
  url?: string;
  title?: string;
  creation?: string;
}

export interface FhirDocumentReference {
  resourceType: "DocumentReference";
  id: string;
  status?: string;
  type?: FhirCodeableConcept;
  category?: FhirCodeableConcept[];
  date?: string;
  description?: string;
  content: Array<{ attachment: FhirAttachment }>;
  context?: {
    encounter?: Array<{ reference?: string }>;
    period?: { start?: string; end?: string };
  };
}

export interface FhirBundleEntry<T> {
  fullUrl?: string;
  resource?: T;
}

export interface FhirBundle<T> {
  resourceType: "Bundle";
  type?: string;
  total?: number;
  link?: Array<{ relation: string; url: string }>;
  entry?: Array<FhirBundleEntry<T>>;
}

export interface FhirOperationOutcome {
  resourceType: "OperationOutcome";
  issue: Array<{
    severity: "fatal" | "error" | "warning" | "information";
    code: string;
    diagnostics?: string;
    details?: FhirCodeableConcept;
  }>;
}
