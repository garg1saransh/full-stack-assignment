# Kontrora — Estimates (Revenue & Billing)

**Author:** Saransh Garg

Staff-engineer assignment: an account-scoped **Estimates** slice on the Kontrora PSA platform (Next.js App Router + Supabase). Quality over completeness — money correctness, tenancy, and RBAC over feature sprawl.

---

## What this fork delivers

| Area | Implementation |
|------|----------------|
| **Schema** | `estimates` + `estimate_line_items` — account-bound, optional project link, amounts in **minor units** (`BIGINT`), soft-delete via `removed_at` |
| **Lifecycle** | `draft → sent → accepted \| rejected` (pure state machine; terminal states immutable) |
| **RBAC** | `view_estimates`, `view_all_estimates`, `manage_estimates` — enforced on every route with account context |
| **API** | List/filter, create with required `Idempotency-Key`, get-by-id, draft edit, lifecycle transitions, soft-delete drafts |
| **UI** | Account overview Estimates card — list, create/edit draft + line items, send / accept / reject |
| **Tests** | Vitest + smoke script for money math and lifecycle |

---

## How to run

**Requirements:** Node.js 20.9+, free [Supabase](https://supabase.com) project.

```bash
npm install
npm run setup:env
# Edit .env.local with:
#   NEXT_PUBLIC_SUPABASE_URL
#   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY
#   SUPABASE_SERVICE_ROLE_KEY

# Supabase SQL Editor (in order):
#   1. supabase/schema.sql     # includes estimates tables
#   2. supabase/seed-roles.sql
# Optional: supabase/estimates.sql  (standalone re-apply of revenue DDL)

npm run seed:users          # demo users + sample estimates
npm run test:estimates      # domain smoke checks
npm run dev                 # http://localhost:3000
```

**Demo:** after seed, password is `Test1234!`.  
Sign in as **Account Manager** (or Superadmin) → open an account → **Estimates**.  
Project Managers can view. Escrow lives on the project detail page.

---

## Architecture decisions

### Money as integer minor units
No floating-point dollars in storage or API totals. Fields are `*_minor` (`BIGINT` / JS integers). `lib/money.ts` handles major↔minor conversion. Totals are **recomputed server-side** from line items — the client cannot invent a total.

### Account tenancy on every path
Every estimate query/update filters `.eq('account_id', accountId)` from the route. Optional `project_id` must belong to the same account (service check + DB trigger `enforce_estimate_project_account`).

Writes use the service-role client **only after** `requireAuthAndPermission(...)` succeeds. Application-layer authZ is the primary tenancy control (consistent with the rest of this codebase).

### Idempotent creates
`POST` requires an `Idempotency-Key` header. A unique partial index on `(account_id, idempotency_key)` plus lookup / unique-violation handling returns the existing document (`idempotent: true`) instead of duplicating revenue records.

### Lifecycle as a pure module
Transitions live in `lib/estimate-lifecycle.ts`. Invalid transitions return **409**. Soft-delete is allowed for **drafts only**, so sent/accepted history stays auditable.

### RBAC (hybrid model)
- `VIEW_ESTIMATES` + account membership, or `VIEW_ALL_ESTIMATES` override  
- `MANAGE_ESTIMATES` requires base permission **and** account context (same judgment as `MANAGE_ACCOUNTS` — no manage-all override)

Seeded on Account Manager, Admin, Executive Director (view-all), and Project Manager (view).

### Compensating write
If the estimate header inserts but line items fail, the header is soft-deleted immediately so totals never exist without lines.

---

## API

Base path: `/api/accounts/:accountId/estimates`

| Method | Path | Permission | Notes |
|--------|------|------------|-------|
| `GET` | `/` | `view_estimates` | Filters: `status`, `projectId` |
| `POST` | `/` | `manage_estimates` | `Idempotency-Key` required; creates `draft` |
| `GET` | `/:estimateId` | `view_estimates` | Account-scoped |
| `PATCH` | `/:estimateId` | `manage_estimates` | `{ action }` for lifecycle **or** draft updates |
| `DELETE` | `/:estimateId` | `manage_estimates` | Soft-delete draft only |

```http
POST /api/accounts/{accountId}/estimates
Idempotency-Key: 550e8400-e29b-41d4-a716-446655440000
Content-Type: application/json

{
  "title": "Phase 1 discovery",
  "tax_minor": 0,
  "line_items": [
    { "description": "Workshop", "quantity": 1, "unit_amount_minor": 250000 }
  ]
}
```

```http
PATCH /api/accounts/{accountId}/estimates/{id}
{ "action": "send" }
```

---

## Security / tenancy review

| Risk | Mitigation |
|------|------------|
| Cross-account read/write | Route `accountId` + `.eq('account_id', …)` on every query; mismatch → 404 |
| Privilege escalation | `requireAuthAndPermission` with account context before privileged DB client |
| Duplicate creates | Required idempotency key + unique index + race handling |
| Float / rounding bugs | Integer cents end-to-end; server recomputes totals |
| Editing closed docs | Draft-only edits; soft-delete draft-only; accepted/rejected immutable |
| Cross-account project link | Trigger + `assertProjectBelongsToAccount` |
| Hard delete of financial history | Soft-delete (`removed_at`) only |

**Known residual risk:** RLS policies are permissive (`USING (TRUE)`), matching the existing platform. Next hardening would encode membership in RLS, add an append-only `estimate_events` audit table, and reconcile Stripe webhooks by estimate id.

---

## How to run tests

```bash
npm run test:estimates   # fast domain smoke (money + lifecycle + totals)
npm test                 # Vitest suite under __tests__/
```

| File | Covers |
|------|--------|
| `__tests__/money.test.ts` | parse/format, line amounts, sum safety |
| `__tests__/estimate-lifecycle.test.ts` | transitions, soft-delete rules, totals |
| `scripts/smoke-estimates.ts` | same invariants without Vitest |

---

## What I’d ship next

1. **Stripe PaymentIntents** from `accepted` estimates (`total_minor`) with `stripe_payment_intent_id` stored on the row  
2. **Reconciliation job** — Stripe charges ↔ accepted estimates, mismatches in admin  
3. **Estimate → invoice / escrow** handoff using the same minor-unit amounts  
4. **Client portal** accept/reject for `sent` estimates (`is_client` on the account)  
5. **Append-only `estimate_events`** — who transitioned, when, idempotency key  
6. **Stricter RLS** joining `account_members` so tenancy holds even if an API filter is missed  

---

## Key files

| Concern | Path |
|---------|------|
| Schema | `supabase/schema.sql` (estimates section), `supabase/estimates.sql` |
| Permissions | `lib/permissions.ts`, `lib/permission-checker.ts`, `supabase/seed-roles.sql` |
| Domain | `lib/money.ts`, `lib/estimate-lifecycle.ts`, `lib/estimate-service.ts` |
| API | `app/api/accounts/[accountId]/estimates/` |
| UI | `components/account-estimates.tsx` (mounted in account overview) |

---

*Submission: fork URL (no PR). Built by Saransh Garg.*
