# ADR-0001: Money and rounding

- Status: Accepted
- Date: 2026-07-22
- Owners: AS ONE Engineering

## Context

AS ONE must produce deterministic commercial totals across PostgreSQL, backend services, POS devices, offline replay, and future country-specific fiscal integrations. Binary floating-point arithmetic cannot safely represent authoritative currency values.

## Decision

- Store monetary values in PostgreSQL as `numeric(19,4)` with an explicit ISO 4217 currency.
- Use an exact decimal type in backend calculations. JavaScript/TypeScript `number`, Dart `double`, and database floating-point types are prohibited for authoritative money.
- Retain four decimal places during calculation, allocation, tax, discount, and intermediate distribution steps.
- For MXN commercial results, round half-up to two decimal places at the explicitly documented commercial boundary.
- Persist the unambiguous rounded components needed to reproduce each completed transaction.
- Country-specific fiscal rules may replace or refine the commercial boundary only through a later accepted decision.

## Alternatives considered

- **Integer minor units:** safe for currencies with fixed minor units, but insufficient alone for four-decimal allocation and future currencies without additional scale metadata.
- **Binary floating point:** rejected because results can differ across calculations and runtimes.
- **Rounding every intermediate value to two decimals:** rejected because it accumulates distribution errors.

## Consequences

Contracts must represent money without float assumptions. Calculation libraries and tests must prove rounding, allocation, negative adjustments, and reconciliation behavior. Fiscal behavior remains explicitly country-dependent.

## Validation

Use cross-runtime golden tests covering midpoint values, taxes, discounts, proportional allocation, refunds, and sum preservation.

## References

- [Core data model](../CORE_DATA_MODEL.md)
- [Database standards](../DATABASE.md)
