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
console.assert(due.length === 1 && due[0].nums.join() === '930', '③ FAIL: ' + JSON.stringify(due.map(d => d.nums)) + ' (기대: 930만 — 628은 동일메일 기발송 그룹 스킵, nextBookings 탐색 포함)');

// ④ 몰아보내기: 전부 청소완료 대기 → 완료 시 1그룹으로 발송, Room Access 블록 방 수만큼 반복
db = { app: { sentChecks: {}, rooms: {
  '620': { status: 'clean_done', doorPw: '#4041*', currentBooking: { guest: 'G', guestEmail: 'g@x.com', bookingId: 'q1', checkinDate: '2026-07-15', checkoutDate: '2026-07-17' }, nextBookings: [] },
  '628': { status: 'cleaning',   doorPw: '#4042*', currentBooking: { guest: 'G', guestEmail: 'g@x.com', bookingId: 'q2', checkinDate: '2026-07-15', checkoutDate: '2026-07-17' }, nextBookings: [] },
} } };
let d2 = vm.runInContext('findCheckinDue()', ctx);
console.assert(d2.length === 0, '④-1 FAIL: 한 방 청소중인데 발송 대상에 나옴 (전부 완료 대기 위반)');
db.app.rooms['628'].status = 'clean_done';
d2 = vm.runInContext('findCheckinDue()', ctx);
console.assert(d2.length === 1 && d2[0].nums.join() === '620,628', '④-2 FAIL: 그룹 1건이어야 함 → ' + JSON.stringify(d2.map(x => x.nums)));

// ⑤ fillTpl_: 클라라 확정 레이아웃 — ▶ Room Access 문단이 방별 반복, ※문단은 1회
const tplBody = 'Hello {guest},\n\n▶ Room Access\n- Room: {floor}F, Room No. {room}\n- Passcode: {doorPw}\n\n※ Once you\'re in, please send us a \'Check-in complete\' message.';
const out = vm.runInContext(`fillTpl_(${JSON.stringify(tplBody)},{guest:'G'},['620','628'],{'620':{doorPw:'#4041*'},'628':{doorPw:'#4042*'}})`, ctx);
const want = 'Hello G,\n\n▶ Room Access\n- Room: 6F, Room No. 620\n- Passcode: #4041*\n\n▶ Room Access\n- Room: 6F, Room No. 628\n- Passcode: #4042*\n\n※ Once you\'re in, please send us a \'Check-in complete\' message.';
console.assert(out === want, '⑤ FAIL: 레이아웃 불일치\n--- got ---\n' + out + '\n--- want ---\n' + want);
// 단일방은 기존과 동일해야 함
const one = vm.runInContext(`fillTpl_(${JSON.stringify(tplBody)},{guest:'G'},['620'],{'620':{doorPw:'#4041*'}})`, ctx);
console.assert(one.includes('Room No. 620') && !one.includes('628') && one.split('▶').length === 2, '⑤-2 FAIL: 단일방 동작 변화');

// ⑥ 수동 sendRoom: 같은 게스트 타방 기발송 → 차단 / 미발송이면 그룹 1통+전방 마크
db = { app: { sentChecks: { '620_2026-07-15': '2026-07-15' }, mailLogs: {}, mailConfig: { stages: { s3_checkin: true }, sources: { direct: true } }, mailTemplates: { s3_checkin: { subject: 'Room {room}', bodyEn: tplBody } }, rooms: {
  '620': { status: 'clean_done', doorPw: '#4041*', currentBooking: { guest: 'H', guestEmail: 'h@x.com', bookingId: 'w1', checkinDate: '2026-07-15', checkoutDate: '2026-07-17' }, nextBookings: [] },
  '628': { status: 'clean_done', doorPw: '#4042*', currentBooking: { guest: 'H', guestEmail: 'h@x.com', bookingId: 'w2', checkinDate: '2026-07-15', checkoutDate: '2026-07-17' }, nextBookings: [] },
} } };
const blocked = vm.runInContext('doGet({parameter:{token:"x",action:"sendRoom",room:"628"}})', ctx);
console.assert(String(blocked).includes('이미 발송됨'), '⑥-1 FAIL: 타방 기발송인데 수동 발송이 살아있음 → ' + blocked);
delete db.app.sentChecks['620_2026-07-15'];
const sentMails = []; vm.runInContext('sendMail=(to,s,b)=>__mail(to,s,b)', ctx); ctx.__mail = (to, s, b) => sentMails.push({ to, s, b });
const okSend = vm.runInContext('doGet({parameter:{token:"x",action:"sendRoom",room:"620"}})', ctx);
console.assert(sentMails.length === 1 && sentMails[0].b.includes('620') && sentMails[0].b.includes('628'), '⑥-2 FAIL: 그룹 1통이 아님 → ' + sentMails.length + '통');
console.assert(db.app.sentChecks['620_2026-07-15'] && db.app.sentChecks['628_2026-07-15'], '⑥-3 FAIL: 전방 마크 안 됨');

// ⑦ doPost 멀티룸 분할 시 구 단일 카드 삭제 (1방→2방 수정 replace, 2026-07-24 Sorokin 건)
db = { app: { pendingBookings: { sv_777: { bookingId: '777', guest: 'Maxim, Sorokin', checkinDate: '2026-08-06', checkoutDate: '2026-09-15' } }, rooms: {} } };
vm.runInContext(`doPost({postData:{contents:JSON.stringify({bookingId:'777',bookingSource:'frontdesk',guest:{lastName:'Maxim',firstName:'Sorokin',email:'s@x.com'},arrivalDate:'2026-08-06',departureDate:'2026-09-15',rooms:[{RoomName:'1037'},{RoomName:'1240'}]})}})`, ctx);
console.assert(!db.app.pendingBookings.sv_777, '⑦-1 FAIL: 구 단일 카드가 안 지워짐');
console.assert(db.app.pendingBookings.sv_777_1037 && db.app.pendingBookings.sv_777_1240, '⑦-2 FAIL: 방별 카드 미생성 → ' + Object.keys(db.app.pendingBookings));
// RoomName이 전부 비면(기록 실패) 구 카드 보존
db = { app: { pendingBookings: { sv_778: { bookingId: '778', guest: 'X' } }, rooms: {} } };
vm.runInContext(`doPost({postData:{contents:JSON.stringify({bookingId:'778',rooms:[{},{RoomName:''}]})}})`, ctx);
console.assert(db.app.pendingBookings.sv_778, '⑦-3 FAIL: 방별 기록 실패인데 구 카드 삭제됨');

console.log('OK — 전 항목 통과 (①정오 보존 ②ETA force ③기발송 그룹 스킵 ④전부완료 대기+그룹 ⑤클라라 레이아웃 ⑥수동 차단+그룹 1통 ⑦멀티룸 분할 시 구 카드 삭제)');
