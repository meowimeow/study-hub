"""화면 스타일과 '실' 그림.

디자인 아이디어: 생각이 '꼬였다'는 말 그대로, 실이 꼬인 그림(쏟아내기)이 곧게 펴진 선(지금)이 된다.
하루 끝(마무리)에는 그 선 위에 끝낸 일만큼 구슬이 놓인다.
"""

import base64

CSS = """
<style>
@import url('https://fonts.googleapis.com/css2?family=Gowun+Batang:wght@400;700&family=IBM+Plex+Sans+KR:wght@400;500;600&display=swap');

:root {
  --vellum: #E6ECEE;
  --paper: #F7F9F9;
  --ink: #14232E;
  --graphite: #5E6E79;
  --thread: #0E7C86;
  --due: #B5432C;
  --rule: #C9D3D8;
  --serif: 'Gowun Batang', 'Noto Serif KR', serif;
  --sans: 'IBM Plex Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif;
}

html, body, .stApp, [data-testid="stAppViewContainer"] { background: var(--vellum); color: var(--ink); }
.stApp, [data-testid="stMarkdownContainer"], button, input, textarea, label, [data-baseweb] { font-family: var(--sans); }

.st-key-css { display: none; }
[data-testid="stHeader"] { background: transparent; }
[data-testid="stToolbar"], [data-testid="stDecoration"], footer, #MainMenu { display: none !important; }

.block-container { max-width: 520px; padding: 1.25rem 1.25rem 7.5rem; }

/* ---- 글자 ---- */
.screen-title { font: 700 1.4rem/1.45 var(--serif); margin: 0 0 .35rem; word-break: keep-all; }
.lede { color: var(--graphite); font-size: .95rem; line-height: 1.65; margin: 0 0 1.1rem; word-break: keep-all; }
.focus-title { font: 700 1.9rem/1.4 var(--serif); margin: 0 0 .7rem; word-break: keep-all; letter-spacing: -0.01em; }
.meta { display: flex; flex-wrap: wrap; gap: .25rem 1.1rem; color: var(--graphite); font-size: .95rem; }
.meta .due { color: var(--due); font-weight: 500; }
.first { margin: 1.15rem 0 1.7rem; padding-left: .9rem; border-left: 2px solid var(--thread);
         font-size: 1.02rem; line-height: 1.7; word-break: keep-all; }
.quiet { color: var(--graphite); font-size: .9rem; line-height: 1.6; }
.note { background: var(--paper); border-left: 2px solid var(--due); padding: .65rem .85rem; margin: .5rem 0;
        font-size: .93rem; line-height: 1.6; word-break: keep-all; }
.result { margin: 1rem 0 1.2rem; }
.result p { margin: 0 0 .5rem; line-height: 1.65; word-break: keep-all; }

/* ---- 목록: 칸을 나누지 않고 가는 선으로만 구분 ---- */
.row { padding: .72rem 0; border-bottom: 1px solid var(--rule); line-height: 1.55; word-break: keep-all; }
.row .sub { display: block; color: var(--graphite); font-size: .85rem; margin-top: .1rem; }
.row .sub .due { color: var(--due); }

/* ---- 실 그림 ---- */
.thread { display: block; width: 100%; height: auto; margin: 0 0 1.5rem; }

/* ---- 버튼 ---- */
button[data-testid^="stBaseButton"] { min-height: 3rem; border-radius: 6px; font-size: 1rem; font-weight: 500; }
button[data-testid="stBaseButton-secondary"], button[data-testid="stBaseButton-secondaryFormSubmit"] {
  background: transparent; color: var(--ink); border: 1px solid var(--graphite); }
button[data-testid="stBaseButton-primary"], button[data-testid="stBaseButton-primaryFormSubmit"] {
  background: var(--thread); color: #fff; border: 1px solid var(--thread); }
button[data-testid^="stBaseButton"]:focus-visible { outline: 3px solid var(--thread); outline-offset: 2px; }

/* 나란히 놓는 버튼은 좁은 화면에서도 쌓이지 않게 */
.st-key-pair [data-testid="stHorizontalBlock"], .st-key-rows [data-testid="stHorizontalBlock"] {
  flex-direction: row !important; flex-wrap: nowrap !important; gap: .6rem; align-items: center; }
.st-key-pair [data-testid="stColumn"], .st-key-rows [data-testid="stColumn"] { min-width: 0 !important; flex: 1 1 0 !important; width: auto !important; }
.st-key-rows [data-testid="stColumn"]:first-child { flex: 4 1 0 !important; }
.st-key-rows button[data-testid^="stBaseButton"] { min-height: 2.2rem; font-size: .85rem; padding: 0 .5rem; }

/* ---- 입력 ---- */
[data-baseweb="textarea"], [data-baseweb="input"], [data-baseweb="select"] > div {
  background: var(--paper); border: 1px solid var(--rule); border-radius: 6px; }
[data-baseweb="textarea"] textarea, [data-baseweb="input"] input { background: transparent; color: var(--ink); font-size: 1rem; line-height: 1.65; }
[data-baseweb="textarea"]:focus-within, [data-baseweb="input"]:focus-within { border-color: var(--thread); }
[data-testid="stForm"] { border: none; padding: 0; }
[data-testid="stExpander"] details { border: none !important; border-top: 1px solid var(--rule) !important; border-radius: 0 !important; background: transparent !important; }
[data-testid="stExpander"] summary { padding: .8rem 0; }

/* ---- 아래 메뉴 ---- */
.st-key-nav { position: fixed; left: 0; right: 0; bottom: 0; z-index: 999; background: var(--paper);
  border-top: 1px solid var(--rule); padding: 0 .25rem env(safe-area-inset-bottom); }
.st-key-nav .stElementContainer { width: 100% !important; }
.st-key-nav [data-testid="stWidgetLabel"] { display: none; }
.st-key-nav [role="radiogroup"] { display: flex; width: 100%; max-width: 520px; margin: 0 auto; gap: 0; }
.st-key-nav button[role="radio"] { flex: 1 1 0; min-width: 0; min-height: 3.4rem; border: none !important; border-radius: 0 !important;
  border-top: 2px solid transparent !important; background: transparent !important; color: var(--graphite) !important;
  padding: 0 !important; white-space: nowrap; }
.st-key-nav button[role="radio"] * { font-size: .9rem; overflow: visible !important; text-overflow: clip !important; white-space: nowrap; }
.st-key-nav button[role="radio"][aria-checked="true"] { color: var(--thread) !important; border-top-color: var(--thread) !important; }
.st-key-nav button[role="radio"][aria-checked="true"] * { font-weight: 600; }
</style>
"""


def _img(svg: str, label: str, extra_style: str = "") -> str:
    """st.html 은 <svg> 태그를 지운다. 이미지(data URI)로 넣으면 안의 애니메이션도 그대로 돈다."""
    data = base64.b64encode(svg.encode("utf-8")).decode("ascii")
    style = f' style="{extra_style}"' if extra_style else ""
    return f'<img class="thread" alt="{label}" src="data:image/svg+xml;base64,{data}"{style}>'


def tangle() -> str:
    """꼬인 실. 쏟아내기 화면 위에 놓인다."""
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 60">'
        '<path d="M2 32 C30 -6 62 62 92 30 S142 -4 120 32 S72 60 162 28 S232 2 216 34 S178 60 254 26 S300 20 318 32"'
        ' fill="none" stroke="#5E6E79" stroke-width="1.6" stroke-linecap="round"/>'
        '<path d="M2 30 C34 60 58 -4 96 34 S136 62 124 28 S80 -2 156 32 S226 58 212 26 S184 -2 258 34 S306 40 318 30"'
        ' fill="none" stroke="#0E7C86" stroke-width="1.1" stroke-linecap="round" opacity=".75"/>'
        "</svg>"
    )
    return _img(svg, "꼬인 실")


def straight() -> str:
    """곧게 펴진 실. 지금 화면 위에 놓이고, 처음 열 때 한 번 그려진다."""
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 14">'
        "<style>"
        ".d{stroke-dasharray:304;stroke-dashoffset:304;animation:d .9s cubic-bezier(.2,.7,.2,1) .1s forwards}"
        ".e{opacity:0;animation:s .3s ease-out .8s forwards}"
        "@keyframes d{to{stroke-dashoffset:0}}@keyframes s{to{opacity:1}}"
        "@media (prefers-reduced-motion:reduce){.d{animation:none;stroke-dashoffset:0}.e{animation:none;opacity:1}}"
        "</style>"
        '<line class="d" x1="2" y1="7" x2="304" y2="7" stroke="#0E7C86" stroke-width="2" stroke-linecap="round"/>'
        '<circle class="e" cx="312" cy="7" r="4.5" fill="#0E7C86"/>'
        "</svg>"
    )
    return _img(svg, "곧게 펴진 실", "margin-bottom:1.8rem")


def beads(n: int) -> str:
    """끝낸 일만큼 구슬이 놓인 실."""
    n = max(0, min(n, 14))
    xs = [160.0] if n == 1 else [12 + i * 296 / (n - 1) for i in range(n)]
    dots = "".join(f'<circle cx="{x:.1f}" cy="9" r="5" fill="#0E7C86"/>' for x in xs)
    svg = (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 18">'
        '<line x1="2" y1="9" x2="318" y2="9" stroke="#5E6E79" stroke-width="1.4" stroke-linecap="round"/>'
        f"{dots}</svg>"
    )
    return _img(svg, f"오늘 끝낸 일 {n}개" if n else "오늘 끝낸 일 없음")
