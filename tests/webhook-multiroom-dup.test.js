// 2026-09-20 클라라 신고: 배정탭 미배정에 같은 예약이 몇 개씩 복제됨.
// 원인 = doPost 멀티룸 분기가 방별 카드 키를 targetKey(=foundKey) 기준으로 만들던 것.
// 재푸시 때 foundKey가 이미 만들어진 방별 카드(sv_123_501)로 잡혀 sv_123_501_501이 새로 생겼다.
// 실행: node tests/webhook-multiroom-dup.test.js
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
vm.runInContext(`fbGet=p=>__get(p);fbSet=(p,v)=>__set(p,v);fbUpdate=(p,v)=>{const c=__get(p)||{};__set(p,{...c,...v})};fbDelete=p=>__set(p,null);todayKST=()=>'2026-09-20';nowHM=()=>'10:00';syncEtaToRoom=()=>{};`, ctx);
ctx.__get = get; ctx.__set = setD;

const post = (payload) => vm.runInContext('doPost', ctx)({ postData: { contents: JSON.stringify(payload) } });
const keys = () => Object.keys(get('app/pendingBookings') || {}).sort();

const multi = (eta) => ({
  bookingId: 123, channelBookingId: 'CH-999', bookingSource: 'booking.com',
  guest: { lastName: 'KIM', firstName: 'A', email: 'kim@x.com' },
  arrivalDate: '2026-09-25', departureDate: '2026-09-27', eta: eta || '',
  rooms: [{ RoomName: '501' }, { RoomName: '502' }],
});

// ── 멀티룸 재푸시가 카드를 복제하지 않는다 ──
db = { app: { pendingBookings: {} } };
post(multi());
assert.deepStrictEqual(keys(), ['sv_123_501', 'sv_123_502'], '첫 푸시 — 방별 카드 2장');
post(multi());
assert.deepStrictEqual(keys(), ['sv_123_501', 'sv_123_502'], '재푸시 — 같은 키를 덮어씀(복제 없음)');
post(multi('16:00'));
assert.deepStrictEqual(keys(), ['sv_123_501', 'sv_123_502'], 'ETA 변경 재푸시도 복제 없음');

// 배정 상태는 재푸시에 보존
setD('app/pendingBookings/sv_123_501/assignedRoom', '501');
post(multi('17:00'));
assert.deepStrictEqual(keys(), ['sv_123_501', 'sv_123_502'], '배정 후 재푸시도 복제 없음');
assert.strictEqual(get('app/pendingBookings/sv_123_501/assignedRoom'), '501', '배정된 방 보존');

// ── 1방 → 멀티룸 전환: 구 단일 카드는 방별 카드로 대체 ──
db = { app: { pendingBookings: {} } };
post({ bookingId: 123, channelBookingId: 'CH-999', guest: { lastName: 'KIM', firstName: 'A' }, arrivalDate: '2026-09-25', departureDate: '2026-09-27', rooms: [{ RoomName: '501' }] });
assert.deepStrictEqual(keys(), ['sv_123'], '단일 예약 — 카드 1장');
post(multi());
assert.deepStrictEqual(keys(), ['sv_123_501', 'sv_123_502'], '멀티룸 전환 — 구 단일 카드 삭제');

// ── 단일 예약 재푸시도 복제 없음(회귀) ──
db = { app: { pendingBookings: {} } };
const single = { bookingId: 777, channelBookingId: 'CH-777', guest: { lastName: 'LEE', firstName: 'B' }, arrivalDate: '2026-09-25', departureDate: '2026-09-26' };
post(single); post(single); post(single);
assert.deepStrictEqual(keys(), ['sv_777'], '단일 예약 재푸시 — 카드 1장 유지');

// ── 이미 쌓인 복제본 청소(cleanupDupePending) ──
const cleanup = () => vm.runInContext('cleanupDupePending', ctx)();
db = { app: { pendingBookings: {
  'sv_123_501':          { bookingId: '123_501', guest: 'KIM, A', assignedRoom: '501' },   // 원본(배정됨)
  'sv_123_502':          { bookingId: '123_502', guest: 'KIM, A', assignedRoom: '502' },   // 원본(배정됨)
  'sv_123_501_501':      { bookingId: '123_501', guest: 'KIM, A', assignedRoom: null },    // 복제본
  'sv_123_501_502':      { bookingId: '123_502', guest: 'KIM, A', assignedRoom: null },    // 복제본
  'sv_123_501_501_501':  { bookingId: '123_501', guest: 'KIM, A', assignedRoom: null },    // 3세대 복제본
  'sv_777':              { bookingId: '777', guest: 'LEE, B', assignedRoom: null },        // 단일 예약 — 손대면 안 됨
  'sv_888_601':          { bookingId: '888_601', guest: 'PARK, C', assignedRoom: null },   // 멀티룸 원본 — 손대면 안 됨
} } };
cleanup();
assert.deepStrictEqual(keys(), ['sv_123_501', 'sv_123_502', 'sv_777', 'sv_888_601'], '복제본만 지우고 원본은 남긴다');

// 배정된 복제본: 배정 표시를 정본 카드로 옮기고 복제본은 삭제 (26222 ohtani 건)
db = { app: { pendingBookings: {
  'sv_123_501':     { bookingId: '123_501', guest: 'KIM, A', assignedRoom: '501' },
  'sv_123_502':     { bookingId: '123_502', guest: 'KIM, A', assignedRoom: null },    // 정본 — 미배정으로 남아 있음
  'sv_123_501_502': { bookingId: '123_502', guest: 'KIM, A', assignedRoom: '602' },   // 복제본인데 배정돼 있음
} } };
cleanup();
assert.deepStrictEqual(keys(), ['sv_123_501', 'sv_123_502'], '복제본 삭제');
assert.strictEqual(get('app/pendingBookings/sv_123_502/assignedRoom'), '602', '배정이 정본 카드로 이관됨');

// 정본 카드가 아예 없으면 복제본을 정본 키로 옮긴다
db = { app: { pendingBookings: {
  'sv_123_501':     { bookingId: '123_501', guest: 'KIM, A', assignedRoom: '501' },
  'sv_123_501_502': { bookingId: '123_502', guest: 'KIM, A', assignedRoom: '602', eta: '15:00' },
} } };
cleanup();
assert.deepStrictEqual(keys(), ['sv_123_501', 'sv_123_502'], '정본 키로 이사');
assert.strictEqual(get('app/pendingBookings/sv_123_502/eta'), '15:00', '내용 보존');

// 정본과 복제본이 서로 다른 방에 배정돼 있으면 건드리지 않고 보고만
db = { app: { pendingBookings: {
  'sv_123_501':     { bookingId: '123_501', guest: 'KIM, A', assignedRoom: '501' },
  'sv_123_502':     { bookingId: '123_502', guest: 'KIM, A', assignedRoom: '502' },
  'sv_123_501_502': { bookingId: '123_502', guest: 'KIM, A', assignedRoom: '602' },
} } };
const rpt = cleanup();
assert.deepStrictEqual(keys(), ['sv_123_501', 'sv_123_501_502', 'sv_123_502'], '판단이 갈리면 보류');
assert.match(rpt, /보류\(정본 sv_123_502은 502호인데 복제본은 602호/, '보류 사유가 로그에 남는다');

// 청소는 멱등 — 두 번 돌려도 같은 결과
const before = keys();
cleanup();
assert.deepStrictEqual(keys(), before, '두 번 실행해도 동일');

console.log('✅ webhook-multiroom-dup: 전 항목 통과');
