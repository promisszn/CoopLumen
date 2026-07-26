# Changelog

All notable changes to CoopLumen are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions follow [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added

- Integration test coverage for member soft-delete (#045): schema-level `deleted_at` checks in `members.schema.integration.test.ts`, plus an HTTP round-trip in `communities.integration.test.ts` covering `DELETE /api/v1/communities/:id/members/:address` — removal, 404 on re-fetch, and the soft-delete clearing on re-add
- Migration 017: members table integrity — Stellar address format constraint, `updated_at` column and trigger, and indexes covering the cross-community and live-member lookup paths
- Integration tests for the members schema: FK cascade, role and address constraints, composite-key uniqueness, and `updated_at` behaviour
- Migration `002_create_communities.sql`: canonical `communities` schema — full column set, CHECK constraints mirroring the API validation (name length, description length, Stellar asset code and issuer formats, avatar URL length), a partial index for the active-community listing, and an index on `(asset_code, asset_issuer)`
- Migration 018: `multisig_requests` table for community treasury actions awaiting co-signer approval (dormant until the multisig phase)
- Migration 017: notification index tuning — composite `(stellar_address, created_at DESC)` for the recipient feed, replacing the redundant single-column index and dropping the no-op `read_at` column from the unread partial index
- Migration 018: `votes` table recording one ballot per voter per proposal, with weighted choices (`for`/`against`/`abstain`) and an optional on-chain transaction hash. Dormant until the governance phase activates it
- Migration 017: `proposals` table for community governance (Phase 3 prep) — type and status enums, quorum percentage, voting window, and execution tracking. Dormant until the governance phase activates it
- Migration 017: `kyc_records` table (Phase 4 prep) — per-community KYC verification state for a Stellar address, dormant until SEP-12 anchor integration lands
- GitHub Actions CI (`.github/workflows/ci.yml`): lint, type-check, frontend tests, and backend tests with a PostgreSQL 16 service container so the DB integration suites run automatically on every push and PR to main
- API versioning: all resource routes moved under the `/api/v1` prefix (health checks stay unversioned)
- Community avatar support: `avatar_url` column and `POST /api/v1/communities/:id/avatar` endpoint
- OpenAPI 3.0 specification for the communities API at `docs/openapi.yaml`
- Integration tests for the full community CRUD lifecycle over HTTP (real DB, gated on `DATABASE_URL`)
- `db.end()` helper for clean test teardown
- Loans API: full lifecycle — create, disburse, repay (partial/full), default, and cancel
- Loan event log and per-loan repayment summary (`GET /api/loans/:id`, `/events`)
- Borrower reputation scoring driven by loan outcomes (on-time repayments vs. defaults)
- Migration 015: loan lifecycle columns (status constraint, repayment tracking, timestamps)
- Project renamed from StellarCommons to CoopLumen
- Live `GET /health` endpoint probing DB and Stellar Horizon connectivity
- `db.ping()` and `StellarService.ping()` helpers
- Frontend `GET /api/health` Next.js route for Docker health checks
- Docker health checks for backend (30s grace) and frontend (60s grace)
- Startup env-var validation — exits early with a clear message on missing vars
- `.nvmrc` pinning Node.js 20 LTS
- `engines` field in all `package.json` files enforcing Node ≥ 20
- `.editorconfig` for consistent indentation and line endings
- Prettier with shared `.prettierrc` and `format` / `format:check` scripts
- `.gitattributes` enforcing LF line endings across all platforms
- Husky pre-commit hook running lint-staged
- lint-staged running ESLint + Prettier on staged files only
- commitlint enforcing Conventional Commits on every commit message
- `Makefile` with `dev`, `test`, `lint`, `format`, `migrate`, `seed`, and more
- `docker-compose.override.yml` with Node.js debugger port, verbose logging, and optional pgAdmin
- Hardened multi-stage Dockerfiles for backend and frontend
- Next.js `output: standalone` for minimal production image
- `.dockerignore` files for backend and frontend
- `CODEOWNERS`, issue templates, PR template, `SECURITY.md`, `CHANGELOG.md`

### Fixed

- Migration 017: `transactions_log.community_id` foreign key is now `ON DELETE SET NULL`. Previously it defaulted to `NO ACTION`, which blocked deleting a community that had logged transactions and tied audit-trail retention to the community lifetime; the audit record now survives community deletion with `community_id` nulled
### Changed

- Migration 001 is now the single source of truth for the `schema_migrations` table: the runner bootstraps by executing that file instead of an inlined copy of the DDL, and records it as applied so it is never replayed
- `schema_migrations` gained an `applied_at` index and table/column comments

### Fixed

- `npm run db:rollback` no longer fails when rolling back `001_schema_migrations`: the tracking row is deleted before the `.down.sql` runs, so dropping the tracking table itself succeeds
- Frontend Jest config used a non-existent `setupFilesAfterFramework` key, so `jest.setup.ts` never loaded and `@testing-library/jest-dom` matchers were unavailable — every component test silently failed. Corrected to `setupFilesAfterEnv`.
- Frontend `type-check` failed on all test files because `@types/jest` was missing; added it to devDependencies.
- Frontend ESLint extended `next/typescript`, a config not shipped by `eslint-config-next@14`, which broke `npm run lint`; dropped it (TypeScript linting is already covered by `next/core-web-vitals`).
- `docs/database.md`: sync the `loans` table reference to the current schema — add the lifecycle columns and constraints introduced in migration 015 (`asset_issuer`, `purpose`, `amount_repaid`, `disbursed_at`, `closed_at`, `updated_at`, the `status` and `amount_repaid` CHECKs, and the `status` index)
- Migration 017: `transactions_log.community_id` foreign key is now `ON DELETE SET NULL`. Previously it defaulted to `NO ACTION`, which blocked deleting a community that had logged transactions and tied audit-trail retention to the community lifetime; the audit record now survives community deletion with `community_id` nulled
- `npm run db:rollback` no longer fails when rolling back `001_schema_migrations`: the tracking row is deleted before the `.down.sql` runs, so dropping the tracking table itself succeeds
- Development seed data used malformed Stellar public keys (55 characters, one containing literal filler text); replaced with well-formed 56-character StrKey addresses

---

## [0.1.0] — 2026-05-13

### Added

- Initial monorepo scaffold: Next.js 14 frontend + Node.js/Express backend + PostgreSQL
- Stellar SDK integration: asset issuance, trustlines, payments
- Community registration and member management API
- Balance dashboard with Freighter wallet integration
- Jest test setup for backend and frontend
- Docker Compose orchestration for all three services
- ESLint + TypeScript strict mode across both workspaces
- Winston structured logging
- `README.md`, `PRD.md`, `CONTRIBUTING.md`
