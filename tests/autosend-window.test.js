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

// ② 같은 날 다음 틱은 도장 때문에 안 돈다 (중복 발송 방지)
assert.strictEqual(win(676), false, '같은 날 재실행 금지');
assert.strictEqual(get('app/autoSend/lastRun/s5_checkoutConfirm'), '2026-07-29');

// ③ 설정 시각 전에는 안 돈다
db = {};
assert.strictEqual(win(599), false, '09:59 — 아직 이름');

// ④ +2시간 넘으면 뒷북 발송 안 한다
db = {};
assert.strictEqual(win(721), false, '12:01 — 상한 초과');

// ⑤ 시각 미설정이면 코드 기본값(s5=11:05=665) 사용
db = {};
assert.strictEqual(vm.runInContext('autoSendWin_', ctx)({}, 's5_checkoutConfirm', 665), true, '기본 11:05');

// ⑥ syncAmounts가 던져도 그 틱의 자동발송이 살아있다
db = { app: { mailConfig: { auto: {} }, rooms: {}, pendingBookings: {}, config: { sendMode: 'manual' } } };
vm.runInContext(`syncAmounts=()=>{throw new Error('Gmail 일시 오류')};nowMinKST=()=>665;`, ctx);
vm.runInContext('masterTick()', ctx);   // 던지면 여기서 테스트가 깨진다
assert.strictEqual(get('app/autoSend/lastRun/s5_checkoutConfirm'), '2026-07-29', '부수작업 예외에도 발송 로직 도달');

console.log('OK — 6항목 통과');
