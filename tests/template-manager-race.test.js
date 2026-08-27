// 2026-08-27 클라라 신고 검증: "템플릿 관리에서 고쳐 저장했는데 옛 내용 그대로"
// 원인 = 모달은 즉시 열리는데 본문은 await get()이 끝나야 채워진다 → 로딩 중 입력이 늦게 온 응답에 덮이고,
//        그 상태로 저장하면 옛 내용이 다시 저장된다. 잠금·stale 폐기·저장 가드를 검증.
// 실행: node tests/template-manager-race.test.js
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');

// index.html에서 템플릿 관리 코드만 잘라 온다 (프론트는 모듈이라 통째로는 못 돌린다)
const slice = (startMark, endMark) => {
  const a = html.indexOf(startMark);
  assert.ok(a > 0, '앵커 없음: ' + startMark);
  const b = html.indexOf(endMark, a);
  assert.ok(b > a, '끝 앵커 없음: ' + endMark);
  return html.slice(a, b);
};
const src = slice('const TPL_FIELDS=', 'window.saveTemplate=saveTemplate;')
  .replace(/window\.\w+\s*=\s*\w+;/g, '');

// ── 목(mock) DOM ──
const fields = {};
const mk = (id) => (fields[id] = { id, value: '', disabled: false, style: {}, textContent: '' });
['tpl-name', 'tpl-subject', 'tpl-bodyko', 'tpl-bodyen', 'tpl-save-btn',
 'tpl-subject-wrap', 'tpl-name-wrap', 'tpl-del-btn', 'tpl-stage'].forEach(mk);

// ── 목 Firebase: get()이 resolve될 시점을 테스트가 직접 잡는다 ──
let pending = [];                                  // [{path, resolve}]
const store = {
  'app/mailTemplates/custom_1': { name: 'ETA 요청(OTA)', subject: '제목A', bodyKo: '옛 본문', bodyEn: '' },
  'app/mailTemplates/custom_2': { name: '셔틀', subject: '제목B', bodyKo: '셔틀 본문', bodyEn: '' },
};
const writes = [];
const ctx = {
  console, assert,
  ref: (_db, p) => p, db: {}, get: (p) => new Promise(r => pending.push({ p, r })),
  update: async (p, v) => { writes.push([p, v]); store[p] = { ...(store[p] || {}), ...v }; },
  set: async (p, v) => { writes.push([p, v]); store[p] = v; },
  remove: async (p) => { delete store[p]; },
  alert: (m) => { ctx.lastAlert = m; }, confirm: () => true,
  refreshTplSelect: async () => {},
  document: { getElementById: (id) => fields[id] || null },
};
vm.createContext(ctx);
vm.runInContext(src, ctx);
const load = () => vm.runInContext('loadTemplateForStage()', ctx);
const save = () => vm.runInContext('saveTemplate()', ctx);
// 대기 중인 get()을 store 값으로 응답
const flush = () => { const q = pending; pending = []; q.forEach(({ p, r }) => r({ exists: () => !!store[p], val: () => store[p] })); };
const tick = () => new Promise(r => setImmediate(r));

(async () => {
  // ① 불러오는 동안 입력칸·저장이 잠긴다 + 직전 내용이 남지 않는다
  fields['tpl-stage'].value = 'custom_1';
  fields['tpl-bodyko'].value = '직전에 보던 다른 템플릿 내용';
  const p1 = load();
  assert.strictEqual(fields['tpl-bodyko'].value, '', '① 로딩 시작 즉시 비워야 함(옛 내용 오인 차단)');
  assert.strictEqual(fields['tpl-bodyko'].disabled, true, '① 로딩 중 본문 입력 잠금');
  assert.strictEqual(fields['tpl-save-btn'].disabled, true, '① 로딩 중 저장 잠금');
  flush(); await p1;
  assert.strictEqual(fields['tpl-bodyko'].value, '옛 본문', '① 로딩 끝나면 채워짐');
  assert.strictEqual(fields['tpl-save-btn'].disabled, false, '① 로딩 끝나면 저장 열림');

  // ② 로딩 완료 후 수정 → 저장하면 수정본이 저장된다 (원래 기대 동작)
  fields['tpl-bodyko'].value = '새 본문';
  await save(); await tick();
  assert.strictEqual(store['app/mailTemplates/custom_1'].bodyKo, '새 본문', '② 수정본이 저장돼야 함');
  flush(); await tick();                                   // 저장 후 재조회 응답

  // ③ 단계를 연달아 바꿔 응답이 뒤늦게·역순으로 와도 마지막 단계만 반영된다
  fields['tpl-stage'].value = 'custom_1'; const a = load();
  fields['tpl-stage'].value = 'custom_2'; const b = load();
  flush(); await a; await b;
  assert.strictEqual(fields['tpl-bodyko'].value, '셔틀 본문', '③ 마지막으로 고른 단계 내용이어야 함');
  assert.strictEqual(fields['tpl-name'].value, '셔틀', '③ 이름도 마지막 단계 것');

  // ④ 불러오기가 안 끝난 상태에서 저장을 강행해도 덮어쓰지 않는다 (2차 방어)
  store['app/mailTemplates/custom_2'] = { name: '셔틀', subject: '제목B', bodyKo: '셔틀 본문', bodyEn: '' };
  const wrote = writes.length;
  const p4 = load();                                        // 응답 전
  fields['tpl-bodyko'].value = '로딩 중에 친 글';
  await save();
  assert.strictEqual(writes.length, wrote, '④ 로딩 중 저장은 쓰기 없이 막혀야 함');
  assert.match(String(ctx.lastAlert), /불러오는 중/, '④ 안내 문구');
  flush(); await p4;

  console.log('OK — 전 항목 통과 (①로딩 잠금·즉시 비움 ②수정본 저장 ③늦은 응답 폐기 ④로딩 중 저장 차단)');
})();
