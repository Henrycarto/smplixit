# SMART on FHIR integration

## Position

Smplixit is a read-only SMART on FHIR application. It authenticates through the hospital's identity provider, reads a patient and their discharge documentation, and writes nothing back to the chart. There is no write path in the client, which is the first thing an EHR analyst checks and the reason app review tends to go quickly.

Implementation lives in `packages/fhir-client`. Application-level policy, which scopes to request and how a FHIR patient becomes working context, lives in `apps/web/lib/fhir.ts`.

## Launch modes

**EHR launch.** The clinician is in a patient chart in Epic or Cerner and opens Smplixit from the activity menu. The EHR redirects to the launch URL with `iss` and `launch`. Patient and encounter context arrive in the token response, so nobody types a medical record number. This is the mode that gets used.

**Standalone launch.** The clinician opens Smplixit directly. No `launch` parameter, so the EHR presents its own patient picker during authorization. Supported because it is how the app gets demonstrated and how a clinician reaches it from a bookmark.

## The flow

```
  1.  EHR              GET  /api/fhir/launch?iss=<fhir-base>&launch=<token>
  2.  Smplixit         GET  {iss}/.well-known/smart-configuration
                            falls back to {iss}/metadata oauth-uris extension
  3.  Smplixit              generate code_verifier, derive S256 challenge,
                            generate state, persist both server side
  4.  Smplixit         302  {authorization_endpoint}
                              ?response_type=code
                              &client_id=...
                              &redirect_uri=...
                              &scope=...
                              &state=...
                              &aud={iss}
                              &code_challenge=...
                              &code_challenge_method=S256
                              &launch=<token>
  5.  Identity provider     clinician authenticates, consents
  6.  EHR              302  {redirect_uri}?code=...&state=...
  7.  Smplixit              constant-time compare state against the stored value
  8.  Smplixit        POST  {token_endpoint}
                              grant_type=authorization_code
                              code, redirect_uri, client_id, code_verifier
  9.  Token response        access_token, expires_in, scope,
                            patient, encounter, fhirUser
 10.  Smplixit         GET  {iss}/Patient/{patient}
 11.  Smplixit         GET  {iss}/DocumentReference?patient=...&type=...
```

### Details that are not optional

**PKCE with S256.** Required by SMART App Launch 2.0 and enforced by both vendors. Without it, anyone who intercepts the authorization code on the redirect can exchange it. Plain challenges are not implemented.

**`aud` must be present and must equal the FHIR base URL.** Epic rejects the request without it. A server that accepts a missing `aud` allows a token minted for one FHIR server to be replayed against another.

**State comparison is constant-time.** `packages/fhir-client/src/pkce.ts` exports `safeEquals` for this. The timing channel is a narrow one, but this is an auth boundary in a PHI system and the correct version is four lines.

**The verifier and state live server side.** An httpOnly cookie or a server session. Putting either in `localStorage` defeats PKCE, because the whole point is that the value never reaches a context an attacker can read.

## Scopes

```
launch
openid
fhirUser
patient/Patient.read
patient/DocumentReference.read
online_access
```

`patient/` prefixed rather than `user/` so access is scoped to the launched patient rather than to everything the clinician can see. Vendors will grant `user/*.read` if asked. Asking for it makes the security review longer and gains nothing.

`online_access` gives a refresh token that lives as long as the clinician's EHR session. `offline_access` is not requested. A background token that outlives the session is a liability for an application that only ever acts in the foreground.

## Discovery

Two paths, tried in order:

1. `.well-known/smart-configuration`. The SMART 2.0 mechanism. Current Epic and Cerner serve it.
2. The CapabilityStatement `oauth-uris` extension at `{iss}/metadata`. Older Epic installs and some on-premise Cerner deployments only expose it here.

The fallback exists because a hospital's FHIR server version is not something a vendor gets to choose. Results are cached per issuer for the process lifetime; these endpoints change on the order of years, and discovery on every launch adds a round trip a clinician waits through.

## Vendor differences

Recorded in `packages/fhir-client/src/vendors.ts` so they are in code rather than in somebody's memory.

### Epic

- Register at fhir.epic.com. Client ids are per environment. Sandbox and production ids are not interchangeable.
- A newly registered non-production client id can take up to an hour to propagate. A 400 on the first launch attempt is usually propagation, not misconfiguration. This is the single most common wasted afternoon in an Epic integration.
- `aud` must match the FHIR base URL exactly, including trailing slash behaviour.
- `DocumentReference` attachments usually come back as a Binary URL rather than inline base64. Request the attachment content type explicitly or the response arrives wrapped in a Binary resource with the content base64 encoded inside it.
- `Patient.communication` is populated inconsistently across installs.

### Oracle Health (Cerner)

- Register at code-console.cerner.com.
- Confidential clients must send the client secret as HTTP Basic auth. The secret in the form body is rejected.
- Scope names are case sensitive, and Cerner rejects the entire request on one unrecognized scope rather than granting the subset it understands.
- The open sandbox at `https://fhir-open.cerner.com/r4/ec2458f2-1e24-41c8-b71b-0e701af7583d` serves read-only data without authentication, which is useful for testing resource parsing before auth is wired.

## Preferred language

`Patient.communication` carries zero or more languages, at most one flagged `preferred`. `FhirClient.preferredLanguage` returns the preferred entry, falls back to the first, and returns `null` when neither exists.

Returning `null` rather than defaulting to English is a deliberate decision. Defaulting a language-access determination to English is exactly the failure this product exists to prevent, and a chart that does not record a language is telling you something real: that nobody asked. The console surfaces that as unknown and makes the clinician choose.

When the chart records a language Poly does not target, the console shows the raw code next to the picker rather than silently ignoring it.

## Document retrieval

`DocumentReference` is searched by patient and filtered to discharge documentation by LOINC code:

| Code | Meaning |
| --- | --- |
| 18842-5 | Discharge summary |
| 11490-0 | Physician discharge summary |
| 28655-9 | Attending physician discharge summary |
| 34745-0 | Instructions |
| 74213-0 | Discharge instructions |

Results sort by date descending. Attachment resolution handles both inline base64 and Binary URL forms, and decodes as UTF-8, because clinical text routinely carries non-ASCII characters in patient names and transcribed notes.

## Testing without credentials

The console runs without any FHIR configuration. `/simplify` accepts pasted text and the whole rewrite, validation, and translation path works end to end. This is how the product is demonstrated and how the services are developed.

Going live against a real EHR requires, in order:

1. Vendor app registration and a client id.
2. A registered redirect URI, which must match `FHIR_REDIRECT_URI` exactly.
3. Scope approval from the hospital.
4. A server-side session store for the verifier and state.
5. A successful launch against the vendor sandbox before production.

Steps 1 through 3 are hospital and vendor process, not engineering work, and they are the long pole in every deployment of this kind of application.
