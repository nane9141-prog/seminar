-- ============================================================
-- 사전등록 테스트 정리: IR큐더스(아이알큐더스) 테스트 신청·기업 삭제
-- Supabase SQL Editor에서 실행. 실제 신청에는 영향 없음
-- ============================================================
delete from public.registrations where company_id in (select id from public.companies where code = 'TEST');
delete from public.invitees     where company_id in (select id from public.companies where code = 'TEST');
delete from public.companies     where code = 'TEST';
-- 신청이 하나도 남지 않았으면 신청번호를 1부터 다시
select setval(pg_get_serial_sequence('public.registrations','reg_no'),
              coalesce((select max(reg_no) from public.registrations), 0) + 1, false);
select count(*) as registrations_left from public.registrations;
