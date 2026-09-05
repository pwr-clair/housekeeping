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

console.log('✅ second-guest-email 4/4 통과');
