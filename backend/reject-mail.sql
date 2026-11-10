-- ============================================================
-- 수동 반려 메일 (11.10): 운영자가 관리자 페이지에서 타이틀·내용을 써서 발송
--  · 선택하면 신청도 함께 취소 처리 (자리 반환). 운영자 취소라 자동 취소 메일은 나가지 않음
-- ============================================================
alter table public.registrations add column if not exists reject_mail_at    timestamptz;
alter table public.registrations add column if not exists reject_mail_title text;
alter table public.registrations add column if not exists reject_mail_body  text;

create or replace function public.admin_send_reject(p_id uuid, p_title text, p_body text, p_cancel boolean default true)
returns void language plpgsql security definer set search_path = public, extensions as $$
declare r registrations; v_url text := _setting('mail_webhook_url');
begin
  if not public.is_admin() then raise exception '권한이 없습니다.'; end if;
  if length(trim(coalesce(p_title,''))) < 2 or length(trim(coalesce(p_body,''))) < 5 then
    raise exception '타이틀과 내용을 입력해 주세요.';
  end if;
  select * into r from registrations where id = p_id;
  if not found then raise exception '신청을 찾지 못했습니다.'; end if;

  if p_cancel and r.status = 'confirmed' then
    update registrations set status = 'cancelled' where id = p_id;   -- decided_by = 운영자 → 자동 취소 메일 없음
  end if;
  update registrations set reject_mail_at = now(), reject_mail_title = left(trim(p_title), 120),
         reject_mail_body = left(trim(p_body), 3000) where id = p_id;

  if coalesce(v_url,'') = '' then raise exception '메일 발송 주소(mail_webhook_url)가 설정되지 않았습니다.'; end if;
  perform net.http_post(
    url  := v_url,
    body := jsonb_build_object(
      'secret', _setting('mail_secret'), 'type', 'rejected',
      'name', r.name, 'email', r.email, 'company', r.company_name, 'dept', r.dept, 'title', r.title,
      'custom_title', trim(p_title), 'custom_body', trim(p_body),
      'links', jsonb_build_object('site', _setting('site_url'))),
    headers := '{"Content-Type":"application/json"}'::jsonb,
    timeout_milliseconds := 10000);
end $$;
revoke all on function public.admin_send_reject(uuid, text, text, boolean) from public, anon;
grant execute on function public.admin_send_reject(uuid, text, text, boolean) to authenticated;
