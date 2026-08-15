/**
 * Contracts shared by the web console and the three Python services.
 *
 * These mirror the Pydantic models in:
 *   services/core/app/schemas.py
 *   services/poly/app/schemas.py
 *   services/guard/app/schemas.py
 *
 * Changing a field here without changing it there produces a runtime shape
 * mismatch that TypeScript cannot catch, because the boundary is JSON over
 * HTTP. Treat the two sides as one file split across two languages.
 */

/* ------------------------------------------------------------------ Core */

export type JobStatus = "completed" | "needs_review" | "failed";

export interface ReadingLevel {
  smog: number;
  flesch_kincaid: number;
  flesch_reading_ease: number;
  /** Max of SMOG and Flesch-Kincaid. The stricter of the two always wins. */
  consensus_grade: number;
  word_count: number;
  sentence_count: number;
  polysyllabic_word_count: number;
  avg_sentence_length: number;
}

export interface DifficultTerm {
  term: string;
  syllables: number;
  occurrences: number;
  plain_language_suggestion: string | null;
}

export interface RewriteAttempt {
  attempt: number;
  target_grade: number;
  resulting_level: ReadingLevel;
  accepted: boolean;
  rejection_reason: string | null;
  model: string;
  prompt_tokens: number | null;
  completion_tokens: number | null;
  latency_ms: number;
}

export interface GuardSummary {
  safety_score: number;
  passed: boolean;
  drugs_in_source: number;
  drugs_in_output: number;
  critical_findings: number;
  warning_findings: number;
  detail_url: string | null;
}

export interface SimplifyRequest {
  discharge_summary: string;
  target_grade?: number;
  patient_id?: string | null;
  encounter_id?: string | null;
  clinician_id?: string | null;
  preserve_terms?: string[];
  run_guard?: boolean;
}

export interface SimplifyResponse {
  job_id: string;
  status: JobStatus;
  original_text: string;
  simplified_text: string;
  original_level: ReadingLevel;
  simplified_level: ReadingLevel;
  target_grade: number;
  /** Consensus grades removed by the rewrite. The number on the badge. */
  grade_reduction: number;
  attempts: RewriteAttempt[];
  difficult_terms_removed: DifficultTerm[];
  guard: GuardSummary | null;
  review_reasons: string[];
  created_at: string;
  duration_ms: number;
}

export interface ScoreRequest {
  text: string;
  target_grade?: number;
}

export interface ScoreResponse {
  level: ReadingLevel;
  target_grade: number;
  meets_target: boolean;
  difficult_terms: DifficultTerm[];
}

export interface JobSummary {
  job_id: string;
  status: JobStatus;
  patient_id: string | null;
  original_grade: number;
  simplified_grade: number;
  target_grade: number;
  safety_score: number | null;
  created_at: string;
}

/* ------------------------------------------------------------------ Poly */

export type TranslationStatus =
  | "releasable"
  | "needs_review"
  | "human_translation_required"
  | "failed";

export type LanguageTier = "machine_translated" | "requires_human_review";

export interface LanguageInfo {
  code: string;
  name: string;
  native_name: string;
  tier: LanguageTier;
  machine_translatable: boolean;
  rtl: boolean;
}

export interface LanguageListResponse {
  languages: LanguageInfo[];
  total: number;
  machine_translated: number;
  requires_human_review: number;
}

export interface TranslateRequest {
  text: string;
  target_lang: string;
  source_lang?: string;
  preserve_terms?: string[];
  job_id?: string | null;
}

export interface TranslateResponse {
  job_id: string | null;
  status: TranslationStatus;
  source_lang: string;
  target_lang: string;
  language_name: string;
  rtl: boolean;
  original_text: string;
  translated_text: string | null;
  protected_terms: string[];
  /** Non-empty means a protected term did not survive. Do not release. */
  lost_terms: string[];
  review_reasons: string[];
  character_count: number;
  duration_ms: number;
  created_at: string;
}

export interface BatchTranslateRequest {
  text: string;
  target_langs: string[];
  source_lang?: string;
  preserve_terms?: string[];
  job_id?: string | null;
}

export interface BatchTranslateResponse {
  job_id: string | null;
  results: TranslateResponse[];
  releasable_count: number;
  held_count: number;
  duration_ms: number;
}

/* ----------------------------------------------------------------- Guard */

export type Severity = "critical" | "warning" | "info";

export type FindingType =
  | "drug_missing"
  | "drug_added"
  | "dose_missing"
  | "dose_changed"
  | "frequency_missing"
  | "frequency_changed"
  | "route_missing"
  | "route_changed"
  | "duration_changed"
  | "warning_lost"
  | "boxed_warning_not_conveyed"
  | "interaction_not_conveyed"
  | "drug_unverified";

export interface Finding {
  type: FindingType;
  severity: Severity;
  drug_name: string | null;
  message: string;
  source_value: string | null;
  output_value: string | null;
  source_context: string | null;
  output_context: string | null;
  fda_verified: boolean;
  remediation: string | null;
}

export interface MedicationRecord {
  name: string;
  surface_form: string;
  dose: string | null;
  route: string | null;
  frequency: string | null;
  duration: string | null;
  detection: "lexicon" | "morphology" | "context";
  fda_verified: boolean;
  has_boxed_warning: boolean;
}

export interface ValidateRequest {
  original_text: string;
  simplified_text: string;
  job_id?: string | null;
  check_fda?: boolean;
}

export interface ValidateResponse {
  job_id: string | null;
  /** False if any critical finding was raised. The score does not override it. */
  passed: boolean;
  safety_score: number;
  drugs_in_source: number;
  drugs_in_output: number;
  critical_findings: number;
  warning_findings: number;
  info_findings: number;
  findings: Finding[];
  source_medications: MedicationRecord[];
  output_medications: MedicationRecord[];
  warnings_in_source: number;
  warnings_in_output: number;
  /** False when openFDA was unreachable. Findings were downgraded, not hidden. */
  fda_available: boolean;
  duration_ms: number;
  created_at: string;
}

/* ----------------------------------------------------------------- Shared */

export interface ApiError {
  error: string;
  detail: string | null;
  context?: Record<string, unknown> | null;
}

/**
 * Grade bands used for color and label across the console.
 *
 * The final band is unbounded, so every grade lands in exactly one band and
 * `gradeBand` can never fall through. It is named rather than inlined so the
 * fallback below refers to it directly: indexing the array to find the last
 * entry yields `T | undefined` under `noUncheckedIndexedAccess`, which makes a
 * total function look partial.
 */
const CLINICAL_BAND = { max: Number.POSITIVE_INFINITY, label: "Clinical", tone: "fail" } as const;

export const GRADE_BANDS = [
  { max: 6, label: "Target", tone: "pass" },
  { max: 8, label: "Acceptable", tone: "near" },
  { max: 12, label: "Above target", tone: "warn" },
  CLINICAL_BAND,
] as const;

export type GradeBand = (typeof GRADE_BANDS)[number];
export type GradeTone = GradeBand["tone"];

export function gradeBand(grade: number): GradeBand {
  return GRADE_BANDS.find((band) => grade <= band.max) ?? CLINICAL_BAND;
}
