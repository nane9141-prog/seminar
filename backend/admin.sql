-- ============================================================
-- 관리자 페이지 권한
-- 운영 아이디(seminar01~03)로 로그인한 계정만 신청 내역 조회·처리 가능
-- ============================================================
create table if not exists public.admins (
  email text primary key,
  label text
);
alter table public.admins enable row level security;
insert into public.admins(email,label) values
  ('seminar01@ops.irkudos.co.kr','운영 1'),
  ('seminar02@ops.irkudos.co.kr','운영 2'),
  ('seminar03@ops.irkudos.co.kr','운영 3')
on conflict (email) do nothing;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from admins where email = lower(coalesce(auth.jwt()->>'email','')))
$$;
grant execute on function public.is_admin() to authenticated;

-- 신청 내역: 운영자만 조회·수정 (삭제는 막고 상태 변경으로 처리)
drop policy if exists admin_select on public.registrations;
drop policy if exists admin_update on public.registrations;
create policy admin_select on public.registrations for select to authenticated using (public.is_admin());
create policy admin_update on public.registrations for update to authenticated using (public.is_admin()) with check (public.is_admin());
revoke delete on public.registrations from anon, authenticated;

-- 설정: 운영자 조회·수정 (접수 열기/닫기, 정원)
drop policy if exists admin_select on public.settings;
drop policy if exists admin_update on public.settings;
create policy admin_select on public.settings for select to authenticated using (public.is_admin() and key <> 'mail_secret');
create policy admin_update on public.settings for update to authenticated using (public.is_admin() and key in ('open','capacity')) with check (public.is_admin() and key in ('open','capacity'));

-- 대상 기업 목록: 운영자 조회
drop policy if exists admin_select on public.companies;
create policy admin_select on public.companies for select to authenticated using (public.is_admin());

-- 처리 기록: 누가 바꿨는지 남김
alter table public.registrations add column if not exists decided_by text;
create or replace function public._stamp_admin() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status is distinct from old.status then
    new.decided_by := case when coalesce(auth.jwt()->>'role','') = 'anon' then '신청자' else coalesce(auth.jwt()->>'email', 'system') end;
  end if;
  return new;
end $$;
drop trigger if exists reg_stamp_admin on public.registrations;
create trigger reg_stamp_admin before update on public.registrations
  for each row execute function public._stamp_admin();

-- D-1 리마인드 메일 (운영자 버튼)
create or replace function public.admin_send_reminders() returns int
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception '권한이 없습니다.'; end if;
  return public.send_reminders();
end $$;
revoke all on function public.admin_send_reminders() from public, anon;
grant execute on function public.admin_send_reminders() to authenticated;
