# Session Intelligence Phase 1: Journey Builder

## Purpose

Phase 1 creates a durable journey layer on top of the stitched Session Intelligence ledger.

It does not generate summaries or cases yet. Its job is to answer one lower-level question reliably:

- what did this shopper do, in order, during this session?

## Inputs

The journey builder reads from:

- `si_sessions`
- `si_events`
- existing stitching crosswalks (`checkout`, `cart`, `user identity`)

## Outputs

### `si_journeys`

One derived row per stitched session.

It stores:

- identity spine (`client_id`, `session_id`, `shopper_number`, `user_id`)
- entry context (`entry_page_path`, source, campaign, device, country)
- first / last product context
- cart / checkout / payment / purchase milestones
- last meaningful action before exit
- last technical or friction signal before exit
- return / later-purchase outcome within the configured lookahead window
- journey confidence and compact counts

### `si_journey_steps`

An ordered compressed step sequence for the session.

Each row stores:

- `step_index`
- `step_key`
- `step_label`
- first / last event in the step
- timing (`started_at`, `ended_at`)
- page / product / variant context
- checkout step when applicable

## Builder model

The builder maps raw events into stable step buckets:

- `home`
- `collection`
- `product`
- `search`
- `cart`
- `checkout_contact`
- `checkout_shipping`
- `checkout_payment`
- `checkout_review`
- `purchase`
- `content`
- `other`

Consecutive events in the same bucket are compressed into one journey step.

## Freshness model

Journey rows are rebuilt lazily.

A journey is rebuilt when:

- no derived journey exists yet
- the builder version changed
- `si_sessions.updated_at` is newer than the stored `source_updated_at`
- the caller explicitly requests `rebuild=true`

## API

### List journeys

`GET /api/session-intelligence/journeys?store=<store>&date=YYYY-MM-DD&limit=50&rebuild=0`

### Get one journey

`GET /api/session-intelligence/journeys/<session_id>?store=<store>&rebuild=0`

## Why this matters

This layer is the base for everything that comes next:

- case files
- money-leak clustering
- late-funnel behavior summaries
- Clarity-style daily briefs without video

Without this layer, later summaries have to infer directly from raw events and become brittle.
