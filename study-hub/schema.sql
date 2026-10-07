-- Supabase 의 SQL Editor 에 통째로 붙여넣고 Run 을 한 번만 누르면 된다.

create table if not exists public.tasks (
  id text primary key,
  title text not null,
  bucket text,
  due text,
  est_min integer,
  first_step text,
  urgency integer default 3,
  status text default 'open',
  planned_for text,
  skips integer default 0,
  skip_day text,
  source text,
  parent_id text,
  created_at text not null,
  done_at text
);
alter table public.tasks enable row level security;

create table if not exists public.dumps (
  id text primary key,
  raw text not null,
  status text default 'pending',
  summary text,
  created_at text not null
);
alter table public.dumps enable row level security;

create table if not exists public.parking (
  id text primary key,
  text text not null,
  status text default 'new',
  created_at text not null
);
alter table public.parking enable row level security;

create table if not exists public.docs (
  id text primary key,
  kind text,
  subject text,
  filename text,
  summary text,
  created_at text not null
);
alter table public.docs enable row level security;
