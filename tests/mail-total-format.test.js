// 2026-09-17 JONAN 26482 금액 114원 사고 검증: 서보이 알림메일 Total이 EU식·US식 혼재 — 둘 다 원 정수로
// 실행: node tests/mail-total-format.test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const src = fs.readFileSync(path.join(__dirname, '..', 'gas', 'Code.gs'), 'utf8');
const ctx = { PropertiesService: { getScriptProperties: () => ({ getProperty: () => 'x' }) }, console };
vm.createContext(ctx); vm.runInContext(src, ctx);
const f = ctx.wonFromMailTotal_;
assert.strictEqual(f('135.000,00'), 135000);   // EU식 (기존)
assert.strictEqual(f('114,750.00'), 114750);   // US식 (26482 사고 케이스)
assert.strictEqual(f('1.158.000,00'), 1158000);
assert.strictEqual(f('99,450.00'), 99450);
assert.strictEqual(f('300000'), 300000);
assert.strictEqual(f(''), null);
console.log('OK mail-total-format');
