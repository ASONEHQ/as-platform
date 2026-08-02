# Operational automation

Internal, read-only operational diagnostics for AS ONE. The module provides
dependency checks, outbox and inventory diagnostics, scoped shadow comparison,
backup-manifest verification and restore precondition validation.

Commands are invoked through `pnpm --filter @asone/api ops -- <command>`.
All commands accept `--json` and `--timeout <milliseconds>`. Scope-bearing
commands require explicit identifiers. Unknown flags are rejected.

| Exit | Meaning                             |
| ---: | ----------------------------------- |
|    0 | Healthy or verification successful  |
|    1 | Degraded state or findings detected |
|    2 | Invalid arguments or configuration  |
|    3 | Required dependency unavailable     |
|    4 | Safety guard rejected the operation |
|    5 | Sanitized internal failure          |

`restore-validate` is precondition validation only: it requires a disposable
allowlisted database, `--dry-run`, and `--confirm`. It performs no restore or
deletion. Backup verification reads a local manifest and file only. RabbitMQ
and object storage are reported as not configured until real clients exist.

No command repairs inventory, consumes outbox events, changes findings,
modifies balances, creates backups, schedules work, or exposes a public route.
