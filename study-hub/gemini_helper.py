"""Wraps Google Gemini for the two kinds of summaries the app makes."""

from google import genai

MODEL_NAME = "gemini-2.5-flash"

_client = None

EXAM_PROMPT = """당신은 대학생의 시험 공부를 도와주는 조교입니다.
아래는 한 과목의 강의 자료(또는 필기)에서 추출한 텍스트입니다.
중간/기말고사 대비용 요약본을 작성해주세요.

요구사항:
- 핵심 개념과 정의를 항목별로 정리
- 시험에 나올 법한 중요 포인트, 공식, 수치는 굵게 강조하거나 별도로 표시
- 헷갈리기 쉬운 개념은 비교해서 설명
- 마지막에 "예상 출제 포인트" 섹션을 만들어 3~5개 제시
- 한국어로, 마크다운 형식으로 작성

--- 원문 시작 ---
{content}
--- 원문 끝 ---
"""

LAB_PROMPT = """당신은 대학 연구실(지능형 추진 연구실, 마이크로 가스터빈 개발) 소속 대학원생/학부연구생의 연구 노트 정리를 도와주는 조교입니다.
아래는 논문이나 현재 진행 중인 연구 관련 자료에서 추출한 텍스트입니다.
연구실 정리용 요약본을 작성해주세요.

요구사항:
- 이 자료가 논문이면: 연구 목적, 방법론, 핵심 결과, 우리 연구(베어링/마이크로 터보젯 엔진)에 적용 가능한 시사점을 정리
- 이 자료가 진행상황/회의록/실험노트이면: 현재까지 진행된 내용, 발견한 이슈, 다음에 해야 할 일(TODO)을 정리
- 전문 용어는 유지하되 핵심을 놓치지 않도록 항목별로 정리
- 한국어로, 마크다운 형식으로 작성
- 마지막에 "다음 액션 아이템" 섹션을 만들어 정리

--- 원문 시작 ---
{content}
--- 원문 끝 ---
"""


def configure(api_key: str):
    global _client
    _client = genai.Client(api_key=api_key)


def summarize(content: str, mode: str) -> str:
    """mode is 'exam' or 'lab'."""
    if _client is None:
        raise RuntimeError("Gemini client is not configured. Call configure(api_key) first.")
    prompt_template = EXAM_PROMPT if mode == "exam" else LAB_PROMPT
    # Gemini has a context limit; trim very long input defensively.
    trimmed = content[:120_000]
    response = _client.models.generate_content(
        model=MODEL_NAME,
        contents=prompt_template.format(content=trimmed),
    )
    return response.text
