// 2026-09-21: 21시 자동 입실중 전환(autoCheckinTick) 폐지가 main에 남아있는지 지키는 테스트.
// 이 폐지는 004e586(옆 브랜치)에만 있어 main 전문 배포 때마다 되살아났다 — 같은 사고 3번째.
// 실행: node tests/auto-checkin-abolished.test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.gs'), 'utf8');

let db = {};
const get = (p) => p.split('/').reduce((o, k) => (o == null ? o : o[k]), db) ?? null;
const setD = (p, v) => { const ks = p.split('/'), last = ks.pop(); let o = db; for (const k of ks) o = o[k] = o[k] || {}; if (v === null) delete o[last]; else o[last] = v; };
const ctx = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'x' }) },
  UrlFetchApp: { fetch: () => ({ getContentText: () => 'null' }) },
  Utilities: { formatDate: () => '00' },
  ScriptApp: { newTrigger: () => ({ timeBased: () => ({ atHour: () => ({ nearMinute: () => ({ everyDays: () => ({ create: () => {} }) }) }), everyMinutes: () => ({ create: () => {} }), everyHours: () => ({ create: () => {} }) }) }), getService: () => ({ getUrl: () => '' }), getProjectTriggers: () => [] },
  GmailApp: { sendEmail: () => {} }, Session: {}, Logger: { log: () => {} },
  ContentService: { createTextOutput: (t) => t }, console,
};
vm.createContext(ctx);
vm.runInContext(src, ctx);
vm.runInContext(`fbGet=p=>__get(p);fbSet=(p,v)=>__set(p,v);fbUpdate=(p,v)=>{const c=__get(p)||{};__set(p,{...c,...v})};fbDelete=p=>__set(p,null);todayKST=()=>'2026-09-21';nowMinKST=()=>1300;`, ctx);
ctx.__get = get; ctx.__set = setD;

const room = (st) => ({ status: st, currentBooking: { guest: 'KIM', checkinDate: '2026-09-21' } });
const fresh = () => {
  db = { app: {
    rooms: { '501': room('clean_done'), '502': room('checkin'), '601': room('need_clean') },
    sentChecks: { '501_2026-09-21': '2026-09-21', '502_2026-09-21': '2026-09-21', '601_2026-09-21': '2026-09-21' },
  } };
};

// ── autoCheckinTick은 아무 것도 하지 않아야 한다 ──
fresh();
vm.runInContext('autoCheckinTick()', ctx);
assert.strictEqual(get('app/rooms/501/status'), 'clean_done', '21시 이후에도 청소완료가 입실중으로 바뀌면 안 된다');
assert.strictEqual(get('app/rooms/502/status'), 'checkin', '다른 방 상태도 건드리지 않는다');
assert.strictEqual(get('app/rooms/601/status'), 'need_clean', '청소필요도 그대로');

// 소스에 트리거 등록이 남아 있으면 안 된다
assert.ok(!/newTrigger\('autoCheckinTick'\)/.test(src), 'setupTriggers에 autoCheckinTick 트리거가 다시 들어갔다');

// ── revertAutoCheckin: 자동 전환된 방을 되돌린다 ──
fresh();
vm.runInContext('revertAutoCheckin()', ctx);
assert.strictEqual(get('app/rooms/502/status'), 'clean_done', '입실중이던 방을 청소완료로 되돌린다');
assert.strictEqual(get('app/rooms/501/status'), 'clean_done', '원래 청소완료인 방은 그대로');
assert.strictEqual(get('app/rooms/601/status'), 'need_clean', '입실중이 아니면 손대지 않는다');

// 입실안내 미발송 방은 되돌리지 않는다 (자동 전환 대상이 아니었으므로)
fresh(); setD('app/sentChecks/502_2026-09-21', null);
vm.runInContext('revertAutoCheckin()', ctx);
assert.strictEqual(get('app/rooms/502/status'), 'checkin', '입실안내가 안 나간 방은 사람이 바꾼 것 — 건드리지 않는다');

// 정비중 방 제외
fresh(); setD('app/rooms/502/blocked', true);
vm.runInContext('revertAutoCheckin()', ctx);
assert.strictEqual(get('app/rooms/502/status'), 'checkin', '정비중 방은 제외');

console.log('✅ auto-checkin-abolished: 전 항목 통과');
