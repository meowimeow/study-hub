"""Study Hub: 꼬인 생각을 쏟아내면, 지금 할 일 하나만 보여주는 앱.

화면
  지금      할 일 하나만. 끝냈어요 / 더 작게 나누기 / 나중에
  쏟아내기  머릿속에 있는 걸 순서 없이 적으면 AI가 할 일로 나눠요
  주차장    하던 일 중에 떠오른 딴 생각을 잠깐 두는 곳
  마무리    오늘 끝낸 일, 내일 먼저 볼 3가지
  자료      예전 기능: 강의자료/논문 요약
"""

import datetime as dt
import html
from pathlib import Path

import streamlit as st
import streamlit.components.v1 as components
from PIL import Image

st.set_page_config(
    page_title="Study Hub",
    page_icon=Image.open(Path(__file__).parent / "icon.png"),
    layout="centered",
    initial_sidebar_state="collapsed",
)

import ai  # noqa: E402
import extractor  # noqa: E402
import store  # noqa: E402
import style  # noqa: E402
from config import get_secret  # noqa: E402

SCREENS = ["지금", "쏟아내기", "주차장", "마무리", "자료"]
PLACEHOLDER = (
    "예: 열역학 중간이 다음 주 수요일인데 아직 3단원도 못 봤고, 금요일까지 보고서 써야 하고, "
    "연구실 미팅 자료도 만들어야 하는데 갑자기 자격증도 따야 하나 싶고…"
)


def h(text) -> str:
    return html.escape(str(text or ""))


def flash(msg: str):
    st.session_state["_flash"] = msg


def go(screen: str):
    st.session_state["_goto"] = screen
    st.rerun()


def due_text(due):
    """(표시할 글, 급한지) 를 돌려준다."""
    if not due:
        return None, False
    try:
        d = dt.date.fromisoformat(due)
    except ValueError:
        return None, False
    n = (d - store.today()).days
    if n < 0:
        return "마감이 지났어요", True
    if n == 0:
        return "오늘까지", True
    if n == 1:
        return "내일까지", True
    return f"{d.month}월 {d.day}일까지, {n}일 남음", n <= 3


def row_html(t: dict) -> str:
    due, urgent = due_text(t.get("due"))
    sub = h(t.get("bucket"))
    if due:
        sub += f' &nbsp; <span class="{"due" if urgent else ""}">{h(due)}</span>'
    return f'<div class="row">{h(t["title"])}<span class="sub">{sub}</span></div>'


# ------------------------------------------------------------------ 홈 화면 아이콘

def install_icon():
    """아이폰 홈 화면 아이콘/이름을 심는다. 화면에는 아무것도 그리지 않는다."""
    st.html("<style>.st-key-pwa{position:absolute;width:0;height:0;overflow:hidden}</style>")
    with st.container(key="pwa"):
        components.html(style.install_icon_script(), height=0)


# ------------------------------------------------------------------ 잠금

def gate():
    pw = get_secret("APP_PASSWORD")
    if not pw or st.session_state.get("unlocked"):
        return
    with st.container(key="css"):
        st.html(style.CSS)
    st.html(style.tangle())
    st.html('<p class="screen-title">비밀번호를 넣어 주세요</p>')
    with st.form("gate"):
        typed = st.text_input("비밀번호", type="password", label_visibility="collapsed", placeholder="비밀번호")
        if st.form_submit_button("열기", type="primary", use_container_width=True):
            if typed == str(pw):
                st.session_state["unlocked"] = True
                st.rerun()
            st.error("비밀번호가 맞지 않아요.")
    st.stop()


# ------------------------------------------------------------ 공통 조각

def parking_form(key: str):
    with st.form(key, clear_on_submit=True):
        text = st.text_input(
            "딴 생각",
            label_visibility="collapsed",
            placeholder="딴 생각이 나면 여기에 적고, 하던 일로 돌아와요",
        )
        if st.form_submit_button("주차장에 두기", use_container_width=True) and text.strip():
            store.add_parking(text)
            flash("주차장에 뒀어요")
            st.rerun()


def run_sort(raw: str, dump_ids=(), source="dump", parking_ids=()) -> bool:
    with st.spinner("정리하는 중이에요"):
        try:
            result = ai.sort_text(raw, store.open_tasks())
        except ai.AIError as e:
            st.error(f"{e} 적은 글은 저장돼 있어요.")
            return False
    store.add_tasks([t.model_dump() for t in result.tasks], source=source)
    for d in dump_ids:
        store.finish_dump(d, result.summary)
    store.mark_parking_sorted(list(parking_ids))
    summary = result.summary if result.tasks else "할 일로 뽑을 만한 내용이 없었어요."
    st.session_state["_result"] = {"summary": summary, "warnings": result.warnings}
    return True


# ------------------------------------------------------------------ 지금

def screen_now(tasks):
    st.html(style.straight())

    if not tasks:
        st.html(
            '<p class="screen-title">할 일이 비어 있어요</p>'
            '<p class="lede">머릿속에 있는 걸 순서 없이 쏟아내면, 할 일로 나눠서 하나만 보여드려요.</p>'
        )
        if st.button("쏟아내러 가기", type="primary", use_container_width=True):
            go("쏟아내기")
        return

    t = tasks[0]
    due, urgent = due_text(t.get("due"))
    meta = f"<span>{h(t.get('bucket'))}</span>"
    if due:
        meta += f'<span class="{"due" if urgent else ""}">{h(due)}</span>'
    if t.get("est_min"):
        meta += f"<span>약 {int(t['est_min'])}분</span>"
    st.html(f'<h1 class="focus-title">{h(t["title"])}</h1><div class="meta">{meta}</div>')
    if t.get("first_step"):
        st.html(f'<p class="first">처음엔 이것만. {h(t["first_step"])}</p>')
    else:
        st.html('<div style="height:1.5rem"></div>')

    if st.button("끝냈어요", type="primary", use_container_width=True):
        store.complete_task(t["id"])
        flash("끝냈어요")
        st.rerun()

    with st.container(key="pair"):
        left, right = st.columns(2)
        split = left.button("더 작게 나누기", use_container_width=True)
        later = right.button("나중에", use_container_width=True)

    if split:
        with st.spinner("나누는 중이에요"):
            try:
                steps = ai.split_task(t)
            except ai.AIError as e:
                st.error(str(e))
                steps = None
        if steps:
            store.replace_with_steps(t, steps)
            flash(f"{len(steps)}단계로 나눴어요")
            st.rerun()
    if later:
        store.skip_task(t)
        flash("나중으로 미뤘어요")
        st.rerun()

    done_n = len(store.done_today())
    if done_n:
        st.html(f'<p class="quiet" style="margin-top:1rem">오늘 {done_n}개 끝냈어요.</p>')

    st.html('<div style="height:1rem"></div>')
    parking_form("park_now")

    rest = tasks[1:]
    if rest:
        with st.expander(f"남은 일 {len(rest)}개 보기"):
            with st.container(key="rows"):
                for r in rest:
                    c1, c2 = st.columns([4, 1])
                    c1.html(row_html(r))
                    if c2.button("빼기", key=f"drop_{r['id']}"):
                        store.drop_task(r["id"])
                        flash("뺐어요")
                        st.rerun()


# ------------------------------------------------------------- 쏟아내기

def screen_dump():
    st.html(style.tangle())

    res = st.session_state.get("_result")
    if res:
        body = f"<p>{h(res['summary'])}</p>" + "".join(f'<div class="note">{h(w)}</div>' for w in res["warnings"])
        st.html(f'<div class="result">{body}</div>')
        if st.button("지금 할 일 보기", type="primary", use_container_width=True):
            st.session_state.pop("_result", None)
            go("지금")
        st.html('<div style="height:1.4rem"></div>')

    st.html(
        '<p class="screen-title">머릿속에 있는 걸 다 적어요</p>'
        '<p class="lede">순서는 없어도 돼요. 문장이 어색해도, 같은 말을 반복해도 괜찮아요. 정리는 제가 해요.</p>'
    )

    pending = store.pending_dumps()
    if pending:
        st.html(f'<div class="note">정리하지 못한 글이 {len(pending)}개 저장돼 있어요.</div>')
        if st.button("저장해 둔 글 다시 정리하기", use_container_width=True):
            if run_sort("\n\n".join(d["raw"] for d in pending), dump_ids=[d["id"] for d in pending]):
                st.rerun()

    with st.form("dump", clear_on_submit=True):
        raw = st.text_area("쏟아내기", height=240, label_visibility="collapsed", placeholder=PLACEHOLDER)
        submitted = st.form_submit_button("정리하기", type="primary", use_container_width=True)
    if submitted:
        if not raw.strip():
            st.warning("먼저 아무거나 적어 주세요.")
        else:
            st.session_state.pop("_result", None)
            dump_id = store.add_dump(raw.strip())  # AI가 실패해도 글은 남는다
            if run_sort(raw.strip(), dump_ids=[dump_id]):
                st.rerun()


# ---------------------------------------------------------------- 주차장

def screen_parking():
    items = store.parking_items()
    st.html(
        '<p class="screen-title">딴 생각 주차장</p>'
        '<p class="lede">하던 일 중에 떠오른 생각을 여기에 둬요. 나중에 한 번에 할 일로 정리해요.</p>'
    )
    parking_form("park_form")

    if not items:
        st.html('<p class="quiet">비어 있어요.</p>')
        return

    with st.container(key="rows"):
        for it in items:
            c1, c2 = st.columns([4, 1])
            c1.html(f'<div class="row">{h(it["text"])}</div>')
            if c2.button("지우기", key=f"del_{it['id']}"):
                store.delete_parking(it["id"])
                st.rerun()

    st.html('<div style="height:1rem"></div>')
    if st.button(f"{len(items)}개 지금 정리하기", type="primary", use_container_width=True):
        if run_sort("\n".join(i["text"] for i in items), source="parking", parking_ids=[i["id"] for i in items]):
            go("쏟아내기")


# ---------------------------------------------------------------- 마무리

def screen_wrap(tasks):
    done = store.done_today()
    st.html(style.beads(len(done)))
    st.html('<p class="screen-title">오늘 하루</p>')

    if done:
        st.html(f'<p class="lede">오늘 {len(done)}개를 끝냈어요.</p>' + "".join(f'<div class="row">{h(t["title"])}</div>' for t in done))
    else:
        st.html('<p class="lede">아직 끝낸 일이 없어요. 하나만 끝내도 여기에 기록돼요.</p>')

    st.html(f'<p class="quiet" style="margin-top:1.2rem">남은 일은 {len(tasks)}개예요.</p>')

    st.html('<p class="screen-title" style="margin-top:1.6rem">내일 먼저 볼 것</p>')
    planned = store.planned_for_tomorrow()
    if planned:
        st.html("".join(row_html(t) for t in planned))
        st.html('<p class="quiet" style="margin-top:.6rem">내일 \'지금\' 화면에는 이 중 하나가 먼저 떠요.</p>')
        label, kind = "다시 정하기", "secondary"
    else:
        st.html('<p class="lede">마감이 가깝고 급한 것부터 3개를 골라 둬요.</p>')
        label, kind = "내일 할 3가지 정하기", "primary"
    if st.button(label, type=kind, use_container_width=True, disabled=not tasks):
        store.plan_tomorrow(3)
        flash("내일 먼저 볼 일을 정했어요")
        st.rerun()

    with st.expander("연결 상태"):
        if store.backend_kind() == "supabase":
            st.html('<p class="quiet">저장: Supabase에 저장 중이에요. 앱이 재시작돼도 남아요.</p>')
        else:
            st.html(
                '<p class="quiet">저장: 임시 저장 중이에요. 앱이 재시작되면 사라질 수 있어요. '
                "Supabase를 연결하면 안전하게 남아요.</p>"
            )
        if ai.api_key():
            st.html('<p class="quiet">Gemini: 연결됨</p>')
        else:
            st.html('<p class="quiet">Gemini: 키가 없어요.</p>')
        st.text_input("Gemini 키 (이 기기에서 이번에만 쓰여요)", type="password", key="gemini_key_input")


# ------------------------------------------------------------------ 자료

def screen_docs():
    st.html(
        '<p class="screen-title">자료 요약</p>'
        '<p class="lede">강의자료나 논문을 올리면 시험 대비나 연구 정리용으로 요약해요.</p>'
    )
    choice = st.radio("종류", ["과목 자료", "연구실 자료"], horizontal=True, label_visibility="collapsed")
    exam = choice == "과목 자료"
    kind, mode = ("subject", "exam") if exam else ("lab", "lab")
    subject = st.text_input("과목 이름", placeholder="예: 열역학") if exam else "연구실"

    n = st.session_state.get("up_n", 0)
    files = st.file_uploader(
        "파일 올리기 (PDF, DOCX, PPTX, TXT)",
        type=["pdf", "docx", "pptx", "txt", "md"],
        accept_multiple_files=True,
        key=f"up_{n}",
    )
    if files and st.button("요약하기", type="primary", use_container_width=True):
        if exam and not subject.strip():
            st.warning("과목 이름을 먼저 적어 주세요.")
        else:
            ok = True
            for f in files:
                with st.spinner(f"{f.name} 요약하는 중이에요"):
                    try:
                        text = extractor.extract_text(f.name, f.getvalue())
                        store.add_doc(kind, subject.strip(), f.name, ai.summarize_doc(text, mode))
                    except ai.AIError as e:
                        st.error(f"{f.name}: {e}")
                        ok = False
                        break
            if ok:
                st.session_state["up_n"] = n + 1
                flash("요약했어요")
                st.rerun()

    docs = store.list_docs(kind)
    if not docs:
        st.html('<p class="quiet" style="margin-top:1rem">아직 요약한 자료가 없어요.</p>')
    for d in docs:
        with st.expander(f"{d.get('subject') or ''} {d['filename']}".strip()):
            st.markdown(d.get("summary") or "")
            if st.button("지우기", key=f"doc_{d['id']}"):
                store.delete_doc(d["id"])
                st.rerun()


# ------------------------------------------------------------------ 시작

install_icon()
gate()

with st.container(key="css"):
    st.html(style.CSS)

# 다른 화면으로 보내 달라는 요청은 메뉴가 만들어지기 전에 처리한다.
if "_goto" in st.session_state:
    st.session_state["screen"] = st.session_state.pop("_goto")
# 이미 선택된 메뉴를 다시 눌러 선택이 풀리면 원래 화면으로 되돌린다.
if st.session_state.get("screen") not in SCREENS:
    st.session_state["screen"] = st.session_state.get("_last", "지금")

with st.container(key="nav"):
    st.segmented_control("화면", SCREENS, key="screen", label_visibility="collapsed")
screen = st.session_state["screen"]
st.session_state["_last"] = screen

if screen != "쏟아내기":
    st.session_state.pop("_result", None)
if "_flash" in st.session_state:
    st.toast(st.session_state.pop("_flash"))

try:
    open_list = store.open_tasks()
    if screen == "지금":
        screen_now(open_list)
    elif screen == "쏟아내기":
        screen_dump()
    elif screen == "주차장":
        screen_parking()
    elif screen == "마무리":
        screen_wrap(open_list)
    else:
        screen_docs()
except store.StoreError as e:
    st.error(str(e))
