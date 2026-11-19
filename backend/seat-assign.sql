-- 좌석 배치 (control 참석자 관리 탭) — 신청 데이터와 분리해 저장
create table if not exists public.seat_assign (
  reg_id      uuid primary key references public.registrations(id) on delete cascade,
  seat        text,
  note        text,
  updated_by  text,
  updated_at  timestamptz not null default now()
);
alter table public.seat_assign enable row level security;
revoke all on public.seat_assign from anon;
drop policy if exists admin_all on public.seat_assign;
create policy admin_all on public.seat_assign for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, insert, update, delete on public.seat_assign to authenticated;
