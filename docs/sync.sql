create table if not exists sh_state (
  code text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table sh_state enable row level security;

create or replace function sh_get(p_code text) returns jsonb
language sql security definer set search_path = public as $$
  select data from sh_state where code = p_code and length(p_code) >= 16
$$;

create or replace function sh_put(p_code text, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if length(p_code) < 16 then raise exception 'code too short'; end if;
  insert into sh_state (code, data, updated_at) values (p_code, p_data, now())
  on conflict (code) do update set data = excluded.data, updated_at = now();
end $$;

revoke all on function sh_get(text) from public;
revoke all on function sh_put(text, jsonb) from public;
grant execute on function sh_get(text), sh_put(text, jsonb) to anon, authenticated;
