-- ═══════════════════════════════════════════════════════════════════
-- PRA Legal — database
-- Run once in Supabase → SQL Editor. Safe to read top to bottom:
--   1 plans   2 profiles   3 usage   4 events   5 admin log
--   6 sign-up trigger   7 security   8 account functions   9 admin functions
--
-- Client matters and client files are NOT stored here. They stay in each
-- user's browser. The server only knows accounts, plans and usage.
-- ═══════════════════════════════════════════════════════════════════


-- ── 1. Plans ────────────────────────────────────────────────────────
-- monthly_tokens: model tokens included per calendar month (UTC).
-- hosted: true when the plan uses YOUR Anthropic key through the proxy.
create table public.plans (
  id              text primary key,
  name            text    not null,
  price_ils       integer not null default 0,
  monthly_tokens  bigint  not null default 0,
  hosted          boolean not null default false,
  sort            integer not null default 0
);

insert into public.plans (id, name, price_ils, monthly_tokens, hosted, sort) values
  ('own_key',      'Own key',       0,          0, false, 1),
  ('practitioner', 'Practitioner', 199,   3000000, true,  2),
  ('firm',         'Firm',         599,   8000000, true,  3);


-- ── 2. Profiles — one row per signed-up user ────────────────────────
create table public.profiles (
  id                      uuid primary key references auth.users(id) on delete cascade,
  email                   text not null,
  full_name               text,
  firm                    text,
  plan                    text not null default 'own_key' references public.plans(id),
  subscription_status     text not null default 'none'
                          check (subscription_status in ('none','active','trialing','past_due','canceled','comped')),
  current_period_end      timestamptz,
  stripe_customer_id      text unique,
  stripe_subscription_id  text,
  bonus_tokens            bigint  not null default 0 check (bonus_tokens >= 0),
  suspended               boolean not null default false,
  is_admin                boolean not null default false,
  created_at              timestamptz not null default now(),
  last_seen_at            timestamptz
);

create index profiles_created_idx on public.profiles (created_at desc);


-- ── 3. Usage — one row per model call made through the proxy ────────
create table public.usage (
  id             bigint generated always as identity primary key,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  created_at     timestamptz not null default now(),
  feature        text,
  model          text not null,
  input_tokens   integer not null default 0,
  output_tokens  integer not null default 0,
  cost_usd       numeric(12,6) not null default 0
);

create index usage_user_month_idx on public.usage (user_id, created_at desc);
create index usage_created_idx    on public.usage (created_at desc);


-- ── 4. Events — lightweight activity log written by the workspace ───
create table public.events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now(),
  kind        text  not null check (char_length(kind) <= 40),
  detail      jsonb not null default '{}'
);

create index events_created_idx on public.events (created_at desc);
create index events_user_idx    on public.events (user_id, created_at desc);


-- ── 5. Admin log — every change an administrator makes ──────────────
create table public.admin_log (
  id          bigint generated always as identity primary key,
  admin_id    uuid references public.profiles(id) on delete set null,
  target_id   uuid references public.profiles(id) on delete set null,
  action      text  not null,
  detail      jsonb not null default '{}',
  created_at  timestamptz not null default now()
);


-- ── 6. Every new sign-up gets a profile ─────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, firm)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'full_name', ''),
    nullif(new.raw_user_meta_data ->> 'firm', '')
  )
  on conflict (id) do nothing;
  return new;
end
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Anyone who signed up before this migration ran
insert into public.profiles (id, email)
select id, email from auth.users
on conflict (id) do nothing;


-- ── 7. Security ─────────────────────────────────────────────────────
-- Row-level security everywhere. Users read only their own rows.
-- Users may change only their name and firm. Plan, status, admin flag
-- and usage are written by the server (service role) or by admin
-- functions below — never directly from the browser.

alter table public.plans     enable row level security;
alter table public.profiles  enable row level security;
alter table public.usage     enable row level security;
alter table public.events    enable row level security;
alter table public.admin_log enable row level security;

create policy "plans are public"
  on public.plans for select using (true);

create policy "read own profile"
  on public.profiles for select using (auth.uid() = id);

create policy "update own profile"
  on public.profiles for update using (auth.uid() = id) with check (auth.uid() = id);

create policy "read own usage"
  on public.usage for select using (auth.uid() = user_id);

create policy "read own events"
  on public.events for select using (auth.uid() = user_id);

create policy "write own events"
  on public.events for insert with check (auth.uid() = user_id);

-- Supabase grants broad table rights to anon/authenticated by default.
-- Narrow them to exactly what the policies above intend.
revoke insert, update, delete on public.plans     from anon, authenticated;
revoke insert, update, delete on public.profiles  from anon, authenticated;
grant  update (full_name, firm) on public.profiles to authenticated;
revoke insert, update, delete on public.usage     from anon, authenticated;
revoke update, delete         on public.events    from anon, authenticated;
revoke all                    on public.admin_log from anon, authenticated;


-- ── 8. Account functions — called by the workspace ──────────────────

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false)
$$;

-- Everything the workspace needs to know about the signed-in user.
create or replace function public.my_account()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id',                  p.id,
    'email',               p.email,
    'full_name',           p.full_name,
    'firm',                p.firm,
    'plan',                p.plan,
    'plan_name',           pl.name,
    'price_ils',           pl.price_ils,
    'hosted',              pl.hosted,
    'subscription_status', p.subscription_status,
    'current_period_end',  p.current_period_end,
    'suspended',           p.suspended,
    'is_admin',            p.is_admin,
    'has_billing',         p.stripe_customer_id is not null,
    'allowance',           pl.monthly_tokens + p.bonus_tokens,
    'used',                coalesce((
                             select sum(u.input_tokens + u.output_tokens)
                             from public.usage u
                             where u.user_id = p.id
                               and u.created_at >= date_trunc('month', now())
                           ), 0),
    'period_start',        date_trunc('month', now())
  )
  from public.profiles p
  join public.plans pl on pl.id = p.plan
  where p.id = auth.uid()
$$;

create or replace function public.touch_last_seen()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles set last_seen_at = now() where id = auth.uid()
$$;

-- Called only by the model proxy (service role) before forwarding a request.
create or replace function public.usage_state(uid uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'plan',      p.plan,
    'hosted',    pl.hosted,
    'status',    p.subscription_status,
    'suspended', p.suspended,
    'allowance', pl.monthly_tokens + p.bonus_tokens,
    'used',      coalesce((
                   select sum(u.input_tokens + u.output_tokens)
                   from public.usage u
                   where u.user_id = p.id
                     and u.created_at >= date_trunc('month', now())
                 ), 0)
  )
  from public.profiles p
  join public.plans pl on pl.id = p.plan
  where p.id = uid
$$;


-- ── 9. Admin functions — called by admin.html ───────────────────────
-- Each one refuses to run unless the caller has is_admin = true.

create or replace function public.admin_overview()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  month_start timestamptz := date_trunc('month', now());
begin
  if not public.is_admin() then
    raise exception 'Administrators only.' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'users',          (select count(*) from public.profiles),
    'new_30d',        (select count(*) from public.profiles where created_at > now() - interval '30 days'),
    'active_7d',      (select count(*) from public.profiles where last_seen_at > now() - interval '7 days'),
    'paying',         (select count(*) from public.profiles where subscription_status in ('active','trialing') and plan <> 'own_key'),
    'comped',         (select count(*) from public.profiles where subscription_status = 'comped'),
    'past_due',       (select count(*) from public.profiles where subscription_status = 'past_due'),
    'suspended',      (select count(*) from public.profiles where suspended),
    'mrr_ils',        (select coalesce(sum(pl.price_ils), 0)
                         from public.profiles p join public.plans pl on pl.id = p.plan
                        where p.subscription_status = 'active'),
    'tokens_month',   (select coalesce(sum(input_tokens + output_tokens), 0) from public.usage where created_at >= month_start),
    'cost_month_usd', (select coalesce(sum(cost_usd), 0) from public.usage where created_at >= month_start),
    'requests_month', (select count(*) from public.usage where created_at >= month_start),
    'by_plan',        (select coalesce(jsonb_object_agg(plan, n), '{}'::jsonb)
                         from (select plan, count(*) as n from public.profiles group by plan) s)
  );
end
$$;

create or replace function public.admin_users(q text default null)
returns table (
  id                  uuid,
  email               text,
  full_name           text,
  firm                text,
  plan                text,
  subscription_status text,
  suspended           boolean,
  is_admin            boolean,
  bonus_tokens        bigint,
  created_at          timestamptz,
  last_seen_at        timestamptz,
  current_period_end  timestamptz,
  has_billing         boolean,
  tokens_month        bigint,
  cost_month_usd      numeric,
  allowance           bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'Administrators only.' using errcode = '42501';
  end if;

  return query
  select
    p.id, p.email, p.full_name, p.firm, p.plan, p.subscription_status,
    p.suspended, p.is_admin, p.bonus_tokens, p.created_at, p.last_seen_at,
    p.current_period_end, p.stripe_customer_id is not null,
    coalesce(m.tokens, 0)::bigint,
    coalesce(m.cost, 0)::numeric,
    (pl.monthly_tokens + p.bonus_tokens)::bigint
  from public.profiles p
  join public.plans pl on pl.id = p.plan
  left join (
    select us.user_id,
           sum(us.input_tokens + us.output_tokens) as tokens,
           sum(us.cost_usd) as cost
    from public.usage us
    where us.created_at >= date_trunc('month', now())
    group by us.user_id
  ) m on m.user_id = p.id
  where q is null or q = ''
     or p.email ilike '%' || q || '%'
     or coalesce(p.full_name, '') ilike '%' || q || '%'
     or coalesce(p.firm, '') ilike '%' || q || '%'
  order by p.created_at desc
  limit 1000;
end
$$;

create or replace function public.admin_daily(days integer default 30)
returns table (day date, tokens bigint, cost_usd numeric, requests bigint)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'Administrators only.' using errcode = '42501';
  end if;

  return query
  select
    g.d::date,
    coalesce(sum(us.input_tokens + us.output_tokens), 0)::bigint,
    coalesce(sum(us.cost_usd), 0)::numeric,
    count(us.id)::bigint
  from generate_series(current_date - (greatest(days, 1) - 1), current_date, interval '1 day') as g(d)
  left join public.usage us
    on us.created_at >= g.d and us.created_at < g.d + interval '1 day'
  group by g.d
  order by g.d;
end
$$;

create or replace function public.admin_events(lim integer default 100, for_user uuid default null)
returns table (created_at timestamptz, user_id uuid, email text, kind text, detail jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'Administrators only.' using errcode = '42501';
  end if;

  return query
  select e.created_at, e.user_id, p.email, e.kind, e.detail
  from public.events e
  join public.profiles p on p.id = e.user_id
  where for_user is null or e.user_id = for_user
  order by e.created_at desc
  limit least(greatest(lim, 1), 500);
end
$$;

create or replace function public.admin_audit(lim integer default 100)
returns table (created_at timestamptz, admin_email text, target_email text, action text, detail jsonb)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
begin
  if not public.is_admin() then
    raise exception 'Administrators only.' using errcode = '42501';
  end if;

  return query
  select l.created_at, a.email, t.email, l.action, l.detail
  from public.admin_log l
  left join public.profiles a on a.id = l.admin_id
  left join public.profiles t on t.id = l.target_id
  order by l.created_at desc
  limit least(greatest(lim, 1), 500);
end
$$;

-- Change a user's plan, suspension, extra tokens or admin flag.
-- Pass only what you want to change; nulls are left alone.
-- A manual plan change does not touch Stripe billing.
create or replace function public.admin_update_user(
  target        uuid,
  new_plan      text    default null,
  new_suspended boolean default null,
  new_bonus     bigint  default null,
  new_admin     boolean default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  changes     jsonb := '{}'::jsonb;
  plan_hosted boolean;
begin
  if not public.is_admin() then
    raise exception 'Administrators only.' using errcode = '42501';
  end if;

  if not exists (select 1 from public.profiles where id = target) then
    raise exception 'No such user.';
  end if;

  if target = auth.uid() and new_admin is false then
    raise exception 'You cannot remove your own admin access.';
  end if;

  if target = auth.uid() and new_suspended is true then
    raise exception 'You cannot suspend your own account.';
  end if;

  if new_plan is not null then
    select hosted into plan_hosted from public.plans where id = new_plan;
    if not found then
      raise exception 'Unknown plan: %', new_plan;
    end if;

    update public.profiles
       set plan = new_plan,
           subscription_status = case
             when not plan_hosted then 'none'
             when subscription_status in ('active','trialing') then subscription_status
             else 'comped'
           end
     where id = target;

    changes := changes || jsonb_build_object('plan', new_plan);
  end if;

  if new_suspended is not null then
    update public.profiles set suspended = new_suspended where id = target;
    changes := changes || jsonb_build_object('suspended', new_suspended);
  end if;

  if new_bonus is not null then
    if new_bonus < 0 then
      raise exception 'Extra tokens cannot be negative.';
    end if;
    update public.profiles set bonus_tokens = new_bonus where id = target;
    changes := changes || jsonb_build_object('bonus_tokens', new_bonus);
  end if;

  if new_admin is not null then
    update public.profiles set is_admin = new_admin where id = target;
    changes := changes || jsonb_build_object('is_admin', new_admin);
  end if;

  if changes <> '{}'::jsonb then
    insert into public.admin_log (admin_id, target_id, action, detail)
    values (auth.uid(), target, 'update_user', changes);
  end if;

  return changes;
end
$$;


-- ── Function permissions ────────────────────────────────────────────
-- Postgres lets everyone execute functions by default. Close that, then
-- open each function to exactly the role that should call it.

revoke all on function public.handle_new_user()                              from public, anon, authenticated;
revoke all on function public.is_admin()                                     from public, anon;
revoke all on function public.my_account()                                   from public, anon;
revoke all on function public.touch_last_seen()                              from public, anon;
revoke all on function public.usage_state(uuid)                              from public, anon, authenticated;
revoke all on function public.admin_overview()                               from public, anon;
revoke all on function public.admin_users(text)                              from public, anon;
revoke all on function public.admin_daily(integer)                           from public, anon;
revoke all on function public.admin_events(integer, uuid)                    from public, anon;
revoke all on function public.admin_audit(integer)                           from public, anon;
revoke all on function public.admin_update_user(uuid, text, boolean, bigint, boolean) from public, anon;

grant execute on function public.is_admin()                                  to authenticated;
grant execute on function public.my_account()                                to authenticated;
grant execute on function public.touch_last_seen()                           to authenticated;
grant execute on function public.usage_state(uuid)                           to service_role;
grant execute on function public.admin_overview()                            to authenticated;
grant execute on function public.admin_users(text)                           to authenticated;
grant execute on function public.admin_daily(integer)                        to authenticated;
grant execute on function public.admin_events(integer, uuid)                 to authenticated;
grant execute on function public.admin_audit(integer)                        to authenticated;
grant execute on function public.admin_update_user(uuid, text, boolean, bigint, boolean) to authenticated;
