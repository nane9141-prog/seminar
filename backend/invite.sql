-- ============================================================
-- 초청 메일 (11.10): 대상 기업 담당자에게 사전등록 초청장 발송
--  · 초청 대상 명단(invitees)은 관리자 페이지 > 초청 대상 탭에서 붙여넣기/CSV로 등록
--  · 초청 링크(?invite=토큰)로 들어오면 신청 폼에 회사·이름·이메일 등이 미리 채워짐
--  · 이미 사전등록(확정)한 사람에게는 보내지 않음
-- ============================================================

create table if not exists public.invitees (
  id           bigint generated always as identity primary key,
  company_id   bigint references public.companies(id),
  company_name text not null,
  name         text not null,
  dept         text,
  title        text,
  email        text not null,
  phone        text,
  note         text,
  token        uuid not null default gen_random_uuid() unique,
  invited_at   timestamptz,            -- 마지막 발송 시각
  invite_count int not null default 0, -- 발송 횟수
  created_at   timestamptz not null default now(),
  created_by   text
);
create unique index if not exists invitees_email_uq on public.invitees (lower(email));

alter table public.invitees enable row level security;
drop policy if exists admin_all on public.invitees;
create policy admin_all on public.invitees for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 등록한 운영자 기록
create or replace function public._stamp_invitee() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then new.created_by := coalesce(auth.jwt()->>'email', new.created_by); end if;
  new.email := lower(trim(new.email));
  return new;
end $$;
drop trigger if exists invitee_stamp on public.invitees;
create trigger invitee_stamp before insert or update of email on public.invitees
  for each row execute function public._stamp_invitee();

-- 초청 메일 웹훅
create or replace function public._send_invite(i invitees) returns void
language plpgsql security definer set search_path = public, extensions as $$
declare v_url text := _setting('mail_webhook_url');
begin
  if coalesce(v_url,'') = '' then return; end if;
  perform net.http_post(
    url  := v_url,
    body := jsonb_build_object(
      'secret', _setting('mail_secret'), 'type', 'invite',
      'name', i.name, 'email', i.email, 'company', i.company_name, 'dept', i.dept, 'title', i.title,
      'invite_token', i.token,
      'links', jsonb_build_object('site', _setting('site_url'), 'android', _setting('app_android_url'))),
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 10000);
end $$;

-- 발송: p_ids 지정 시 그 사람들만(재발송 포함), 비우면 미발송 전원. 이미 확정 등록한 사람은 건너뜀
create or replace function public.admin_send_invites(p_ids bigint[] default null) returns int
language plpgsql security definer set search_path = public as $$
declare i invitees; n int := 0;
begin
  if not public.is_admin() then raise exception '권한이 없습니다.'; end if;
  for i in
    select v.* from invitees v
     where (p_ids is null and v.invited_at is null) or (p_ids is not null and v.id = any(p_ids))
     order by v.id
  loop
    if exists (select 1 from registrations r where r.status = 'confirmed' and lower(r.email) = i.email) then continue; end if;
    perform _send_invite(i);
    update invitees set invited_at = now(), invite_count = invite_count + 1 where id = i.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.admin_send_invites(bigint[]) from public, anon;
grant execute on function public.admin_send_invites(bigint[]) to authenticated;

-- 초청 링크로 들어온 사람의 신청 폼 미리 채우기 (토큰을 아는 사람만 조회)
create or replace function public.invite_info(p_token uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object('company_id', company_id, 'company', company_name, 'name', name,
                            'dept', dept, 'title', title, 'email', email, 'phone', phone)
  from invitees where token = p_token
$$;
revoke all on function public.invite_info(uuid) from public;
grant execute on function public.invite_info(uuid) to anon, authenticated;

-- 테스트 메일 (운영자 본인 주소 등으로 1통)
create or replace function public.admin_send_invite_test(p_email text) returns void
language plpgsql security definer set search_path = public as $$
declare i invitees;
begin
  if not public.is_admin() then raise exception '권한이 없습니다.'; end if;
  i.name := '홍길동'; i.title := '팀장'; i.company_name := '테스트 주식회사'; i.email := lower(trim(p_email));
  i.token := '00000000-0000-0000-0000-000000000000';
  perform _send_invite(i);
end $$;
revoke all on function public.admin_send_invite_test(text) from public, anon;
grant execute on function public.admin_send_invite_test(text) to authenticated;
