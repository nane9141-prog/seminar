# The New Mandate : GO LIVE

2027년 전자주주총회 의무화 대비 세미나 원페이지 사이트

- 일시: 2026.11.30(월) 13:30–18:00 (등록 13:00)
- 장소: 페어몬트 앰배서더 서울 B1 그랜드볼룸
- 주최: IR큐더스

## 구조

```
index.html      단일 페이지 (히어로는 WebGL Flow Line → 도트 → 코드 → 파티클 분해·재조립)
tokens.css      색·서체·간격 토큰 (브랜드 블루 #0071F3)
base.css        공통 기본 스타일
assets/         KSMP 로고(ksmp-logo.svg), OG 이미지, 연사 사진, 협력사 로고
.nojekyll       GitHub Pages Jekyll 처리 비활성화
CNAME           (도메인 확정 후 추가)
```

## 배포 (GitHub Pages)

1. Settings → Pages → Source: Deploy from a branch → `main` / `/ (root)`
2. 1~2분 후 `https://nane9141-prog.github.io/seminar/` 에서 확인
3. 수정은 commit · push 하면 자동 반영

## 도메인 연결 (확정 후)

1. 저장소 루트에 `CNAME` 파일 생성, 내용은 도메인 한 줄 (예: `seminar.irkudos.co.kr`)
2. DNS 설정
   - 서브도메인: CNAME 레코드 → `nane9141-prog.github.io`
   - 루트 도메인: A 레코드 4개 → `185.199.108.153`, `185.199.109.153`, `185.199.110.153`, `185.199.111.153`
3. Settings → Pages → Custom domain 입력 → DNS 확인 후 **Enforce HTTPS** 체크
4. `index.html`의 `og:image`를 절대 URL로 교체

## 오픈 전 체크리스트

- [ ] 점선 박스(`.tbd`) 표시 제거 및 확정 문구로 교체 (2부 주제, 주차, 지하철 출구, 문의처, 경품)
- [ ] 등록 버튼 `#formLink` href에 외부 등록 폼 URL 연결 (`target="_blank"`)
- [ ] 히어로·모바일바·GNB의 `#register` 버튼도 폼으로 바로 보낼지 결정
- [ ] 주주PASS 링크(`#appLink`)를 iOS·Android 자동 분기 링크로 교체 (현재 Google Play)
- [ ] 연사 사진 → `assets/` 추가 후 `hallmarkSlots({ 'speaker-1': 'assets/…' })` 또는 각 카드에 `<img>` 삽입
- [ ] 협력사 로고 → `assets/` 추가
- [ ] `assets/og-image.png` (1200×630) 추가
- [ ] GA 스크립트, 개인정보처리방침 링크
