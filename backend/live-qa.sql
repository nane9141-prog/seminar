-- ============================================================
-- 현장 질의 (QR 질문폼 /ask  ·  seminar-screen control 질문 패널  ·  메인 스크린 M10-2)
-- ============================================================

-- 접수 마감 시각 (운영자가 Table Editor에서 바꿀 수 있음)
insert into public.settings(key,value,note) values
  ('ask_close','2026-11-30T17:00:00+09:00','현장 질문 접수 마감 시각'),
  ('ask_open','true','현장 질문 접수 열림 여부 (true/false)')
on conflict (key) do nothing;

create table if not exists public.live_questions (
  id          bigint generated always as identity primary key,
  kind        text not null default 'live' check (kind in ('live','pre')),
  n           int,                       -- 종류별 번호 (현장 Q01, 사전 Q01)
  company     text not null,
  name        text not null,
  session     text not null default 'all' check (session in ('all','s1','s2','s3','s4','demo')),
  body        text not null,
  who         text,                                -- 답변 연사 (운영자 입력)
  status      text not null default 'new' check (status in ('new','picked','hidden')),
  ord         double precision,                    -- 선택 목록 순서
  picked_by   text,
  shown_at    timestamptz,                         -- 마지막 송출 시각
  device      text,
  source_reg  uuid unique,                         -- 사전 질문: 원본 신청 id
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists lq_created on public.live_questions (created_at);

create table if not exists public.qa_state (
  id          int primary key default 1 check (id = 1),
  cur         bigint references public.live_questions(id) on delete set null,
  updated_by  text,
  updated_at  timestamptz not null default now()
);
insert into public.qa_state(id) values (1) on conflict do nothing;

alter table public.live_questions enable row level security;
alter table public.qa_state       enable row level security;
revoke all on public.live_questions, public.qa_state from anon;

-- 운영자(admins) 조회·수정·삭제
drop policy if exists admin_all on public.live_questions;
create policy admin_all on public.live_questions for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists admin_all on public.qa_state;
create policy admin_all on public.qa_state for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.live_questions to authenticated;
grant select, update on public.qa_state to authenticated;

create or replace function public._lq_touch() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists lq_touch on public.live_questions;
create trigger lq_touch before update on public.live_questions for each row execute function public._lq_touch();

-- 번호 매기기 (운영자가 직접 넣는 사전 질문도 포함)
create or replace function public._lq_number() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.n is null then
    perform pg_advisory_xact_lock(hashtext('live_questions_n_'||new.kind));
    select coalesce(max(n),0)+1 into new.n from live_questions where kind = new.kind;
  end if;
  return new;
end $$;
drop trigger if exists lq_number on public.live_questions;
create trigger lq_number before insert on public.live_questions for each row execute function public._lq_number();

-- 접수 상태 (질문 페이지가 처음 열릴 때 확인)
create or replace function public.ask_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'open', coalesce((select value from settings where key='ask_open'),'true') = 'true'
            and now() < coalesce((select value from settings where key='ask_close')::timestamptz, '2026-11-30T17:00:00+09:00'),
    'close', (select value from settings where key='ask_close'))
$$;
grant execute on function public.ask_status() to anon, authenticated;

-- 질문 제출 (참석자)
create or replace function public.submit_question(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_company text := btrim(coalesce(p->>'company',''));
  v_name    text := btrim(coalesce(p->>'name',''));
  v_session text := coalesce(nullif(p->>'session',''),'all');
  v_body    text := btrim(coalesce(p->>'body',''));
  v_device  text := left(coalesce(p->>'device',''),64);
  v_id bigint; v_n int;
begin
  if coalesce(p->>'hp','') <> '' then return jsonb_build_object('ok',true); end if;   -- 봇
  if not (public.ask_status()->>'open')::boolean then
    return jsonb_build_object('ok',false,'error','closed');
  end if;
  if length(v_company) < 1 or length(v_company) > 60 then return jsonb_build_object('ok',false,'error','company'); end if;
  if length(v_name) < 1 or length(v_name) > 30 then return jsonb_build_object('ok',false,'error','name'); end if;
  if v_session not in ('all','s1','s2','s3','s4','demo') then return jsonb_build_object('ok',false,'error','session'); end if;
  if length(v_body) < 5 or length(v_body) > 500 then return jsonb_build_object('ok',false,'error','body'); end if;
  if v_device <> '' then
    if (select count(*) from live_questions where device = v_device and created_at > now() - interval '1 minute') >= 3 then
      return jsonb_build_object('ok',false,'error','rate');
    end if;
    if exists (select 1 from live_questions where device = v_device and body = v_body and created_at > now() - interval '30 minutes') then
      return jsonb_build_object('ok',false,'error','dup');
    end if;
  end if;
  insert into live_questions(kind,company,name,session,body,device)
    values ('live',v_company,v_name,v_session,v_body,nullif(v_device,''))
    returning id, n into v_id, v_n;
  return jsonb_build_object('ok',true,'n',v_n);
end $$;
revoke all on function public.submit_question(jsonb) from public;
grant execute on function public.submit_question(jsonb) to anon, authenticated;

-- 메인 스크린: 송출 중인 질문 하나만 (로그인 없이)
create or replace function public.qa_current() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce((
    select jsonb_build_object('id',q.id,'kind',q.kind,'n',q.n,'company',q.company,'name',q.name,
                              'session',q.session,'body',q.body,'who',q.who,'at',s.updated_at)
    from qa_state s join live_questions q on q.id = s.cur where s.id = 1),
    jsonb_build_object('id',null,'at',(select updated_at from qa_state where id=1)))
$$;
grant execute on function public.qa_current() to anon, authenticated;

-- 송출 (운영자)
create or replace function public.admin_qa_show(p_id bigint, p_by text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception '권한이 없습니다.'; end if;
  update qa_state set cur = p_id, updated_by = coalesce(p_by, auth.jwt()->>'email'), updated_at = now() where id = 1;
  if p_id is not null then update live_questions set shown_at = now() where id = p_id; end if;
end $$;
revoke all on function public.admin_qa_show(bigint,text) from public, anon;
grant execute on function public.admin_qa_show(bigint,text) to authenticated;

-- 사전 질문 가져오기 (확정 신청자의 사전 질문, 이미 가져온 것은 건너뜀)
create or replace function public.admin_import_pre_questions() returns int
language plpgsql security definer set search_path = public as $$
declare c int;
begin
  if not public.is_admin() then raise exception '권한이 없습니다.'; end if;
  insert into live_questions(kind,company,name,session,body,source_reg)
    select 'pre', r.company_name, r.name, 'all', btrim(r.question), r.id
    from registrations r
    where r.status = 'confirmed' and nullif(btrim(r.question),'') is not null
      and not exists (select 1 from live_questions q where q.source_reg = r.id)
    order by r.created_at;
  get diagnostics c = row_count;
  return c;
end $$;
revoke all on function public.admin_import_pre_questions() from public, anon;
grant execute on function public.admin_import_pre_questions() to authenticated;

-- 행사 전 테스트 질문 초기화 (운영자)
create or replace function public.admin_qa_reset(p_kind text default 'live') returns int
language plpgsql security definer set search_path = public as $$
declare c int;
begin
  if not public.is_admin() then raise exception '권한이 없습니다.'; end if;
  update qa_state set cur = null, updated_at = now() where id = 1;
  delete from live_questions where p_kind = 'all' or kind = p_kind;
  get diagnostics c = row_count;
  return c;
end $$;
revoke all on function public.admin_qa_reset(text) from public, anon;
grant execute on function public.admin_qa_reset(text) to authenticated;

-- 질문 페이지 회사 목록: 사전 신청(확정·대기)한 회사 이름 + 다른 이름
create or replace function public.ask_companies() returns jsonb
language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object('name',name,'aliases',aliases) order by name),'[]'::jsonb)
  from (
    select distinct on (coalesce(c.name, r.company_name))
           coalesce(c.name, r.company_name) as name, coalesce(c.aliases,'{}') as aliases
    from registrations r left join companies c on c.id = r.company_id
    where r.status in ('confirmed','pending')
  ) t
$$;
grant execute on function public.ask_companies() to anon, authenticated;
