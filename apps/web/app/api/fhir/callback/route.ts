/**
 * SMART on FHIR authorization callback.
 *
 * Reads the pending launch back from the cookie, verifies state, exchanges the
 * code for a session, and loads patient context.
 *
 * The launch cookie is cleared on every path out of this handler, success or
 * failure. A verifier that survives its exchange is a replayable credential.
 *
 * What this handler does NOT do is put the access token in a cookie. The token
 * grants read access to patient records, and a deployment needs to decide where
 * it lives, encrypted server-side session, a secrets service, or a short-lived
 * server-only store, as part of its security review. Writing it to a cookie
 * here would make that decision silently and badly for every deployment.
 */

import { NextResponse, type NextRequest } from "next/server";

import {
  LAUNCH_COOKIE,
  completeLaunch,
  loadPatientContext,
  type PendingLaunch,
} from "@/lib/fhir";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  // The identity provider reports its own failures here rather than at /token.
  const oauthError = params.get("error");
  if (oauthError) {
    return fail(request, {
      error: oauthError,
      detail: params.get("error_description") ?? "The identity provider rejected the request",
      status: 400,
    });
  }

  const code = params.get("code");
  const state = params.get("state");
  if (!code || !state) {
    return fail(request, {
      error: "invalid_callback",
      detail: "The callback is missing the code or state parameter",
      status: 400,
    });
  }

  const raw = request.cookies.get(LAUNCH_COOKIE)?.value;
  if (!raw) {
    return fail(request, {
      error: "launch_expired",
      detail:
        "No pending launch. The launch context expires after five minutes. Start again from the EHR.",
      status: 400,
    });
  }

  let pending: PendingLaunch;
  try {
    pending = JSON.parse(raw) as PendingLaunch;
  } catch {
    return fail(request, {
      error: "launch_corrupt",
      detail: "The launch context could not be read. Start again from the EHR.",
      status: 400,
    });
  }

  try {
    const session = await completeLaunch({ code, state, pending });
    const patient = await loadPatientContext(session);

    // Context travels as query parameters, not the token. The patient id is
    // already visible to this clinician in the chart they launched from.
    const destination = new URL("/simplify", request.nextUrl.origin);
    destination.searchParams.set("patient", patient.patientId);
    if (patient.preferredLanguage) {
      destination.searchParams.set("lang", patient.preferredLanguage);
    }

    const response = NextResponse.redirect(destination);
    response.cookies.delete(LAUNCH_COOKIE);
    return response;
  } catch (cause) {
    return fail(request, {
      error: "token_exchange_failed",
      detail: cause instanceof Error ? cause.message : "Could not complete the SMART launch",
      status: 502,
    });
  }
}

function fail(
  request: NextRequest,
  body: { error: string; detail: string; status: number },
): NextResponse {
  void request;
  const response = NextResponse.json(
    { error: body.error, detail: body.detail },
    { status: body.status },
  );
  response.cookies.delete(LAUNCH_COOKIE);
  return response;
}
