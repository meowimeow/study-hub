'use strict';
/* Study Hub — 서버 없이 기기에서 도는 앱.
   데이터는 이 기기에 저장되고, 원하면 Supabase로 기기끼리 맞춘다. 키는 기기에만 둔다. */

const SCREENS = ['지금', '쏟아내기', '주차장', '마무리', '자료'];
const LS_STATE = 'sh_state_v1', LS_CFG = 'sh_settings_v1', LS_SCREEN = 'sh_screen';
const MODEL = 'gemini-2.5-flash';
const WEEKDAYS = '월화수목금토일';
const PLACEHOLDER = '예: 열역학 중간이 다음 주 수요일인데 아직 3단원도 못 봤고, 금요일까지 보고서 써야 하고, 연구실 미팅 자료도 만들어야 하는데 갑자기 자격증도 따야 하나 싶고…';

/* ------------------------------------------------------------ 저장 */

const lsGet = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };

function emptyState() { return { rev: 0, tasks: [], dumps: [], parking: [], docs: [] }; }
function normalize(s) {
  const o = emptyState();
  if (s && typeof s === 'object') {
    o.rev = Number(s.rev) || 0;
    for (const k of ['tasks', 'dumps', 'parking', 'docs']) o[k] = Array.isArray(s[k]) ? s[k] : [];
  }
  return o;
}
function loadState() { try { return normalize(JSON.parse(lsGet(LS_STATE))); } catch (e) { return emptyState(); } }
function loadCfg() { try { return Object.assign({ gemini: '', sbUrl: '', sbKey: '', code: '' }, JSON.parse(lsGet(LS_CFG)) || {}); } catch (e) { return { gemini: '', sbUrl: '', sbKey: '', code: '' }; } }

let S = loadState();
let CFG = loadCfg();
let screen = SCREENS.includes(lsGet(LS_SCREEN)) ? lsGet(LS_SCREEN) : '지금';
const ui = { result: null, busy: null, error: null, docKind: 'subject', draft: {}, sync: '', syncErr: '' };
let storageOk = true;

function saveCfg() { lsSet(LS_CFG, JSON.stringify(CFG)); }
function commit() {
  S.rev = Date.now();
  storageOk = lsSet(LS_STATE, JSON.stringify(S));
  schedulePush();
  render();
}

/* ------------------------------------------------------------ 날짜·보조 */

const pad = (n) => String(n).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => iso(new Date());
const tomorrowISO = () => { const d = new Date(); d.setDate(d.getDate() + 1); return iso(d); };
const uid = () => (crypto.randomUUID ? crypto.randomUUID().replace(/-/g, '').slice(0, 12) : Math.random().toString(16).slice(2, 14));
const nowISO = () => new Date().toISOString();
function dueDays(due) {
  if (!due || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return null;
  const [y, m, d] = due.split('-').map(Number);
  const a = new Date(y, m - 1, d), b = new Date(); b.setHours(0, 0, 0, 0);
  return Math.round((a - b) / 86400000);
}
function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function dueText(due) {
  const n = dueDays(due);
  if (n === null) return [null, false];
  if (n < 0) return ['마감이 지났어요', true];
  if (n === 0) return ['오늘까지', true];
  if (n === 1) return ['내일까지', true];
  const [, m, d] = due.split('-').map(Number);
  return [`${m}월 ${d}일까지, ${n}일 남음`, n <= 3];
}

/* ------------------------------------------------------------ 할 일 규칙 */

function orderTasks(tasks) {
  const t0 = todayISO();
  const key = (t) => {
    const plannedFlag = t.planned_for && t.planned_for <= t0 ? 0 : 1;
    const days = dueDays(t.due);
    const bucket = days === null ? 2 : days <= 3 ? 0 : days <= 14 ? 1 : 2;
    const skips = t.skip_day === t0 ? (t.skips || 0) : 0;
    return [plannedFlag, skips, bucket, -(t.urgency || 3), days === null ? 9999 : days, t.created_at || ''];
  };
  return tasks.map((t) => [key(t), t]).sort((a, b) => {
    for (let i = 0; i < a[0].length; i++) { if (a[0][i] < b[0][i]) return -1; if (a[0][i] > b[0][i]) return 1; }
    return 0;
  }).map((x) => x[1]);
}
const openTasks = () => orderTasks(S.tasks.filter((t) => t.status === 'open'));
const doneToday = () => S.tasks.filter((t) => t.status === 'done' && (t.done_day === todayISO() || (t.done_at || '').startsWith(todayISO())))
  .sort((a, b) => (b.done_at || '').localeCompare(a.done_at || ''));
const plannedTomorrow = () => openTasks().filter((t) => t.planned_for === tomorrowISO());

function addTasks(items, source, parentId, plannedFor) {
  items.forEach((it, i) => {
    S.tasks.push({
      id: uid(), title: it.title, bucket: it.bucket || '생활', due: it.due || null, est_min: it.est_min || null,
      first_step: it.first_step || '', urgency: it.urgency || 3, status: 'open', source,
      parent_id: parentId || null, planned_for: plannedFor || null, skips: 0, skip_day: null,
      created_at: new Date(Date.now() + i).toISOString(), done_at: null, done_day: null,
    });
  });
}
function completeTask(t) { t.status = 'done'; t.done_at = nowISO(); t.done_day = todayISO(); }
function skipTask(t) { const d = todayISO(); t.skips = (t.skip_day === d ? (t.skips || 0) : 0) + 1; t.skip_day = d; t.planned_for = null; }
function replaceWithSteps(t, steps) {
  addTasks(steps.map((s) => ({ ...s, bucket: t.bucket, due: t.due, urgency: t.urgency })), 'split', t.id, todayISO());
  t.status = 'split';
}
function planTomorrow(n) {
  const tm = tomorrowISO();
  S.tasks.forEach((t) => { if (t.planned_for === tm) t.planned_for = null; });
  const open = S.tasks.filter((t) => t.status === 'open');
  orderTasks(open.map((t) => ({ ...t, planned_for: null }))).slice(0, n).forEach((c) => {
    const real = S.tasks.find((t) => t.id === c.id); if (real) real.planned_for = tm;
  });
}

/* ------------------------------------------------------------ Gemini */

class AIError extends Error {}

async function gemini(prompt, schema) {
  if (!CFG.gemini) throw new AIError('Gemini 키가 없어요. 마무리 화면의 "연결과 설정"에서 키를 넣어 주세요.');
  const body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: schema ? 0.3 : 0.4, thinkingConfig: { thinkingBudget: 0 } } };
  if (schema) { body.generationConfig.responseMimeType = 'application/json'; body.generationConfig.responseSchema = schema; }
  let r;
  try {
    r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': CFG.gemini }, body: JSON.stringify(body),
    });
  } catch (e) { throw new AIError('Gemini에 연결하지 못했어요. 인터넷 연결을 확인해 주세요.'); }
  if (!r.ok) {
    let msg = ''; try { msg = (await r.json()).error.message || ''; } catch (e) { /* ignore */ }
    if (r.status === 400 && /API key/i.test(msg)) throw new AIError('Gemini 키가 맞지 않아요. 키를 다시 확인해 주세요.');
    if (r.status === 403) throw new AIError('Gemini 키가 맞지 않거나 권한이 없어요. 키를 다시 확인해 주세요.');
    if (r.status === 429) throw new AIError('Gemini 무료 사용량을 잠시 다 썼어요. 1분쯤 뒤에 다시 눌러 주세요.');
    if (r.status === 503) throw new AIError('Gemini가 지금 붐벼요. 30초쯤 뒤에 다시 눌러 주세요.');
    throw new AIError(`정리하지 못했어요. (${r.status} ${msg.slice(0, 140)})`);
  }
  const data = await r.json();
  const text = (((data.candidates || [])[0] || {}).content || {}).parts;
  const out = text && text.map((p) => p.text || '').join('');
  if (!out) throw new AIError('Gemini가 빈 답을 돌려줬어요. 다시 시도해 주세요.');
  if (!schema) return out;
  try { return JSON.parse(out); } catch (e) { throw new AIError('Gemini 답을 읽지 못했어요. 다시 시도해 주세요.'); }
}

const SORT_SCHEMA = {
  type: 'OBJECT', required: ['tasks', 'summary', 'warnings'],
  properties: {
    tasks: { type: 'ARRAY', items: { type: 'OBJECT', required: ['title', 'bucket', 'first_step', 'urgency'], properties: {
      title: { type: 'STRING' }, bucket: { type: 'STRING', enum: ['시험', '연구실', '과제', '생활'] },
      due: { type: 'STRING', nullable: true }, est_min: { type: 'INTEGER', nullable: true },
      first_step: { type: 'STRING' }, urgency: { type: 'INTEGER' } } } },
    summary: { type: 'STRING' }, warnings: { type: 'ARRAY', items: { type: 'STRING' } },
  },
};
const SPLIT_SCHEMA = {
  type: 'OBJECT', required: ['steps'],
  properties: { steps: { type: 'ARRAY', items: { type: 'OBJECT', required: ['title', 'est_min', 'first_step'], properties: {
    title: { type: 'STRING' }, est_min: { type: 'INTEGER' }, first_step: { type: 'STRING' } } } } },
};

function sortPrompt(raw, existing) {
  const now = new Date();
  const lines = existing.map((t) => `- ${t.title}${t.due ? ` (마감 ${t.due})` : ''}`).join('\n') || '(없음)';
  return `너는 할 일이 많고 생각이 자주 바뀌어 머릿속이 꼬인 대학생의 생각을 정리해 주는 도우미야.
오늘은 ${todayISO()}(${WEEKDAYS[(now.getDay() + 6) % 7]}요일)이야. 사용자는 시험, 연구실, 과제, 생활 일이 섞여 있는 대학생이야.
아래는 사용자가 순서 없이 쏟아낸 글이야. 여기서 실제로 해야 할 일만 뽑아줘.

규칙:
- 글에 없는 일을 만들지 마. 걱정이나 기분을 말한 문장은 행동이 아니면 넣지 마.
- 한 문장에 일이 여러 개면 나누고, 같은 일이 반복되면 하나로 합쳐.
- title은 '~하기'처럼 행동으로 끝나는 20자 안팎의 짧은 문장.
- bucket은 시험, 연구실, 과제, 생활 중 하나.
- due는 글에서 마감이 드러난 때만 YYYY-MM-DD로 적고, 모르면 null. '다음 주 화요일' 같은 말은 오늘 날짜 기준으로 계산해.
- est_min은 솔직한 예상 소요 시간(분, 5~180). 모르면 null.
- first_step은 2분 안에 몸을 움직여 시작할 수 있는 아주 구체적인 첫 동작 한 문장. 예: '교재 3단원 첫 페이지 펴기'.
- urgency는 1~5. 마감이 가깝거나 사용자가 중요하다고 한 것일수록 높게.
- 이미 있는 할 일과 같은 내용이면 새로 만들지 마.
- warnings는 실제로 부딪히는 것만 최대 3개. 마감이 같은 날이나 하루 차이로 몰렸거나, 하루에 할 수 없는 양일 때. 각각 한 문장. 없으면 빈 목록.
- summary는 차분한 한 문장. 예: '할 일 6개로 나눴어요. 이번 주 안에 끝내야 하는 건 2개예요.' 응원 문구와 느낌표는 쓰지 마.

이미 있는 할 일:
${lines}

쏟아낸 글:
"""${raw.slice(0, 20000)}"""`;
}

async function aiSort(raw) {
  const r = await gemini(sortPrompt(raw, openTasks()), SORT_SCHEMA);
  const tasks = (r.tasks || []).map((t) => ({
    title: String(t.title || '').trim(), bucket: ['시험', '연구실', '과제', '생활'].includes(t.bucket) ? t.bucket : '생활',
    due: dueDays(t.due) === null ? null : t.due, est_min: Number.isFinite(t.est_min) ? t.est_min : null,
    first_step: String(t.first_step || '').trim(), urgency: Math.min(5, Math.max(1, Math.round(t.urgency) || 3)),
  })).filter((t) => t.title);
  return { tasks, summary: String(r.summary || ''), warnings: (r.warnings || []).slice(0, 3).map(String) };
}

async function aiSplit(task) {
  const r = await gemini(`대학생이 아래 할 일이 너무 커서 시작을 못 하고 있어.
25분 안에 끝낼 수 있는 2~4개의 작은 단계로 나눠줘. 위에서 아래로 순서대로 하면 전체가 끝나야 해.
- title은 '~하기'처럼 행동으로 끝나는 짧은 문장
- est_min은 5~25
- first_step은 2분 안에 시작할 수 있는 첫 동작 한 문장

할 일: ${task.title}
처음 동작 힌트: ${task.first_step || '없음'}`, SPLIT_SCHEMA);
  const steps = (r.steps || []).filter((s) => s && String(s.title || '').trim()).slice(0, 4)
    .map((s) => ({ title: String(s.title).trim(), est_min: s.est_min || null, first_step: String(s.first_step || '') }));
  if (steps.length < 2) throw new AIError('더 작게 나누지 못했어요. 지금 할 일을 직접 바꿔 보세요.');
  return steps;
}

const EXAM_PROMPT = (c) => `너는 대학생의 시험 공부를 돕는 조교야. 아래는 한 과목의 강의 자료에서 뽑은 텍스트야.
중간·기말고사 대비 요약본을 한국어 마크다운으로 써줘.
- 핵심 개념과 정의를 항목별로 정리
- 공식, 수치, 시험에 나올 만한 포인트는 굵게
- 헷갈리기 쉬운 개념은 비교해서 설명
- 마지막에 '예상 출제 포인트' 3~5개

--- 원문 ---
${c}`;
const LAB_PROMPT = (c) => `너는 대학 연구실 연구 노트 정리를 돕는 조교야. 아래는 논문이나 진행 중인 연구 자료에서 뽑은 텍스트야.
한국어 마크다운으로 정리해 줘.
- 논문이면: 연구 목적, 방법, 핵심 결과, 우리 연구에 적용할 수 있는 점
- 진행상황·회의록이면: 지금까지 한 일, 발견한 문제, 다음에 할 일
- 전문 용어는 그대로 두고 항목별로
- 마지막에 '다음 액션' 섹션

--- 원문 ---
${c}`;

/* ------------------------------------------------------------ 동기화 (Supabase) */

const SYNC_SQL = `create table if not exists sh_state (
  code text primary key,
  data jsonb not null,
  updated_at timestamptz not null default now()
);
alter table sh_state enable row level security;

create or replace function sh_get(p_code text) returns jsonb
language sql security definer set search_path = public as $$
  select data from sh_state where code = p_code and length(p_code) >= 16
$$;

create or replace function sh_put(p_code text, p_data jsonb) returns void
language plpgsql security definer set search_path = public as $$
begin
  if length(p_code) < 16 then raise exception 'code too short'; end if;
  insert into sh_state (code, data, updated_at) values (p_code, p_data, now())
  on conflict (code) do update set data = excluded.data, updated_at = now();
end $$;

revoke all on function sh_get(text) from public;
revoke all on function sh_put(text, jsonb) from public;
grant execute on function sh_get(text), sh_put(text, jsonb) to anon, authenticated;`;

// 대시보드 주소(supabase.com/dashboard/project/<코드>)를 넣어도 API 주소로 바꿔 준다.
function sbBase() {
  const m = CFG.sbUrl.match(/supabase\.com\/dashboard\/project\/([a-z0-9]+)/i);
  return (m ? `https://${m[1]}.supabase.co` : CFG.sbUrl).replace(/\/+$/, '');
}
const syncOn = () => /^https:\/\//.test(CFG.sbUrl) && CFG.sbKey && CFG.code.length >= 16;
async function rpc(fn, body) {
  const headers = { apikey: CFG.sbKey, 'Content-Type': 'application/json' };
  if (CFG.sbKey.startsWith('eyJ')) headers.Authorization = 'Bearer ' + CFG.sbKey;
  let r;
  try { r = await fetch(`${sbBase()}/rest/v1/rpc/${fn}`, { method: 'POST', headers, body: JSON.stringify(body) }); }
  catch (e) { throw new Error('Supabase에 연결하지 못했어요. 주소를 확인해 주세요.'); }
  if (!r.ok) {
    let m = ''; try { m = (await r.json()).message || ''; } catch (e) { /* ignore */ }
    if (r.status === 404) throw new Error('Supabase에 동기화용 표가 아직 없어요. 아래 SQL을 SQL Editor에서 한 번 실행해 주세요.');
    if (r.status === 401 || r.status === 403) throw new Error('Supabase 키가 맞지 않아요. publishable(anon) 키인지 확인해 주세요.');
    throw new Error(`동기화하지 못했어요. (${r.status} ${m.slice(0, 120)})`);
  }
  const t = await r.text();
  return t ? JSON.parse(t) : null;
}
let pushTimer = null, pushing = false, pushAgain = false;
function schedulePush() { if (!syncOn()) return; clearTimeout(pushTimer); pushTimer = setTimeout(push, 1500); }
async function push() {
  if (!syncOn()) return;
  if (pushing) { pushAgain = true; return; }
  pushing = true;
  try { await rpc('sh_put', { p_code: CFG.code, p_data: S }); ui.sync = '동기화됨 ' + new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }); ui.syncErr = ''; }
  catch (e) { ui.syncErr = e.message; }
  pushing = false;
  if (pushAgain) { pushAgain = false; schedulePush(); }
  if (screen === '마무리') render();
}
async function pull() {
  if (!syncOn()) return;
  try {
    const remote = await rpc('sh_get', { p_code: CFG.code });
    if (remote && Number(remote.rev) > S.rev) {
      S = normalize(remote); storageOk = lsSet(LS_STATE, JSON.stringify(S));
      ui.sync = '다른 기기의 내용을 가져왔어요'; ui.syncErr = ''; render();
    } else if (!remote || Number(remote.rev) < S.rev) { await push(); }
    else { ui.sync = '동기화됨'; ui.syncErr = ''; if (screen === '마무리') render(); }
  } catch (e) { ui.syncErr = e.message; if (screen === '마무리') render(); }
}

/* ------------------------------------------------------------ 조각 */

const IMG = (svg, label, cls) => `<img class="thread ${cls || ''}" alt="${esc(label)}" src="data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}">`;
const tangle = () => IMG('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 60"><path d="M2 32 C30 -6 62 62 92 30 S142 -4 120 32 S72 60 162 28 S232 2 216 34 S178 60 254 26 S300 20 318 32" fill="none" stroke="#5E6E79" stroke-width="1.6" stroke-linecap="round"/><path d="M2 30 C34 60 58 -4 96 34 S136 62 124 28 S80 -2 156 32 S226 58 212 26 S184 -2 258 34 S306 40 318 30" fill="none" stroke="#0E7C86" stroke-width="1.1" stroke-linecap="round" opacity=".75"/></svg>', '꼬인 실');
const straight = () => IMG('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 14"><style>.d{stroke-dasharray:304;stroke-dashoffset:304;animation:d .9s cubic-bezier(.2,.7,.2,1) .1s forwards}.e{opacity:0;animation:s .3s ease-out .8s forwards}@keyframes d{to{stroke-dashoffset:0}}@keyframes s{to{opacity:1}}@media (prefers-reduced-motion:reduce){.d{animation:none;stroke-dashoffset:0}.e{animation:none;opacity:1}}</style><line class="d" x1="2" y1="7" x2="304" y2="7" stroke="#0E7C86" stroke-width="2" stroke-linecap="round"/><circle class="e" cx="312" cy="7" r="4.5" fill="#0E7C86"/></svg>', '곧게 펴진 실', 'straight');
function beads(n) {
  n = Math.max(0, Math.min(n, 14));
  const xs = n === 1 ? [160] : Array.from({ length: n }, (_, i) => 12 + (i * 296) / (n - 1));
  const dots = xs.map((x) => `<circle cx="${x.toFixed(1)}" cy="9" r="5" fill="#0E7C86"/>`).join('');
  return IMG(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 18"><line x1="2" y1="9" x2="318" y2="9" stroke="#5E6E79" stroke-width="1.4" stroke-linecap="round"/>${dots}</svg>`, n ? `오늘 끝낸 일 ${n}개` : '오늘 끝낸 일 없음');
}

function rowHtml(t, action) {
  const [due, urgent] = dueText(t.due);
  let sub = esc(t.bucket);
  if (due) sub += ` &nbsp; <span class="${urgent ? 'due' : ''}">${esc(due)}</span>`;
  return `<div class="row"><div class="grow">${esc(t.title)}<span class="sub">${sub}</span></div>${action || ''}</div>`;
}
function parkingForm(id) {
  return `<form data-form="park" class="stack"><input type="text" name="text" data-draft="${id}" value="${esc(ui.draft[id] || '')}" placeholder="딴 생각이 나면 여기에 적고, 하던 일로 돌아와요" aria-label="딴 생각" autocomplete="off" enterkeyhint="done"><button class="btn" type="submit">주차장에 두기</button></form>`;
}
const errBox = () => (ui.error ? `<div class="error" role="alert">${esc(ui.error)}</div>` : '');
const busyLabel = (idle) => (ui.busy ? `<span class="spin"></span>${esc(ui.busy)}` : idle);

/* ------------------------------------------------------------ 화면 */

function viewNow() {
  const tasks = openTasks();
  let out = straight();
  if (!tasks.length) {
    return out + '<p class="screen-title">할 일이 비어 있어요</p><p class="lede">머릿속에 있는 걸 순서 없이 쏟아내면, 할 일로 나눠서 하나만 보여드려요.</p><button class="btn primary" data-act="go" data-to="쏟아내기">쏟아내러 가기</button>';
  }
  const t = tasks[0];
  const [due, urgent] = dueText(t.due);
  let meta = `<span>${esc(t.bucket)}</span>`;
  if (due) meta += `<span class="${urgent ? 'due' : ''}">${esc(due)}</span>`;
  if (t.est_min) meta += `<span>약 ${Number(t.est_min)}분</span>`;
  out += `<h1 class="focus-title">${esc(t.title)}</h1><div class="meta">${meta}</div>`;
  out += t.first_step ? `<p class="first">처음엔 이것만. ${esc(t.first_step)}</p>` : '<div style="height:1.5rem"></div>';
  out += errBox();
  out += `<button class="btn primary" data-act="done" data-id="${t.id}">끝냈어요</button>`;
  out += `<div class="pair"><button class="btn" data-act="split" data-id="${t.id}" ${ui.busy ? 'disabled' : ''}>${busyLabel('더 작게 나누기')}</button><button class="btn" data-act="later" data-id="${t.id}">나중에</button></div>`;
  const n = doneToday().length;
  if (n) out += `<p class="quiet" style="margin-top:1rem">오늘 ${n}개 끝냈어요.</p>`;
  out += '<div class="gap"></div>' + parkingForm('park_now');
  const rest = tasks.slice(1);
  if (rest.length) {
    out += `<details><summary>남은 일 ${rest.length}개 보기</summary><div class="body">${rest.map((r) => rowHtml(r, `<button class="btn small" data-act="drop" data-id="${r.id}">빼기</button>`)).join('')}</div></details>`;
  }
  return out;
}

function viewDump() {
  let out = tangle();
  const res = ui.result;
  if (res) {
    out += `<div class="result"><p>${esc(res.summary)}</p>${res.warnings.map((w) => `<div class="note">${esc(w)}</div>`).join('')}</div><button class="btn primary" data-act="go" data-to="지금">지금 할 일 보기</button><div class="gap"></div>`;
  }
  out += '<p class="screen-title">머릿속에 있는 걸 다 적어요</p><p class="lede">순서는 없어도 돼요. 문장이 어색해도, 같은 말을 반복해도 괜찮아요. 정리는 제가 해요.</p>';
  const pending = S.dumps.filter((d) => d.status === 'pending');
  if (pending.length) {
    out += `<div class="note">정리하지 못한 글이 ${pending.length}개 저장돼 있어요.</div><div style="height:.6rem"></div><button class="btn" data-act="retry" ${ui.busy ? 'disabled' : ''}>${busyLabel('저장해 둔 글 다시 정리하기')}</button>`;
  }
  out += errBox();
  out += `<form data-form="dump" style="margin-top:.8rem"><textarea name="raw" data-draft="dump" placeholder="${esc(PLACEHOLDER)}" aria-label="쏟아내기">${esc(ui.draft.dump || '')}</textarea><button class="btn primary" type="submit" ${ui.busy ? 'disabled' : ''}>${busyLabel('정리하기')}</button></form>`;
  return out;
}

function viewParking() {
  const items = S.parking.filter((p) => p.status === 'open');
  let out = '<p class="screen-title">딴 생각 주차장</p><p class="lede">하던 일 중에 떠오른 생각을 여기에 둬요. 나중에 한 번에 할 일로 정리해요.</p>' + parkingForm('park_form');
  if (!items.length) return out + '<p class="quiet" style="margin-top:1rem">비어 있어요.</p>';
  out += '<div style="margin-top:1rem">' + items.map((it) => `<div class="row"><div class="grow">${esc(it.text)}</div><button class="btn small" data-act="delpark" data-id="${it.id}">지우기</button></div>`).join('') + '</div>';
  out += errBox() + `<div class="gap"></div><button class="btn primary" data-act="sortpark" ${ui.busy ? 'disabled' : ''}>${busyLabel(`${items.length}개 지금 정리하기`)}</button>`;
  return out;
}

function viewWrap() {
  const done = doneToday(), tasks = openTasks();
  let out = beads(done.length) + '<p class="screen-title">오늘 하루</p>';
  out += done.length ? `<p class="lede">오늘 ${done.length}개를 끝냈어요.</p>` + done.map((t) => `<div class="row"><div class="grow">${esc(t.title)}</div></div>`).join('') : '<p class="lede">아직 끝낸 일이 없어요. 하나만 끝내도 여기에 기록돼요.</p>';
  out += `<p class="quiet" style="margin-top:1.2rem">남은 일은 ${tasks.length}개예요.</p><p class="screen-title" style="margin-top:1.6rem">내일 먼저 볼 것</p>`;
  const planned = plannedTomorrow();
  let label, cls;
  if (planned.length) { out += planned.map((t) => rowHtml(t)).join('') + '<p class="quiet" style="margin-top:.6rem">내일 \'지금\' 화면에는 이 중 하나가 먼저 떠요.</p>'; label = '다시 정하기'; cls = ''; }
  else { out += '<p class="lede">마감이 가깝고 급한 것부터 3개를 골라 둬요.</p>'; label = '내일 할 3가지 정하기'; cls = 'primary'; }
  out += `<button class="btn ${cls}" data-act="plan" ${tasks.length ? '' : 'disabled'}>${label}</button>`;
  out += viewSettings();
  return out;
}

function viewSettings() {
  const syncState = ui.syncErr ? `<div class="error">${esc(ui.syncErr)}</div>` : ui.sync ? `<p class="quiet">${esc(ui.sync)}</p>` : '';
  return `<details><summary>연결과 설정</summary><div class="body">
<p class="quiet">${storageOk ? '저장: 이 기기에 저장 중이에요.' : '저장: 이 브라우저는 저장을 막고 있어요. 홈 화면에 추가한 앱으로 열어 주세요.'}${syncOn() ? ' 기기끼리 맞추는 중이에요.' : ' 다른 기기와 맞추려면 아래 동기화를 설정하세요.'}</p>
<p class="quiet">Gemini: ${CFG.gemini ? '연결됨' : '키가 없어요.'}</p>
<label class="field" for="k-gem">Gemini 키 (이 기기에만 저장돼요)</label>
<input id="k-gem" type="password" data-cfg="gemini" value="${esc(CFG.gemini)}" autocomplete="off" autocapitalize="off" spellcheck="false">
<hr style="border:0;border-top:1px solid var(--rule);margin:1.2rem 0">
<p class="quiet"><b>기기끼리 맞추기 (선택)</b><br>폰과 컴퓨터에 같은 세 값을 넣으면 같은 데이터가 보여요.</p>
<label class="field" for="k-url">Supabase 주소 (https://….supabase.co)</label>
<input id="k-url" type="url" data-cfg="sbUrl" value="${esc(CFG.sbUrl)}" autocomplete="off" autocapitalize="off" spellcheck="false">
<label class="field" for="k-key">Supabase publishable 키</label>
<input id="k-key" type="password" data-cfg="sbKey" value="${esc(CFG.sbKey)}" autocomplete="off" autocapitalize="off" spellcheck="false">
<label class="field" for="k-code">동기화 코드 (16자 이상, 비밀번호처럼 쓰여요)</label>
<input id="k-code" type="text" data-cfg="code" value="${esc(CFG.code)}" autocomplete="off" autocapitalize="off" spellcheck="false">
<div class="pair"><button class="btn" data-act="newcode">코드 만들기</button><button class="btn primary" data-act="syncnow">지금 맞추기</button></div>
${syncState}
<details><summary>처음 한 번 실행할 SQL</summary><div class="body"><p class="quiet">Supabase의 SQL Editor에 붙여 넣고 Run 하세요.</p><pre class="sql">${esc(SYNC_SQL)}</pre><div style="height:.6rem"></div><button class="btn small" data-act="copysql">SQL 복사</button></div></details>
<hr style="border:0;border-top:1px solid var(--rule);margin:1.2rem 0">
<div class="pair"><button class="btn" data-act="export">내보내기</button><label class="btn" style="display:flex;align-items:center;justify-content:center;cursor:pointer">가져오기<input type="file" accept="application/json,.json" data-import style="display:none"></label></div>
<p class="quiet" style="margin-top:.6rem">내보내기는 데이터를 파일 하나로 저장해요. 가져오기는 그 파일로 이 기기를 덮어써요.</p>
</div></details>`;
}

function mdToHtml(md) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`(.+?)`/g, '<code>$1</code>');
  let out = '', list = false;
  for (const raw of String(md || '').split('\n')) {
    const line = raw.trimEnd();
    let m;
    if ((m = line.match(/^\s*[-*]\s+(.*)/)) || (m = line.match(/^\s*\d+\.\s+(.*)/))) { if (!list) { out += '<ul>'; list = true; } out += `<li>${inline(m[1])}</li>`; continue; }
    if (list) { out += '</ul>'; list = false; }
    if ((m = line.match(/^#{1,6}\s+(.*)/))) out += `<h3>${inline(m[1])}</h3>`;
    else if (line.trim()) out += `<p>${inline(line)}</p>`;
  }
  return out + (list ? '</ul>' : '');
}

function viewDocs() {
  const exam = ui.docKind === 'subject';
  let out = '<p class="screen-title">자료 요약</p><p class="lede">강의자료나 논문을 올리면 시험 대비나 연구 정리용으로 요약해요.</p>';
  out += `<div class="seg" role="group" aria-label="종류"><button data-act="dockind" data-kind="subject" aria-pressed="${exam}">과목 자료</button><button data-act="dockind" data-kind="lab" aria-pressed="${!exam}">연구실 자료</button></div>`;
  if (exam) out += `<input type="text" data-draft="subject" value="${esc(ui.draft.subject || '')}" placeholder="과목 이름 (예: 열역학)" aria-label="과목 이름">`;
  out += `<label class="file">파일 올리기 (PDF, TXT, MD)<input type="file" data-doc accept=".pdf,.txt,.md,application/pdf,text/plain" multiple ${ui.busy ? 'disabled' : ''}></label>`;
  out += `<details style="margin-top:0;border-top:0"><summary style="padding-top:0">글을 직접 붙여 넣기</summary><div class="body"><form data-form="doctext"><textarea name="text" style="min-height:140px" placeholder="강의 내용이나 논문 초록을 붙여 넣어요" aria-label="붙여 넣을 글"></textarea><button class="btn" type="submit" ${ui.busy ? 'disabled' : ''}>요약하기</button></form></div></details>`;
  if (ui.busy) out += `<p class="quiet"><span class="spin"></span>${esc(ui.busy)}</p>`;
  out += errBox();
  const docs = S.docs.filter((d) => d.kind === ui.docKind).sort((a, b) => b.created_at.localeCompare(a.created_at));
  if (!docs.length) out += '<p class="quiet" style="margin-top:1rem">아직 요약한 자료가 없어요.</p>';
  out += docs.map((d) => `<details><summary>${esc(`${d.subject || ''} ${d.filename}`.trim())}</summary><div class="body"><div class="md">${mdToHtml(d.summary)}</div><div style="height:.6rem"></div><button class="btn small" data-act="deldoc" data-id="${d.id}">지우기</button></div></details>`).join('');
  return out;
}

/* ------------------------------------------------------------ 그리기 */

const VIEWS = { 지금: viewNow, 쏟아내기: viewDump, 주차장: viewParking, 마무리: viewWrap, 자료: viewDocs };
const openState = new Set();

function render() {
  const nav = document.getElementById('nav'), view = document.getElementById('view');
  nav.innerHTML = '<div class="tabs">' + SCREENS.map((s) => `<button data-act="go" data-to="${s}" ${s === screen ? 'aria-current="page"' : ''}>${s}</button>`).join('') + '</div>';
  // 열어 둔 설정 칸은 다시 그려도 열린 채로 둔다.
  document.querySelectorAll('#view details[data-k]').forEach((d) => { d.open ? openState.add(d.dataset.k) : openState.delete(d.dataset.k); });
  const active = document.activeElement && document.activeElement.id;
  view.innerHTML = VIEWS[screen]();
  view.querySelectorAll('details').forEach((d, i) => { d.dataset.k = screen + i; if (openState.has(d.dataset.k)) d.open = true; });
  if (active) { const el = document.getElementById(active); if (el) el.focus(); }
}

function go(s) {
  if (s !== '쏟아내기') ui.result = null;
  ui.error = null; screen = s; lsSet(LS_SCREEN, s); render(); window.scrollTo(0, 0);
}
let toastTimer;
function toast(msg) { const t = document.getElementById('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 1800); }

/* ------------------------------------------------------------ 동작 */

async function runSort(raw, opt) {
  ui.busy = '정리하는 중이에요'; ui.error = null; ui.result = null; render();
  try {
    const r = await aiSort(raw);
    addTasks(r.tasks, opt.source || 'dump');
    (opt.dumpIds || []).forEach((id) => { const d = S.dumps.find((x) => x.id === id); if (d) { d.status = 'done'; d.summary = r.summary; } });
    (opt.parkingIds || []).forEach((id) => { const p = S.parking.find((x) => x.id === id); if (p) p.status = 'sorted'; });
    ui.result = { summary: r.tasks.length ? r.summary : '할 일로 뽑을 만한 내용이 없었어요.', warnings: r.warnings };
    ui.busy = null; screen = '쏟아내기'; lsSet(LS_SCREEN, screen); commit(); window.scrollTo(0, 0);
  } catch (e) {
    ui.busy = null; ui.error = (e instanceof AIError ? e.message : '정리하지 못했어요. 잠시 뒤에 다시 시도해 주세요.') + ' 적은 글은 저장돼 있어요.'; render();
  }
}

async function summarize(name, text) {
  const exam = ui.docKind === 'subject';
  const subject = (ui.draft.subject || '').trim();
  if (exam && !subject) { ui.error = '과목 이름을 먼저 적어 주세요.'; render(); return false; }
  if (!text.trim()) { ui.error = `${name}에서 글자를 읽지 못했어요. 스캔한 이미지 PDF일 수 있어요.`; render(); return false; }
  ui.busy = `${name} 요약하는 중이에요`; ui.error = null; render();
  try {
    const content = text.slice(0, 120000);
    const summary = await gemini((exam ? EXAM_PROMPT : LAB_PROMPT)(content), null);
    S.docs.push({ id: uid(), kind: ui.docKind, subject: exam ? subject : '연구실', filename: name, summary, created_at: nowISO() });
    ui.busy = null; commit(); toast('요약했어요'); return true;
  } catch (e) { ui.busy = null; ui.error = `${name}: ${e instanceof AIError ? e.message : '요약하지 못했어요.'}`; render(); return false; }
}

function loadScript(src) {
  return new Promise((ok, no) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = () => no(new Error('pdf')); document.head.appendChild(s); });
}
async function readPdf(file) {
  const base = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  if (!window.pdfjsLib) await loadScript(base + 'pdf.min.js');
  window.pdfjsLib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js';
  const pdf = await window.pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
  let out = '';
  for (let i = 1; i <= pdf.numPages && out.length < 130000; i++) {
    const c = await (await pdf.getPage(i)).getTextContent();
    out += c.items.map((x) => x.str).join(' ') + '\n\n';
  }
  return out;
}
async function handleFiles(files) {
  for (const f of files) {
    let text = '';
    try {
      ui.busy = `${f.name} 읽는 중이에요`; ui.error = null; render();
      text = /\.pdf$/i.test(f.name) ? await readPdf(f) : await f.text();
    } catch (e) { ui.busy = null; ui.error = `${f.name}: 파일을 읽지 못했어요. PDF를 읽으려면 인터넷 연결이 필요해요.`; render(); return; }
    if (!(await summarize(f.name, text))) return;
  }
}

const clickActions = {
  go: (el) => go(el.dataset.to),
  done: (el) => { const t = S.tasks.find((x) => x.id === el.dataset.id); if (t) { completeTask(t); commit(); toast('끝냈어요'); } },
  later: (el) => { const t = S.tasks.find((x) => x.id === el.dataset.id); if (t) { skipTask(t); commit(); toast('나중으로 미뤘어요'); } },
  drop: (el) => { const t = S.tasks.find((x) => x.id === el.dataset.id); if (t) { t.status = 'dropped'; commit(); toast('뺐어요'); } },
  split: async (el) => {
    const t = S.tasks.find((x) => x.id === el.dataset.id); if (!t || ui.busy) return;
    ui.busy = '나누는 중이에요'; ui.error = null; render();
    try { const steps = await aiSplit(t); replaceWithSteps(t, steps); ui.busy = null; commit(); toast(`${steps.length}단계로 나눴어요`); }
    catch (e) { ui.busy = null; ui.error = e instanceof AIError ? e.message : '나누지 못했어요. 잠시 뒤에 다시 시도해 주세요.'; render(); }
  },
  retry: () => { const p = S.dumps.filter((d) => d.status === 'pending'); if (p.length && !ui.busy) runSort(p.map((d) => d.raw).join('\n\n'), { dumpIds: p.map((d) => d.id) }); },
  delpark: (el) => { S.parking = S.parking.filter((p) => p.id !== el.dataset.id); commit(); },
  sortpark: () => { const items = S.parking.filter((p) => p.status === 'open'); if (items.length && !ui.busy) runSort(items.map((i) => i.text).join('\n'), { source: 'parking', parkingIds: items.map((i) => i.id) }); },
  plan: () => { planTomorrow(3); commit(); toast('내일 먼저 볼 일을 정했어요'); },
  dockind: (el) => { ui.docKind = el.dataset.kind; ui.error = null; render(); },
  deldoc: (el) => { S.docs = S.docs.filter((d) => d.id !== el.dataset.id); commit(); },
  newcode: () => { const a = new Uint8Array(12); crypto.getRandomValues(a); CFG.code = Array.from(a, (b) => b.toString(16).padStart(2, '0')).join(''); saveCfg(); render(); },
  syncnow: () => { ui.sync = ''; ui.syncErr = ''; if (!syncOn()) { ui.syncErr = '주소(https://로 시작), 키, 16자 이상의 코드를 모두 넣어 주세요.'; render(); } else { ui.sync = '맞추는 중이에요…'; render(); pull(); } },
  copysql: () => { (navigator.clipboard ? navigator.clipboard.writeText(SYNC_SQL) : Promise.reject()).then(() => toast('SQL을 복사했어요'), () => toast('복사하지 못했어요. 직접 선택해서 복사해 주세요.')); },
  export: () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' }));
    a.download = `study-hub-${todayISO()}.json`; document.body.appendChild(a); a.click(); a.remove();
  },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && clickActions[el.dataset.act]) clickActions[el.dataset.act](el);
});
document.addEventListener('input', (e) => {
  const t = e.target;
  if (t.dataset.draft) ui.draft[t.dataset.draft] = t.value;
  if (t.dataset.cfg) { CFG[t.dataset.cfg] = t.value.trim(); saveCfg(); }
});
document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.cfg && t.dataset.cfg !== 'gemini') { ui.sync = ''; ui.syncErr = ''; if (syncOn()) pull(); else render(); }
  if (t.dataset.cfg === 'gemini') render();
  if (t.matches('[data-doc]') && t.files.length) { const fs = Array.from(t.files); t.value = ''; handleFiles(fs); }
  if (t.matches('[data-import]') && t.files.length) {
    try {
      const data = normalize(JSON.parse(await t.files[0].text()));
      if (!confirm('이 기기의 내용을 파일 내용으로 덮어쓸까요?')) return;
      S = data; commit(); toast('가져왔어요');
    } catch (err) { toast('파일을 읽지 못했어요'); }
  }
});
document.addEventListener('submit', (e) => {
  const f = e.target.closest('form[data-form]'); if (!f) return;
  e.preventDefault();
  const kind = f.dataset.form, fd = new FormData(f);
  if (kind === 'park') {
    const text = String(fd.get('text') || '').trim(); if (!text) return;
    Object.keys(ui.draft).filter((k) => k.startsWith('park')).forEach((k) => { ui.draft[k] = ''; });
    S.parking.push({ id: uid(), text, status: 'open', created_at: nowISO() }); commit(); toast('주차장에 뒀어요');
  } else if (kind === 'dump') {
    const raw = String(fd.get('raw') || '').trim();
    if (!raw) { ui.error = '먼저 아무거나 적어 주세요.'; render(); return; }
    ui.draft.dump = '';
    const id = uid(); // AI가 실패해도 글은 남는다
    S.dumps.push({ id, raw, status: 'pending', summary: '', created_at: nowISO() });
    S.rev = Date.now(); storageOk = lsSet(LS_STATE, JSON.stringify(S));
    runSort(raw, { dumpIds: [id] });
  } else if (kind === 'doctext') {
    const text = String(fd.get('text') || ''); if (text.trim()) summarize('붙여 넣은 글', text);
  }
});

document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') pull(); });
window.addEventListener('online', () => { pull(); });

render();
pull();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
