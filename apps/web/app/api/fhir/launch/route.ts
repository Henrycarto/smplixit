/**
 * SMART on FHIR launch endpoint.
 *
 * The EHR redirects here with `iss` and `launch`. This handler generates the
 * PKCE pair, stores the verifier and state in an httpOnly cookie, and redirects
 * to the hospital identity provider.
 *
 * The cookie is the session store. It is httpOnly, secure outside local dev,
 * SameSite=Lax so it survives the redirect back from the identity provider, and
 * scoped to a five minute lifetime because that is the entire window in which
 * it is useful. A deployment that already has a server-side session service
 * should swap this for it: the values must never be readable from client
 * JavaScript, which is the whole point of PKCE.
 */

import { NextResponse, type NextRequest } from "next/server";

import { LAUNCH_COOKIE, LAUNCH_TTL_SECONDS, beginLaunch, isFhirConfigured } from "@/lib/fhir";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!isFhirConfigured()) {
    return NextResponse.json(
      {
        error: "fhir_not_configured",
        detail:
          "Set FHIR_CLIENT_ID and FHIR_ISSUER, then register the redirect URI with the EHR vendor.",
      },
      { status: 503 },
    );
  }

  const iss = request.nextUrl.searchParams.get("iss") ?? undefined;
  const launch = request.nextUrl.searchParams.get("launch") ?? undefined;

  try {
    const { authorizeUrl, pending } = await beginLaunch({ iss, launch });

    const response = NextResponse.redirect(authorizeUrl);
    response.cookies.set(LAUNCH_COOKIE, JSON.stringify(pending), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/fhir",
      maxAge: LAUNCH_TTL_SECONDS,
    });
    return response;
  } catch (cause) {
    return NextResponse.json(
      {
        error: "launch_failed",
        detail: cause instanceof Error ? cause.message : "Could not start the SMART launch",
      },
      { status: 502 },
    );
  }
}
