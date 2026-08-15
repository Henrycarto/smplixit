/**
 * Vendor-specific behaviour.
 *
 * SMART on FHIR is a standard, and every implementation of it differs. These
 * are the differences that cost real integration time, recorded so the next
 * person does not rediscover them against a hospital's test environment on a
 * Friday afternoon.
 */

import type { FhirVendor } from "./types";

export interface VendorProfile {
  vendor: FhirVendor;
  label: string;
  /** Whether the vendor requires app registration before a sandbox launch works. */
  requiresRegistration: boolean;
  /** Public sandbox FHIR base URL, for development. */
  sandboxIss?: string;
  notes: string[];
}

export const VENDOR_PROFILES: Record<FhirVendor, VendorProfile> = {
  epic: {
    vendor: "epic",
    label: "Epic",
    requiresRegistration: true,
    sandboxIss: "https://fhir.epic.com/interconnect-fhir-oauth/api/FHIR/R4",
    notes: [
      "Register the app at fhir.epic.com. A client id is issued per environment, " +
        "so sandbox and production ids differ and are not interchangeable.",
      "Non-production client ids can take up to an hour to propagate after " +
        "registration. A 400 on the first launch attempt is usually propagation, " +
        "not a configuration error.",
      "The `aud` parameter is mandatory and must exactly match the FHIR base URL, " +
        "including whether it has a trailing slash.",
      "DocumentReference attachments are usually returned as a Binary URL rather " +
        "than inline base64. Request the attachment content type explicitly or " +
        "the response comes back wrapped in a Binary resource.",
      "Patient.communication is populated inconsistently across Epic installs. " +
        "Treat a missing preferred language as unknown, not as English.",
    ],
  },
  cerner: {
    vendor: "cerner",
    label: "Oracle Health (Cerner)",
    requiresRegistration: true,
    sandboxIss: "https://fhir-open.cerner.com/r4/ec2458f2-1e24-41c8-b71b-0e701af7583d",
    notes: [
      "Register at code-console.cerner.com. Confidential clients must send the " +
        "client secret as HTTP Basic auth. The secret in the form body is rejected.",
      "The open sandbox endpoint serves read-only data without authentication, " +
        "which is useful for testing resource parsing before auth is wired up.",
      "Scope names are case sensitive and Cerner rejects the whole request on a " +
        "single unrecognized scope rather than granting the subset it understands.",
      "Some on-premise deployments do not serve .well-known/smart-configuration. " +
        "Discovery falls back to the CapabilityStatement oauth-uris extension.",
    ],
  },
  generic: {
    vendor: "generic",
    label: "Generic FHIR R4 server",
    requiresRegistration: false,
    notes: [
      "Any server that serves .well-known/smart-configuration and supports " +
        "PKCE with S256 works without vendor-specific handling.",
    ],
  },
};

/**
 * Best-effort vendor detection from the issuer URL.
 *
 * Used only to select documentation and error hints. Nothing in the auth flow
 * branches on it, because a heuristic on a hostname is not something an auth
 * decision should depend on.
 */
export function detectVendor(iss: string): FhirVendor {
  const host = safeHost(iss);
  if (host.includes("epic.com") || host.includes("epichosted.com")) return "epic";
  if (host.includes("cerner.com") || host.includes("oracle")) return "cerner";
  return "generic";
}

function safeHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}
