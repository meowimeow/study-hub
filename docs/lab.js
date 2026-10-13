'use strict';
/* 연구실 모드 — 삼출냉각 연구용.
   목표는 AI가 대신 정리해 주는 것이 아니라, 내가 직접 확인하고 설명하고 예측하는 습관을 만드는 것.
   그래서: AI가 채운 값은 모두 '미확인'으로 시작하고, 퀴즈는 정답을 먼저 보여주지 않고,
   Fluent 결과 칸은 예측을 먼저 적어야 열린다. 논문 요약·학습노트·서지 추천은 일부러 만들지 않았다. */

const PAPER_FIELDS = [
  { k: 'd', label: '구멍 지름 d', short: 'd', hint: '단위까지 (예: 0.5 mm)' },
  { k: 'pd', label: '피치비 P/d', short: 'P/d', hint: '' },
  { k: 'alpha', label: '분사각 α', short: 'α', hint: '도(°)' },
  { k: 'M', label: '블로잉비 M', short: 'M', hint: '' },
  { k: 'DR', label: '밀도비 DR', short: 'DR', hint: '' },
  { k: 'Tu', label: '난류강도', short: 'Tu', hint: '' },
  { k: 'kind', label: '실험 / CFD', short: '실험/CFD', type: 'select', opts: ['', '실험', 'CFD', '실험+CFD'] },
  { k: 'metric', label: '평가지표', short: '지표', hint: 'η 또는 φ', list: ['η', 'φ'] },
  { k: 'result', label: '핵심 결과', short: '핵심 결과', type: 'area' },
  { k: 'limit', label: '한계', short: '한계', type: 'area' },
];
const CASE_CONF = [['mesh', '격자 수'], ['bc', '경계조건'], ['turb', '난류모델']];
const SEED_CARDS = ['η', 'φ', '블로잉비 M', '밀도비 DR', 'y+', '단위 셀 해석', '난류모델'];
const STEPS = [1, 3, 7, 14, 30];
// 쓰는 Fluent. 라이선스가 있는 것과 없는 것을 구분해서 기록한다.
const FL_VERS = [['2023R1', '2023R1 (라이선스 있음)', '2023R1'], ['2026R1S', '2026R1 학생용', '2026R1 학생용'], ['CLUSTER', '학교 클러스터 (라이선스 있음)', '클러스터']];
const verShort = (v) => (FL_VERS.find((x) => x[0] === v) || [0, 0, ''])[2];
const verTag = (v) => (v ? `<span class="tag ${v === '2026R1S' ? 'bad' : 'ok'}">${esc(verShort(v))}</span>` : '<span class="tag bad">버전 미선택</span>');
const verOptions = (cur) => `<option value="">버전 선택</option>` + FL_VERS.map(([k, l]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${esc(l)}</option>`).join('');
function verNote(v, prevVer) {
  let out = '';
  if (v === '2026R1S') out += '<div class="note">학생용 버전이에요. 라이선스 제한(격자 규모·기능 등)이 있을 수 있어요. 이 버전에서 막히는 게 있으면 기록해 두고, 정식 라이선스가 있는 2023R1이나 학교 클러스터에서 돌려도 되는지 확인하세요.</div>';
  if (prevVer && v && prevVer !== v) out += `<div class="note">이전 케이스는 ${esc(verShort(prevVer))}로 돌렸어요. 버전이 다르면 메뉴·기본 설정·결과가 달라질 수 있으니, 비교할 때 주의하세요.</div>`;
  return out;
}

const getBy = (col, id) => S[col].find((x) => x.id === id);
const live = (col) => S[col].filter((x) => !x.deleted);
function addDaysISO(n) { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); }
function touchSave() { stamp(); S.rev = Date.now(); storageOk = lsSet(LS_STATE, JSON.stringify(S)); schedulePush(); }
function setPath(obj, path, val) {
  const ks = path.split('.'); let o = obj;
  ks.slice(0, -1).forEach((k) => { if (typeof o[k] !== 'object' || o[k] === null) o[k] = {}; o = o[k]; });
  o[ks[ks.length - 1]] = val;
}

/* ------------------------------------------------------------ 연구실 화면 */

function viewLab() {
  const tabs = [['papers', '논문표'], ['quiz', '퀴즈'], ['cases', 'Fluent'], ['tuts', '튜토리얼']];
  let out = '<p class="screen-title">연구실</p><p class="lede">삼출냉각 연구용이에요. 여기서는 AI가 대신 이해해 주지 않아요. 직접 확인하고, 설명하고, 예측해요.</p>';
  out += '<div class="seg" role="group" aria-label="연구실 기능">' + tabs.map(([k, l]) => `<button data-act="labtab" data-tab="${k}" aria-pressed="${ui.lab === k}">${l}</button>`).join('') + '</div>';
  out += ui.lab === 'quiz' ? viewQuiz() : ui.lab === 'cases' ? viewCases() : ui.lab === 'tuts' ? viewTuts() : viewPapers();
  return out;
}

/* ------------------------------------------------------------ 기능 1: 논문 추출표 */

function newPaper(draft) {
  const f = {};
  PAPER_FIELDS.forEach((pf) => { f[pf.k] = { v: (draft && draft.f && draft.f[pf.k]) || '', src: '', ok: false }; });
  return { id: uid(), title: (draft && draft.title) || '', authors: (draft && draft.authors) || '', year: (draft && draft.year) || '', opened: false, ai: !!draft, f, created_at: nowISO() };
}
const verifiedCount = (p) => PAPER_FIELDS.filter((pf) => p.f[pf.k] && p.f[pf.k].ok).length;
const bib = (p) => `${p.authors || '저자 미입력'} (${p.year || '연도 미입력'}). ${p.title || '제목 미입력'}`;

function viewPapers() {
  if (ui.paper && getBy('papers', ui.paper) && !getBy('papers', ui.paper).deleted) return paperEditor(getBy('papers', ui.paper));
  const papers = live('papers');
  let out = `<div class="stack"><label class="file" style="margin:0">PDF를 올리면 AI가 초안을 채워요. 값은 모두 "미확인"으로 시작해요.<input type="file" data-paper-pdf accept=".pdf,application/pdf" ${ui.busy ? 'disabled' : ''}></label>
<button class="btn" data-act="paperadd">논문 직접 추가</button></div>`;
  if (ui.busy) out += `<p class="quiet" style="margin-top:.8rem"><span class="spin"></span>${esc(ui.busy)}</p>`;
  out += errBox();
  if (!papers.length) return out + '<p class="quiet" style="margin-top:1rem">아직 논문이 없어요. 읽은 논문을 한 편씩 넣어요.</p>';
  out += `<div class="seg" style="margin-top:1.2rem" role="group" aria-label="보기"><button data-act="paperview" data-v="list" aria-pressed="${ui.paperView !== 'table'}">목록</button><button data-act="paperview" data-v="table" aria-pressed="${ui.paperView === 'table'}">표 (1편 = 1행)</button></div>`;
  out += ui.paperView === 'table' ? paperTable(papers) : papers.map(paperRow).join('');
  out += citeList(papers);
  return out;
}

function paperRow(p) {
  const n = verifiedCount(p), total = PAPER_FIELDS.length;
  const tag = p.opened ? '<span class="tag ok">원문 열어봄</span>' : '<span class="tag bad">인용 제외</span>';
  return `<div class="row"><div class="grow"><b>${esc(p.title || '제목 없음')}</b>${tag}<span class="sub">${esc(p.authors || '저자 미입력')} · ${esc(p.year || '연도 미입력')} · 직접 확인한 값 ${n}/${total}</span></div><button class="btn small" data-act="paperopen" data-id="${p.id}">열기</button></div>`;
}

function cell(p, pf) {
  const f = p.f[pf.k] || { v: '', src: '', ok: false };
  const v = f.v ? esc(f.v) : '—';
  if (!f.ok) return `<td class="unv">${v}<span class="tag">미확인</span></td>`;
  return `<td>${v}${f.src ? `<span class="src">${esc(f.src)}</span>` : '<span class="src warn">위치 없음</span>'}</td>`;
}
function paperTable(papers) {
  const head = '<th class="stick">서지</th>' + PAPER_FIELDS.map((pf) => `<th>${esc(pf.short)}</th>`).join('');
  const rows = papers.map((p) => `<tr><th class="stick" scope="row">${esc(p.title || '제목 없음')}<span class="src">${esc(p.authors || '')} ${esc(p.year || '')}</span>${p.opened ? '' : '<span class="tag bad">인용 제외</span>'}</th>${PAPER_FIELDS.map((pf) => cell(p, pf)).join('')}</tr>`).join('');
  return `<div class="tablewrap"><table class="lab"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table></div><p class="quiet" style="margin-top:.6rem">회색 칸은 아직 원문과 대조하지 않은 값이에요.</p>`;
}

function citeList(papers) {
  const ok = papers.filter((p) => p.opened), no = papers.filter((p) => !p.opened);
  let out = '<details><summary>인용 목록</summary><div class="body">';
  out += ok.length ? '<ol class="cite">' + ok.map((p) => `<li>${esc(bib(p))}</li>`).join('') + '</ol>' : '<p class="quiet">원문을 직접 열어 본 논문이 아직 없어요.</p>';
  if (no.length) out += '<p class="quiet" style="margin-top:.8rem">제외됨 (원문을 직접 열어 보지 않음)</p><ol class="cite out">' + no.map((p) => `<li>${esc(bib(p))}</li>`).join('') + '</ol>';
  if (ok.length) out += '<div style="height:.6rem"></div><button class="btn small" data-act="copycite">인용 목록 복사</button>';
  return out + '</div></details>';
}

function paperEditor(p) {
  const b = (path) => `data-b="papers|${p.id}|${path}"`;
  let out = `<button class="btn small" data-act="paperback">← 목록</button><div class="gap"></div>`;
  if (p.ai) out += '<div class="note">AI가 채운 초안이에요. 틀렸을 수 있어요. 원문에서 직접 찾아 확인한 값만 "직접 확인함"에 체크하세요.</div>';
  out += `<p class="screen-title" style="margin-top:1rem">서지</p>
<label class="field" for="p-title">제목</label><input id="p-title" type="text" ${b('title')} value="${esc(p.title)}">
<label class="field" for="p-auth">저자</label><input id="p-auth" type="text" ${b('authors')} value="${esc(p.authors)}">
<label class="field" for="p-year">연도</label><input id="p-year" type="text" inputmode="numeric" ${b('year')} value="${esc(p.year)}">
<label class="check"><input type="checkbox" ${b('opened')} ${p.opened ? 'checked' : ''}> 원문을 직접 열어봤어요</label>`;
  if (!p.opened) out += '<p class="quiet">체크하기 전까지 이 논문은 인용 목록에서 제외돼요.</p>';
  out += '<p class="screen-title" style="margin-top:1.6rem">추출 값</p>';
  out += PAPER_FIELDS.map((pf) => {
    const f = p.f[pf.k] || { v: '', src: '', ok: false };
    const id = `f-${pf.k}`;
    let input;
    if (pf.type === 'select') input = `<select id="${id}" ${b(`f.${pf.k}.v`)}>${pf.opts.map((o) => `<option value="${o}" ${o === f.v ? 'selected' : ''}>${o || '선택'}</option>`).join('')}</select>`;
    else if (pf.type === 'area') input = `<textarea id="${id}" style="min-height:90px;margin-bottom:.5rem" ${b(`f.${pf.k}.v`)}>${esc(f.v)}</textarea>`;
    else input = `<input id="${id}" type="text" ${pf.list ? 'list="dl-metric"' : ''} ${b(`f.${pf.k}.v`)} value="${esc(f.v)}" placeholder="${esc(pf.hint)}">`;
    return `<div class="fld ${f.ok ? 'ok' : 'unv'}"><label class="field" for="${id}" style="margin-top:0">${esc(pf.label)}${f.ok ? '' : '<span class="tag">미확인</span>'}</label>${input}
<input type="text" aria-label="${esc(pf.label)} 원문 위치" ${b(`f.${pf.k}.src`)} value="${esc(f.src)}" placeholder="원문 위치 (쪽·그림·표) 예: p.7, Fig.5">
<label class="check"><input type="checkbox" ${b(`f.${pf.k}.ok`)} ${f.ok ? 'checked' : ''}> 직접 확인함</label></div>`;
  }).join('');
  out += '<datalist id="dl-metric"><option value="η"><option value="φ"></datalist>';
  out += '<div class="gap"></div><button class="btn" data-act="paperdel" data-id="' + p.id + '">이 논문 지우기</button>';
  return out;
}

const PAPER_SCHEMA = (() => {
  const s = { type: 'STRING', nullable: true };
  return { type: 'OBJECT', required: ['title'], properties: { title: s, authors: s, year: s, d: s, pd: s, alpha: s, M: s, DR: s, Tu: s, kind: s, metric: s, result: s, limit: s } };
})();
const PAPER_PROMPT = (text) => `아래는 막냉각·삼출냉각 관련 논문에서 뽑은 텍스트야. 학생이 직접 원문과 대조하기 전의 '초안'을 만들기 위한 추출이야.
규칙:
- 원문에 적힌 값만 그대로 옮겨. 계산하거나 추정하거나 다른 지식으로 채우지 마.
- 원문에서 찾지 못했거나 확실하지 않으면 null. 틀린 값을 쓰는 것보다 비워 두는 게 낫다.
- title, authors, year: 본문 첫머리에 있는 것만. 없으면 null.
- d(구멍 지름), pd(피치비 P/d), alpha(분사각), M(블로잉비), DR(밀도비), Tu(난류강도): 단위와 함께 문자열로. 여러 조건을 다뤘으면 "0.5, 1.0, 1.5"처럼 범위/목록으로.
- kind: "실험", "CFD", "실험+CFD" 중 하나. 모르면 null.
- metric: 쓰인 평가지표 (η 또는 φ 등).
- result: 저자가 명시한 핵심 결과 한두 문장. 해석을 덧붙이지 마.
- limit: 저자가 명시한 한계나 가정. 없으면 null.

--- 원문 ---
${text}`;

async function labPdf(file) {
  ui.busy = `${file.name} 읽는 중이에요`; ui.error = null; render();
  let text = '';
  try { text = await readPdf(file); } catch (e) { ui.busy = null; ui.error = 'PDF를 읽지 못했어요. PDF를 읽으려면 인터넷 연결이 필요해요.'; render(); return; }
  if (!text.trim()) { ui.busy = null; ui.error = '글자를 읽지 못했어요. 스캔한 이미지 PDF일 수 있어요. "논문 직접 추가"로 입력해 주세요.'; render(); return; }
  ui.busy = '초안을 채우는 중이에요'; render();
  try {
    const r = await gemini(PAPER_PROMPT(text.slice(0, 100000)), PAPER_SCHEMA);
    const f = {};
    PAPER_FIELDS.forEach((pf) => { f[pf.k] = r[pf.k] ? String(r[pf.k]) : ''; });
    const p = newPaper({ title: r.title || file.name.replace(/\.pdf$/i, ''), authors: r.authors || '', year: r.year ? String(r.year) : '', f });
    S.papers.push(p); ui.paper = p.id; ui.busy = null; commit(); toast('초안을 채웠어요. 모든 값은 미확인이에요');
  } catch (e) { ui.busy = null; ui.error = e instanceof AIError ? e.message : '초안을 만들지 못했어요.'; render(); }
}

/* ------------------------------------------------------------ 기능 2: 개념 퀴즈 */

function seedCards() {
  SEED_CARDS.forEach((name, i) => {
    const id = 'seed' + i;
    if (S.cards.some((c) => c.id === id)) return;
    const c = { id, name, box: 0, due: todayISO(), reps: 0, lapses: 0, last: null, created_at: '2000-01-01T00:00:0' + i + 'Z', u: 0 };
    S.cards.push(c); snap.set(id, strip(c));
  });
}
const dueCards = () => live('cards').filter((c) => (c.due || '') <= todayISO()).sort((a, b) => (a.due || '').localeCompare(b.due || '') || (a.last || '').localeCompare(b.last || ''));

function viewQuiz() {
  seedCards();
  const cards = live('cards'), due = dueCards(), q = ui.quiz;
  let out = '';
  if (q) {
    const c = getBy('cards', q.cardId);
    out += `<div class="gap"></div><p class="quiet">카드</p><p class="focus-title" style="font-size:1.5rem">${esc(c ? c.name : '')}</p>`;
    out += errBox();
    if (!q.q) return out + `<p class="quiet"><span class="spin"></span>질문을 만드는 중이에요</p>`;
    out += `<p class="first" style="margin-top:.4rem">${esc(q.q)}</p>`;
    if (!q.fb) {
      out += `<form data-form="quizans"><textarea name="a" data-draft="quiz" aria-label="내 설명" placeholder="내 말로 설명해요. 모르겠으면 아는 데까지만 적어도 돼요." ${ui.busy ? 'disabled' : ''}>${esc(ui.draft.quiz || '')}</textarea><button class="btn primary" type="submit" ${ui.busy ? 'disabled' : ''}>${busyLabel('제출')}</button></form>`;
      out += '<div class="pair"><button class="btn" data-act="quiznewq" ' + (ui.busy ? 'disabled' : '') + '>질문 바꾸기</button><button class="btn" data-act="quizquit">그만하기</button></div>';
    } else {
      const fb = q.fb;
      const label = { ok: '논리가 맞아 보여요', partial: '일부는 맞고, 다시 볼 곳이 있어요', wrong: '다시 생각해 볼 곳이 있어요' }[fb.verdict] || '';
      out += `<div class="result"><p><b>${esc(label)}</b></p>`;
      out += fb.issues.map((i) => `<div class="note"><span class="quiet" style="display:block;margin:0">내 답: “${esc(i.quote)}”</span>${esc(i.why)}</div>`).join('');
      if (fb.hint) out += `<p class="quiet" style="margin-top:.6rem">생각해 볼 것: ${esc(fb.hint)}</p>`;
      out += '<p class="quiet" style="margin-top:.6rem">AI도 틀릴 수 있어요. 지적이 이상하면 교재나 논문으로 확인하세요. 정답은 일부러 알려주지 않아요.</p></div>';
      out += `<div class="stack"><button class="btn" data-act="quizrewrite">내 답 고쳐 쓰기</button>
<div class="pair"><button class="btn ${fb.verdict === 'ok' ? 'primary' : ''}" data-act="quizgrade" data-ok="1">맞게 설명했어요</button><button class="btn ${fb.verdict === 'ok' ? '' : 'primary'}" data-act="quizgrade" data-ok="0">틀렸어요, 다시 볼래요</button></div></div>`;
    }
    return out;
  }
  out += `<p class="lede">카드를 하나 뽑아 AI가 질문하면, 내가 직접 설명해요. 틀린 곳만 짚어 주고 정답은 보여주지 않아요. 틀린 카드는 곧 다시 나와요.</p>`;
  out += errBox();
  out += due.length ? `<button class="btn primary" data-act="quizstart" ${ui.busy ? 'disabled' : ''}>${busyLabel(`오늘 풀 카드 ${due.length}개 시작`)}</button>` : '<p class="quiet">오늘 풀 카드를 다 풀었어요.</p>';
  out += '<details><summary>카드 목록</summary><div class="body">';
  out += cards.map((c) => `<div class="row"><div class="grow">${esc(c.name)}<span class="sub">${c.reps ? `${c.reps}번 풀었고 ${c.lapses || 0}번 틀렸어요 · ` : '아직 안 풀었어요 · '}${(c.due || '') <= todayISO() ? '오늘 나와요' : `${esc(c.due)}에 나와요`}</span></div><button class="btn small" data-act="carddel" data-id="${c.id}">지우기</button></div>`).join('');
  out += '<form data-form="newcard" style="margin-top:1rem" class="stack"><input type="text" name="name" placeholder="새 개념 카드 (예: 모멘텀 플럭스비)" aria-label="새 카드 이름" autocomplete="off"><button class="btn" type="submit">카드 추가</button></form></div></details>';
  return out;
}

const EVAL_SCHEMA = { type: 'OBJECT', required: ['verdict', 'issues', 'hint'], properties: {
  verdict: { type: 'STRING', enum: ['ok', 'partial', 'wrong'] },
  issues: { type: 'ARRAY', items: { type: 'OBJECT', required: ['quote', 'why'], properties: { quote: { type: 'STRING' }, why: { type: 'STRING' } } } },
  hint: { type: 'STRING' } } };

async function quizAsk(c, prev) {
  ui.busy = '질문을 만드는 중이에요'; ui.error = null; ui.quiz.q = ''; render();
  try {
    const t = await gemini(`막냉각·삼출냉각(effusion cooling) 연구를 공부하는 학생에게 낼 질문 하나를 만들어줘.
개념: ${c.name}
- 학생이 자기 말로 '설명'해야 하는 열린 질문. 이유·원리·조건·한계를 묻는 형태. 예: "η가 x/d에 따라 감소하는 이유를 설명해보라."
- 정답이나 힌트, 설명을 포함하지 마. 질문 한 문장만 써.
${prev ? `- 직전 질문과 다른 관점으로: ${prev}` : ''}`, null);
    ui.quiz.q = t.trim().replace(/^["“]|["”]$/g, ''); ui.busy = null; render();
  } catch (e) { ui.busy = null; ui.quiz = null; ui.error = e instanceof AIError ? e.message : '질문을 만들지 못했어요.'; render(); }
}
async function quizEval(c, answer) {
  ui.busy = '살펴보는 중이에요'; ui.error = null; render();
  try {
    const r = await gemini(`너는 막냉각·삼출냉각 연구 지도 조교야. 학생이 아래 질문에 자기 말로 답했어.
질문: ${ui.quiz.q}
개념: ${c.name}
학생의 답: """${answer}"""

규칙:
- 올바른 정답이나 올바른 설명을 알려주지 마. 정답을 대신 말해 주면 학생이 스스로 생각하지 않아.
- 틀렸거나 근거가 약한 부분만 골라. quote는 학생 답에서 그대로 따온 짧은 구절, why는 그 부분이 왜 문제인지 한두 문장 (정답을 직접 말하지 말고, 어디가 이상한지만).
- hint는 학생이 스스로 다시 생각해 볼 수 있게 던지는 질문 한 개. 정답을 담지 마.
- 확신이 없으면 지적하지 말고 hint로 물어봐. 학생 답이 거의 비었으면 verdict는 wrong, issues는 비우고 hint만.
- verdict: 모두 맞아 보이면 ok(issues 빈 배열), 일부만 문제면 partial, 핵심이 틀렸으면 wrong.`, EVAL_SCHEMA);
    ui.quiz.fb = { verdict: r.verdict, issues: (r.issues || []).filter((i) => i && i.why), hint: r.hint || '' };
    ui.busy = null; render();
  } catch (e) { ui.busy = null; ui.error = e instanceof AIError ? e.message : '살펴보지 못했어요.'; render(); }
}
function gradeCard(c, ok) {
  c.reps = (c.reps || 0) + 1; c.last = nowISO();
  if (ok) { c.box = Math.min((c.box || 0) + 1, STEPS.length); c.due = addDaysISO(STEPS[c.box - 1]); }
  else { c.box = 0; c.lapses = (c.lapses || 0) + 1; c.due = todayISO(); }
}

/* ------------------------------------------------------------ 기능 3: Fluent 실행 기록 */

const hasPred = (c) => !!(c.pred || '').trim();
const hasActual = (c) => !!((c.actual || '').trim() || (c.why || '').trim());

function viewCases() {
  if (ui.caseId && getBy('cases', ui.caseId) && !getBy('cases', ui.caseId).deleted) return caseEditor(getBy('cases', ui.caseId));
  const cases = live('cases').sort((a, b) => a.created_at.localeCompare(b.created_at));
  let out = '<p class="lede">케이스를 돌리기 전에 예상을 먼저 적어요. 예상을 적어야 결과 칸이 열려요.</p>';
  out += '<form data-form="newcase" class="stack"><input type="text" name="name" placeholder="새 케이스 이름 (예: case03_P/d=4)" aria-label="새 케이스 이름" autocomplete="off"><button class="btn primary" type="submit">케이스 만들기</button></form>';
  if (!cases.length) return out + '<p class="quiet" style="margin-top:1rem">아직 케이스가 없어요.</p>';
  out += `<div class="seg" style="margin-top:1.2rem" role="group" aria-label="보기"><button data-act="caseview" data-v="list" aria-pressed="${ui.caseView !== 'table'}">목록</button><button data-act="caseview" data-v="table" aria-pressed="${ui.caseView === 'table'}">비교 표</button></div>`;
  if (ui.caseView === 'table') return out + caseTable(cases);
  out += cases.slice().reverse().map((c) => {
    const st = !hasPred(c) ? '예상 전' : !hasActual(c) ? '실행 대기' : '결과 있음';
    return `<div class="row"><div class="grow"><b>${esc(c.name || '이름 없음')}</b>${verTag(c.ver)}<span class="tag ${st === '결과 있음' ? 'ok' : ''}">${st}</span><span class="sub">${esc(c.changes || '바뀐 점 미입력')}</span></div><button class="btn small" data-act="caseopen" data-id="${c.id}">열기</button></div>`;
  }).join('');
  return out;
}

function caseTable(cases) {
  const rows = [['ver', 'Fluent 버전'], ['tut', '튜토리얼'], ['prev', '이전 케이스'], ['changes', '바뀐 점'], ...CASE_CONF, ['pred', '예상 결과'], ['actual', '실제 결과'], ['why', '예상과 다른 이유']];
  const conf = new Set(['ver', 'mesh', 'bc', 'turb']);
  const val = (c, k) => (k === 'prev' ? ((getBy('cases', c.prev) || {}).name || '') : k === 'ver' ? verShort(c.ver) : k === 'tut' ? ((getBy('tuts', c.tut) || {}).name || '') : (c[k] || ''));
  const head = '<th class="stick"></th>' + cases.map((c) => `<th>${esc(c.name || '이름 없음')}</th>`).join('');
  const body = rows.map(([k, l]) => `<tr><th class="stick" scope="row">${l}</th>${cases.map((c, i) => {
    const v = val(c, k), pv = i ? val(cases[i - 1], k) : v;
    const changed = i && conf.has(k) && v !== pv;
    return `<td class="${changed ? 'chg' : ''} ${k === 'pred' || k === 'actual' || k === 'why' || k === 'changes' ? 'wrap' : ''}">${v ? esc(v) : '—'}</td>`;
  }).join('')}</tr>`).join('');
  return `<div class="tablewrap"><table class="lab"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div><p class="quiet" style="margin-top:.6rem">바로 왼쪽 케이스와 달라진 버전·격자·경계조건·난류모델 칸은 강조돼요.</p>`;
}

function caseEditor(c) {
  const b = (path) => `data-b="cases|${c.id}|${path}"`;
  const others = live('cases').filter((x) => x.id !== c.id);
  const locked = !hasPred(c);
  let out = `<button class="btn small" data-act="caseback">← 목록</button><div class="gap"></div>
<label class="field" for="c-name">케이스 이름</label><input id="c-name" type="text" ${b('name')} value="${esc(c.name)}">
<label class="field" for="c-ver">Fluent 버전</label><select id="c-ver" ${b('ver')}>${verOptions(c.ver)}</select>${verNote(c.ver, (getBy('cases', c.prev) || {}).ver)}
<label class="field" for="c-tut">따라 하는 튜토리얼</label><select id="c-tut" ${b('tut')}><option value="">없음</option>${live('tuts').map((t) => `<option value="${t.id}" ${t.id === c.tut ? 'selected' : ''}>${esc(t.name || '이름 없음')}</option>`).join('')}</select>
<label class="field" for="c-prev">이전 케이스</label><select id="c-prev" ${b('prev')}><option value="">없음</option>${others.map((o) => `<option value="${o.id}" ${o.id === c.prev ? 'selected' : ''}>${esc(o.name || '이름 없음')}</option>`).join('')}</select>
<label class="field" for="c-chg">이전 케이스와 바뀐 점</label><textarea id="c-chg" style="min-height:80px" ${b('changes')}>${esc(c.changes)}</textarea>`;
  out += CASE_CONF.map(([k, l]) => `<label class="field" for="c-${k}">${l}</label><input id="c-${k}" type="text" ${b(k)} value="${esc(c[k])}">`).join('');
  out += `<p class="screen-title" style="margin-top:1.6rem">1. 실행 전: 예상</p>
<p class="quiet" id="pred-note">${c.predicted_at ? `예상을 적은 시각: ${esc(new Date(c.predicted_at).toLocaleString('ko-KR'))}.` : ''} ${hasActual(c) ? '결과를 적은 뒤에는 예상을 고칠 수 없어요.' : '돌리기 전에 먼저 적어요. 어떤 값이 어떻게 나올지, 그 이유까지.'}</p>
<textarea id="c-pred" ${b('pred')} ${hasActual(c) ? 'readonly' : ''} placeholder="예: M이 커지면 η 피크가 하류로 밀리고, 구멍 사이 η는 낮아질 것이다. 왜냐하면…">${esc(c.pred)}</textarea>
<p class="screen-title" style="margin-top:1.2rem">2. 실행 후: 결과</p>
<p class="quiet" id="lock-note" ${locked ? '' : 'hidden'}>예상을 먼저 적으면 이 칸이 열려요.</p>
<label class="field" for="c-act">실제 결과</label><textarea id="c-act" data-needs-pred ${b('actual')} ${locked ? 'disabled' : ''}>${esc(c.actual)}</textarea>
<label class="field" for="c-why">예상과 다른 이유 (같았다면 "같음"과 근거)</label><textarea id="c-why" data-needs-pred ${b('why')} ${locked ? 'disabled' : ''}>${esc(c.why)}</textarea>
<div class="gap"></div><button class="btn" data-act="casedel" data-id="${c.id}">이 케이스 지우기</button>`;
  return out;
}
// 글을 쓰는 중에는 화면을 다시 그리지 않으므로, 잠금과 읽기 전용은 여기서 바로 바꾼다.
function refreshCaseLocks(c) {
  const locked = !hasPred(c);
  document.querySelectorAll('[data-needs-pred]').forEach((el) => { el.disabled = locked; });
  const ln = document.getElementById('lock-note'); if (ln) ln.hidden = !locked;
  const pr = document.getElementById('c-pred'); if (pr) pr.readOnly = hasActual(c);
}


/* ------------------------------------------------------------ 튜토리얼 복습·평 */

const TUT_STATUS = ['진행 중', '끝냄', '보류'];
function viewTuts() {
  if (ui.tutId && getBy('tuts', ui.tutId) && !getBy('tuts', ui.tutId).deleted) return tutEditor(getBy('tuts', ui.tutId));
  const tuts = live('tuts').sort((a, b) => b.created_at.localeCompare(a.created_at));
  let out = '<p class="lede">따라 한 튜토리얼마다 쓴 버전, 내 말로 한 복습, 평을 남겨요. AI가 대신 써 주지 않아요.</p>';
  out += '<form data-form="newtut" class="stack"><input type="text" name="name" placeholder="튜토리얼 이름 (예: 막냉각 평판 튜토리얼)" aria-label="새 튜토리얼 이름" autocomplete="off"><button class="btn primary" type="submit">튜토리얼 추가</button></form>';
  if (!tuts.length) return out + '<p class="quiet" style="margin-top:1rem">아직 없어요.</p>';
  out += tuts.map((t) => {
    const n = live('cases').filter((c) => c.tut === t.id).length;
    return `<div class="row"><div class="grow"><b>${esc(t.name || '이름 없음')}</b>${verTag(t.ver)}<span class="tag">${esc(t.status || '진행 중')}</span>${(t.review || '').trim() ? '<span class="tag ok">복습 있음</span>' : '<span class="tag bad">복습 안 씀</span>'}<span class="sub">케이스 ${n}개${t.rating ? ` · 도움 ${esc(t.rating)}/5` : ''}</span></div><button class="btn small" data-act="tutopen" data-id="${t.id}">열기</button></div>`;
  }).join('');
  return out;
}
function tutEditor(t) {
  const b = (path) => `data-b="tuts|${t.id}|${path}"`;
  const cases = live('cases').filter((c) => c.tut === t.id).sort((a, b2) => a.created_at.localeCompare(b2.created_at));
  let out = `<button class="btn small" data-act="tutback">← 목록</button><div class="gap"></div>
<label class="field" for="t-name">튜토리얼 이름</label><input id="t-name" type="text" ${b('name')} value="${esc(t.name)}">
<label class="field" for="t-ver">쓴 Fluent 버전</label><select id="t-ver" ${b('ver')}>${verOptions(t.ver)}</select>${verNote(t.ver)}
<label class="field" for="t-src">튜토리얼 출처와 문서 버전</label><input id="t-src" type="text" ${b('source')} value="${esc(t.source)}" placeholder="예: Fluent 2023 R1 Tutorial Guide, 3장">
<label class="field" for="t-st">진행 상태</label><select id="t-st" ${b('status')}>${TUT_STATUS.map((s) => `<option ${s === (t.status || '진행 중') ? 'selected' : ''}>${s}</option>`).join('')}</select>
<label class="field" for="t-lim">버전·라이선스 때문에 달랐거나 막힌 것</label><textarea id="t-lim" style="min-height:80px" ${b('limits')} placeholder="예: 튜토리얼과 메뉴 이름이 달랐다 / 격자 크기 제한에 걸렸다">${esc(t.limits)}</textarea>
<p class="screen-title" style="margin-top:1.6rem">복습</p>
<p class="quiet">보지 않고 내 말로 써요. 이 튜토리얼이 무엇을 보여줬고, 각 단계가 왜 필요했는지.</p>
<textarea id="t-rev" ${b('review')}>${esc(t.review)}</textarea>
<label class="field" for="t-stuck">따라는 했지만 이유를 모르는 단계</label><textarea id="t-stuck" style="min-height:90px" ${b('stuck')}>${esc(t.stuck)}</textarea>
<p class="screen-title" style="margin-top:1.6rem">평</p>
<label class="field" for="t-rate">이해에 도움이 된 정도</label><select id="t-rate" ${b('rating')}><option value="">선택</option>${[1, 2, 3, 4, 5].map((n) => `<option ${String(n) === String(t.rating) ? 'selected' : ''}>${n}</option>`).join('')}</select>
<textarea id="t-eval" style="min-height:110px" ${b('eval')} placeholder="좋았던 점, 아쉬웠던 점, 다음에 더 봐야 할 것">${esc(t.eval)}</textarea>`;
  out += '<p class="screen-title" style="margin-top:1.4rem">이 튜토리얼로 돌린 케이스</p>';
  out += cases.length ? cases.map((c) => `<div class="row"><div class="grow">${esc(c.name || '이름 없음')} ${verTag(c.ver)}</div><button class="btn small" data-act="caseopen" data-id="${c.id}" data-tab="cases">열기</button></div>`).join('') : '<p class="quiet">Fluent 탭에서 케이스를 만들고 이 튜토리얼을 고르면 여기에 모여요.</p>';
  out += `<div class="gap"></div><button class="btn" data-act="tutdel" data-id="${t.id}">이 튜토리얼 지우기</button>`;
  return out;
}

/* ------------------------------------------------------------ 연결 */

function labInput(t) {
  if (!t.dataset.b) return false;
  const [col, id, path] = t.dataset.b.split('|');
  const it = getBy(col, id); if (!it) return true;
  setPath(it, path, t.type === 'checkbox' ? t.checked : t.value);
  if (col === 'cases' && path === 'pred' && !it.predicted_at && t.value.trim()) it.predicted_at = nowISO();
  touchSave();
  if (col === 'cases') refreshCaseLocks(it);
  return true;
}
function labSubmit(kind, fd) {
  if (kind === 'newcase') {
    const name = String(fd.get('name') || '').trim(); if (!name) { toast('이름을 먼저 적어 주세요'); return true; }
    const c = { id: uid(), name, ver: '', tut: '', prev: '', changes: '', mesh: '', bc: '', turb: '', pred: '', actual: '', why: '', predicted_at: null, created_at: nowISO() };
    const last = live('cases').sort((a, b) => a.created_at.localeCompare(b.created_at)).pop(); if (last) { c.prev = last.id; c.ver = last.ver || ''; c.tut = last.tut || ''; } else c.ver = '2023R1';
    S.cases.push(c); ui.caseId = c.id; commit(); return true;
  }
  if (kind === 'newtut') {
    const name = String(fd.get('name') || '').trim(); if (!name) { toast('이름을 먼저 적어 주세요'); return true; }
    const last = live('tuts').sort((a, b) => a.created_at.localeCompare(b.created_at)).pop();
    const t = { id: uid(), name, ver: (last && last.ver) || '2023R1', source: '', status: '진행 중', limits: '', review: '', stuck: '', rating: '', eval: '', created_at: nowISO() };
    S.tuts.push(t); ui.tutId = t.id; commit(); return true;
  }
  if (kind === 'newcard') {
    const name = String(fd.get('name') || '').trim(); if (!name) return true;
    S.cards.push({ id: uid(), name, box: 0, due: todayISO(), reps: 0, lapses: 0, last: null, created_at: nowISO() }); commit(); toast('카드를 추가했어요'); return true;
  }
  if (kind === 'quizans') {
    const a = String(fd.get('a') || '').trim(); if (!a) { toast('먼저 내 말로 적어 주세요'); return true; }
    ui.draft.quiz = a; const c = getBy('cards', ui.quiz.cardId); if (c) quizEval(c, a); return true;
  }
  return false;
}
const labActions = {
  labtab: (el) => { ui.lab = el.dataset.tab; ui.error = null; lsSet('sh_lab', ui.lab); render(); },
  paperadd: () => { const p = newPaper(); S.papers.push(p); ui.paper = p.id; commit(); },
  paperopen: (el) => { ui.paper = el.dataset.id; render(); window.scrollTo(0, 0); },
  paperback: () => { ui.paper = null; render(); },
  paperview: (el) => { ui.paperView = el.dataset.v; render(); },
  paperdel: (el) => { if (!confirm('이 논문을 지울까요?')) return; const p = getBy('papers', el.dataset.id); if (p) { p.deleted = true; ui.paper = null; commit(); } },
  copycite: () => {
    const text = live('papers').filter((p) => p.opened).map((p) => bib(p)).join('\n');
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(() => toast('복사했어요'), () => toast('복사하지 못했어요'));
  },
  tutopen: (el) => { ui.tutId = el.dataset.id; render(); window.scrollTo(0, 0); },
  tutback: () => { ui.tutId = null; render(); },
  tutdel: (el) => { if (!confirm('이 튜토리얼을 지울까요?')) return; const t = getBy('tuts', el.dataset.id); if (t) { t.deleted = true; ui.tutId = null; commit(); } },
  caseopen: (el) => { if (el.dataset.tab) { ui.lab = 'cases'; lsSet('sh_lab', 'cases'); } ui.caseId = el.dataset.id; render(); window.scrollTo(0, 0); },
  caseback: () => { ui.caseId = null; render(); },
  caseview: (el) => { ui.caseView = el.dataset.v; render(); },
  casedel: (el) => { if (!confirm('이 케이스를 지울까요?')) return; const c = getBy('cases', el.dataset.id); if (c) { c.deleted = true; ui.caseId = null; commit(); } },
  quizstart: () => {
    const due = dueCards(); if (!due.length || ui.busy) return;
    const c = due.find((x) => x.id !== ui.lastCard) || due[0];
    ui.quiz = { cardId: c.id, q: '', fb: null }; ui.draft.quiz = ''; quizAsk(c, '');
  },
  quiznewq: () => { const c = ui.quiz && getBy('cards', ui.quiz.cardId); if (c && !ui.busy) quizAsk(c, ui.quiz.q); },
  quizquit: () => { ui.quiz = null; ui.draft.quiz = ''; render(); },
  quizrewrite: () => { ui.quiz.fb = null; render(); },
  quizgrade: (el) => {
    const c = getBy('cards', ui.quiz.cardId); if (!c) return;
    gradeCard(c, el.dataset.ok === '1'); ui.lastCard = c.id; ui.quiz = null; ui.draft.quiz = ''; commit();
    toast(el.dataset.ok === '1' ? `${c.due}에 다시 나와요` : '오늘 안에 다시 나와요');
  },
  carddel: (el) => { const c = getBy('cards', el.dataset.id); if (c) { c.deleted = true; commit(); } },
};
