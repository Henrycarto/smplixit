/**
 * SMART App Launch authorization and token exchange.
 *
 * Supports both launch modes:
 *
 *   EHR launch         the clinician is already in a patient chart and clicks
 *                      Smplixit. The EHR redirects to our launch URL with
 *                      `iss` and `launch`. Patient context comes back in the
 *                      token response, so the app never asks who the patient is.
 *
 *   Standalone launch  the clinician opens Smplixit directly. No `launch`
 *                      parameter, so the EHR shows its own patient picker.
 *
 * The token response carries the context. `patient` and `encounter` are only
 * present when the matching launch scopes were granted, which is why the
 * session type marks them optional rather than assuming they are there.
 */

import { discoverSmartConfiguration } from "./discovery";
import { safeEquals } from "./pkce";
import type { AuthorizeParams, SmartSession, TokenResponse } from "./types";

export class AuthError extends Error {
  constructor(
    message: string,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Build the authorization URL.
 *
 * The `aud` parameter is the FHIR base URL and is mandatory. Epic rejects the
 * request outright without it, and a server that accepts a missing `aud` is
 * vulnerable to having a token minted for one FHIR server replayed against
 * another.
 */
export async function buildAuthorizeUrl(params: AuthorizeParams): Promise<string> {
  const config = await discoverSmartConfiguration(params.iss);

  const url = new URL(config.authorization_endpoint);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("scope", params.scopes.join(" "));
  url.searchParams.set("state", params.state);
  url.searchParams.set("aud", params.iss);
  url.searchParams.set("code_challenge", params.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");

  if (params.launch) {
    url.searchParams.set("launch", params.launch);
  }

  return url.toString();
}

export interface CallbackParams {
  code: string;
  state: string;
  /** The state generated before redirect, read back from the session store. */
  expectedState: string;
  codeVerifier: string;
  clientId: string;
  redirectUri: string;
  iss: string;
  /** Confidential clients only. Public clients omit this and rely on PKCE. */
  clientSecret?: string;
}

/**
 * Exchange an authorization code for a session.
 *
 * The state check happens first and is not optional. Skipping it turns the
 * callback into an open redirect that will happily mint a session for an
 * attacker-supplied code.
 */
export async function exchangeCodeForSession(params: CallbackParams): Promise<SmartSession> {
  if (!safeEquals(params.state, params.expectedState)) {
    throw new AuthError(
      "State mismatch on the authorization callback",
      "The state returned by the EHR does not match the value issued at launch. " +
        "This request was rejected.",
    );
  }

  const config = await discoverSmartConfiguration(params.iss);

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    code_verifier: params.codeVerifier,
  });

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };

  // Confidential clients authenticate with HTTP Basic per the SMART spec.
  // Cerner in particular rejects the client_secret in the form body.
  if (params.clientSecret) {
    headers.Authorization = `Basic ${btoa(`${params.clientId}:${params.clientSecret}`)}`;
  }

  const response = await fetch(config.token_endpoint, { method: "POST", headers, body });

  if (!response.ok) {
    const detail = await response.text();
    throw new AuthError(`Token exchange failed with ${response.status}`, detail.slice(0, 500));
  }

  return toSession(await response.json(), params.iss);
}

/** Refresh an expiring session. Requires the `online_access` or `offline_access` scope. */
export async function refreshSession(
  session: SmartSession,
  params: { clientId: string; clientSecret?: string },
): Promise<SmartSession> {
  if (!session.refreshToken) {
    throw new AuthError(
      "This session has no refresh token",
      "Request the online_access or offline_access scope to enable refresh.",
    );
  }

  const config = await discoverSmartConfiguration(session.serverUrl);

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Accept: "application/json",
  };
  if (params.clientSecret) {
    headers.Authorization = `Basic ${btoa(`${params.clientId}:${params.clientSecret}`)}`;
  }

  const response = await fetch(config.token_endpoint, {
    method: "POST",
    headers,
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: session.refreshToken,
      client_id: params.clientId,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new AuthError(`Token refresh failed with ${response.status}`, detail.slice(0, 500));
  }

  const refreshed = toSession(await response.json(), session.serverUrl);

  // Some servers omit the patient context on refresh. Carry the original
  // context forward rather than losing which patient the clinician is on.
  return {
    ...refreshed,
    patientId: refreshed.patientId ?? session.patientId,
    encounterId: refreshed.encounterId ?? session.encounterId,
    fhirUser: refreshed.fhirUser ?? session.fhirUser,
    refreshToken: refreshed.refreshToken ?? session.refreshToken,
  };
}

function toSession(token: TokenResponse, serverUrl: string): SmartSession {
  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token,
    // Subtract a 60 second margin. A token that expires mid-request produces a
    // 401 the clinician sees as a crash.
    expiresAt: Date.now() + Math.max(0, token.expires_in - 60) * 1000,
    scope: token.scope,
    serverUrl,
    patientId: token.patient,
    encounterId: token.encounter,
    fhirUser: token.fhirUser,
    idToken: token.id_token,
  };
}

export function isExpired(session: SmartSession): boolean {
  return Date.now() >= session.expiresAt;
}

/** Scopes Smplixit needs. Read-only, and narrower than most vendors default to. */
export const DEFAULT_SCOPES = [
  "launch",
  "openid",
  "fhirUser",
  "patient/Patient.read",
  "patient/DocumentReference.read",
  "online_access",
] as const;
