alter table public.live_questions add column if not exists email text;
-- 질문 제출 (참석자)
create or replace function public.submit_question(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_company text := btrim(coalesce(p->>'company',''));
  v_name    text := btrim(coalesce(p->>'name',''));
  v_session text := coalesce(nullif(p->>'session',''),'all');
  v_body    text := btrim(coalesce(p->>'body',''));
  v_device  text := left(coalesce(p->>'device',''),64);
  v_email   text := nullif(lower(btrim(coalesce(p->>'email',''))),'');
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
  if v_email is not null and (length(v_email) > 120 or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$') then return jsonb_build_object('ok',false,'error','email'); end if;
  if v_device <> '' then
    if (select count(*) from live_questions where device = v_device and created_at > now() - interval '1 minute') >= 3 then
      return jsonb_build_object('ok',false,'error','rate');
    end if;
    if exists (select 1 from live_questions where device = v_device and body = v_body and created_at > now() - interval '30 minutes') then
      return jsonb_build_object('ok',false,'error','dup');
    end if;
  end if;
  insert into live_questions(kind,company,name,session,body,device,email)
    values ('live',v_company,v_name,v_session,v_body,nullif(v_device,''),v_email)
    returning id, n into v_id, v_n;
  return jsonb_build_object('ok',true,'n',v_n);
end $$;
revoke all on function public.submit_question(jsonb) from public;
grant execute on function public.submit_question(jsonb) to anon, authenticated;

