/**
 * SMART configuration discovery.
 *
 * The EHR hands us an `iss` at launch and nothing else. Everything needed to
 * run the OAuth flow, the authorize and token endpoints, comes from discovery
 * against that base URL. Hardcoding endpoints per customer is how integrations
 * break the first time a hospital moves to a new Epic environment.
 *
 * Two discovery paths, tried in order:
 *
 *   1. `.well-known/smart-configuration`  the SMART 2.0 way. Epic and Cerner
 *      both serve it on current versions.
 *   2. the CapabilityStatement `oauth-uris` extension. Older Epic installs, and
 *      some on-premise Cerner deployments, only expose it here.
 *
 * The fallback exists because a hospital's FHIR server version is not something
 * a vendor gets to choose.
 */

import type { SmartConfiguration } from "./types";

const WELL_KNOWN_PATH = ".well-known/smart-configuration";

const OAUTH_URIS_EXTENSION =
  "http://fhir-registry.smarthealthit.org/StructureDefinition/oauth-uris";

export class DiscoveryError extends Error {
  constructor(
    message: string,
    readonly iss: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DiscoveryError";
  }
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

async function fetchWellKnown(iss: string, signal?: AbortSignal): Promise<SmartConfiguration> {
  const response = await fetch(joinUrl(iss, WELL_KNOWN_PATH), {
    headers: { Accept: "application/json" },
    signal,
  });
  if (!response.ok) {
    throw new DiscoveryError(`smart-configuration returned ${response.status}`, iss);
  }
  const config = (await response.json()) as SmartConfiguration;
  if (!config.authorization_endpoint || !config.token_endpoint) {
    throw new DiscoveryError("smart-configuration is missing required endpoints", iss);
  }
  return config;
}

interface CapabilityStatement {
  rest?: Array<{
    security?: {
      extension?: Array<{
        url?: string;
        extension?: Array<{ url?: string; valueUri?: string }>;
      }>;
    };
  }>;
}

async function fetchFromCapabilityStatement(
  iss: string,
  signal?: AbortSignal,
): Promise<SmartConfiguration> {
  const response = await fetch(joinUrl(iss, "metadata"), {
    headers: { Accept: "application/fhir+json" },
    signal,
  });
  if (!response.ok) {
    throw new DiscoveryError(`CapabilityStatement returned ${response.status}`, iss);
  }

  const statement = (await response.json()) as CapabilityStatement;
  const oauthExtension = statement.rest
    ?.flatMap((rest) => rest.security?.extension ?? [])
    .find((extension) => extension.url === OAUTH_URIS_EXTENSION);

  const authorize = oauthExtension?.extension?.find((e) => e.url === "authorize")?.valueUri;
  const token = oauthExtension?.extension?.find((e) => e.url === "token")?.valueUri;

  if (!authorize || !token) {
    throw new DiscoveryError("CapabilityStatement carries no oauth-uris extension", iss);
  }

  return { authorization_endpoint: authorize, token_endpoint: token };
}

/**
 * Resolve the OAuth endpoints for a FHIR server.
 *
 * Results are cached per `iss` for the process lifetime. These endpoints change
 * on the order of years, and discovery on every launch adds a round trip to a
 * flow a clinician is waiting on.
 */
const cache = new Map<string, SmartConfiguration>();

export async function discoverSmartConfiguration(
  iss: string,
  options: { signal?: AbortSignal; refresh?: boolean } = {},
): Promise<SmartConfiguration> {
  const key = iss.replace(/\/+$/, "");
  if (!options.refresh) {
    const cached = cache.get(key);
    if (cached) return cached;
  }

  let config: SmartConfiguration;
  try {
    config = await fetchWellKnown(iss, options.signal);
  } catch (wellKnownError) {
    try {
      config = await fetchFromCapabilityStatement(iss, options.signal);
    } catch (metadataError) {
      throw new DiscoveryError(
        "Could not discover SMART endpoints from either .well-known/smart-configuration " +
          "or the CapabilityStatement. Confirm the issuer URL is the FHIR base URL, " +
          "not the app launch URL.",
        iss,
        { wellKnownError, metadataError },
      );
    }
  }

  cache.set(key, config);
  return config;
}

/** Test hook. Clears the discovery cache. */
export function clearDiscoveryCache(): void {
  cache.clear();
}
