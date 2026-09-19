// 2026-09-19 턴오버 자가 복구 검증: 1031에서 fbSet이 'Address unavailable'로 죽어도 뒷방은 넘어가고, 다음 틱에 1031도 복구. 복구(keepStatus)는 상태 유지.
// 실행: node tests/turnover-selfheal.test.js
const fs = require('fs'), path = require('path'), vm = require('vm');
const src = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.gs'), 'utf8');

// GAS 전역 스텁 + 인메모리 Firebase
let db = {};
const get = (p) => p.split('/').reduce((o, k) => (o == null ? o : o[k]), db) ?? null;
const setD = (p, v) => { const ks = p.split('/'), last = ks.pop(); let o = db; for (const k of ks) o = o[k] = o[k] || {}; if (v === null) delete o[last]; else o[last] = v; };
const ctx = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'x' }) },
  UrlFetchApp: { fetch: () => ({ getContentText: () => 'null' }) },
  Utilities: { formatDate: (d, tz, fmt) => fmt === 'HH' ? '15' : '00' }, // 15:00 고정(발송창 내)
  ScriptApp: { newTrigger: () => ({ timeBased: () => ({ atHour: () => ({ nearMinute: () => ({ everyDays: () => ({ create: () => {} }) }) }), everyMinutes: () => ({ create: () => {} }) }) }), getService: () => ({ getUrl: () => '' }), getProjectTriggers: () => [] },
  GmailApp: { sendEmail: () => {} }, Session: {}, Logger: { log: () => {} },
  ContentService: { createTextOutput: (t) => t }, console,
};
vm.createContext(ctx);
vm.runInContext(src, ctx);
// fb 4함수·날짜만 스텁으로 교체
vm.runInContext(`fbGet=p=>__get(p);fbSet=(p,v)=>__set(p,v);fbUpdate=(p,v)=>{const c=__get(p)||{};__set(p,{...c,...v})};fbDelete=p=>__set(p,null);todayKST=()=>'2026-07-15';kstDate=n=>n===-7?'2026-07-08':'2026-07-12';nowHM=()=>'15:00';`, ctx);
ctx.__get = get; ctx.__set = setD;


const assert = require('assert');
const bk = (g, ci, co) => ({ guest: g, bookingId: g, checkinDate: ci, checkoutDate: co });
db = { app: { bookingHistory: {}, pendingBookings: {}, rooms: {
  '1031': { status: 'checkout_done', currentBooking: bk('old1', '2026-07-14', '2026-07-15'), nextBookings: [bk('new1', '2026-07-15', '2026-07-16')] },
  '1240': { status: 'checkout_done', currentBooking: bk('old2', '2026-07-14', '2026-07-15'), nextBookings: [bk('new2', '2026-07-15', '2026-07-16')] },
} } };
vm.runInContext('roomNums=()=>["1031","1240"]', ctx);
// 11:59 트리거: 1031 이력 쓰기에서 예외
vm.runInContext(`__origSet=fbSet;fbSet=(p,v)=>{if(p.includes('_1031_'))throw new Error('Address unavailable');__origSet(p,v)}`, ctx);
vm.runInContext('t1159_moveBookings()', ctx);
assert.strictEqual(get('app/rooms/1240/currentBooking/guest'), 'new2', '앞방 오류가 뒷방을 막으면 안 됨');
assert.strictEqual(get('app/rooms/1240/status'), 'need_clean');
assert.strictEqual(get('app/rooms/1031/currentBooking/guest'), 'old1');
// 다음 틱 복구: 오류 해소 → 1031 승격, 상태 유지
vm.runInContext('fbSet=__origSet;rotateDueBookings_(true)', ctx);
assert.strictEqual(get('app/rooms/1031/currentBooking/guest'), 'new1');
assert.strictEqual(get('app/rooms/1031/status'), 'checkout_done', '복구는 상태 유지');
// 멱등: 한 번 더 돌려도 그대로
vm.runInContext('rotateDueBookings_(true)', ctx);
assert.strictEqual(get('app/rooms/1240/currentBooking/guest'), 'new2');
assert.strictEqual(Object.keys(get('app/bookingHistory')).length, 2);
console.log('OK turnover-selfheal');
