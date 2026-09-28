# Study Hub

과목별 시험 자료를 올리면 Gemini가 자동으로 중간/기말고사 대비 요약본을 만들어주고,
"연구실" 탭에서는 논문이나 현재 진행 중인 연구 자료를 올리면 정리용 요약본을 만들어주는 개인용 웹앱입니다.

브라우저로 접속하는 웹앱이라 **아이폰, 맥, 윈도우 어디서든 같은 주소로 접속**하면 동일한 데이터(과목, 업로드한 자료, 요약본)를 볼 수 있습니다.

## 1. Gemini API 키 발급

1. https://aistudio.google.com/app/apikey 접속 (구글 계정 로그인)
2. "Create API key" 클릭 → 생성된 키 복사

무료 등급으로도 충분히 사용 가능합니다.

## 2. 로컬(맥/윈도우)에서 실행하기

터미널(맥) 또는 명령 프롬프트/PowerShell(윈도우)에서:

```bash
cd study-hub
python3 -m venv venv
source venv/bin/activate        # 윈도우는: venv\Scripts\activate
pip install -r requirements.txt
```

API 키 설정 (둘 중 하나):

- `.streamlit/secrets.toml.example` 파일을 `.streamlit/secrets.toml` 로 복사하고 안의 키 값을 본인 키로 교체
- 또는 앱 실행 후 왼쪽 사이드바에 직접 키를 입력 (세션 동안만 유지됨)

앱 실행:

```bash
streamlit run app.py
```

실행하면 자동으로 브라우저가 열리고 `http://localhost:8501` 로 접속됩니다.
같은 와이파이에 연결된 아이폰에서 보려면 터미널에 출력되는 "Network URL"
(예: `http://192.168.x.x:8501`)로 접속하면 됩니다. 단, 컴퓨터를 끄면 접속이 끊깁니다.

## 3. 아이폰/맥/윈도우 어디서든 접속되게 배포하기 (권장)

컴퓨터를 켜두지 않아도 항상 같은 주소로 접속하려면 **Streamlit Community Cloud**(무료)에 올리는 것을 추천합니다.

1. 이 `study-hub` 폴더를 GitHub 저장소로 push
2. https://share.streamlit.io 접속 → GitHub 계정으로 로그인
3. "New app" → 방금 만든 저장소, 브랜치, `app.py` 선택 → Deploy
4. 배포 후 "Settings → Secrets"에 아래 내용 추가:
   ```
   GEMINI_API_KEY = "본인의_Gemini_API_키"
   ```
5. 발급된 주소(예: `https://study-hub-xxxx.streamlit.app`)를 아이폰 홈 화면에 추가하면
   앱처럼 아이콘을 눌러 바로 접속할 수 있습니다 (Safari에서 열기 → 공유 → "홈 화면에 추가").

이렇게 배포하면 맥, 윈도우, 아이폰 모두 같은 주소 하나로 접속되고 데이터도 공유됩니다.

> 참고: Streamlit Community Cloud는 앱이 오래 쉬면(inactive) 저장 공간이 초기화될 수 있습니다.
> 중요한 자료/요약본은 주기적으로 "원본 파일 다운로드" 버튼으로 백업해두는 것을 권장합니다.
> 더 안정적으로 데이터를 영구 보관하려면 나중에 Supabase/Google Drive 연동으로 확장할 수 있습니다 (요청 시 추가 가능).

## 4. 사용법

- **📖 과목별 시험 자료** 탭: 과목 추가 → 강의자료(PDF/DOCX/PPTX/TXT) 업로드 → "요약본 생성" 클릭 → 시험 대비 요약본 자동 생성
- **🔬 연구실** 탭: "논문 정리" 또는 "진행상황 정리" 선택 → 자료 업로드 → 연구 정리용 요약본 자동 생성
- 각 요약본은 펼쳐서 확인할 수 있고, 원본 파일 다운로드/삭제도 가능합니다.

## 폴더 구조

```
study-hub/
├── app.py              # Streamlit 메인 앱 (탭 구성, UI)
├── db.py               # SQLite 저장/조회 (과목, 업로드 파일, 요약본)
├── extractor.py        # PDF/DOCX/PPTX/TXT → 텍스트 추출
├── gemini_helper.py     # Gemini 호출 + 시험용/연구실용 프롬프트
├── requirements.txt
└── .streamlit/secrets.toml.example
```
