-- ============================================================
-- 자동 메일 2차: 반려 사유 3종, 현장 참석 체크, 메일 링크 설정, D-1 예약 발송, 참석 감사 메일
-- ============================================================

-- 1) 신청 테이블: 반려 사유 · 현장 참석 · 메일 발송 기록
alter table public.registrations add column if not exists reject_reason text
  check (reject_reason in ('ineligible','company_full','capacity_full'));
alter table public.registrations add column if not exists attended boolean not null default false;
alter table public.registrations add column if not exists attended_at timestamptz;
alter table public.registrations add column if not exists reminded_at timestamptz;
alter table public.registrations add column if not exists thanked_at timestamptz;

-- 2) 메일에 들어가는 링크 (관리자 페이지에서 수정)
insert into public.settings(key,value,note) values
  ('site_url','https://nane9141-prog.github.io/seminar/','사이트 주소 — 메일의 취소·재신청 링크에 사용. 도메인 연결 후 교체'),
  ('app_android_url','https://play.google.com/store/apps/details?id=com.irkudos.jujupass','주주PASS 안드로이드'),
  ('app_ios_url','','주주PASS iOS (추후 등록)'),
  ('slides_url','','발표자료 링크 (M7)'),
  ('survey_url','','설문 링크 (M7, 추후 등록)'),
  ('reminder_at','2026-11-29 14:00 KST','D-1 리마인드 예약 시각 (안내용)')
on conflict (key) do nothing;

drop policy if exists admin_update on public.settings;
create policy admin_update on public.settings for update to authenticated
  using (public.is_admin() and key in ('open','capacity','site_url','app_android_url','app_ios_url','slides_url','survey_url'))
  with check (public.is_admin() and key in ('open','capacity','site_url','app_android_url','app_ios_url','slides_url','survey_url'));

-- 3) 메일 웹훅: 신청 정보 + 링크 + 반려 사유를 함께 보냄
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
      'dept', r.dept, 'title', r.title, 'cancel_token', r.cancel_token, 'reason', r.reject_reason,
      'links', jsonb_build_object(
        'site', _setting('site_url'), 'android', _setting('app_android_url'), 'ios', _setting('app_ios_url'),
        'slides', _setting('slides_url'), 'survey', _setting('survey_url'))),
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 10000);
end $$;

-- 반려 시 사유가 없으면 '대상 기준 미충족'으로
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
      raise exception '전체 정원(%명)이 마감되어 승인할 수 없습니다. 반려 사유 "전체 정원 마감"으로 반려해 주세요.', _setting('capacity');
    end if;
    if _company_count(new.company_id, new.company_name) >= _setting('per_company')::int then
      raise exception '이 기업은 이미 %명이 확정되어 승인할 수 없습니다. 반려 사유 "기업당 2자리 마감"으로 반려해 주세요.', _setting('per_company');
    end if;
    new.status := 'confirmed';
    new.reject_reason := null;
  elsif new.status = 'rejected' then
    new.reject_reason := coalesce(new.reject_reason, 'ineligible');
  end if;
  new.decided_at := now();
  return new;
end $$;

-- 현장 참석 체크 시각
create or replace function public._stamp_attended() returns trigger
language plpgsql as $$
begin
  if new.attended is distinct from old.attended then
    new.attended_at := case when new.attended then now() else null end;
  end if;
  return new;
end $$;
drop trigger if exists reg_stamp_attended on public.registrations;
create trigger reg_stamp_attended before update of attended on public.registrations
  for each row execute function public._stamp_attended();

-- 4) D-1 리마인드: 확정자 중 아직 안 받은 사람에게만 (중복 발송 방지)
create or replace function public.send_reminders() returns int
language plpgsql security definer set search_path = public as $$
declare r registrations; n int := 0;
begin
  for r in select * from registrations where status = 'confirmed' and reminded_at is null loop
    perform _send_mail('reminder', r);
    update registrations set reminded_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.send_reminders() from public, anon, authenticated;

-- 5) 참석 감사 메일(M7): 현장 참석 체크된 사람 중 아직 안 받은 사람에게만
create or replace function public.admin_send_thanks() returns int
language plpgsql security definer set search_path = public as $$
declare r registrations; n int := 0;
begin
  if not public.is_admin() then raise exception '권한이 없습니다.'; end if;
  for r in select * from registrations where status = 'confirmed' and attended and thanked_at is null loop
    perform _send_mail('thanks', r);
    update registrations set thanked_at = now() where id = r.id;
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function public.admin_send_thanks() from public, anon;
grant execute on function public.admin_send_thanks() to authenticated;

-- 6) D-1 예약 발송: 2026-11-29(일) 14:00 KST = 05:00 UTC
create extension if not exists pg_cron;
select cron.unschedule(jobid) from cron.job where jobname = 'seminar-d1-reminder';
select cron.schedule('seminar-d1-reminder', '0 5 29 11 *',
  $$ select public.send_reminders() where now()::date = date '2026-11-29' $$);

-- 7) 11.9 수정: 주주PASS 설치 링크를 기기별 자동 연결 URL 한 개로 통일 (app_android_url 칸 공용), 사이트에서도 사용
update public.settings set note = '주주PASS 설치 링크 (기기별 자동 연결 URL, 사이트·메일 공용)' where key = 'app_android_url';
update public.settings set note = '사용 안 함 (11.9 결정: 분기 URL 한 개로 통일)' where key = 'app_ios_url';
create or replace function public.event_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'open', _setting('open') = 'true',
    'capacity', _setting('capacity')::int,
    'remaining', greatest(_setting('capacity')::int - _total_count(), 0),
    'app_url', nullif(_setting('app_android_url'), '')
  )
$$;
