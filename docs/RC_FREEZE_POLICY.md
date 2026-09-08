# RC Freeze Policy — AS POS V1 Release Candidate

**Effective from TASK 15.0, starting checkpoint `1035a58` ("fix(parity):
complete forensic legacy closure"), target go-live September 15, 2026.**

This document governs every change made during Release Candidate
certification. TASK 15.0 is **not** another feature wave — its job is to
determine whether the platform, as it stands at `1035a58`, is safe to run
a real park on, survive real failures, support multiple real operators,
stay financially/inventory-consistent, be provisioned for a brand-new
customer without code changes, and be deployed and sold commercially.
Real legacy parity is already 100% (A=64, H=19, G=17, B=C=D=E=F=0) —
this task does not reopen that matrix.

## Allowed during the freeze

- Correctness fixes (a genuine bug found during certification)
- Security fixes (an exploitable gap found during review)
- Data-integrity fixes (financial, inventory, tenant/branch isolation)
- Recovery fixes (a failure scenario that doesn't fail safely)
- Launch-blocking UX fixes (a control that is genuinely inaccessible,
  hidden, or leads to an unrecoverable state at real Flutter Release
  desktop widths)
- Production configuration fixes (env var handling, secret validation,
  CORS, TLS, object-storage requirement clarity)
- Deployment fixes (backup/restore, provisioning tooling, runbooks)
- Performance fixes **proven necessary** by a real measurement in Phase
  11 — never speculative tuning
- Missing tests for launch-critical behavior this certification exercises

## Not allowed during the freeze

- Speculative new modules or product capabilities
- Redesigns or cosmetic rewrites not tied to a discovered blocker
- New business domains
- Feature expansion beyond what TASK 14.5A already closed
- Architectural rewrites without a concrete launch blocker forcing one
- Fake integrations (Mercado Pago stays paused — see below)

## Mercado Pago

Remains explicitly **paused** for the entire certification: no
credentials configured, no webhook activated, no live provider calls,
no physical terminal test, no fake/simulated approvals. Card/provider
payment is reported in the final certification as **EXTERNAL PROVIDER
ACTIVATION PENDING** — this does not, by itself, mark the local POS
financial architecture RED; what must happen before integrated card
processing can be advertised as live is documented separately.

## Commit discipline

No commits while certification is running. If certification finishes
with zero RED items, tests green, backup/restore green, new-tenant
sellability green, and no known data-integrity or security blocker, a
single local checkpoint commit is created:
`chore(release): certify AS POS V1 release candidate`. Not pushed, not
deployed. If any RED remains, no certification commit is created —
remaining gaps are reported instead, exactly as TASK 14.5A's own
methodology required for its parity numbers.

## Every fix made under this freeze must

1. Be traceable to a specific blocker found during a specific
   certification phase (cited in the relevant `docs/RC_*.md` file).
2. Be re-verified by rerunning the affected tests/certification step,
   not merely asserted fixed.
3. Never silently expand scope — a discovered blocker gets exactly the
   fix it needs, not an adjacent redesign.
