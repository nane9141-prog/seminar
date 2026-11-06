/**
 * 전자주주총회플랫폼 시연 설명회 · 사전등록 메일 발송기
 *
 * 설치 (발송 계정으로 로그인한 상태에서)
 * 1. script.google.com → 새 프로젝트 → 이 코드를 붙여넣기
 * 2. 프로젝트 설정 → 스크립트 속성에 추가
 *    SECRET   : Supabase settings 테이블의 mail_secret 값
 *    SITE_URL : 사이트 주소 (예: https://nane9141-prog.github.io/seminar/)
 *    FROM     : (선택) 발송 계정의 '다른 주소로 보내기' 별칭. 계정 주소 그대로 보낼 땐 비워둠
 *    REPLY_TO : (선택) 답장 받을 주소
 * 3. 함수 testSend 실행 → 권한 승인 → 본인에게 테스트 메일 확인
 * 4. 배포 → 새 배포 → 웹 앱 / 실행: 나 / 액세스: 모든 사용자 → URL 복사
 * 5. Supabase settings 테이블 mail_webhook_url 에 그 URL 입력
 *
 * 발송 계정을 바꿀 때: 새 계정에서 1~4를 다시 하고 mail_webhook_url만 교체
 */

const EVENT = {
  title: '전자주주총회플랫폼 시연 설명회',
  date: '2026년 11월 30일(월)',
  time: '13:00 등록 · 13:30~18:00',
  place: '페어몬트 앰배서더 서울 B1 그랜드볼룸',
  address: '서울 영등포구 여의대로 108',
  start: '20261130T043000Z', // 13:30 KST
  end: '20261130T090000Z',   // 18:00 KST
  contact: 'seminar@irkudos.co.kr',
};

function doPost(e) {
  const p = JSON.parse(e.postData.contents || '{}');
  const props = PropertiesService.getScriptProperties();
  if (!p.secret || p.secret !== props.getProperty('SECRET')) {
    return ContentService.createTextOutput('forbidden');
  }
  sendFor_(p);
  return ContentService.createTextOutput('ok');
}

function sendFor_(p) {
  const site = (PropertiesService.getScriptProperties().getProperty('SITE_URL') || '').replace(/\/?$/, '/');
  const cancelUrl = site + '?cancel=' + p.cancel_token;
  const who = esc_(p.name) + '님';
  const info = infoTable_(p);
  let subject, body, ics = false;

  switch (p.type) {
    case 'confirmed':
    case 'approved':
      subject = '[IR큐더스] ' + EVENT.title + ' 사전등록이 완료되었습니다';
      body = '<p>' + who + ', 사전등록이 완료되었습니다.</p>' + info +
        '<p><b>입장 안내</b><br>행사 당일 등록 데스크에서 성함과 회사명으로 본인 확인 후 입장하실 수 있습니다. 별도 QR은 없습니다.</p>' +
        '<p>참석이 어려우시면 아래 링크로 취소해 주세요. 다른 분께 자리가 돌아갑니다.<br><a href="' + cancelUrl + '">사전등록 취소하기</a></p>';
      ics = true;
      break;
    case 'pending':
      subject = '[IR큐더스] ' + EVENT.title + ' 신청이 접수되었습니다 (승인 대기)';
      body = '<p>' + who + ', 신청이 접수되었습니다.</p>' + info +
        '<p>직접 입력하신 기업은 운영팀 확인 후 영업일 1일 이내에 승인 여부를 메일로 안내드립니다. 승인 시점에 해당 기업 잔여석(기업당 2명)과 전체 정원이 남아 있어야 확정됩니다.</p>';
      break;
    case 'rejected':
      subject = '[IR큐더스] ' + EVENT.title + ' 신청 결과 안내';
      body = '<p>' + who + ', 신청해 주셔서 감사합니다.</p>' +
        '<p>이번 설명회는 2027년 전자주주총회 의무화 대상 기업(최근 사업연도 말 자산총액 2조원 이상 상장회사)을 대상으로 운영되어, 아쉽게도 참석 확정이 어렵습니다. 문의사항은 아래 연락처로 회신해 주세요.</p>';
      break;
    case 'cancelled':
      subject = '[IR큐더스] ' + EVENT.title + ' 사전등록이 취소되었습니다';
      body = '<p>' + who + ', 사전등록이 취소되었습니다.</p>' + info +
        '<p>다시 참석을 원하시면 사이트에서 새로 신청해 주세요. 잔여석이 있을 때 등록됩니다.</p>';
      break;
    case 'reminder':
      subject = '[IR큐더스] 내일 ' + EVENT.title + '에서 뵙겠습니다';
      body = '<p>' + who + ', 내일 설명회에서 뵙겠습니다.</p>' + info +
        '<p>13:00부터 등록 데스크에서 성함과 회사명으로 본인 확인 후 입장하실 수 있습니다.<br>' +
        '참석이 어려우시면 <a href="' + cancelUrl + '">취소</a>해 주세요.</p>';
      ics = true;
      break;
    default:
      return;
  }

  const html = layout_(body);
  const opts = { htmlBody: html, name: 'IR큐더스 세미나' };
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('FROM')) opts.from = props.getProperty('FROM');
  if (props.getProperty('REPLY_TO')) opts.replyTo = props.getProperty('REPLY_TO');
  if (ics) opts.attachments = [Utilities.newBlob(icsText_(p), 'text/calendar', 'seminar.ics')];
  GmailApp.sendEmail(p.email, subject, stripTags_(html), opts);
}

function infoTable_(p) {
  const row = (k, v) => '<tr><td style="padding:6px 16px 6px 0;color:#6b7280;white-space:nowrap;vertical-align:top">' + k +
    '</td><td style="padding:6px 0;color:#111827">' + v + '</td></tr>';
  return '<table style="border-collapse:collapse;margin:20px 0;font-size:15px">' +
    row('신청번호', 'No. ' + p.reg_no) +
    row('신청자', esc_(p.company) + ' · ' + esc_(p.name) + (p.title ? ' ' + esc_(p.title) : '')) +
    row('일시', EVENT.date + '<br>' + EVENT.time) +
    row('장소', EVENT.place + '<br><span style="color:#6b7280">' + EVENT.address + '</span>') +
    '</table>';
}

function layout_(inner) {
  return '<div style="background:#f3f4f6;padding:32px 12px;font-family:Pretendard,-apple-system,\'Apple SD Gothic Neo\',\'Malgun Gothic\',sans-serif">' +
    '<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden">' +
    '<div style="background:#121212;padding:28px 32px;color:#fff">' +
    '<div style="font-size:13px;color:#5ea2ff;letter-spacing:.04em">IR KUDOS</div>' +
    '<div style="font-size:22px;font-weight:700;margin-top:6px">' + EVENT.title + '</div></div>' +
    '<div style="padding:28px 32px;font-size:15px;line-height:1.7;color:#111827">' + inner + '</div>' +
    '<div style="padding:20px 32px;border-top:1px solid #e5e7eb;font-size:12px;color:#6b7280">문의 ' + EVENT.contact +
    '<br>본 메일은 발신 전용이 아니며 회신하시면 운영팀이 확인합니다.</div></div></div>';
}

function icsText_(p) {
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//IR KUDOS//Seminar//KO', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    'UID:seminar-20261130-' + p.reg_no + '@irkudos.co.kr',
    'DTSTAMP:' + Utilities.formatDate(new Date(), 'UTC', "yyyyMMdd'T'HHmmss'Z'"),
    'DTSTART:' + EVENT.start, 'DTEND:' + EVENT.end,
    'SUMMARY:' + EVENT.title,
    'LOCATION:' + EVENT.place + ' (' + EVENT.address + ')',
    'DESCRIPTION:13:00 등록 시작. 등록 데스크에서 성함과 회사명으로 본인 확인 후 입장.',
    'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n');
}

function esc_(s) {
  return String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
}
function stripTags_(h) {
  return h.replace(/<br\s*\/?>/g, '\n').replace(/<\/(p|tr|div)>/g, '\n').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/\n{3,}/g, '\n\n').trim();
}

/** 설치 확인용: 실행한 계정 주소로 신청 완료 메일을 보냅니다 */
function testSend() {
  sendFor_({
    type: 'confirmed', reg_no: 0, name: '테스트', title: '매니저', company: 'IR큐더스',
    email: Session.getActiveUser().getEmail(), cancel_token: 'test'
  });
}
