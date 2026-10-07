"""Gemini 호출. 쏟아낸 글 정리, 큰 일 쪼개기, 자료 요약."""

from __future__ import annotations

import datetime as dt
from typing import Literal, Optional

import streamlit as st
from google import genai
from google.genai import types
from pydantic import BaseModel

from config import get_secret
import store

MODEL = "gemini-2.5-flash"
WEEKDAYS = "월화수목금토일"


class AIError(Exception):
    """화면에 그대로 보여줘도 되는 한국어 메시지를 담는다."""


def api_key() -> str | None:
    return st.session_state.get("gemini_key_input") or get_secret("GEMINI_API_KEY")


def _client():
    key = api_key()
    if not key:
        raise AIError("Gemini 키가 없어요. 아래 '연결 상태'에서 키를 넣거나 Secrets에 GEMINI_API_KEY를 등록해 주세요.")
    return genai.Client(api_key=key)


# ------------------------------------------------------------ 구조화 출력

class NewTask(BaseModel):
    title: str
    bucket: Literal["시험", "연구실", "과제", "생활"]
    due: Optional[str] = None
    est_min: Optional[int] = None
    first_step: str
    urgency: int


class SortResult(BaseModel):
    tasks: list[NewTask]
    summary: str
    warnings: list[str]


class Step(BaseModel):
    title: str
    est_min: int
    first_step: str


class SplitResult(BaseModel):
    steps: list[Step]


def _generate(prompt: str, schema):
    try:
        resp = _client().models.generate_content(
            model=MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=schema,
                temperature=0.3,
                thinking_config=types.ThinkingConfig(thinking_budget=0),
            ),
        )
        parsed = resp.parsed
        if isinstance(parsed, schema):
            return parsed
        return schema.model_validate_json(resp.text)
    except AIError:
        raise
    except Exception as e:  # 네트워크, 한도 초과, 잘못된 키 등
        msg = str(e)
        if "API key" in msg or "API_KEY" in msg or "PERMISSION_DENIED" in msg:
            raise AIError("Gemini 키가 맞지 않아요. 키를 다시 확인해 주세요.") from e
        if "429" in msg or "RESOURCE_EXHAUSTED" in msg:
            raise AIError("Gemini 무료 사용량을 잠시 다 썼어요. 1분쯤 뒤에 다시 눌러 주세요.") from e
        raise AIError("정리하지 못했어요. 잠시 뒤에 다시 시도해 주세요.") from e


def _valid_date(s):
    try:
        return dt.date.fromisoformat(s).isoformat() if s else None
    except ValueError:
        return None


# --------------------------------------------------------------- 정리하기

SORT_PROMPT = """너는 할 일이 많고 생각이 자주 바뀌어 머릿속이 꼬인 대학생의 생각을 정리해 주는 도우미야.
오늘은 {today}({weekday}요일)이야. 사용자는 시험, 연구실, 과제, 생활 일이 섞여 있는 대학생이야.
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
{existing}

쏟아낸 글:
\"\"\"{raw}\"\"\"
"""


def sort_text(raw: str, existing: list[dict]) -> SortResult:
    today = store.today()
    lines = [f"- {t['title']}" + (f" (마감 {t['due']})" if t.get("due") else "") for t in existing] or ["(없음)"]
    result = _generate(
        SORT_PROMPT.format(
            today=today.isoformat(), weekday=WEEKDAYS[today.weekday()],
            existing="\n".join(lines), raw=raw[:20000],
        ),
        SortResult,
    )
    for t in result.tasks:
        t.due = _valid_date(t.due)
        t.urgency = min(5, max(1, t.urgency))
        t.title = t.title.strip()
    result.tasks = [t for t in result.tasks if t.title]
    return result


# ------------------------------------------------------------ 더 작게 나누기

SPLIT_PROMPT = """대학생이 아래 할 일이 너무 커서 시작을 못 하고 있어.
25분 안에 끝낼 수 있는 2~4개의 작은 단계로 나눠줘. 위에서 아래로 순서대로 하면 전체가 끝나야 해.
- title은 '~하기'처럼 행동으로 끝나는 짧은 문장
- est_min은 5~25
- first_step은 2분 안에 시작할 수 있는 첫 동작 한 문장

할 일: {title}
처음 동작 힌트: {first_step}
"""


def split_task(task: dict) -> list[dict]:
    result = _generate(SPLIT_PROMPT.format(title=task["title"], first_step=task.get("first_step") or "없음"), SplitResult)
    steps = [s.model_dump() for s in result.steps if s.title.strip()][:4]
    if len(steps) < 2:
        raise AIError("더 작게 나누지 못했어요. 지금 할 일을 직접 바꿔 보세요.")
    return steps


# ------------------------------------------------------------------ 자료 요약

EXAM_PROMPT = """너는 대학생의 시험 공부를 돕는 조교야. 아래는 한 과목의 강의 자료에서 뽑은 텍스트야.
중간·기말고사 대비 요약본을 한국어 마크다운으로 써줘.
- 핵심 개념과 정의를 항목별로 정리
- 공식, 수치, 시험에 나올 만한 포인트는 굵게
- 헷갈리기 쉬운 개념은 비교해서 설명
- 마지막에 '예상 출제 포인트' 3~5개

--- 원문 ---
{content}
"""

LAB_PROMPT = """너는 대학 연구실 연구 노트 정리를 돕는 조교야. 아래는 논문이나 진행 중인 연구 자료에서 뽑은 텍스트야.
한국어 마크다운으로 정리해 줘.
- 논문이면: 연구 목적, 방법, 핵심 결과, 우리 연구에 적용할 수 있는 점
- 진행상황·회의록이면: 지금까지 한 일, 발견한 문제, 다음에 할 일
- 전문 용어는 그대로 두고 항목별로
- 마지막에 '다음 액션' 섹션

--- 원문 ---
{content}
"""


def summarize_doc(content: str, mode: str) -> str:
    prompt = (EXAM_PROMPT if mode == "exam" else LAB_PROMPT).format(content=content[:120_000])
    try:
        return _client().models.generate_content(model=MODEL, contents=prompt).text or ""
    except AIError:
        raise
    except Exception as e:
        raise AIError("요약하지 못했어요. 잠시 뒤에 다시 시도해 주세요.") from e
