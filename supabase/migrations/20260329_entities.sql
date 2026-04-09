-- ============================================================
-- ORBIT: Multi-Entity Support
-- Run this in the Supabase SQL Editor
-- ============================================================

-- 1. Entities table
create table if not exists entities (
  id                   uuid default gen_random_uuid() primary key,
  org_id               uuid references organisations(id) on delete cascade not null,
  name                 text not null,
  functional_currency  text not null default 'USD',
  jurisdiction         text,                                         -- e.g. 'US', 'DE', 'CA'
  parent_entity_id     uuid references entities(id) on delete set null,
  is_active            boolean not null default true,
  created_at           timestamptz default now(),
  updated_at           timestamptz default now()
);

-- 2. Row-level security
alter table entities enable row level security;

do $$ begin
  create policy "org members can view entities"
    on entities for select
    using (org_id = (select org_id from profiles where id = auth.uid()));
exception when duplicate_object then null;
end $$;

do $$ begin
  create policy "org admins can manage entities"
    on entities for all
    using (org_id = (select org_id from profiles where id = auth.uid()));
exception when duplicate_object then null;
end $$;

-- 3. Updated_at trigger
create or replace function update_entities_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end;
$$;

do $$ begin
  create trigger entities_updated_at
    before update on entities
    for each row execute procedure update_entities_updated_at();
exception when duplicate_object then null;
end $$;

-- 4. Add entity_id FK to key tables (nullable — NULL means org-level / pre-entity)
alter table hedge_positions    add column if not exists entity_id uuid references entities(id) on delete set null;
alter table fx_exposures       add column if not exists entity_id uuid references entities(id) on delete set null;
alter table bank_accounts      add column if not exists entity_id uuid references entities(id) on delete set null;

-- 5. Indexes for fast entity-scoped queries
create index if not exists idx_hedge_positions_entity  on hedge_positions(entity_id);
create index if not exists idx_fx_exposures_entity     on fx_exposures(entity_id);
create index if not exists idx_bank_accounts_entity    on bank_accounts(entity_id);
create index if not exists idx_entities_org            on entities(org_id);
