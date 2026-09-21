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
vm.runInContext(`fbGet=p=>__get(p);fbSet=(p,v)=>__set(p,v);fbUpdate=(p,v)=>{const c=__get(p)||{};__set(p,{...c,...v})};fbDelete=p=>__set(p,null);todayKST=()=>'2026-09-21';nowHM=()=>'10:00';syncEtaToRoom=()=>{};`, ctx);
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

// ── 예약 수정으로 빠진 방의 카드는 정리된다 (26325·26230 유령 카드) ──
const multiRooms = (rooms, eta) => ({
  bookingId: 26325, channelBookingId: 'CH-325', bookingSource: 'booking.com',
  guest: { lastName: 'Bilinski', firstName: 'W', email: 'b@x.com' },
  arrivalDate: '2026-09-24', departureDate: '2026-09-25', eta: eta || '',
  rooms: rooms.map(r => ({ RoomName: r })),
});

db = { app: { pendingBookings: {} } };
post(multiRooms(['1236', '1240', '920']));
assert.deepStrictEqual(keys(), ['sv_26325_1236', 'sv_26325_1240', 'sv_26325_920'], '첫 푸시 — 방 3개');
post(multiRooms(['1236', '1240']));            // SIRVOY에서 920을 뺐다
assert.deepStrictEqual(keys(), ['sv_26325_1236', 'sv_26325_1240'], '빠진 방(920) 카드는 삭제된다');

// 배정된 카드는 지우지 않고 보존 (사람 판단 필요)
db = { app: { pendingBookings: {} } };
post(multiRooms(['1236', '1240', '920']));
setD('app/pendingBookings/sv_26325_920/assignedRoom', '628');
post(multiRooms(['1236', '1240']));
assert.deepStrictEqual(keys(), ['sv_26325_1236', 'sv_26325_1240', 'sv_26325_920'], '배정된 카드는 보존');
assert.strictEqual(get('app/pendingBookings/sv_26325_920/assignedRoom'), '628', '배정 표시 그대로');

// 멀티룸 → 1방으로 줄면 방별 카드는 전부 낡은 것
db = { app: { pendingBookings: {} } };
post(multiRooms(['1236', '1240']));
post(multiRooms(['1236']));                    // 1방짜리로 수정 → 단일 카드 경로
assert.deepStrictEqual(keys(), ['sv_26325'], '1방으로 줄면 단일 카드만 남는다');

// rooms 배열이 없는 푸시는 방별 카드를 건드리지 않는다 (수정 알림 등)
db = { app: { pendingBookings: {} } };
post(multiRooms(['1236', '1240']));
post({ bookingId: 26325, channelBookingId: 'CH-325', guest: { lastName: 'Bilinski', firstName: 'W' },
       arrivalDate: '2026-09-24', departureDate: '2026-09-25' });
assert.ok(keys().includes('sv_26325_1236') && keys().includes('sv_26325_1240'),
  'rooms 없는 푸시에 방별 카드를 지우면 안 된다');

// ── 이미 쌓인 복제본 청소(cleanupDupePending) ──
const cleanup = () => vm.runInContext('cleanupDupePending', ctx)();
const R = (bid) => ({ currentBooking: { bookingId: bid, guest: 'KIM, A' }, nextBookings: [] });

// 복제본만 지우고 원본은 남긴다 (3세대 복제본 포함)
db = { app: { rooms: {}, pendingBookings: {
  'sv_123_501':          { bookingId: '123_501', guest: 'KIM, A', assignedRoom: '501' },   // 원본
  'sv_123_502':          { bookingId: '123_502', guest: 'KIM, A', assignedRoom: '502' },   // 원본
  'sv_123_501_501':      { bookingId: '123_501', guest: 'KIM, A', assignedRoom: null },
  'sv_123_501_502':      { bookingId: '123_502', guest: 'KIM, A', assignedRoom: null },
  'sv_123_501_501_501':  { bookingId: '123_501', guest: 'KIM, A', assignedRoom: null },
  'sv_777':              { bookingId: '777', guest: 'LEE, B', assignedRoom: null },        // 단일 예약
  'sv_888_601':          { bookingId: '888_601', guest: 'PARK, C', assignedRoom: null },   // 멀티룸 원본
} } };
cleanup();
assert.deepStrictEqual(keys(), ['sv_123_501', 'sv_123_502', 'sv_777', 'sv_888_601'], '복제본만 지우고 원본은 남긴다');

// 배정된 복제본 + 방이 실제로 그 예약을 담고 있음 → 배정을 정본 카드로 이관
db = { app: { rooms: { '602': R('123_502') }, pendingBookings: {
  'sv_123_501':     { bookingId: '123_501', guest: 'KIM, A', assignedRoom: '501' },
  'sv_123_502':     { bookingId: '123_502', guest: 'KIM, A', assignedRoom: null },
  'sv_123_501_502': { bookingId: '123_502', guest: 'KIM, A', assignedRoom: '602' },
} } };
cleanup();
assert.deepStrictEqual(keys(), ['sv_123_501', 'sv_123_502'], '복제본 삭제');
assert.strictEqual(get('app/pendingBookings/sv_123_502/assignedRoom'), '602', '실제 방 기준으로 배정 이관');

// ★ 객실 모달에서 예약만 지운 경우 — 카드엔 '602호 배정'이 남아 있지만 방엔 예약이 없다.
//   이때 배정 표시를 그대로 옮기면 정본이 숨겨져 손님이 조용히 사라진다 → 미배정으로 되돌린다.
db = { app: { rooms: {}, pendingBookings: {
  'sv_123_501':     { bookingId: '123_501', guest: 'KIM, A', assignedRoom: '501' },
  'sv_123_502':     { bookingId: '123_502', guest: 'KIM, A', assignedRoom: null },
  'sv_123_501_502': { bookingId: '123_502', guest: 'KIM, A', assignedRoom: '602' },
} } };
const rpt2 = cleanup();
assert.deepStrictEqual(keys(), ['sv_123_501', 'sv_123_502'], '고아 복제본 삭제');
assert.strictEqual(get('app/pendingBookings/sv_123_502/assignedRoom'), null, '정본은 미배정으로 — 배정탭에 다시 떠야 함');
assert.match(rpt2, /미배정 복원/, '복원 사유가 로그에 남는다');

// 정본 카드가 아예 없으면 복제본을 정본 키로 옮긴다 (내용 보존)
db = { app: { rooms: {}, pendingBookings: {
  'sv_123_501':     { bookingId: '123_501', guest: 'KIM, A', assignedRoom: '501' },
  'sv_123_501_502': { bookingId: '123_502', guest: 'KIM, A', assignedRoom: '602', eta: '15:00' },
} } };
cleanup();
assert.deepStrictEqual(keys(), ['sv_123_501', 'sv_123_502'], '정본 키로 이사');
assert.strictEqual(get('app/pendingBookings/sv_123_502/eta'), '15:00', '내용 보존');
assert.strictEqual(get('app/pendingBookings/sv_123_502/assignedRoom'), null, '방에 없으니 미배정');

// 정본 배정과 실제 방이 어긋나면 건드리지 않고 보고만
db = { app: { rooms: { '602': R('123_502') }, pendingBookings: {
  'sv_123_501':     { bookingId: '123_501', guest: 'KIM, A', assignedRoom: '501' },
  'sv_123_502':     { bookingId: '123_502', guest: 'KIM, A', assignedRoom: '502' },
  'sv_123_501_502': { bookingId: '123_502', guest: 'KIM, A', assignedRoom: '602' },
} } };
const rpt = cleanup();
assert.deepStrictEqual(keys(), ['sv_123_501', 'sv_123_501_502', 'sv_123_502'], '판단이 갈리면 보류');
assert.match(rpt, /보류\(정본 sv_123_502은 502호인데 실제는 602호/, '보류 사유가 로그에 남는다');

// 청소는 멱등 — 두 번 돌려도 같은 결과
const before = keys();
cleanup();
assert.deepStrictEqual(keys(), before, '두 번 실행해도 동일');

// ── 진단(dumpPendingDupes)은 읽기만 한다 ──
db = { app: { rooms: {}, pendingBookings: {
  'sv_123_501':     { bookingId: '123_501', guest: 'KIM, A', assignedRoom: '930', checkoutDate: '2026-09-27' },
  'sv_123_501_502': { bookingId: '123_502', guest: 'KIM, A', assignedRoom: '937', checkoutDate: '2026-09-27' },
  'sv_999':         { bookingId: '999', guest: 'PAST, G', assignedRoom: '620', checkoutDate: '2026-09-18' },  // 퇴실 완료 — 고아 아님
} } };
const snap = JSON.stringify(db);
const d = vm.runInContext('dumpPendingDupes', ctx)();
assert.strictEqual(JSON.stringify(db), snap, '진단은 DB를 바꾸지 않는다');
assert.match(d, /고아 카드/, '고아 카드 항목을 보고한다');
assert.match(d, /sv_123_501 {2}배정표시=930호/, '고아 카드를 찾아낸다');
assert.ok(!/PAST, G/.test(d), '퇴실 완료분은 고아로 찍지 않는다');

// ── dumpUpcoming: 단일카드+방별카드 혼재를 잡아낸다 (읽기 전용) ──
const upcoming = () => vm.runInContext('dumpUpcoming', ctx)();
db = { app: { rooms: {}, pendingBookings: {
  'sv_26500_501': { bookingId: '26500_501', guest: 'A', assignedRoom: '501', checkinDate: '2026-09-24', checkoutDate: '2026-09-26' },
  'sv_26500_502': { bookingId: '26500_502', guest: 'A', assignedRoom: '502', checkinDate: '2026-09-24', checkoutDate: '2026-09-26' },
  'sv_26500':     { bookingId: '26500',     guest: 'A', assignedRoom: null,  checkinDate: '2026-09-24', checkoutDate: '2026-09-26' },  // 유령
  'sv_26600':     { bookingId: '26600',     guest: 'B', assignedRoom: '601', checkinDate: '2026-09-25', checkoutDate: '2026-09-26' },  // 정상 단일
  'sv_26400':     { bookingId: '26400',     guest: 'C', assignedRoom: '620', checkinDate: '2026-09-01', checkoutDate: '2026-09-02' },  // 과거 — 제외
} } };
const snap2 = JSON.stringify(db);
const u = upcoming();
assert.strictEqual(JSON.stringify(db), snap2, 'dumpUpcoming은 DB를 바꾸지 않는다');
assert.match(u, /예약 26500 — 카드 3장 \(단일 1 \/ 방별 2\).*혼재/, '혼재를 잡아낸다');
assert.ok(!/26400/.test(u), '오늘 이전 체크인은 제외');
assert.match(u, /예약 26600 — 카드 1장 \(단일 1 \/ 방별 0\)$/m, '정상 예약엔 경고 없음');
assert.match(u, /★ 이상한 예약 1건/, '이상 건수를 센다');

console.log('✅ webhook-multiroom-dup: 전 항목 통과');
