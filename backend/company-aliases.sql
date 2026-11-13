-- ============================================================
-- 대상 기업 다른 이름 (11.13): 사이트 회사 검색 · 관리자 명단 붙여넣기에서 함께 찾음
--  · 예) 현대자동차 → 현대차, 케이티 → KT
-- ============================================================
alter table public.companies add column if not exists aliases text[] not null default '{}';

update public.companies c set aliases = (select array(select distinct unnest(c.aliases || a.al)))
from (values ('한국전력', array['한국전력공사','한전']),
             ('현대차', array['현대자동차']),
             ('LS ELECTRIC', array['엘에스일렉트릭','LS일렉트릭']),
             ('유진투자증권', array['유진증권']),
             ('KCC글라스', array['케이씨씨글라스']),
             ('KT', array['케이티']),
             ('KT&G', array['케이티앤지']),
             ('KCC', array['케이씨씨'])) a(name, al)
where c.name = a.name;

-- 사이트 회사 검색 목록에 다른 이름을 함께 내려줌
drop function if exists public.list_companies();
create function public.list_companies()
returns table (id bigint, name text, code text, market text, remaining int, aliases text[])
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.code, c.market,
         greatest(coalesce(c.seat_limit, _setting('per_company')::int) - count(r.id)::int, 0),
         c.aliases
  from companies c
  left join registrations r on r.company_id = c.id and r.status = 'confirmed'
  where c.eligible
  group by c.id
  order by c.name
$$;
revoke all on function public.list_companies() from public;
grant execute on function public.list_companies() to anon, authenticated;

select name, aliases from public.companies where cardinality(aliases) > 0 order by name;
