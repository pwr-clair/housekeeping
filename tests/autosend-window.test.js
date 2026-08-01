// 2026-07-29 방문고지 미발송 사고 검증: 발송창=시각~+2h + 하루 1회 도장, 부수작업 예외가 발송을 안 죽임
// 실행: node tests/autosend-window.test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.gs'), 'utf8');

let db = {};
const get = (p) => p.split('/').reduce((o, k) => (o == null ? o : o[k]), db) ?? null;
const setD = (p, v) => { const ks = p.split('/'), last = ks.pop(); let o = db; for (const k of ks) o = o[k] = o[k] || {}; if (v === null) delete o[last]; else o[last] = v; };
const ctx = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'x' }) },
  UrlFetchApp: { fetch: () => ({ getContentText: () => 'null' }) },
  Utilities: { formatDate: () => '00' },
  ScriptApp: { newTrigger: () => ({ timeBased: () => ({ atHour: () => ({ nearMinute: () => ({ everyDays: () => ({ create: () => {} }) }) }), everyMinutes: () => ({ create: () => {} }) }) }), getService: () => ({ getUrl: () => '' }), getProjectTriggers: () => [] },
  GmailApp: { sendEmail: () => {} }, Session: {}, Logger: { log: () => {} },
  ContentService: { createTextOutput: (t) => t }, console,
};
vm.createContext(ctx);
vm.runInContext(src, ctx);
vm.runInContext(`fbGet=p=>__get(p);fbSet=(p,v)=>__set(p,v);fbUpdate=(p,v)=>{const c=__get(p)||{};__set(p,{...c,...v})};fbDelete=p=>__set(p,null);todayKST=()=>'2026-07-29';`, ctx);
ctx.__get = get; ctx.__set = setD;

const auto = { s5_checkoutConfirm: { time: '10:00' } };   // 클라라 설정 10:00 = 600분
const win = (min) => vm.runInContext('autoSendWin_', ctx)(auto, 's5_checkoutConfirm', min);

// ① 트리거가 밀려 10:11에 처음 돌아도 잡는다 (구 10분 창이면 놓쳤던 케이스 = 이번 사고)
db = {};
assert.strictEqual(win(671), true, '10:11 첫 틱 — 밀려도 발송해야 함');

// ② 오늘 도장이 찍혀 있으면 다음 틱은 안 돈다 (중복 발송 방지)
setD('app/autoSend/lastRun/s5_checkoutConfirm', '2026-07-29');
assert.strictEqual(win(676), false, '같은 날 재실행 금지');

// ③ 설정 시각 전에는 안 돈다
db = {};
assert.strictEqual(win(599), false, '09:59 — 아직 이름');

// ④ +2시간 넘으면 뒷북 발송 안 한다
db = {};
assert.strictEqual(win(721), false, '12:01 — 상한 초과');

// ⑤ 시각 미설정이면 코드 기본값(s5=11:05=665) 사용
db = {};
assert.strictEqual(vm.runInContext('autoSendWin_', ctx)({}, 's5_checkoutConfirm', 665), true, '기본 11:05');

// ⑥ syncAmounts가 던져도 발송은 살아있다 + 빈 제목 템플릿(본문만)도 자동발송된다 (2026-08-02 실사고)
//    — 제목 필수 가드가 방문고지(무제목 운영)를 조용히 skip해 매일 0건이 되던 구조 검증
db = { app: {
  mailConfig: { auto: {}, stages: { s5_checkoutConfirm: true }, sources: { booking: true } },
  mailTemplates: { s5_checkoutConfirm: { subject: '', bodyKo: '방문고지 본문' } },
  rooms: {}, config: { sendMode: 'manual' },
  pendingBookings: { sv_1: { bookingId: '1', guest: 'Kim', guestEmail: 'g@x.com', source: 'booking.com', checkinDate: '2026-07-27', checkoutDate: '2026-07-29' } },
} };
let mails = [];
ctx.GmailApp.sendEmail = (...a) => { mails.push(a); };
vm.runInContext(`syncAmounts=()=>{throw new Error('Gmail 일시 오류')};nowMinKST=()=>665;`, ctx);
vm.runInContext('masterTick()', ctx);   // syncAmounts가 던지면 여기서 테스트가 깨진다
assert.strictEqual(mails.length, 1, '빈 제목 템플릿도 1통 발송돼야 함');
assert.strictEqual(mails[0][1], '', '제목은 빈 그대로 (OTA 채팅 헤더 방지)');
assert.strictEqual(get('app/autoSend/lastRun/s5_checkoutConfirm'), '2026-07-29', '발송 성공 뒤 도장');

// ⑦ 발송이 죽으면 도장을 찍지 않는다 → 다음 틱이 재시도 (2026-08-01: 도장만 남고 발송이 날아가던 구조)
db = {};
let calls = 0;
const boom = () => { calls++; throw new Error('Firebase 일시 오류'); };
vm.runInContext('runAuto_', ctx)(auto, 's5_checkoutConfirm', 671, boom);
assert.strictEqual(get('app/autoSend/lastRun/s5_checkoutConfirm'), null, '실패했으면 도장 없어야 함');
vm.runInContext('runAuto_', ctx)(auto, 's5_checkoutConfirm', 676, boom);
assert.strictEqual(calls, 2, '다음 틱이 재시도해야 함');

// ⑧ 1건 이상 발송하면 도장이 찍히고 같은 날 재실행은 막힌다
vm.runInContext('runAuto_', ctx)(auto, 's5_checkoutConfirm', 681, () => { calls++; return 1; });
assert.strictEqual(get('app/autoSend/lastRun/s5_checkoutConfirm'), '2026-07-29', '성공 뒤 도장');
vm.runInContext('runAuto_', ctx)(auto, 's5_checkoutConfirm', 686, () => { calls++; return 1; });
assert.strictEqual(calls, 3, '도장 뒤엔 재실행 안 함');

// ⑨ 0건 발송이면 도장을 안 찍는다 → 다음 틱이 창 안에서 재시도 (2026-08-02: 조용한 skip이 도장으로 그날 발송을 지우던 구조)
db = {};
vm.runInContext('runAuto_', ctx)(auto, 's5_checkoutConfirm', 671, () => { calls++; return 0; });
assert.strictEqual(get('app/autoSend/lastRun/s5_checkoutConfirm'), null, '0건이면 도장 없어야 함');
vm.runInContext('runAuto_', ctx)(auto, 's5_checkoutConfirm', 676, () => { calls++; return 0; });
assert.strictEqual(calls, 5, '0건 뒤에도 다음 틱이 재시도해야 함');

// ⑩ 본문이 아예 없는 템플릿은 발송 skip → 0건 = 도장도 없음 (checkAutoSend가 사유를 짚어준다)
db = { app: {
  mailConfig: { auto: {}, stages: { s5_checkoutConfirm: true }, sources: { booking: true } },
  mailTemplates: { s5_checkoutConfirm: { subject: '제목만 있음' } },
  rooms: {}, config: { sendMode: 'manual' },
  pendingBookings: { sv_1: { bookingId: '1', guest: 'Kim', guestEmail: 'g@x.com', source: 'booking.com', checkinDate: '2026-07-27', checkoutDate: '2026-07-29' } },
} };
mails = [];
vm.runInContext('masterTick()', ctx);
assert.strictEqual(mails.length, 0, '본문 없는 템플릿은 발송 안 함');
assert.strictEqual(get('app/autoSend/lastRun/s5_checkoutConfirm'), null, 'skip으로 0건이면 도장 없어야 함');

console.log('OK — 10항목 통과');
