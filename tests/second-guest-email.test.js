// 2026-09-05 특이사항 두 번째 게스트 이메일 동봉 검증: notes 속 이메일이 수신자에 붙는다
// 실행: node tests/second-guest-email.test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.gs'), 'utf8');

let db = {};
const get = (p) => p.split('/').reduce((o, k) => (o == null ? o : o[k]), db) ?? null;
const setD = (p, v) => { const ks = p.split('/'), last = ks.pop(); let o = db; for (const k of ks) o = o[k] = o[k] || {}; if (v === null) delete o[last]; else o[last] = v; };
const sent = [];
const ctx = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'x' }) },
  UrlFetchApp: { fetch: () => ({ getContentText: () => 'null' }) },
  Utilities: { formatDate: () => '00' },
  ScriptApp: { newTrigger: () => ({ timeBased: () => ({ atHour: () => ({ nearMinute: () => ({ everyDays: () => ({ create: () => {} }) }) }), everyMinutes: () => ({ create: () => {} }) }) }), getService: () => ({ getUrl: () => '' }), getProjectTriggers: () => [] },
  GmailApp: { sendEmail: (to, sub, body) => sent.push({ to, sub, body }) },
  Session: {}, Logger: { log: () => {} },
  ContentService: { createTextOutput: (t) => t }, console,
};
vm.createContext(ctx);
vm.runInContext(src, ctx);
vm.runInContext(`fbGet=p=>__get(p);fbSet=(p,v)=>__set(p,v);fbUpdate=(p,v)=>{const c=__get(p)||{};__set(p,{...c,...v})};fbDelete=p=>__set(p,null);todayKST=()=>'2026-09-05';nowHM=()=>'12:00';`, ctx);
ctx.__get = get; ctx.__set = setD;

// ① mailToFor_ 단독: bk.notes 속 이메일 추출 + 본인 이메일 중복 제거(대소문자 무시)
let to = ctx.mailToFor_({ guestEmail: 'a@x.com', notes: '2인: 김둘째 B@y.com / A@X.COM' }, null, null);
assert.strictEqual(to, 'a@x.com,B@y.com', '① notes 이메일 동봉+중복 제거: ' + to);

// ② pendingBookings형 bk(자체 notes 없음, assignedRoom만) → 배정 방 예약의 notes에서 수집
setD('app/rooms/930', { currentBooking: { bookingId: 'd1', guestEmail: 'a@x.com', notes: '두번째 게스트 c@z.com' } });
to = ctx.mailToFor_({ bookingId: 'd1', guestEmail: 'a@x.com', assignedRoom: '930' }, null, null);
assert.strictEqual(to, 'a@x.com,c@z.com', '② 방 notes 수집: ' + to);

// ③ 실발송 경로(sendStageMail, force): 수신자가 primary+second 로 나간다
setD('app/mailTemplates/s2_reminder', { subject: 'S', bodyKo: '본문' });
sent.length = 0;
const ok = ctx.sendStageMail('s2_reminder', { bookingId: 'd1', guest: 'G', guestEmail: 'a@x.com', assignedRoom: '930', checkinDate: '2026-09-06', checkoutDate: '2026-09-08' }, null, true);
assert.strictEqual(ok, true, '③ 발송 성공해야 함');
assert.strictEqual(sent.length, 1, '③ 1통 발송: ' + sent.length);
assert.strictEqual(sent[0].to, 'a@x.com,c@z.com', '③ 수신자: ' + sent[0].to);

// ④ notes에 이메일이 없으면 기존과 완전 동일(primary 단독)
to = ctx.mailToFor_({ guestEmail: 'a@x.com', notes: '주차 요청, 얼리체크인' }, null, null);
assert.strictEqual(to, 'a@x.com', '④ 무변화: ' + to);

// ⑤ sendS2Tomorrow: dry=기발송/발송예정 구분, 실발송=미발송만+가이드 링크 치환+임시 템플릿 정리
vm.runInContext(`kstDate=o=>o===1?'2026-09-06':'2026-09-05';`, ctx);
db = {};
setD('app/rooms/930', { currentBooking: { bookingId: 'd1', guestEmail: 'a@x.com', notes: '두번째 게스트 c@z.com' } });
setD('app/mailTemplates/s2_reminder', { subject: 'Reminder', bodyKo: '가이드: https://pwr-guide.online/main 확인' });
setD('app/pendingBookings/sv_d1', { bookingId: 'd1', guest: 'G1', guestEmail: 'a@x.com', assignedRoom: '930', checkinDate: '2026-09-06', checkoutDate: '2026-09-08' });
setD('app/pendingBookings/sv_d2', { bookingId: 'd2', guest: 'G2', guestEmail: 'd@w.com', checkinDate: '2026-09-06', checkoutDate: '2026-09-07' });
setD('app/mailLogs/d2_s2_reminder', { stage: 's2_reminder' });   // G2는 아침에 이미 발송됨
let out = ctx.doGet({ parameter: { token: 'x', action: 'sendS2Tomorrow', dry: '1', guide: 'appt2026' } });
assert.ok(out.includes('[발송예정] 930호 G1 → a@x.com,c@z.com'), '⑤ dry 발송예정: ' + out);
assert.ok(out.includes('[기발송]') && out.includes('G2'), '⑤ dry 기발송 표시: ' + out);
assert.ok(get('app/mailTemplates/custom_tmp_s2guide') === null, '⑤ dry는 임시 템플릿 안 만듦');
sent.length = 0;
out = ctx.doGet({ parameter: { token: 'x', action: 'sendS2Tomorrow', guide: 'appt2026' } });
assert.strictEqual(sent.length, 1, '⑤ 미발송 1건만 발송: ' + out);
assert.strictEqual(sent[0].to, 'a@x.com,c@z.com', '⑤ 두 주소 수신: ' + sent[0].to);
assert.ok(sent[0].body.includes('pwr-guide.online/appt2026'), '⑤ 가이드 링크 치환: ' + sent[0].body);
assert.ok(out.includes('치환 2곳') || out.includes('치환 1곳'), '⑤ 치환 보고: ' + out);
assert.ok(get('app/mailTemplates/custom_tmp_s2guide') === null || get('app/mailTemplates/custom_tmp_s2guide') === undefined, '⑤ 임시 템플릿 삭제됨');
assert.ok(get('app/mailLogs/d1_s2_reminder'), '⑤ 발송 도장 기록');

console.log('✅ second-guest-email 5/5 통과');
