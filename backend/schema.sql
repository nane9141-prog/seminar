-- ============================================================
-- 전자주주총회플랫폼 시연 설명회 · 사전등록
-- ============================================================
create extension if not exists pg_net;

-- 설정값 (운영자가 Table Editor에서 수정)
create table if not exists public.settings (
  key   text primary key,
  value text,
  note  text
);
insert into public.settings(key,value,note) values
  ('capacity','300','전체 정원'),
  ('per_company','2','기업당 최대 인원'),
  ('open','true','접수 열림 여부 (true/false)'),
  ('mail_webhook_url','','Apps Script 웹앱 URL — 발송 계정 확정 후 입력'),
  ('mail_secret', replace(gen_random_uuid()::text,'-',''),'Apps Script와 공유하는 비밀값')
on conflict (key) do nothing;

-- 대상 기업 (2025 사업연도 말 자산총액 2조원 이상)
create table if not exists public.companies (
  id            bigint generated always as identity primary key,
  code          text unique,
  name          text not null,
  market        text,
  total_assets  bigint,
  fiscal_month  int,
  eligible      boolean not null default true
);

-- 신청
create table if not exists public.registrations (
  id             uuid primary key default gen_random_uuid(),
  reg_no         bigint generated always as identity,
  company_id     bigint references public.companies(id),
  company_name   text not null,
  is_manual      boolean not null default false,
  biz_no         text,
  status         text not null check (status in ('confirmed','pending','rejected','cancelled')),
  name           text not null,
  dept           text,
  title          text,
  phone          text not null,
  email          text not null,
  session        text,
  question       text,
  consult        boolean not null default false,
  agree_privacy  boolean not null,
  agree_marketing boolean not null default false,
  cancel_token   uuid not null default gen_random_uuid(),
  memo           text,
  created_at     timestamptz not null default now(),
  decided_at     timestamptz
);
create unique index if not exists reg_email_active on public.registrations (lower(email)) where status in ('confirmed','pending');
create unique index if not exists reg_phone_active on public.registrations (phone)        where status in ('confirmed','pending');
create index if not exists reg_company on public.registrations (company_id) where status = 'confirmed';

alter table public.settings      enable row level security;
alter table public.companies     enable row level security;
alter table public.registrations enable row level security;
-- 정책 없음 = 브라우저(anon)는 테이블에 직접 접근 불가. 아래 함수로만 접근.

-- ------------------------------------------------------------
-- 내부 헬퍼
-- ------------------------------------------------------------
create or replace function public._setting(k text) returns text
language sql stable security definer set search_path = public as
$$ select value from settings where key = k $$;

create or replace function public._norm(t text) returns text
language sql immutable as
$$ select lower(regexp_replace(coalesce(t,''), '\s|\(주\)|㈜|주식회사|\.|,', '', 'g')) $$;

create or replace function public._company_count(p_company_id bigint, p_company_name text) returns int
language sql stable security definer set search_path = public as $$
  select count(*)::int from registrations r
  where r.status = 'confirmed'
    and ( (p_company_id is not null and r.company_id = p_company_id)
       or (p_company_id is null and r.company_id is null and _norm(r.company_name) = _norm(p_company_name)) )
$$;

create or replace function public._total_count() returns int
language sql stable security definer set search_path = public as
$$ select count(*)::int from registrations where status = 'confirmed' $$;

-- ------------------------------------------------------------
-- 공개 함수 (사이트에서 호출)
-- ------------------------------------------------------------
-- 기업 목록 + 기업별 남은 자리
create or replace function public.list_companies()
returns table (id bigint, name text, code text, market text, remaining int)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.code, c.market,
         greatest(_setting('per_company')::int - count(r.id)::int, 0)
  from companies c
  left join registrations r on r.company_id = c.id and r.status = 'confirmed'
  where c.eligible
  group by c.id
  order by c.name
$$;

-- 전체 접수 현황
create or replace function public.event_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'open', _setting('open') = 'true',
    'capacity', _setting('capacity')::int,
    'remaining', greatest(_setting('capacity')::int - _total_count(), 0)
  )
$$;

-- 신청
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
  if _setting('open') <> 'true' then
    return jsonb_build_object('ok', false, 'code', 'closed');
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
    if _company_count(v_company.id, null) >= v_per then
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

-- 취소 (메일의 취소 링크)
create or replace function public.cancel_registration(p_token uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare v registrations;
begin
  update registrations set status = 'cancelled', decided_at = now()
   where cancel_token = p_token and status in ('confirmed','pending')
  returning * into v;
  if not found then return jsonb_build_object('ok', false); end if;
  return jsonb_build_object('ok', true, 'name', v.name, 'company', v.company_name);
end $$;

revoke all on function public._setting(text), public._company_count(bigint,text), public._total_count() from public, anon, authenticated;
grant execute on function public.list_companies(), public.event_status(), public.register(jsonb), public.cancel_registration(uuid) to anon, authenticated;

-- ------------------------------------------------------------
-- 운영자 승인: Table Editor에서 status를 'approved'로 바꾸면
-- 자리 확인 후 confirmed로 확정 (자리가 없으면 저장 거부)
-- ------------------------------------------------------------
alter table public.registrations drop constraint if exists registrations_status_check;
alter table public.registrations add constraint registrations_status_check
  check (status in ('confirmed','pending','rejected','cancelled'));

create or replace function public._before_status() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = old.status then return new; end if;
  if new.status = 'approved' then
    if old.status <> 'pending' then
      raise exception '승인 대기(pending) 상태만 승인할 수 있습니다.';
    end if;
    perform pg_advisory_xact_lock(20261130);
    if _total_count() >= _setting('capacity')::int then
      raise exception '전체 정원이 마감되어 승인할 수 없습니다.';
    end if;
    if _company_count(new.company_id, new.company_name) >= _setting('per_company')::int then
      raise exception '이 기업은 이미 %명이 확정되어 승인할 수 없습니다.', _setting('per_company');
    end if;
    new.status := 'confirmed';
  end if;
  new.decided_at := now();
  return new;
end $$;

drop trigger if exists reg_before_status on public.registrations;
create trigger reg_before_status before update of status on public.registrations
  for each row execute function public._before_status();

-- ------------------------------------------------------------
-- 메일 발송: 상태가 생기거나 바뀌면 Apps Script 웹훅 호출
-- ------------------------------------------------------------
create or replace function public._send_mail(p_type text, r registrations) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_url text := _setting('mail_webhook_url');
begin
  if coalesce(v_url,'') = '' then return; end if;
  perform net.http_post(
    url  := v_url,
    body := jsonb_build_object(
      'secret', _setting('mail_secret'), 'type', p_type,
      'reg_no', r.reg_no, 'name', r.name, 'email', r.email, 'company', r.company_name,
      'dept', r.dept, 'title', r.title, 'cancel_token', r.cancel_token),
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 10000);
end $$;

create or replace function public._after_reg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform _send_mail(case when new.status = 'confirmed' then 'confirmed' else 'pending' end, new);
  elsif new.status is distinct from old.status then
    if new.status = 'confirmed' and old.status = 'pending' then perform _send_mail('approved', new);
    elsif new.status = 'rejected'  then perform _send_mail('rejected', new);
    elsif new.status = 'cancelled' then perform _send_mail('cancelled', new);
    end if;
  end if;
  return null;
end $$;

drop trigger if exists reg_after on public.registrations;
create trigger reg_after after insert or update of status on public.registrations
  for each row execute function public._after_reg();

-- D-1 리마인드 (운영자가 실행: select public.send_reminders();)
create or replace function public.send_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare r registrations; n int := 0;
begin
  for r in select * from registrations where status = 'confirmed' loop
    perform _send_mail('reminder', r); n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.send_reminders() from public, anon, authenticated;

-- 운영용 보기
create or replace view public.admin_overview with (security_invoker = true) as
select r.reg_no, r.status, r.company_name, r.is_manual, r.biz_no, r.name, r.dept, r.title,
       r.phone, r.email, r.session, r.question, r.consult, r.agree_marketing, r.created_at, r.decided_at, r.memo
from public.registrations r order by r.created_at;
revoke all on public.admin_overview from anon, authenticated;
