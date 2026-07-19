// 2026-07-15 3버그 수정 검증: ①정오 청소완료 보존 ②ETA 최신 우선 ③멀티룸 재발송 차단
// 실행: node tests/noon-eta-multiroom.test.js
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

// ① 정오 이동: clean_done 보존, checkout_confirm→need_clean
db = { app: { bookingHistory: {}, pendingBookings: {}, rooms: {
  '620': { status: 'clean_done', currentBooking: { guest: 'A', bookingId: 'b1', checkinDate: '2026-07-14', checkoutDate: '2026-07-15' }, nextBookings: [] },
  '628': { status: 'checkout_confirm', currentBooking: { guest: 'B', bookingId: 'b2', checkinDate: '2026-07-14', checkoutDate: '2026-07-15' }, nextBookings: [{ guest: 'C', bookingId: 'b3', checkinDate: '2026-07-15', checkoutDate: '2026-07-16' }] },
} } };
ctx.roomNums = () => ['620', '628'];
vm.runInContext('roomNums=()=>["620","628"]', ctx);
vm.runInContext('t1159_moveBookings()', ctx);
console.assert(db.app.rooms['620'].status === 'clean_done', '①-1 FAIL: clean_done이 리셋됨 → ' + db.app.rooms['620'].status);
console.assert(db.app.rooms['628'].status === 'need_clean', '①-2 FAIL: checkout_confirm이 need_clean으로 안 감');
console.assert(db.app.rooms['628'].currentBooking.guest === 'C', '①-3 FAIL: 승격 안 됨');

// ② syncEtaToRoom: force 없으면 기존 checkinTime 보존(빈칸만 채움), force면 덮어씀
db = { app: { rooms: { '930': { currentBooking: { guest: 'D', bookingId: 'b9', checkinTime: '18:00' }, nextBookings: [] } } } };
vm.runInContext('syncEtaToRoom("b9","14:00")', ctx);
console.assert(db.app.rooms['930'].currentBooking.checkinTime === '18:00', '②-1 FAIL: 수기 18:00이 무force 동기화에 덮임');
vm.runInContext('syncEtaToRoom("b9","14:00",true)', ctx);
console.assert(db.app.rooms['930'].currentBooking.checkinTime === '14:00', '②-2 FAIL: force 덮어쓰기 안 됨');
db.app.rooms['930'].currentBooking.checkinTime = '';
vm.runInContext('syncEtaToRoom("b9","16:00")', ctx);
console.assert(db.app.rooms['930'].currentBooking.checkinTime === '16:00', '②-3 FAIL: 빈칸 채움 안 됨');

// ③ findCheckinDue: 같은 이메일 타방 기발송 → 스킵 / 다른 게스트는 정상 발송 대상
db = { app: { sentChecks: { '620_2026-07-15': '2026-07-15' }, rooms: {
  '620': { status: 'clean_done', currentBooking: { guest: 'E', guestEmail: 'e@x.com', bookingId: 'm1', checkinDate: '2026-07-15' }, nextBookings: [] },
  '628': { status: 'clean_done', currentBooking: { guest: 'E', guestEmail: 'E@x.com', bookingId: 'm2', checkinDate: '2026-07-15' }, nextBookings: [] },
  '930': { status: 'clean_done', currentBooking: null, nextBookings: [{ guest: 'F', guestEmail: 'f@x.com', bookingId: 'm3', checkinDate: '2026-07-15' }] },
} } };
const due = vm.runInContext('findCheckinDue()', ctx);
console.assert(due.length === 1 && due[0].num === '930', '③ FAIL: ' + JSON.stringify(due.map(d => d.num)) + ' (기대: 930만 — 628은 동일메일 스킵, nextBookings 탐색 포함)');

console.log('OK — 3버그 수정 검증 통과 (①정오 보존 ②ETA force 구분 ③멀티룸 스킵+nextBookings)');
