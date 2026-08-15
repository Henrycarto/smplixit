/**
 * Authenticated FHIR resource access.
 *
 * Scoped to what Smplixit reads: the patient, their discharge documents, and
 * the binary content behind those documents. Every call is a GET. This client
 * has no write path, by design. An integration that cannot write cannot corrupt
 * a chart, and that is the first question a hospital's Epic analyst asks.
 */

import type {
  FhirBundle,
  FhirDocumentReference,
  FhirOperationOutcome,
  FhirPatient,
  SmartSession,
} from "./types";

export class FhirError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly outcome?: FhirOperationOutcome,
  ) {
    super(message);
    this.name = "FhirError";
  }
}

/** LOINC codes for discharge documentation. Used to filter DocumentReference. */
export const DISCHARGE_SUMMARY_LOINC = [
  "18842-5", // Discharge summary
  "11490-0", // Physician discharge summary
  "28655-9", // Attending physician discharge summary
  "34745-0", // Instructions
  "74213-0", // Discharge instructions
] as const;

export class FhirClient {
  constructor(private readonly session: SmartSession) {}

  private get baseUrl(): string {
    return this.session.serverUrl.replace(/\/+$/, "");
  }

  private async request<T>(path: string, signal?: AbortSignal): Promise<T> {
    const url = path.startsWith("http") ? path : `${this.baseUrl}/${path.replace(/^\/+/, "")}`;

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.session.accessToken}`,
        Accept: "application/fhir+json",
      },
      signal,
    });

    if (!response.ok) {
      let outcome: FhirOperationOutcome | undefined;
      try {
        const body = await response.json();
        if (body?.resourceType === "OperationOutcome") outcome = body;
      } catch {
        // A non-JSON error body is common on gateway failures. The status code
        // is the useful part either way.
      }
      const diagnostics = outcome?.issue?.[0]?.diagnostics;
      throw new FhirError(
        diagnostics ?? `FHIR request failed with ${response.status}`,
        response.status,
        outcome,
      );
    }

    return (await response.json()) as T;
  }

  async getPatient(patientId?: string, signal?: AbortSignal): Promise<FhirPatient> {
    const id = patientId ?? this.session.patientId;
    if (!id) {
      throw new FhirError(
        "No patient in context. Launch from a patient chart, or pass a patient id.",
        400,
      );
    }
    return this.request<FhirPatient>(`Patient/${id}`, signal);
  }

  /**
   * The patient's preferred language, as a BCP 47 code Poly understands.
   *
   * FHIR allows several `communication` entries with at most one marked
   * preferred. When none is marked, the first entry is the convention most
   * vendors follow, so that is the fallback. Returns null rather than guessing
   * English: defaulting a language-access decision to English is precisely the
   * failure this product exists to prevent.
   */
  static preferredLanguage(patient: FhirPatient): string | null {
    const entries = patient.communication ?? [];
    const preferred = entries.find((entry) => entry.preferred) ?? entries[0];
    const coding = preferred?.language?.coding?.[0];
    return coding?.code?.toLowerCase() ?? null;
  }

  static patientDisplayName(patient: FhirPatient): string {
    const name = patient.name?.find((n) => n.use === "official") ?? patient.name?.[0];
    if (!name) return `Patient ${patient.id}`;
    if (name.text) return name.text;
    return [name.given?.join(" "), name.family].filter(Boolean).join(" ") || `Patient ${patient.id}`;
  }

  /** Discharge documents for a patient, most recent first. */
  async getDischargeDocuments(
    options: { patientId?: string; count?: number; signal?: AbortSignal } = {},
  ): Promise<FhirDocumentReference[]> {
    const id = options.patientId ?? this.session.patientId;
    if (!id) {
      throw new FhirError("No patient in context", 400);
    }

    const params = new URLSearchParams({
      patient: id,
      _count: String(options.count ?? 25),
      _sort: "-date",
      // The `type` search parameter takes a comma-separated OR list.
      type: DISCHARGE_SUMMARY_LOINC.map((code) => `http://loinc.org|${code}`).join(","),
    });

    const bundle = await this.request<FhirBundle<FhirDocumentReference>>(
      `DocumentReference?${params.toString()}`,
      options.signal,
    );

    return (bundle.entry ?? [])
      .map((entry) => entry.resource)
      .filter((resource): resource is FhirDocumentReference => Boolean(resource));
  }

  /**
   * Resolve a DocumentReference to plain text.
   *
   * Attachments arrive one of two ways: inline base64 in `data`, or a URL
   * pointing at a Binary resource. Epic favours the URL form for anything
   * sizeable, so both paths are needed in practice.
   */
  async getDocumentText(
    document: FhirDocumentReference,
    signal?: AbortSignal,
  ): Promise<string> {
    const attachment = document.content?.[0]?.attachment;
    if (!attachment) {
      throw new FhirError(`DocumentReference/${document.id} has no attachment`, 404);
    }

    if (attachment.data) {
      return decodeBase64(attachment.data);
    }

    if (attachment.url) {
      const url = attachment.url.startsWith("http")
        ? attachment.url
        : `${this.baseUrl}/${attachment.url.replace(/^\/+/, "")}`;

      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${this.session.accessToken}`,
          // Ask for the raw bytes. Without this Epic returns a Binary resource
          // wrapper with the content base64 encoded inside it.
          Accept: attachment.contentType ?? "text/plain",
        },
        signal,
      });

      if (!response.ok) {
        throw new FhirError(`Could not fetch attachment: ${response.status}`, response.status);
      }

      const contentType = response.headers.get("content-type") ?? "";
      if (contentType.includes("fhir+json") || contentType.includes("application/json")) {
        const binary = (await response.json()) as { data?: string };
        if (binary.data) return decodeBase64(binary.data);
      }

      return response.text();
    }

    throw new FhirError(
      `DocumentReference/${document.id} has neither inline data nor a URL`,
      404,
    );
  }
}

function decodeBase64(value: string): string {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  // Clinical text routinely carries non-ASCII characters in patient names and
  // in transcribed notes. Decoding as UTF-8 rather than latin1 keeps them.
  return new TextDecoder("utf-8").decode(bytes);
}
