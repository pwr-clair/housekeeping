// 2026-09-19 복구 검증: 딜레이 메시지(latePrepTick_) + 입실안내 얼리 발송(checkinDueNow)
// 8/24~8/28 작업이 옆 브랜치에만 남아 main 전문 배포 때 유실됐던 건의 회귀 방지.
// 실행: node tests/late-prep-early-send.test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.gs'), 'utf8');

let db = {}, mails = [];
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
vm.runInContext(`fbGet=p=>__get(p);fbSet=(p,v)=>__set(p,v);fbUpdate=(p,v)=>{const c=__get(p)||{};__set(p,{...c,...v})};fbDelete=p=>__set(p,null);todayKST=()=>'2026-09-19';sendMail=(to,s,b)=>{__mails.push({to,s,b});};`, ctx);
ctx.__get = get; ctx.__set = setD; ctx.__mails = mails;

const at = (min) => vm.runInContext(`nowMinKST=()=>${min};`, ctx);
const due = (eta, nowMin) => {           // checkinDueNow는 Utilities로 현재분을 읽는다 → 스텁 교체
  ctx.Utilities.formatDate = (d, tz, f) => f === 'HH' ? String(Math.floor(nowMin / 60)).padStart(2, '0') : String(nowMin % 60).padStart(2, '0');
  return vm.runInContext('checkinDueNow', ctx)({ checkinTime: eta });
};

// ── 얼리 발송 ────────────────────────────────────────────
assert.strictEqual(due('', 869), false, 'ETA 없음 14:29 — 아직');
assert.strictEqual(due('', 870), true, 'ETA 없음 14:30 — 기본창');
assert.strictEqual(due('13:00', 720), true, 'ETA 13:00 → 12:00부터 발송');
assert.strictEqual(due('13:00', 719), false, 'ETA 13:00 — 11:59엔 금지');
assert.strictEqual(due('12:30', 719), false, '정오 이전으로는 절대 안 내려감');
assert.strictEqual(due('18:00', 870), true, 'ETA 늦어도 기본창(14:30)보다 늦춰지지 않음');
assert.strictEqual(due('02:00', 720), false, '새벽 ETA는 얼리 아님 — 12:00 발송 금지');
assert.strictEqual(due('02:00', 870), true, '새벽 ETA는 기본창 유지');

// ── 딜레이 메시지 ────────────────────────────────────────
const room = (guest, email, notes) => ({ currentBooking: { guest, guestEmail: email, notes: notes || '', checkinDate: '2026-09-19' } });
const reset = (tplName) => {
  db = { app: { rooms: { '501': room('KIM', 'kim@x.com') }, sentChecks: {}, mailTemplates: {}, mailLogs: {} } };
  if (tplName) setD('app/mailTemplates/custom_1', { name: tplName, subject: '{room}호 준비 지연', bodyKo: '{guest}님 {room}호 준비가 늦어집니다' });
  mails.length = 0;
};
const tick = () => vm.runInContext('latePrepTick_()', ctx);

reset('늦은 객실준비 안내'); at(909); tick();
assert.strictEqual(mails.length, 0, '15:09 — 창 이전엔 발송 안 함');

reset('늦은 객실준비 안내'); at(1080); tick();
assert.strictEqual(mails.length, 0, '18:00 — 창 종료 후엔 발송 안 함');

reset('늦은 객실준비 안내'); at(910); tick();
assert.strictEqual(mails.length, 1, '15:10 — 미발송 방 게스트에게 발송');
assert.match(mails[0].b, /KIM님 501호/, '치환 확인');
tick();
assert.strictEqual(mails.length, 1, '같은 게스트 하루 1회 — 다음 틱은 스킵');

reset('늦은 객실준비 안내'); setD('app/sentChecks/501_2026-09-19', '2026-09-19'); at(910); tick();
assert.strictEqual(mails.length, 0, '입실안내 이미 나간 방은 대상 아님');

reset(null); at(910); tick();
assert.strictEqual(mails.length, 0, "이름에 '늦은' 든 템플릿 없으면 조용히 스킵");

// 멀티룸 = 한 통, 이메일 칸이 비어도 특이사항 주소로 (guestRecipients_ 규약)
reset('늦은 객실준비 안내');
setD('app/rooms/502', room('KIM', 'kim@x.com'));
setD('app/rooms/601', room('LEE', '', '연락처 lee@y.com'));
at(910); tick();
assert.strictEqual(mails.length, 2, '게스트 2명 = 2통 (KIM은 멀티룸 1통)');
assert.match(mails.find(m => /KIM/.test(m.b)).b, /501, 502호/, '멀티룸 방번호 묶음');
assert.strictEqual(mails.find(m => m.to === 'lee@y.com').to, 'lee@y.com', '특이사항 속 주소로 발송');

// 차단(blocked) 방은 제외
reset('늦은 객실준비 안내'); setD('app/rooms/501/blocked', true); at(910); tick();
assert.strictEqual(mails.length, 0, '정비중 방은 대상 아님');

console.log('✅ late-prep-early-send: 전 항목 통과');
