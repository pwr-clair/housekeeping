// 2026-09-18 클라라: 이메일 칸이 비어도 특이사항(notes)에 주소가 있으면 그리로 발송 (후지모토 26481·26483 건)
// 실행: node tests/notes-only-email.test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.gs'), 'utf8');
let db = {};
const get = (p) => p.split('/').reduce((o, k) => (o == null ? o : o[k]), db) ?? null;
const setD = (p, v) => { const ks = p.split('/'), last = ks.pop(); let o = db; for (const k of ks) o = o[k] = o[k] || {}; if (v === null) delete o[last]; else o[last] = v; };
const ctx = {
  PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'x' }) },
  UrlFetchApp: { fetch: () => ({ getContentText: () => 'null' }) },
  Utilities: { formatDate: () => '00' }, ScriptApp: { getService: () => ({ getUrl: () => '' }) },
  GmailApp: { sendEmail: () => {} }, Session: {}, Logger: { log: () => {} },
  ContentService: { createTextOutput: (t) => t }, console,
};
vm.createContext(ctx); vm.runInContext(src, ctx);
vm.runInContext(`fbGet=p=>__get(p);fbSet=(p,v)=>__set(p,v);fbUpdate=(p,v)=>{const c=__get(p)||{};__set(p,{...c,...v})};fbDelete=p=>__set(p,null);todayKST=()=>'2026-09-18';`, ctx);
ctx.__get = get; ctx.__set = setD;
const R = vm.runInContext('guestRecipients_', ctx);

// ① 특이사항에만 주소 → 그 주소
assert.strictEqual(R({ guestEmail: '', notes: 'ryoku.fujimoto@gmail.com' }), 'ryoku.fujimoto@gmail.com');
// ② 둘 다 → 합류(중복 제거, 대소문자 무시)
assert.strictEqual(R({ guestEmail: 'a@x.com', notes: 'call b@y.com / A@X.COM' }), 'a@x.com,b@y.com');
// ③ 어디에도 없음 → ''
assert.strictEqual(R({ guestEmail: '', notes: '2명 늦게 도착' }), '');

// ④ 실제 발송 경로: 이메일 칸 비고 특이사항 주소만 있는 예약이 sendStageMail로 나간다
const sent = [];
vm.runInContext('sendMail=(to,s,b)=>{__sent.push(to)};', ctx); ctx.__sent = sent;
db = { app: { mailTemplates: { s2_reminder: { subject: 'RE {guest}', bodyKo: '안내' } }, rooms: { '930': {} } } };
const bk = { bookingId: '26481', guest: 'FUJIMOTO, TOMOHISA', guestEmail: '', notes: 'ryoku.fujimoto@gmail.com', source: 'Front desk', checkinDate: '2026-09-23', checkoutDate: '2026-09-27' };
vm.runInContext('sendStageMail', ctx)('s2_reminder', bk, '930', true);
assert.deepStrictEqual(sent, ['ryoku.fujimoto@gmail.com'], '특이사항 주소로 발송돼야 함');
// ⑤ 주소가 어디에도 없으면 안 나간다
sent.length = 0; db = { app: { mailTemplates: { s2_reminder: { subject: 'RE', bodyKo: '안내' } }, rooms: {} } };
vm.runInContext('sendStageMail', ctx)('s2_reminder', { ...bk, notes: '' }, '930', true);
assert.deepStrictEqual(sent, [], '이메일 없으면 미발송');
console.log('OK notes-only-email — 5항목 통과');
