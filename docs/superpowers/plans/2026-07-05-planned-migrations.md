# Planned Migrations Implementation Plan

> **For agentic workers:** Execute each project in priority order (P1 → P3 → P4 → P2). Each project is self-contained.

**Goal:** Complete all 4 planned migrations from PLANNED.md

**Priority Order:** P1 (Enum) → P3 (Calibration) → P4 (Pagination) → P2 (Elo JSON→DB)

**Tech Stack:** Prisma + PostgreSQL + Next.js 14 + TypeScript

---

## P1: 12 String → PostgreSQL Enum Migration

### Task 1.1: Add enum declarations to schema.prisma
- Add 12 enum blocks to schema.prisma
- Change 12 field types from String → enum
- Run `prisma migrate dev`

### Task 1.2: Update TS code for enum compatibility
- Verify all String comparisons still work (Prisma auto-maps)

### Task 1.3: Test migration
- Run `prisma generate`, verify no type errors

---

## P3: Calibration Params → DB SystemConfig

### Task 3.1: Create seed script
- INSERT default L/k/x0/T into SystemConfig on boot

### Task 3.2: Wire admin settings to calibration params
- Add calibration fields to admin settings page

---

## P4: Signal Pagination

### Task 4.1: Add pagination to goal-signals API
- Accept page/limit params, return paginated response

### Task 4.2: Add pagination to admin signals API
- Same pattern

---

## P2: Elo Ratings JSON → PostgreSQL

### Task 2.1: Rewrite eloRating.ts (filesystem→DB)
- Replace getServerFs/loadRatings/saveRatings with DB queries

### Task 2.2: Update all callers
- Add await to all getRating/getAllRatings/updateRatings callers

---
