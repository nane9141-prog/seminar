/**
 * 전자주주총회 플랫폼 시연 설명회 · 자동 메일 발송기 (디자인 A안)
 *
 * 설치 (발송 계정으로 로그인한 상태에서)
 * 1. script.google.com → 새 프로젝트 → 이 코드를 붙여넣기
 * 2. 프로젝트 설정 → 스크립트 속성
 *    SECRET   : Supabase settings 테이블의 mail_secret 값
 *    FROM     : 발신 주소 agm@irkudos.co.kr (11.9 확정). agm@ 계정에서 직접 설치하면 비워두고,
 *               다른 계정에서 설치하면 그 계정에 agm@를 '다른 주소로 보내기'로 등록한 뒤 입력
 * 3. 함수 testAll 실행 → 권한 승인 → 실행 계정 메일함에서 8종 확인 (초청 메일 포함)
 * 4. 배포 → 새 배포 → 웹 앱 / 실행: 나 / 액세스: 모든 사용자 → URL 복사
 * 5. Supabase settings 테이블 mail_webhook_url 에 그 URL 입력
 *
 * 6. (초청 메일 반송 확인) 함수 installBounceCheck 를 한 번 실행 → 권한 승인. 10분마다 반송 메일을 읽어 관리자 페이지에 표시
 *    코드를 고친 뒤에는 배포 → 배포 관리 → 수정 → 버전 '새 버전'으로 저장 (웹훅 URL 유지)
 *
 * 초청 메일 추적: 발송 성공/실패·반송은 아래 SB_URL로 보고, 열람은 메일 속 1px 이미지가 이 웹 앱(doGet)을 부를 때 기록
 * 링크(사이트 주소, 주주PASS, 발표자료, 설문)는 관리자 페이지 > 메일 링크에서 바꾸면 바로 반영됩니다.
 * 발송 계정을 바꿀 때: 새 계정에서 1~4를 다시 하고 mail_webhook_url만 교체
 */

const SENDER_NAME = 'IR큐더스';
// 초청 메일 결과 보고용 (공개 키 — 브라우저에도 노출되는 값, 권한은 mail_secret으로 확인)
const SB_URL = 'https://zrhtqpzgubaqzsdaxhvt.supabase.co';
const SB_KEY = 'sb_publishable_JwET6KLGmdYBkOIIttgOOQ_HEpCKLar';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ZERO = '00000000-0000-0000-0000-000000000000';
const EV = {
  title: '전자주주총회 플랫폼 시연 설명회',
  date: '2026년 11월 30일(월)', time: '13:00 등록 · 13:30 ~ 18:00',
  place: '페어몬트 앰배서더 서울 지하 1층(B1) 그랜드볼룸', addr: '서울특별시 영등포구 여의대로 108',
  map: 'https://map.naver.com/p/search/%ED%8E%98%EC%96%B4%EB%AA%AC%ED%8A%B8%20%EC%95%B0%EB%B0%B0%EC%84%9C%EB%8D%94%20%EC%84%9C%EC%9A%B8',
  gcal: 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=%EC%A0%84%EC%9E%90%EC%A3%BC%EC%A3%BC%EC%B4%9D%ED%9A%8C%ED%94%8C%EB%9E%AB%ED%8F%BC%20%EC%8B%9C%EC%97%B0%20%EC%84%A4%EB%AA%85%ED%9A%8C&dates=20261130T043000Z/20261130T090000Z&location=%ED%8E%98%EC%96%B4%EB%AA%AC%ED%8A%B8%20%EC%95%B0%EB%B0%B0%EC%84%9C%EB%8D%94%20%EC%84%9C%EC%9A%B8%20B1',
  start: '20261130T043000Z', end: '20261130T090000Z',
  phone: '02-6011-2000', mail: 'agm@irkudos.co.kr'
};
const C = { ink: '#0f1524', ink2: '#3d4556', ink3: '#7a8294', line: '#e3e7ef', soft: '#f4f6fb', blue: '#2f6bff', navy: '#141a6e', page: '#ffffff', box: '#e6e9ef' };
const FONT = "-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic','맑은 고딕','Noto Sans KR',sans-serif";
const CHIP = {
  done: ['#e7f6ee', '#137a45', '참석 확정'], wait: ['#fff4e0', '#9a5b00', '확인 중'], no: ['#fdecec', '#b42323', '신청 결과'],
  cancel: ['#eef0f4', '#4d5566', '취소 완료'], d1: ['#e8efff', '#1f4fd6', 'D-3'], thanks: ['#e8efff', '#1f4fd6', '참석 감사'],
  invite: ['#e8efff', '#1f4fd6', 'INVITATION · 초청']
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
  const inv = p.type === 'invite' && UUID_RE.test(p.invite_token || '') && p.invite_token !== ZERO;
  try {
    send_(p);
  } catch (err) {
    if (inv) report_({ p_status: 'failed', p_token: p.invite_token, p_error: String(err && err.message || err) });
    return ContentService.createTextOutput('error: ' + (err && err.message || err));
  }
  if (inv) report_({ p_status: 'sent', p_token: p.invite_token });
  return ContentService.createTextOutput('ok');
}

/* ---------- 열람 기록: 메일 속 1px 이미지가 ?o=토큰 으로 부름 ---------- */
function doGet(e) {
  const t = e && e.parameter && e.parameter.o;
  if (t && UUID_RE.test(t) && t !== ZERO) rpc_('track_open', { p_token: t });
  return ContentService.createTextOutput('');
}

function report_(body) {
  body.p_secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  rpc_('mail_report', body);
}
function rpc_(fn, body) {
  try {
    UrlFetchApp.fetch(SB_URL + '/rest/v1/rpc/' + fn, {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      headers: { apikey: SB_KEY }, payload: JSON.stringify(body)
    });
  } catch (err) { console.warn('rpc ' + fn + ' 실패: ' + err); }
}

/* ---------- 반송 확인: 10분마다 받은편지함의 반송 메일을 읽어 보고 ---------- */
const BOUNCE_LABEL = '설명회-반송확인';
function checkBounces() {
  const label = GmailApp.getUserLabelByName(BOUNCE_LABEL) || GmailApp.createLabel(BOUNCE_LABEL);
  const threads = GmailApp.search('from:(mailer-daemon OR postmaster) newer_than:7d -label:' + BOUNCE_LABEL, 0, 50);
  threads.forEach(th => {
    th.getMessages().forEach(msg => {
      const body = msg.getPlainBody() || '';
      let to = (msg.getHeader('X-Failed-Recipients') || '').split(',').map(x => x.trim()).filter(Boolean);
      if (!to.length) {
        const m = body.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) || [];
        to = m.filter(a => !/mailer-daemon|postmaster|googlemail|irkudos\.co\.kr/i.test(a));
      }
      const reason = (body.match(/(5\d\d[ -][^\n]{0,160})/) || body.match(/([^\n]*(?:not found|does not exist|찾을 수 없|존재하지 않)[^\n]*)/i) || [, '반송'])[1].trim();
      [...new Set(to.map(a => a.toLowerCase()))].forEach(a => report_({ p_status: 'bounced', p_email: a, p_error: reason }));
    });
    th.addLabel(label);
  });
}
/** 한 번만 실행: checkBounces 를 10분마다 자동 실행 */
function installBounceCheck() {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'checkBounces').forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('checkBounces').timeBased().everyMinutes(10).create();
  checkBounces();
}

function send_(p) {
  const m = compose_(p);
  if (!m) return;
  const props = PropertiesService.getScriptProperties();
  let html = m.html;
  // 초청 메일 열람 확인용 1px 이미지 (이 웹 앱 주소 + ?o=토큰)
  if (p.type === 'invite' && UUID_RE.test(p.invite_token || '') && p.invite_token !== ZERO) {
    let url = '';
    try { url = ScriptApp.getService().getUrl(); } catch (_) {}
    if (url) html = html.replace('</body>', '<img src="' + url + '?o=' + p.invite_token + '" width="1" height="1" alt="" style="display:block;width:1px;height:1px;border:0;opacity:0"></body>');
  }
  const opts = { htmlBody: html, name: SENDER_NAME, replyTo: EV.mail };
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
  const inviteUrl = site + '?invite=' + (p.invite_token || '') + '#register';
  const honor = esc_(p.name) + (p.title ? ' ' + esc_(p.title) : '') + '님';
  const full = ['entry', 'app', 'parking', 'program'];
  const D = {
    confirmed: {
      chip: 'done', subject: '[IR큐더스] 전자주주총회 플랫폼 시연 설명회 참석이 확정되었습니다',
      pre: '11월 30일(월) 오후 1시부터 페어몬트 앰배서더 서울 지하 1층에서 등록을 시작합니다.',
      head: esc_(p.name) + '님, 참석이 확정되었습니다',
      lead: '신청해 주셔서 감사합니다. 전자주주총회 준비에 필요한 법률·실무 쟁점과, 모의 전자주주총회로 확인하는 실제 운영 과정을 준비했습니다. 아래 일정과 참석 안내를 확인해 주세요.',
      card: 'full', btns: [['캘린더에 추가', EV.gcal, 1], ['오시는 길', EV.map, 0]], guide: full, cancel: true, ics: true
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
      chip: 'd1', subject: '[IR큐더스] 11월 30일(월) 전자주주총회 플랫폼 시연 설명회 참석 안내',
      pre: '11월 30일(월) 13:00부터 등록합니다. 주주PASS 설치와 주차 안내를 확인해 주세요.',
      head: '다음 주 월요일,<br>설명회에서 뵙겠습니다',
      salute: esc_(p.company) + ' ' + honor + '께',
      lead: '전자주주총회 플랫폼 시연 설명회가 <b>11월 30일(월) 오후 1시 30분</b>에 열립니다. 등록은 오후 1시부터입니다.<br>' +
        '장소와 참석 준비사항을 다시 안내해 드리니, 행사 전에 확인해 주시기 바랍니다.',
      sign: 'IR큐더스 드림', letter: true, hero: 'header-remind.jpg',
      card: 'full', btns: [['오시는 길', EV.map, 1]].concat(appLinks.length ? [['주주PASS 설치', appLinks[0][1], 0]] : []),
      guide: ['check', 'timetable'], cancel: true, ics: true
    },
    invite: {
      chip: 'invite', subject: '[IR큐더스] 전자주주총회 플랫폼 시연 설명회에 초대합니다 (11.30 월, 페어몬트 앰배서더 서울)',
      pre: '2027년 전자주주총회 의무화 대비, 법률·실무 쟁점과 실제 운영 시연을 한자리에서 확인하세요. 기업별 최대 2명, 선착순 300명.',
      head: '전자주주총회 플랫폼<br>시연 설명회에 초대합니다',
      salute: esc_(p.company) + ' ' + honor + '께',
      lead: '안녕하십니까, IR큐더스입니다.<br><br>' +
        '2027년 1월 1일부터 최근 사업연도 말 자산총액 2조 원 이상 상장회사는 전자주주총회를 개최해야 합니다. ' +
        '이에 전자주주총회 도입을 준비하시는 기업 담당자분들을 위해 시연 설명회를 마련했습니다.<br><br>' +
        '전문가와 함께 개정 상법의 주요 내용과 전자주주총회 준비에 필요한 법률·실무 쟁점을 살펴보고, ' +
        '주주명부와 의안 설정부터 출석 확인, 표결, 결과 집계까지 통합시스템의 운영 과정을 시연합니다. ' +
        '참석자께서는 현장 출석이나 전자 출석으로 모의 전자주주총회에 참여해 직접 투표하실 수 있습니다.<br><br>' +
        '바쁘시더라도 참석하시어 자리를 빛내 주시기 바랍니다.',
      sign: 'IR큐더스 드림', letter: true, hero: 'header.jpg',
      card: 'invite', btns: [['사전등록하기', inviteUrl, 1], ['설명회 자세히 보기', site, 0]],
      note: '사전등록은 <b>기업별 최대 2명</b>, 선착순 <b>300명</b>까지 받으며 <b>11월 27일(금) 18:00</b>에 마감합니다. 정원이 차면 일찍 마감될 수 있습니다. 위 버튼으로 신청하시면 회사와 성함이 미리 입력되어 있습니다.',
      guide: ['timetable'], foot: '본 메일은 전자주주총회 의무화 대상 상장회사 담당자께 보내드리는 초청 메일입니다. 수신을 원치 않으시면 이 메일에 회신해 주세요. 메일 열람과 링크 클릭 여부는 설명회 안내 목적으로만 확인합니다.'
    },
    thanks: {
      chip: 'thanks', subject: '[IR큐더스] 전자주주총회 플랫폼 시연 설명회에 참석해 주셔서 감사합니다',
      pre: '참석해 주셔서 감사합니다.' + (L.survey ? ' 2분 설문에 참여해 주세요.' : ''),
      head: '참석해 주셔서 감사합니다',
      lead: '오늘 설명회에 함께해 주셔서 감사합니다.' + (L.survey ? ' 더 나은 설명회를 위해 2분 설문에 참여해 주시면 감사하겠습니다.' : ''),
      note: '전자주주총회 도입 일정이나 운영 방식이 궁금하시면 이 메일에 회신해 주세요. IR큐더스 담당자가 연락드리겠습니다.',
      card: 'none', btns: L.survey ? [['설문 참여하기', L.survey, 1]] : [],
      guide: []
    }
  };
  const m = D[p.type];
  if (!m) return null;
  const html = build_(m, p, { cancelUrl: cancelUrl, site: site, appLinks: appLinks });
  return { subject: m.subject, html: html, text: text_(html), ics: !!m.ics };
}

function appLinks_(L) {
  // 기기별 자동 연결 URL 한 개 (관리자 > 메일 링크 > 주주PASS 설치)
  return L.android ? [['설치하기', L.android]] : [];
}

/* ---------- 레이아웃 ---------- */
function build_(m, p, x) {
  const inv = !!m.letter; // 초청·D-3: 큰 헤더 + 가운데 정렬 초청장 형식 / 나머지: 얇은 띠 헤더 + 왼쪽 정렬 안내
  const ch = CHIP[m.chip];
  const chip = '<span style="display:inline-block;padding:5px 10px;border-radius:6px;background:' + ch[0] + ';color:' + ch[1] + ';font:700 12px/1 ' + FONT + '">' + ch[2] + '</span>';
  const note = m.note ? '<p style="margin:20px 0 0;padding:14px 16px;border-radius:10px;' + (inv ? 'text-align:center;' : '') + 'background:' + (m.chip === 'wait' ? '#fff8ec' : C.soft) + ';font:400 14px/1.6 ' + FONT + ';color:' + C.ink2 + '">' + m.note + '</p>' : '';
  const btns = m.btns.length ? '<table role="presentation" cellpadding="0" cellspacing="0"' + (inv ? ' align="center" style="margin:28px auto 0"' : ' style="margin:28px 0 0"') + '><tr>' + m.btns.map(btn_).join('') + '</tr></table>' : '';
  const cancel = m.cancel ? '<p style="margin:32px 0 0;font:400 13px/1.6 ' + FONT + ';color:' + C.ink3 + '">참석이 어려우시면 <a href="' + x.cancelUrl + '" style="color:' + C.ink3 + ';text-decoration:underline">사전등록 취소</a>를 눌러 주세요. 다른 분께 자리가 돌아갑니다. 참석자 변경은 이 메일에 회신해 주세요.</p>' : '';
  const header = '<tr><td bgcolor="#060a10" style="background:#060a10;border-radius:15px 15px 0 0">' +
    '<img src="' + x.site + 'assets/mail/' + (m.hero || 'header-bar.jpg?v=3') + '" width="600" alt="전자주주총회 플랫폼 시연 설명회 · 2026.11.30 13:30 · 페어몬트 앰배서더 서울 지하 1층(B1) 그랜드볼룸 · IR KUDOS" ' +
    'style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:15px 15px 0 0;color:#ffffff;font:700 15px/1.6 ' + FONT + '"></td></tr>';
  return '<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light"><title>' + esc_(m.subject) + '</title>' +
    '<style>@media (max-width:620px){.px{padding-left:24px!important;padding-right:24px!important}.h1{font-size:22px!important}}</style></head>' +
    '<body style="margin:0;padding:0;background:' + C.page + ';-webkit-text-size-adjust:100%;word-break:keep-all">' +
    '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent">' + m.pre + '&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>' +
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="' + C.page + '" style="background:' + C.page + '"><tr><td align="center" style="padding:32px 12px">' +
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border:1px solid ' + C.box + ';border-radius:16px;border-collapse:separate;overflow:hidden">' +
    header +
    '<tr><td class="px" style="padding:' + (inv ? '44px 40px 44px' : '36px 40px 44px') + '">' +
    (inv ? '<div style="text-align:center">' : '') + chip +
    '<h1 class="h1" style="margin:' + (inv ? '18px' : '14px') + ' 0 0;font:800 ' + (inv ? '28px' : '25px') + '/1.35 ' + FONT + ';letter-spacing:-.02em;color:' + C.ink + '">' + m.head + '</h1>' +
    (m.salute ? '<p style="margin:28px 0 0;font:700 16px/1.6 ' + FONT + ';color:' + C.ink + '">' + m.salute + '</p>' : '') +
    '<p style="margin:12px 0 0;font:400 15px/1.75 ' + FONT + ';color:' + C.ink2 + '">' + m.lead + '</p>' +
    (m.sign ? '<p style="margin:20px 0 0;font:700 15px/1.6 ' + FONT + ';color:' + C.ink + '">' + m.sign + '</p>' : '') +
    (inv ? '</div>' : '') +
    (inv ? card_(m, p) + btns + note : note + card_(m, p) + btns) + guide_(m, x) + cancel +
    '</td></tr>' +
    '<tr><td class="px" style="padding:24px 40px 28px;border-top:1px solid ' + C.line + ';background:#fafbfd;border-radius:0 0 15px 15px">' +
    '<p style="margin:0;font:800 12px/1 ' + FONT + ';letter-spacing:.08em;color:' + C.ink + '">IR KUDOS</p>' +
    '<p style="margin:10px 0 0;font:400 12px/1.7 ' + FONT + ';color:' + C.ink3 + '">문의 <a href="mailto:' + EV.mail + '" style="color:' + C.ink3 + '">' + EV.mail + '</a> · 대표번호 ' + EV.phone +
    '<br>' + (m.foot || '본 메일은 ' + EV.title + ' 사전등록 신청자에게 발송되는 안내 메일입니다.') + '</p>' +
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
  const rows = m.card === 'invite' ? [
    row_('일시', EV.date + sub(EV.time)),
    row_('장소', EV.place + sub(EV.addr)),
    row_('대상', '전자주주총회 의무화 대상 상장회사' + sub('최근 사업연도 말 자산총액 2조 원 이상')),
    row_('신청', '11월 27일(금) 18:00 마감' + sub('기업별 최대 2명 · 선착순 300명'))
  ] : [
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
    ? ' ' + link('설치하기', x.appLinks[0][1])
    : '';
  const G = {
    entry: ['입장 안내', '별도의 입장권이나 QR코드는 필요 없습니다. 행사 당일 오후 1시부터 지하 1층 등록 데스크에서 성함과 소속을 말씀해 주세요. 확인 후 명찰을 드립니다.'],
    app: ['시연 투표 참여', '현장 출석이나 전자 출석 중 한 가지 방식으로 참여하실 수 있습니다.<br><b>현장 출석</b> <b>주주PASS</b> 앱을 미리 설치하고 본인인증을 마쳐 주세요. 당일 등록 데스크에서 NFC 태그로 출석을 등록하시면 됩니다.<br><b>전자 출석</b> 당일 등록 데스크에서 알려드리는 경로로 출석하실 수 있습니다.<br>설치·인증에 문제가 있으면 등록 데스크에서 도와드립니다.' + app],
    parking: ['주차', '페어몬트 호텔 주차장을 이용하시고, 등록 데스크에서 주차 지원을 등록해 주세요. 더현대 서울 주차장은 지원되지 않습니다.'],
    program: ['행사 프로그램', '13:30 개회 · 13:40 법률·실무 세션 · 15:30 통합 솔루션 소개 및 운영 시연 · 17:25 질의응답 및 폐회']
  };
  let h = '';
  m.guide.forEach(k => {
    if (k === 'check') {
      const items = [['13:00', '지하 1층 등록 데스크에서 성함·소속 확인 후 명찰 수령'], ['투표 참여', '현장 출석: 주주PASS 앱 설치·본인인증 후 등록 데스크에서 NFC 태그로 출석 등록 / 전자 출석: 등록 데스크에서 안내하는 경로로 접속' + app], ['주차', '페어몬트 호텔 주차장 이용 후 등록 데스크에서 주차 지원 등록 (더현대 서울 주차장은 지원 불가)']];
      h += '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:28px 0 0">' + items.map((it, i) =>
        '<tr><td style="width:28px;vertical-align:top;padding:8px 0"><span style="display:inline-block;width:20px;height:20px;border-radius:50%;background:' + C.blue + ';color:#ffffff;font:700 12px/20px ' + FONT + ';text-align:center">' + (i + 1) + '</span></td>' +
        '<td style="padding:8px 0;font:400 14px/1.6 ' + FONT + ';color:' + C.ink2 + '"><b style="color:' + C.ink + '">' + it[0] + '</b> &nbsp;' + it[1] + '</td></tr>').join('') + '</table>';
    } else if (k === 'timetable') {
      const tt = [['13:00', '등록 및 입장', ''], ['13:30', '개회 및 행사 안내', ''],
        ['13:40', '전자주주총회 제도 도입 및 진행 관련 주요 실무 쟁점', '김승준 변호사 · 김앤장 법률사무소'],
        ['14:35', '상법 개정과 전자주총이 몰고 올 기업 경영의 지각변동', '권재열 연구소장 · 한국주주총회연구소'],
        ['15:30', '전자주주총회 도입·운영 방안 및 통합 솔루션 소개', '박성용 본부장 · IR큐더스'],
        ['16:10', '전자주주총회 운영 시연 및 표결 참여', '박성용 본부장 · IR큐더스'], ['17:25', '사전 질문 및 현장 질의응답, 경품 추첨 및 폐회', '']];
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
    'DESCRIPTION:13:00부터 지하 1층 등록 데스크에서 성함과 소속 확인 후 명찰 수령.',
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

/** 설치 확인용: 실행 계정 메일함으로 초청 + 4종 + 반려 사유 3종을 보냅니다 */
function testAll() {
  const me = Session.getActiveUser().getEmail();
  const links = { site: 'https://seminar.irkudos.co.kr/', android: 'https://kudos.agmlive.co.kr/appstore/juju-pass/redirect', survey: 'https://example.com/survey' };
  const base = { reg_no: 0, name: '테스트', title: '매니저', company: 'IR큐더스', email: me, cancel_token: '00000000-0000-0000-0000-000000000000', links: links };
  ['invite', 'confirmed', 'cancelled', 'reminder', 'thanks'].forEach(t => send_(Object.assign({}, base, { type: t, invite_token: '00000000-0000-0000-0000-000000000000' })));
  ['ineligible', 'company_full', 'capacity_full'].forEach(r => send_(Object.assign({}, base, { type: 'rejected', reason: r })));
}
