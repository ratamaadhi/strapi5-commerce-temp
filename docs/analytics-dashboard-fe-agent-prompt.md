# FE Agent Prompt: Internal Analytics Dashboard

You are the FE agent for a Next.js app. Implement an internal analytics dashboard for the Strapi commerce backend.

## Context

- Dashboard is internal only, not storefront-facing.
- Backend source of truth is Strapi analytics API.
- Do not invent a new role system in FE. Authorization must come from Strapi auth/session data.
- If role access is needed, treat Strapi staff/analytics-admin as source of truth.

## Backend API

Use these Strapi routes:

- `GET /api/analytics/conversion`
  - query: `from`, `to`, `utm_source`, `utm_medium`, `utm_campaign`
  - returns conversion summary, funnel counts, and daily breakdown
- `POST /api/analytics/events`
  - storefront tracking only
  - do not use this in the dashboard UI

## Dashboard Requirements

- Show conversion rate `session -> purchase`
- Show funnel metrics for:
  - `session_start`
  - `product_view`
  - `add_to_cart`
  - `checkout_start`
  - `purchase`
- Show daily breakdown
- Default date range: last 30 days
- Support UTM filters if API supports them
- Provide loading, empty, and error states

## Auth / Guard Rules

- Use Strapi-authenticated user as the only source of access control.
- Do not create FE-local roles.
- Gate the dashboard at Next.js middleware or server layout.
- If user is not authenticated or does not have staff/analytics-admin access, redirect to login or deny access.
- The API must still be protected server-side; FE guard is only UX.

## Implementation Guidance

1. Inspect existing Next.js app structure.
2. Reuse current auth/session pattern if present.
3. Build dashboard as a separate internal route group or section.
4. Keep storefront and dashboard flows separate.
5. Use typed API client or server helper for analytics fetches.
6. Prefer small reusable components for KPI cards, funnel blocks, date filters, and daily table/chart.

## Acceptance Criteria

- Authenticated staff can access dashboard.
- Unauthenticated users cannot access dashboard.
- Dashboard renders conversion + funnel + daily data from Strapi.
- Date range and UTM filters work.
- UI has loading, empty, and error handling.
- No storefront tracking changes unless needed for shared utilities.

## Deliverables

- Brief summary of files changed
- Endpoint(s) used
- Auth guard approach used
- Any backend gaps discovered
- No commit unless explicitly requested
