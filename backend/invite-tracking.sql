-- ============================================================
-- 초청 메일 추적 (11.10): 발송 성공/실패 · 반송 · 열람 · 사이트 방문(클릭)
--  · 성공/실패/반송은 Apps Script가 mail_report로 알려줌 (mail_secret 확인)
--  · 열람은 메일 속 1px 이미지 → Apps Script doGet → track_open
--  · 클릭은 초청 링크로 사이트에 들어올 때 invite_info가 기록
-- ============================================================

alter table public.invitees add column if not exists send_status text
  check (send_status in ('queued','sent','failed','bounced'));
alter table public.invitees add column if not exists send_error  text;
alter table public.invitees add column if not exists sent_at     timestamptz;
alter table public.invitees add column if not exists bounced_at  timestamptz;
alter table public.invitees add column if not exists opened_at   timestamptz;  -- 처음 열람
alter table public.invitees add column if not exists open_count  int not null default 0;
alter table public.invitees add column if not exists clicked_at  timestamptz;  -- 처음 사이트 방문
alter table public.invitees add column if not exists click_count int not null default 0;

-- 발송 요청 시 상태를 '대기'로
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
    update invitees set invited_at = now(), invite_count = invite_count + 1,
                        send_status = 'queued', send_error = null, bounced_at = null
     where id = i.id;
    perform _send_invite(i);
    n := n + 1;
  end loop;
  return n;
end $$;

-- Apps Script → 발송 결과 보고 (sent / failed / bounced)
create or replace function public.mail_report(p_secret text, p_status text, p_token uuid default null,
                                              p_email text default null, p_error text default null) returns int
language plpgsql volatile security definer set search_path = public as $$
declare n int;
begin
  if p_secret is distinct from _setting('mail_secret') then return -1; end if;
  if p_status = 'sent' then
    update invitees set send_status = 'sent', sent_at = now(), send_error = null
     where token = p_token and send_status is distinct from 'bounced';
  elsif p_status = 'failed' then
    update invitees set send_status = 'failed', send_error = left(p_error, 300) where token = p_token;
  elsif p_status = 'bounced' then
    update invitees set send_status = 'bounced', bounced_at = now(), send_error = left(p_error, 300)
     where (p_token is not null and token = p_token) or (p_token is null and email = lower(trim(p_email)));
  else
    return 0;
  end if;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.mail_report(text,text,uuid,text,text) from public;
grant execute on function public.mail_report(text,text,uuid,text,text) to anon;

-- 열람 기록 (메일 속 1px 이미지)
create or replace function public.track_open(p_token uuid) returns void
language sql volatile security definer set search_path = public as $$
  update invitees set opened_at = coalesce(opened_at, now()), open_count = open_count + 1 where token = p_token
$$;
revoke all on function public.track_open(uuid) from public;
grant execute on function public.track_open(uuid) to anon;

-- 초청 링크로 사이트 방문: 폼 미리 채우기 + 클릭 기록
drop function if exists public.invite_info(uuid);
create function public.invite_info(p_token uuid) returns jsonb
language plpgsql volatile security definer set search_path = public as $$
declare i invitees;
begin
  update invitees set clicked_at = coalesce(clicked_at, now()), click_count = click_count + 1
   where token = p_token returning * into i;
  if not found then return null; end if;
  return jsonb_build_object('company_id', i.company_id, 'company', i.company_name, 'name', i.name,
                            'dept', i.dept, 'title', i.title, 'email', i.email, 'phone', i.phone);
end $$;
revoke all on function public.invite_info(uuid) from public;
grant execute on function public.invite_info(uuid) to anon, authenticated;
