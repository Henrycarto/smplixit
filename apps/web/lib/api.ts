/**
 * Typed clients for the three services.
 *
 * One thin fetch wrapper, no data-fetching library. The console makes a small
 * number of calls with hand-managed loading state, and a cache layer would add
 * a way for a stale rewrite to be shown next to a fresh safety verdict. In a
 * product where those two things must agree, that is a real hazard rather than
 * a theoretical one.
 */

import type {
  BatchTranslateRequest,
  BatchTranslateResponse,
  JobSummary,
  LanguageListResponse,
  ScoreRequest,
  ScoreResponse,
  SimplifyRequest,
  SimplifyResponse,
  TranslateRequest,
  TranslateResponse,
  ValidateRequest,
  ValidateResponse,
} from "@smplixit/shared-types";

export const CORE_URL = process.env.NEXT_PUBLIC_CORE_API_URL ?? "http://localhost:8001";
export const POLY_URL = process.env.NEXT_PUBLIC_POLY_API_URL ?? "http://localhost:8002";
export const GUARD_URL = process.env.NEXT_PUBLIC_GUARD_API_URL ?? "http://localhost:8003";

export class ApiRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly detail?: string,
  ) {
    super(message);
    this.name = "ApiRequestError";
  }
}

async function request<T>(
  baseUrl: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        ...init.headers,
      },
      cache: "no-store",
    });
  } catch (cause) {
    // A network failure and a 500 are different problems with different fixes,
    // so they get different messages rather than one generic failure state.
    throw new ApiRequestError(
      `Could not reach ${baseUrl}. Confirm the service is running.`,
      0,
      cause instanceof Error ? cause.message : undefined,
    );
  }

  if (!response.ok) {
    let detail: string | undefined;
    try {
      const body = await response.json();
      detail = typeof body?.detail === "string" ? body.detail : JSON.stringify(body?.detail);
    } catch {
      detail = await response.text().catch(() => undefined);
    }
    throw new ApiRequestError(
      `${path} failed with ${response.status}`,
      response.status,
      detail?.slice(0, 500),
    );
  }

  return (await response.json()) as T;
}

function post<T>(baseUrl: string, path: string, body: unknown): Promise<T> {
  return request<T>(baseUrl, path, { method: "POST", body: JSON.stringify(body) });
}

/* ------------------------------------------------------------------ Core */

export const core = {
  simplify: (payload: SimplifyRequest) =>
    post<SimplifyResponse>(CORE_URL, "/simplify", payload),

  score: (payload: ScoreRequest) => post<ScoreResponse>(CORE_URL, "/score", payload),

  listJobs: (limit = 50) => request<JobSummary[]>(CORE_URL, `/jobs?limit=${limit}`),

  getJob: (jobId: string) => request<SimplifyResponse>(CORE_URL, `/jobs/${jobId}`),

  health: () => request<{ status: string }>(CORE_URL, "/health"),
};

/* ------------------------------------------------------------------ Poly */

export const poly = {
  languages: () => request<LanguageListResponse>(POLY_URL, "/languages"),

  translate: (payload: TranslateRequest) =>
    post<TranslateResponse>(POLY_URL, "/translate", payload),

  translateBatch: (payload: BatchTranslateRequest) =>
    post<BatchTranslateResponse>(POLY_URL, "/translate/batch", payload),

  health: () => request<{ status: string }>(POLY_URL, "/health"),
};

/* ----------------------------------------------------------------- Guard */

export const guard = {
  validate: (payload: ValidateRequest) =>
    post<ValidateResponse>(GUARD_URL, "/validate", payload),

  getValidation: (jobId: string) =>
    request<ValidateResponse>(GUARD_URL, `/validate/${jobId}`),

  health: () => request<{ status: string }>(GUARD_URL, "/health"),
};

/** Service reachability for the status rail. Never throws. */
export async function serviceStatus(): Promise<Record<string, boolean>> {
  const checks = await Promise.allSettled([core.health(), poly.health(), guard.health()]);
  return {
    core: checks[0].status === "fulfilled",
    poly: checks[1].status === "fulfilled",
    guard: checks[2].status === "fulfilled",
  };
}
