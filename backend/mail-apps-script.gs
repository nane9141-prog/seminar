/**
 * 전자주주총회플랫폼 시연 설명회 · 자동 메일 발송기 (디자인 A안)
 *
 * 설치 (발송 계정으로 로그인한 상태에서)
 * 1. script.google.com → 새 프로젝트 → 이 코드를 붙여넣기
 * 2. 프로젝트 설정 → 스크립트 속성
 *    SECRET   : Supabase settings 테이블의 mail_secret 값
 *    FROM     : (선택) '다른 주소로 보내기' 별칭 (예: seminar@irkudos.co.kr). 계정 주소 그대로 보낼 땐 비워둠
 * 3. 함수 testAll 실행 → 권한 승인 → 실행 계정 메일함에서 7종 확인
 * 4. 배포 → 새 배포 → 웹 앱 / 실행: 나 / 액세스: 모든 사용자 → URL 복사
 * 5. Supabase settings 테이블 mail_webhook_url 에 그 URL 입력
 *
 * 링크(사이트 주소, 주주PASS, 발표자료, 설문)는 관리자 페이지 > 메일 링크에서 바꾸면 바로 반영됩니다.
 * 발송 계정을 바꿀 때: 새 계정에서 1~4를 다시 하고 mail_webhook_url만 교체
 */

const SENDER_NAME = 'IR큐더스';
const EV = {
  title: '전자주주총회플랫폼 시연 설명회',
  date: '2026년 11월 30일(월)', time: '13:00 등록 · 13:30 ~ 18:00',
  place: '페어몬트 앰배서더 서울 B1 그랜드볼룸', addr: '서울특별시 영등포구 여의대로 108',
  map: 'https://map.naver.com/p/search/%ED%8E%98%EC%96%B4%EB%AA%AC%ED%8A%B8%20%EC%95%B0%EB%B0%B0%EC%84%9C%EB%8D%94%20%EC%84%9C%EC%9A%B8',
  gcal: 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=%EC%A0%84%EC%9E%90%EC%A3%BC%EC%A3%BC%EC%B4%9D%ED%9A%8C%ED%94%8C%EB%9E%AB%ED%8F%BC%20%EC%8B%9C%EC%97%B0%20%EC%84%A4%EB%AA%85%ED%9A%8C&dates=20261130T043000Z/20261130T090000Z&location=%ED%8E%98%EC%96%B4%EB%AA%AC%ED%8A%B8%20%EC%95%B0%EB%B0%B0%EC%84%9C%EB%8D%94%20%EC%84%9C%EC%9A%B8%20B1',
  start: '20261130T043000Z', end: '20261130T090000Z',
  phone: '02-6011-2000', mail: 'seminar@irkudos.co.kr'
};
const C = { ink: '#0f1524', ink2: '#3d4556', ink3: '#7a8294', line: '#e3e7ef', soft: '#f4f6fb', blue: '#2f6bff', navy: '#141a6e', page: '#eef1f6' };
const FONT = "-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic','맑은 고딕','Noto Sans KR',sans-serif";
const CHIP = {
  done: ['#e7f6ee', '#137a45', '등록 완료'], wait: ['#fff4e0', '#9a5b00', '승인 대기'], no: ['#fdecec', '#b42323', '신청 결과'],
  cancel: ['#eef0f4', '#4d5566', '취소 완료'], d1: ['#e8efff', '#1f4fd6', 'D-1'], thanks: ['#e8efff', '#1f4fd6', '참석 감사']
};
const REJECT = {
  ineligible: '이번 설명회는 2027년 전자주주총회 의무화 대상 기업(최근 사업연도 말 자산총액 2조원 이상 상장회사)을 대상으로 운영되어, 신청하신 기업은 참석을 확정하기 어렵습니다.',
  company_full: '신청하신 기업은 이미 2명의 참석이 확정되어, 기업당 2자리 기준에 따라 추가 등록이 어렵습니다.',
  capacity_full: '전체 정원 300명이 모두 마감되어 참석을 확정하기 어렵습니다. 취소로 자리가 생기면 사이트에서 다시 신청하실 수 있습니다.'
};

/* ---------- 웹훅 ---------- */
function doPost(e) {
  const p = JSON.parse((e.postData && e.postData.contents) || '{}');
  if (!p.secret || p.secret !== PropertiesService.getScriptProperties().getProperty('SECRET')) {
    return ContentService.createTextOutput('forbidden');
  }
  send_(p);
  return ContentService.createTextOutput('ok');
}

function send_(p) {
  const m = compose_(p);
  if (!m) return;
  const props = PropertiesService.getScriptProperties();
  const opts = { htmlBody: m.html, name: SENDER_NAME, replyTo: EV.mail };
  if (props.getProperty('FROM')) opts.from = props.getProperty('FROM');
  if (m.ics) opts.attachments = [Utilities.newBlob(ics_(p), 'text/calendar', 'seminar.ics')];
  GmailApp.sendEmail(p.email, m.subject, m.text, opts);
}

/* ---------- 메일별 내용 ---------- */
function compose_(p) {
  const L = p.links || {};
  const site = (L.site || '').replace(/\/?$/, '/');
  const cancelUrl = site + '?cancel=' + p.cancel_token;
  const appLinks = appLinks_(L);
  const full = ['entry', 'app', 'parking', 'program'];
  const D = {
    confirmed: {
      chip: 'done', subject: '[IR큐더스] 전자주주총회플랫폼 시연 설명회 사전등록이 완료되었습니다',
      pre: '11월 30일(월) 13:00 등록 시작, 페어몬트 앰배서더 서울 B1 그랜드볼룸에서 뵙겠습니다.',
      head: esc_(p.name) + '님, 사전등록이 완료되었습니다',
      lead: '2027년 전자주주총회 의무화를 앞두고 법률·학계 세션과 가상 주주총회 라이브 시연을 함께 준비했습니다. 아래 일정과 입장 안내를 확인해 주세요.',
      card: 'full', btns: [['캘린더에 추가', EV.gcal, 1], ['오시는 길', EV.map, 0]], guide: full, cancel: true, ics: true
    },
    approved: {
      chip: 'done', subject: '[IR큐더스] 전자주주총회플랫폼 시연 설명회 참석이 확정되었습니다',
      pre: '운영팀 확인이 끝났습니다. 11월 30일(월) 13:00부터 등록을 시작합니다.',
      head: esc_(p.name) + '님, 참석이 확정되었습니다',
      lead: '운영팀 확인을 마쳤습니다. 아래 일정과 입장 안내를 확인해 주세요.',
      card: 'full', btns: [['캘린더에 추가', EV.gcal, 1], ['오시는 길', EV.map, 0]], guide: full, cancel: true, ics: true
    },
    pending: {
      chip: 'wait', subject: '[IR큐더스] 시연 설명회 신청이 접수되었습니다 (승인 대기)',
      pre: '운영팀 확인 후 영업일 1일 이내에 결과를 안내드립니다.',
      head: '신청이 접수되었습니다',
      lead: '이번 설명회는 2027년 전자주주총회 의무화 대상 기업을 위한 자리로, 직접 입력하신 기업은 운영팀 확인 후 확정됩니다. 영업일 1일 이내에 결과를 메일로 안내드립니다.',
      note: '승인 시점에 기업당 2명, 전체 300명 안에 자리가 남아 있어야 확정됩니다.',
      card: 'short', btns: [], guide: []
    },
    rejected: {
      chip: 'no', subject: '[IR큐더스] 시연 설명회 신청 결과를 안내드립니다',
      pre: '신청해 주셔서 감사합니다.',
      head: '이번에는 참석을 확정하기 어렵습니다',
      lead: '신청해 주셔서 감사합니다. ' + (REJECT[p.reason] || REJECT.ineligible),
      note: '전자주주총회 도입 상담이 필요하시면 이 메일에 회신해 주세요. 담당자가 연락드리겠습니다.',
      card: 'none', btns: p.reason === 'capacity_full' ? [['사이트 바로가기', site, 0]] : [], guide: []
    },
    cancelled: {
      chip: 'cancel', subject: '[IR큐더스] 시연 설명회 사전등록이 취소되었습니다',
      pre: '다시 참석하시려면 사이트에서 새로 신청해 주세요.',
      head: '사전등록이 취소되었습니다',
      lead: '다시 참석하시려면 사이트에서 새로 신청해 주세요. 잔여석이 있을 때 등록됩니다.',
      note: '직접 취소하지 않으셨다면 이 메일에 바로 회신해 주세요.',
      card: 'short', btns: [['다시 신청하기', site, 0]], guide: []
    },
    reminder: {
      chip: 'd1', subject: '[IR큐더스] 내일 13:00부터 등록 — 전자주주총회플랫폼 시연 설명회',
      pre: '주주PASS 설치와 주차 안내를 확인해 주세요.',
      head: '내일 뵙겠습니다',
      lead: '설명회가 내일입니다. 오시기 전에 세 가지만 확인해 주세요.',
      card: 'full', btns: [['오시는 길', EV.map, 1]].concat(appLinks.length ? [[appLinks.length > 1 ? '주주PASS 설치 (Android)' : '주주PASS 설치', appLinks[0][1], 0]] : []),
      guide: ['check', 'timetable'], cancel: true, ics: true
    },
    thanks: {
      chip: 'thanks', subject: '[IR큐더스] 시연 설명회 발표자료를 보내드립니다',
      pre: '참석해 주셔서 감사합니다.' + (L.survey ? ' 발표자료와 2분 설문을 확인해 주세요.' : ''),
      head: '참석해 주셔서 감사합니다',
      lead: (L.slides ? '오늘 다룬 법률·학계 세션과 플랫폼 시연 발표자료를 보내드립니다. ' : '오늘 설명회에 함께해 주셔서 감사합니다. ') +
            (L.survey ? '더 나은 설명회를 위해 2분 설문에 참여해 주시면 감사하겠습니다.' : ''),
      note: '전자주주총회 도입 일정이나 운영 방식이 궁금하시면 이 메일에 회신해 주세요. IR큐더스 담당자가 연락드리겠습니다.',
      card: 'none', btns: [].concat(L.slides ? [['발표자료 받기', L.slides, 1]] : []).concat(L.survey ? [['설문 참여하기', L.survey, L.slides ? 0 : 1]] : []),
      guide: []
    }
  };
  const m = D[p.type];
  if (!m) return null;
  const html = build_(m, p, { cancelUrl: cancelUrl, site: site, appLinks: appLinks });
  return { subject: m.subject, html: html, text: text_(html), ics: !!m.ics };
}

function appLinks_(L) {
  const a = [];
  if (L.android) a.push(['Android', L.android]);
  if (L.ios) a.push(['iPhone', L.ios]);
  return a;
}

/* ---------- 레이아웃 ---------- */
function build_(m, p, x) {
  const ch = CHIP[m.chip];
  const chip = '<span style="display:inline-block;padding:5px 10px;border-radius:6px;background:' + ch[0] + ';color:' + ch[1] + ';font:700 12px/1 ' + FONT + '">' + ch[2] + '</span>';
  const note = m.note ? '<p style="margin:20px 0 0;padding:14px 16px;border-radius:10px;background:' + (m.chip === 'wait' ? '#fff8ec' : C.soft) + ';font:400 14px/1.6 ' + FONT + ';color:' + C.ink2 + '">' + m.note + '</p>' : '';
  const btns = m.btns.length ? '<table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 0"><tr>' + m.btns.map(btn_).join('') + '</tr></table>' : '';
  const cancel = m.cancel ? '<p style="margin:32px 0 0;font:400 13px/1.6 ' + FONT + ';color:' + C.ink3 + '">참석이 어려우시면 <a href="' + x.cancelUrl + '" style="color:' + C.ink3 + ';text-decoration:underline">사전등록 취소</a>를 눌러 주세요. 다른 분께 자리가 돌아갑니다. 참석자 변경은 이 메일에 회신해 주세요.</p>' : '';
  const header = '<tr><td bgcolor="' + C.navy + '" style="background:' + C.navy + ';border-radius:16px 16px 0 0">' +
    '<img src="' + x.site + 'assets/mail/header.jpg" width="600" alt="전자주주총회플랫폼 시연 설명회 · 2026.11.30 13:30 · 페어몬트 앰배서더 서울 B1 그랜드볼룸 · IR KUDOS" ' +
    'style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:16px 16px 0 0;color:#ffffff;font:700 15px/1.6 ' + FONT + '"></td></tr>';
  return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><title>' + esc_(m.subject) + '</title>' +
    '<style>@media (max-width:620px){.px{padding-left:24px!important;padding-right:24px!important}.h1{font-size:22px!important}}</style></head>' +
    '<body style="margin:0;padding:0;background:' + C.page + ';-webkit-text-size-adjust:100%;word-break:keep-all">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">' + m.pre + '&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="' + C.page + '" style="background:' + C.page + '"><tr><td align="center" style="padding:32px 12px">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:16px">' +
    header +
    '<tr><td class="px" style="padding:40px 40px 44px">' + chip +
    '<h1 class="h1" style="margin:14px 0 0;font:800 25px/1.35 ' + FONT + ';letter-spacing:-.02em;color:' + C.ink + '">' + m.head + '</h1>' +
    '<p style="margin:12px 0 0;font:400 15px/1.75 ' + FONT + ';color:' + C.ink2 + '">' + m.lead + '</p>' +
    note + card_(m, p) + btns + guide_(m, x) + cancel +
    '</td></tr>' +
    '<tr><td class="px" style="padding:24px 40px 28px;border-top:1px solid ' + C.line + ';background:#fafbfd;border-radius:0 0 16px 16px">' +
    '<p style="margin:0;font:800 12px/1 ' + FONT + ';letter-spacing:.08em;color:' + C.ink + '">IR KUDOS</p>' +
    '<p style="margin:10px 0 0;font:400 12px/1.7 ' + FONT + ';color:' + C.ink3 + '">문의 <a href="mailto:' + EV.mail + '" style="color:' + C.ink3 + '">' + EV.mail + '</a> · 대표번호 ' + EV.phone +
    '<br>본 메일은 ' + EV.title + ' 사전등록 신청자에게 발송되는 안내 메일입니다.</p>' +
    '</td></tr></table></td></tr></table></body></html>';
}

function btn_(b) {
  const style = b[2]
    ? 'background:' + C.blue + ';color:#ffffff;border:1px solid ' + C.blue
    : 'background:#ffffff;color:' + C.ink + ';border:1px solid #cfd5e1';
  return '<td style="padding:0 8px 8px 0"><a href="' + b[1] + '" target="_blank" style="display:inline-block;padding:14px 22px;border-radius:10px;font:700 15px/1 ' + FONT + ';text-decoration:none;' + style + '">' + b[0] + '</a></td>';
}

function row_(k, v) {
  return '<tr><td style="padding:7px 0;width:76px;vertical-align:top;font:500 13px/1.6 ' + FONT + ';color:' + C.ink3 + '">' + k +
    '</td><td style="padding:7px 0;font:600 14px/1.6 ' + FONT + ';color:' + C.ink + '">' + v + '</td></tr>';
}

function card_(m, p) {
  if (m.card === 'none') return '';
  const sub = s => '<br><span style="font-weight:400;color:' + C.ink2 + '">' + s + '</span>';
  const rows = [
    row_('신청번호', 'No. ' + p.reg_no),
    row_('신청자', esc_(p.company) + ' · ' + esc_(p.name) + (p.title ? ' ' + esc_(p.title) : '')),
    row_('일시', EV.date + sub(EV.time)),
    row_('장소', m.card === 'full' ? EV.place + sub(EV.addr) : EV.place)
  ];
  return '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 0;background:' + C.soft + ';border-radius:12px"><tr><td style="padding:16px 20px">' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + rows.join('') + '</table></td></tr></table>';
}

function guide_(m, x) {
  const link = (t, u) => '<a href="' + u + '" style="color:' + C.blue + ';text-decoration:underline">' + t + '</a>';
  const app = x.appLinks.length
    ? ' 설치: ' + x.appLinks.map(a => link(a[0], a[1])).join(' · ')
    : '';
  const G = {
    entry: ['입장 안내', '별도 입장권은 없습니다. B1 등록 데스크에서 성함과 소속을 확인한 뒤 네임태그를 받아 입장해 주세요.'],
    app: ['시연 참여 준비', '가상 주주총회에서 직접 투표할 수 있도록 스마트폰에 현장표결 앱 <b>주주PASS</b>를 미리 설치해 주세요.' + app],
    parking: ['주차', '페어몬트 호텔 주차장을 이용하시는 경우에만 무료 주차가 가능합니다. 연결된 더현대 서울 주차장은 주차 지원이 되지 않습니다.'],
    program: ['프로그램', '13:30 개회 · 13:40 세션 1·2 (법률·학계) · 15:30 전자주총 플랫폼 소개·가상 주주총회 시연 · 17:25 Q&amp;A·경품 추첨']
  };
  let h = '';
  m.guide.forEach(k => {
    if (k === 'check') {
      const items = [['13:00', 'B1 등록 데스크에서 성함·소속 확인 후 네임태그 수령'], ['주주PASS', '가상 주주총회 투표용 앱을 미리 설치' + app], ['주차', '페어몬트 호텔 주차장만 무료 (더현대 서울 주차장 지원 불가)']];
      h += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 0">' + items.map((it, i) =>
        '<tr><td style="width:28px;vertical-align:top;padding:8px 0"><span style="display:inline-block;width:20px;height:20px;border-radius:50%;background:' + C.blue + ';color:#ffffff;font:700 12px/20px ' + FONT + ';text-align:center">' + (i + 1) + '</span></td>' +
        '<td style="padding:8px 0;font:400 14px/1.6 ' + FONT + ';color:' + C.ink2 + '"><b style="color:' + C.ink + '">' + it[0] + '</b> &nbsp;' + it[1] + '</td></tr>').join('') + '</table>';
    } else if (k === 'timetable') {
      const tt = [['13:00', '등록 및 입장', ''], ['13:30', '개회 및 행사·경품 안내', ''],
        ['13:40', '상법 개정 관련 영향 및 대응방안', '김승준 변호사 · 김앤장 법률사무소'],
        ['14:35', '상법 개정과 전자주총이 몰고 올 기업 경영의 지각변동', '권재열 연구소장 · 한국주주총회연구소'],
        ['15:30', '전자주총 디지털 대응방안 및 솔루션 소개', '박성용 본부장 · IR큐더스'],
        ['16:10', '가상의 주주총회 라이브 시연', '주주PASS로 직접 투표'], ['17:25', 'Q&amp;A · 경품 추첨 및 폐회', '']];
      h += '<p style="margin:32px 0 10px;font:700 15px/1.4 ' + FONT + ';color:' + C.ink + '">타임테이블</p><table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + tt.map(t =>
        '<tr><td style="width:56px;vertical-align:top;padding:9px 0;border-top:1px solid ' + C.line + ';font:600 13px/1.5 ' + FONT + ';color:' + C.blue + '">' + t[0] + '</td>' +
        '<td style="padding:9px 0;border-top:1px solid ' + C.line + ';font:600 14px/1.5 ' + FONT + ';color:' + C.ink + '">' + t[1] +
        (t[2] ? '<br><span style="font-weight:400;font-size:13px;color:' + C.ink3 + '">' + t[2] + '</span>' : '') + '</td></tr>').join('') + '</table>';
    } else {
      h += '<p style="margin:24px 0 4px;font:700 15px/1.4 ' + FONT + ';color:' + C.ink + '">' + G[k][0] + '</p>' +
        '<p style="margin:0;font:400 14px/1.7 ' + FONT + ';color:' + C.ink2 + '">' + G[k][1] + '</p>';
    }
  });
  return h;
}

/* ---------- 보조 ---------- */
function ics_(p) {
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//IR KUDOS//Seminar//KO', 'METHOD:PUBLISH', 'BEGIN:VEVENT',
    'UID:seminar-20261130-' + p.reg_no + '@irkudos.co.kr',
    'DTSTAMP:' + Utilities.formatDate(new Date(), 'UTC', "yyyyMMdd'T'HHmmss'Z'"),
    'DTSTART:' + EV.start, 'DTEND:' + EV.end, 'SUMMARY:' + EV.title,
    'LOCATION:' + EV.place + ' (' + EV.addr + ')',
    'DESCRIPTION:13:00 등록 시작. B1 등록 데스크에서 성함과 소속 확인 후 입장.',
    'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}
function esc_(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function text_(h) {
  return h.replace(/<title>[\s\S]*?<\/title>/, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<h1/g, '\n<h1').replace(/<div style="display:none[\s\S]*?<\/div>/, '')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, '$2 ($1)')
    .replace(/<br\s*\/?>/g, '\n').replace(/<\/(p|tr|h1)>/g, '\n').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** 설치 확인용: 실행 계정 메일함으로 7종 + 반려 사유 3종을 보냅니다 */
function testAll() {
  const me = Session.getActiveUser().getEmail();
  const links = { site: 'https://nane9141-prog.github.io/seminar/', android: 'https://play.google.com/store/apps/details?id=com.irkudos.jujupass', ios: '', slides: 'https://example.com/slides', survey: 'https://example.com/survey' };
  const base = { reg_no: 0, name: '테스트', title: '매니저', company: 'IR큐더스', email: me, cancel_token: 'test', links: links };
  ['confirmed', 'pending', 'approved', 'cancelled', 'reminder', 'thanks'].forEach(t => send_(Object.assign({}, base, { type: t })));
  ['ineligible', 'company_full', 'capacity_full'].forEach(r => send_(Object.assign({}, base, { type: 'rejected', reason: r })));
}
