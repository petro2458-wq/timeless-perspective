-- ════════════════════════════════════════════════════════════════════
--  BackTest — Supabase schema
--  One row per record: the POI, the entry model it produced, and the
--  prices inside it, all on one line.
--
--  Run this in the Supabase SQL editor, then paste your project URL and
--  anon key into the CONFIG block at the top of poi-backtest.html.
-- ════════════════════════════════════════════════════════════════════

create table if not exists public.poi_backtest (
  id                  uuid primary key default gen_random_uuid(),
  created_at          timestamptz not null default now(),

  -- identity
  trader              text,
  date                date,
  entry_tf            text,          -- 1m / 3m / 5m / 15m
  entry_time          time,
  instrument          text,
  h4_bias             text,          -- Long / Short
  h1_bias             text,          -- Long / Short
  m15_bias            text,          -- Long / Short (drives every R sign)
  htf_phase           text,
  h4_phase            text,
  poi_type            text,          -- Flip Zone / Supply Zone / Demand Zone
  poi_ref             text,          -- e.g. ES-0923-1. Two trades on one POI share it,
                                     -- so POI-level stats can collapse them.

  -- the seven positive confluences
  conf_break_structure boolean not null default false,
  conf_flip           boolean not null default false,
  conf_sweep_liq      boolean not null default false,
  conf_pro_trend      boolean not null default false,
  conf_pd             boolean not null default false,
  conf_unmitigated    boolean not null default false,
  conf_chain          boolean not null default false,
  -- negative confluence (not counted in the N/7 tally)
  conf_inducement     boolean not null default false,
  -- deprecated — no longer written by the app; kept for historical rows
  conf_pro_internal   boolean not null default false,
  conf_liquidity      boolean not null default false,
  conf_htf_stack      boolean not null default false,
  conf_push           boolean not null default false,

  -- entry model
  poi_tf              text,          -- 1m / 3m / 5m / 15m (the timeframe the POI was identified on)
  entry_model         text,          -- No Entry Model / EM3 Aggressive / EM3 Conservative / Flip Zone - Swept / Flip Zone - Unswept
  fake_shift          text,          -- Fractal / Strong — which structure the fMS broke (EM3)
  fz_state            text,          -- Already swept / Needed to be swept
  push_liq            text,          -- Yes / No

  -- prices.  POI 1R = abs(poi_entry - poi_inval)
  --          entry R = abs(entry_price - stop1|stop2)
  poi_entry           numeric,
  poi_inval           numeric,
  entry_price         numeric,
  stop1               numeric,
  stop2               numeric,
  target_price        numeric,
  be_trigger          numeric,
  mfe_price           numeric,
  mae_price           numeric,

  -- outcome
  outcome             text,          -- Win / Loss / Breakeven
  after_be            text,          -- Worked / Failed — only for Breakeven rows

  -- self-review flag
  needs_review        boolean not null default false,

  -- peer review
  pr_reviewer         text,
  pr_notes            text,
  pr_complete         boolean not null default false,

  -- reference
  tv_h4               text,
  tv_h1               text,
  tv_m15              text,
  tv_m3               text,
  tv_m1               text,
  notes               text,
  raw_dictation       text
);

-- Every column except id is nullable on purpose: rows are created blank or
-- half-parsed from dictation and completed in the grid.

create index if not exists poi_backtest_date_idx       on public.poi_backtest (date desc);
create index if not exists poi_backtest_trader_idx     on public.poi_backtest (trader);
create index if not exists poi_backtest_instrument_idx on public.poi_backtest (instrument);
create index if not exists poi_backtest_model_idx      on public.poi_backtest (entry_model);
create index if not exists poi_backtest_ref_idx        on public.poi_backtest (poi_ref);

alter table public.poi_backtest enable row level security;


-- ─── Migrating a table created by an earlier version of this file ───
-- The older schema had poi_date/poi_time/direction, a nested `entries`
-- jsonb column and no b/e or outcome fields. If you already created it:
--
-- alter table public.poi_backtest
--   add column if not exists entry_tf     text,
--   add column if not exists h4_bias      text,
--   add column if not exists h1_bias      text,
--   add column if not exists m15_bias     text,
--   add column if not exists entry_model  text,
--   add column if not exists poi_ref      text,
--   add column if not exists fake_shift   text,
--   add column if not exists fz_state     text,
--   add column if not exists push_liq     text,
--   add column if not exists poi_entry    numeric,
--   add column if not exists poi_inval    numeric,
--   add column if not exists entry_price  numeric,
--   add column if not exists stop1        numeric,
--   add column if not exists stop2        numeric,
--   add column if not exists target_price numeric,
--   add column if not exists be_trigger   numeric,
--   add column if not exists outcome      text,
--   add column if not exists after_be     text,
--   add column if not exists tv_m3        text,
--   add column if not exists tv_m1        text,
--   add column if not exists date         date,
--   add column if not exists poi_tf       text,
--   add column if not exists conf_break_structure boolean not null default false,
--   add column if not exists conf_sweep_liq boolean not null default false,
--   add column if not exists conf_pro_trend boolean not null default false,
--   add column if not exists conf_inducement boolean not null default false,
--   add column if not exists htf_phase    text,
--   add column if not exists needs_review  boolean not null default false,
--   add column if not exists pr_reviewer  text,
--   add column if not exists pr_notes     text,
--   add column if not exists pr_complete  boolean not null default false;


-- ════════════════════════════════════════════════════════════════════
--  ACCESS — pick ONE.
-- ════════════════════════════════════════════════════════════════════

-- ─── OPTION A · OPEN ────────────────────────────────────────────────
-- Anyone who loads the page can read and write. The anon key ships in the
-- page source, and the BackTest card is now linked from the homepage, so
-- treat this as testing-only and move to Option B before real capture.

create policy "anon read"   on public.poi_backtest for select to anon using (true);
create policy "anon insert" on public.poi_backtest for insert to anon with check (true);
create policy "anon update" on public.poi_backtest for update to anon using (true);
create policy "anon delete" on public.poi_backtest for delete to anon using (true);


-- ─── OPTION B · TWO NAMED TRADERS (recommended) ─────────────────────
-- Requires Supabase Auth (email magic link). Only the two listed
-- addresses can read or write, whoever else finds the page.
--
-- 1. Drop the Option A policies:
--
--    drop policy if exists "anon read"   on public.poi_backtest;
--    drop policy if exists "anon insert" on public.poi_backtest;
--    drop policy if exists "anon update" on public.poi_backtest;
--    drop policy if exists "anon delete" on public.poi_backtest;
--
-- 2. Put both addresses in, then run:
--
--    create policy "team access" on public.poi_backtest
--      for all to authenticated
--      using      (auth.jwt() ->> 'email' in ('you@example.com','partner@example.com'))
--      with check (auth.jwt() ->> 'email' in ('you@example.com','partner@example.com'));
--
-- 3. Add a sign-in step to the page:
--
--    await sb.auth.signInWithOtp({ email: <typed email> });
--
--    One click in the inbox per device; the session then persists.
