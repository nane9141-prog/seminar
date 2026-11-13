-- ============================================================
-- 관리자 수동 등록 (11.13): 운영자가 관리자 페이지에서 참석자를 직접 등록
--  · 대상 기업 목록에서 고르거나 회사명을 직접 입력 (대상 기업 외도 가능)
--  · 마감 시각 · 접수 중지와 상관없이 등록 가능
--  · 기업 좌석 · 전체 정원을 넘으면 먼저 알려주고, 운영자가 확인하면(force) 그대로 등록
--  · 참석 확정 메일(M1)은 선택해서 보냄
-- ============================================================

-- 확정 메일 트리거: 수동 등록에서 '메일 안 보냄'을 고르면 건너뜀
create or replace function public._after_reg() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    if new.status = 'confirmed' and coalesce(current_setting('seminar.skip_mail', true), '') <> 'on' then
      perform _send_mail('confirmed', new);
    end if;
  elsif new.status is distinct from old.status then
    -- 신청자가 메일의 취소 링크로 취소한 경우에만 자동 메일. 운영자 취소·반려 사유는 운영자가 직접 안내
    if new.status = 'cancelled' and new.decided_by = '신청자' then perform _send_mail('cancelled', new); end if;
  end if;
  return null;
end $$;

create or replace function public.admin_register(p jsonb, p_send_mail boolean default true, p_force boolean default false)
returns jsonb language plpgsql volatile security definer set search_path = public as $$
declare
  v_company companies;
  v_cid     bigint := nullif(p->>'company_id','')::bigint;
  v_cname   text;
  v_email   text := lower(trim(coalesce(p->>'email','')));
  v_phone   text := regexp_replace(coalesce(p->>'phone',''), '[^0-9]', '', 'g');
  v_dup     registrations;
  v_reg     registrations;
  v_limit   int;
begin
  if not public.is_admin() then raise exception '권한이 없습니다.'; end if;
  if length(trim(coalesce(p->>'name',''))) < 2 then raise exception '이름을 입력해 주세요.'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception '이메일 형식을 확인해 주세요.'; end if;
  if v_phone !~ '^01[016789][0-9]{7,8}$' then raise exception '휴대폰 번호를 확인해 주세요.'; end if;

  if v_cid is not null then
    select * into v_company from companies where id = v_cid;
    if not found then raise exception '회사를 찾지 못했습니다.'; end if;
    v_cname := v_company.name;
  else
    v_cname := trim(coalesce(p->>'company_name',''));
    if length(v_cname) < 2 then raise exception '회사명을 입력해 주세요.'; end if;
  end if;

  perform pg_advisory_xact_lock(20261130);

  select * into v_dup from registrations
   where status in ('confirmed','pending') and (lower(email) = v_email or phone = v_phone) limit 1;
  if found then
    raise exception '이미 등록된 이메일 또는 휴대폰입니다 (No. % %).', v_dup.reg_no, v_dup.name;
  end if;

  if not p_force then
    if _total_count() >= _setting('capacity')::int then
      return jsonb_build_object('ok', false, 'code', 'full', 'msg', '전체 정원 ' || _setting('capacity') || '명이 이미 찼습니다.');
    end if;
    if v_cid is not null then
      v_limit := coalesce(v_company.seat_limit, _setting('per_company')::int);
      if _company_count(v_cid, null) >= v_limit then
        return jsonb_build_object('ok', false, 'code', 'company_full', 'msg', v_cname || '은(는) 이미 ' || v_limit || '명이 확정되어 있습니다.');
      end if;
    end if;
  end if;

  if not p_send_mail then perform set_config('seminar.skip_mail', 'on', true); end if;

  insert into registrations
    (company_id, company_name, is_manual, status, name, dept, title, phone, email,
     question, agree_privacy, memo, decided_by, decided_at)
  values
    (v_cid, v_cname, v_cid is null, 'confirmed', trim(p->>'name'), nullif(trim(p->>'dept'),''), nullif(trim(p->>'title'),''),
     v_phone, v_email, nullif(left(p->>'question', 1000),''), true,
     trim('수동 등록 ' || coalesce(nullif(trim(p->>'memo'),''), '')), coalesce(auth.jwt()->>'email', 'admin'), now())
  returning * into v_reg;

  perform set_config('seminar.skip_mail', '', true);
  return jsonb_build_object('ok', true, 'reg_no', v_reg.reg_no, 'name', v_reg.name, 'company', v_cname);
end $$;
revoke all on function public.admin_register(jsonb, boolean, boolean) from public, anon;
grant execute on function public.admin_register(jsonb, boolean, boolean) to authenticated;
