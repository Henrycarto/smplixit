# Architecture

## Why three services and not one

The three functions have different failure modes, different scaling curves, and different third-party dependencies. Collapsing them into one process would tie all three together in ways that hurt.

| Concern | Core | Poly | Guard |
| --- | --- | --- | --- |
| Latency profile | 5 to 40 seconds, model bound | 1 to 3 seconds | 200 to 800 ms |
| Scaling driver | Discharge volume | Language mix, not volume | Discharge volume |
| Third-party dependency | Model provider | DeepL | openFDA |
| Failure impact | No rewrite | No translation | No release |

The concrete argument: openFDA rate limits at 240 requests per minute per IP. If Guard shared a process with Core, a burst of rewrites at shift change would exhaust the openFDA budget and the resulting backpressure would stall the rewrite queue behind it. Separated, Guard queues against its own semaphore and Core keeps working.

The second argument is deployment order. Guard is the release gate. Rolling Guard first, then Poly, then Core means Core never runs against a Guard version it does not expect. That ordering is encoded in `.github/workflows/deploy.yml` and only works because they deploy independently.

## Request flow

```
  Clinician in Epic
        |
        | SMART on FHIR launch, OAuth 2.0 + PKCE
        v
  Web console (Next.js)
        |
        | POST /simplify
        v
  +-------------------+
  |   Smplixit Core   |
  |                   |
  |  1. score source  |  SMOG + Flesch-Kincaid
  |  2. rewrite       |  constrained prompt pipeline
  |  3. re-score      |  both formulas must clear the target
  |  4. loop or stop  |  up to MAX_REWRITE_ATTEMPTS
  +---------+---------+
            |
            | POST /validate  (blocking, on the critical path)
            v
  +-------------------+        +------------------+
  |  Smplixit Guard   |------->|     openFDA      |
  |                   |        |  drug/label.json |
  |  extract drugs    |        +------------------+
  |  diff pre/post    |
  |  score + verdict  |
  +---------+---------+
            |
            | verdict
            v
     Core assembles the response
            |
            | status: completed | needs_review | failed
            v
       Web console
            |
            | POST /translate  (optional, clinician initiated)
            v
  +-------------------+        +------------------+
  |  Smplixit Poly    |------->|      DeepL       |
  |  protect terms    |        +------------------+
  |  translate        |
  |  verify survival  |
  +-------------------+
```

Guard is synchronous and on the critical path. That is a deliberate latency cost. An asynchronous safety check means a window during which a document exists in a released state without having been validated, and there is no acceptable length for that window.

## The release gate

A rewrite reaches `completed` only when all of the following hold:

1. Both SMOG and Flesch-Kincaid land at or below `target_grade + GRADE_TOLERANCE`.
2. Guard returned a verdict.
3. That verdict carries zero critical findings.
4. No other review reason was recorded.

Anything else is `needs_review`. There is no partial release and no override in the API. A clinician can act on a held document in the console, and that action is itself an audit event.

Failing closed is the important half. If Guard is unreachable and `GUARD_REQUIRED` is true, Core returns `needs_review` rather than `completed`. A rewrite that could not be validated is indistinguishable, from the outside, from a rewrite that failed validation, so it is treated the same way.

## Data model

Two tables, in `services/core/app/db.py`.

**`rewrite_jobs`** is one row per request. It holds the source text, the released text, both measured reading levels, the Guard verdict, and the review reasons. The dashboard reads this table.

**`audit_events`** is append-only. One row per state change, including every rejected rewrite attempt with the score that got it rejected. There is no update or delete path on this model in application code.

The separation matters under audit. The question a compliance officer asks is not "what did the patient receive", which is one field on one row. It is "show me that the document the patient received was the one that passed validation, and show me what else was considered". The second question is only answerable if the rejected attempts were kept.

Retention is a customer policy decision and is enforced by a scheduled job outside the application. Common configurations run 7 years to match state medical record retention.

## Failure modes

| Failure | Behaviour | Rationale |
| --- | --- | --- |
| Model provider down | 3 retries with exponential backoff, then `failed` with the error | A transient 429 should not cost the clinician the request |
| Model returns empty | Counts as a failed attempt, loop continues | Cheaper to retry than to fail |
| Target grade never reached | `needs_review` with the best attempt attached | The clinician gets something to work with, marked as not meeting target |
| Guard unreachable | `needs_review`, document held | Fail closed |
| openFDA unreachable | Guard still runs, findings downgraded from critical to warning, `fda_available: false` | Structural comparison still works without drug verification, and the console says so |
| Postgres unreachable | Rewrite still returns, persistence logged and skipped, `/jobs` returns 503 | A database outage should not cost a clinician a completed rewrite they are looking at |
| DeepL quota exhausted | Translation returns `failed` with the quota message | Actionable, distinct from a network error |
| Protected term lost in translation | `needs_review` with the lost terms listed | The whole point of the protection pass |

## Security boundary

```
                    Hospital VPC
  +--------------------------------------------------+
  |                                                  |
  |  Public subnets                                  |
  |    ALB, NAT gateways. Nothing else.              |
  |                                                  |
  |  Private subnets                                 |
  |    ECS tasks. No public IP. Egress on 443 only.  |
  |                                                  |
  |  Database subnets                                |
  |    RDS. No NAT route in either direction.        |
  |                                                  |
  +--------------------------------------------------+
              |                    |
              | TLS 1.2+           | TLS 1.2+
              v                    v
       Model provider          openFDA
       DeepL                   (public data)
```

The database subnet tier has no default route. That is what separates it from a merely private subnet: a private subnet with a NAT route can still send data out, and a subnet without one cannot, regardless of what runs in it.

Controls in place:

- Encryption at rest with a customer-managed KMS key, rotation enabled.
- `rds.force_ssl` set at the parameter group, so the database rejects unencrypted connections rather than trusting clients to encrypt.
- Containers run as UID 10001 with a read-only root filesystem.
- The ECS execution role reads secrets at task start. The task role, which is what the running application holds, cannot read them.
- S3 export bucket denies any request where `aws:SecureTransport` is false.
- The FHIR client has no write path. It cannot modify a chart.

PHI leaves the VPC only in outbound model and translation requests. Both providers are configured for zero retention. That configuration is a contractual control, not a technical one, and it is the item to verify first in any security review of this system.

## Scaling

Target tracking on CPU at 65 percent, scaling out on a 60 second cooldown and in on 300 seconds. The asymmetry is intentional: discharge volume arrives in shift-change waves, and holding capacity through the trough between waves costs less than a cold scale-out during one.

Fargate Spot is available on the cluster but is not in the default capacity provider strategy. A task interrupted mid-rewrite is a clinician watching a request fail.

The practical ceiling is openFDA, not compute. At 240 requests per minute and roughly six unique drugs per discharge summary, Guard's cache is what makes the throughput acceptable: a six hour TTL on a drug label means a busy ward converges to near-zero openFDA traffic within the first hour of a shift.

## What is deliberately absent

**No queue.** A rewrite is a foreground action a clinician waits on. Adding a queue would mean adding a status polling loop and a way for a clinician to walk away from a document mid-flight, which is worse than a 20 second wait.

**No cache on rewrites.** Two identical discharge summaries are not the same document and must not share an audit row.

**No PHI in logs.** Log lines carry job ids, drug names, and scores. Never patient text.

**No write path to the EHR.** Requested regularly, and declined. Writing back to a chart moves this from a documentation tool to a clinical system, which is a different regulatory posture and a different product.
