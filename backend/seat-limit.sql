-- ============================================================
-- 기업별 좌석 수 예외 (11.10): companies.seat_limit 가 있으면 기업당 2명 대신 그 값을 적용
-- 테스트용 기업: IR큐더스(아이알큐더스) · 6석  → 테스트 후 backend/test-cleanup.sql 로 정리
-- ============================================================
alter table public.companies add column if not exists seat_limit int;

insert into public.companies(code, name, market, eligible, seat_limit)
values ('TEST', 'IR큐더스(아이알큐더스)', '테스트', true, 6)
on conflict (code) do update set name = excluded.name, market = excluded.market, eligible = true, seat_limit = 6;

create or replace function public.list_companies()
returns table (id bigint, name text, code text, market text, remaining int)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.code, c.market,
         greatest(coalesce(c.seat_limit, _setting('per_company')::int) - count(r.id)::int, 0)
  from companies c
  left join registrations r on r.company_id = c.id and r.status = 'confirmed'
  where c.eligible
  group by c.id
  order by c.name
$$;

create or replace function public.register(p jsonb) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare
  v_company   companies;
  v_manual    boolean := (p->>'company_id') is null;
  v_cname     text;
  v_status    text;
  v_email     text := lower(trim(coalesce(p->>'email','')));
  v_phone     text := regexp_replace(coalesce(p->>'phone',''), '[^0-9]', '', 'g');
  v_reg       registrations;
  v_cap       int := _setting('capacity')::int;
  v_per       int := _setting('per_company')::int;
begin
  -- 봇 차단용 숨김 칸
  if coalesce(p->>'hp','') <> '' then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;
  if _setting('open') <> 'true' or now() >= timestamptz '2026-11-27 18:00:00+09' then
    return jsonb_build_object('ok', false, 'code', 'closed');
  end if;
  -- 대상 기업 목록에서 고른 신청만 받음 (직접 입력 신청 없음, 11.9 결정)
  if v_manual then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  -- 필수값 검증
  if length(trim(coalesce(p->>'name',''))) < 2
     or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'
     or v_phone !~ '^01[016789][0-9]{7,8}$'
     or coalesce((p->>'agree_privacy')::boolean, false) is not true then
    return jsonb_build_object('ok', false, 'code', 'invalid');
  end if;

  -- 모든 신청을 한 줄로 세워 처리 (선착순 보장)
  perform pg_advisory_xact_lock(20261130);

  if exists (select 1 from registrations
             where status in ('confirmed','pending')
               and (lower(email) = v_email or phone = v_phone)) then
    return jsonb_build_object('ok', false, 'code', 'duplicate');
  end if;

  if _total_count() >= v_cap then
    return jsonb_build_object('ok', false, 'code', 'full');
  end if;

  if not v_manual then
    select * into v_company from companies
     where id = (p->>'company_id')::bigint and eligible;
    if not found then
      return jsonb_build_object('ok', false, 'code', 'invalid');
    end if;
    if _company_count(v_company.id, null) >= coalesce(v_company.seat_limit, v_per) then
      return jsonb_build_object('ok', false, 'code', 'company_full');
    end if;
    v_cname  := v_company.name;
    v_status := 'confirmed';
  else
    v_cname := trim(coalesce(p->>'company_name',''));
    if length(v_cname) < 2 then
      return jsonb_build_object('ok', false, 'code', 'invalid');
    end if;
    v_status := 'pending';
  end if;

  insert into registrations
    (company_id, company_name, is_manual, biz_no, status, name, dept, title, phone, email,
     session, question, consult, agree_privacy, agree_marketing)
  values
    (v_company.id, v_cname, v_manual, nullif(trim(p->>'biz_no'),''), v_status,
     trim(p->>'name'), nullif(trim(p->>'dept'),''), nullif(trim(p->>'title'),''), v_phone, v_email,
     nullif(p->>'session',''), nullif(left(p->>'question', 1000),''),
     coalesce((p->>'consult')::boolean,false), true, coalesce((p->>'agree_marketing')::boolean,false))
  returning * into v_reg;

  return jsonb_build_object('ok', true, 'status', v_status, 'reg_no', v_reg.reg_no,
                            'company', v_cname, 'name', v_reg.name, 'email', v_reg.email);
end $$;

select id, name, code, seat_limit from public.companies where code = 'TEST';
