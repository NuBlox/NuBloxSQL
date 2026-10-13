# NuBloxSQL Architecture

This directory contains detailed architecture beneath the [Product Blueprint](../product/BLUEPRINT.md).

- [Universal Database Driver](UNIVERSAL-DATABASE-DRIVER.md) — SQL/non-SQL native interfaces, vendor catalogues and cloud connection security boundaries.
- [Database Lifecycle](DATABASE-LIFECYCLE.md) — the eleven-phase select-to-retire lifecycle.
- [Database Jobs](DATABASE-JOBS.md) — operation, durable job and workflow architecture across the lifecycle.
- [Native Job Discovery](NATIVE-JOB-DISCOVERY.md) — read-only MySQL/SQL Server scheduler inventory and explicit engine boundaries.
- [Database Security](DATABASE-SECURITY.md) — read-only native principal, role and privilege discovery boundaries.
- [Plan Integrity](PLAN-INTEGRITY.md) — lifecycle plan hashes, migration checkpoint replay prevention and transaction-safe completion evidence.
- [NuBlox Shell](SHELL.md) — terminal application boundary and command direction.
- [Repository Structure](REPOSITORY-STRUCTURE.md) — canonical repository layout and placement rules.
- [Repository Hygiene](REPOSITORY-HYGIENE.md) — merge discipline, obsolete branch reconciliation and archival safeguards.

Architecture documents explain how the product is structured. They do not override the Product Blueprint or machine-readable release contracts.
