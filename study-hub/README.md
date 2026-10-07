# Study Hub

할 일이 많고 생각이 자주 바뀌어서 머릿속이 꼬일 때, 풀어서 **지금 할 일 하나만** 보여주는 앱입니다.
아이폰, 맥, 윈도우 어디서든 브라우저로 같은 주소를 열면 같은 내용이 보여요.

## 화면

| 화면 | 하는 일 |
| --- | --- |
| 지금 | 할 일 하나만 보여줘요. 끝냈어요 / 더 작게 나누기 / 나중에. 딴 생각이 나면 바로 아래 칸에 적어 두고 돌아와요 |
| 쏟아내기 | 머릿속에 있는 걸 순서 없이 적으면 Gemini가 할 일로 나누고, 마감이 부딪히는 곳을 짚어줘요 |
| 주차장 | 하던 일 중에 떠오른 딴 생각을 모아 두는 곳. 나중에 한 번에 할 일로 정리해요 |
| 마무리 | 오늘 끝낸 일, 내일 먼저 볼 3가지 |
| 자료 | 강의자료/논문 요약 (예전 기능) |

'지금'에 뜨는 순서는 규칙으로 정해져 있어요: 오늘/내일로 정해 둔 것 → 오늘 '나중에'를 덜 누른 것 → 마감이 가까운 것 → 급한 것.
AI는 쏟아낸 글을 할 일로 나눌 때와 '더 작게 나누기'에서만 쓰여요.

## 여는 방법

이미 Streamlit Cloud에 올라가 있으니, 이 저장소(`main`)에 변경이 올라오면 앱이 자동으로 다시 배포돼요.
주소를 열기만 하면 됩니다. 아이폰은 사파리에서 열고 공유 → '홈 화면에 추가'를 누르면 아이콘이 생겨요.

내 컴퓨터에서 직접 띄워 보려면:

```bash
cd study-hub
pip install -r requirements.txt
streamlit run app.py
```

## Secrets (Streamlit Cloud → 앱 → Settings → Secrets)

```toml
GEMINI_API_KEY = "Gemini 키"
SUPABASE_URL = "https://xxxx.supabase.co"
SUPABASE_KEY = "Supabase secret 키"
APP_PASSWORD = "원하면 비밀번호 (없으면 생략)"
```

- `GEMINI_API_KEY`는 https://aistudio.google.com/app/apikey 에서 무료로 받아요.
- `SUPABASE_*`를 넣지 않으면 앱이 **임시 저장**으로 동작해요. 앱이 재시작되면 할 일이 사라질 수 있어요.
- 이 저장소는 코드만 올라가요. 할 일과 메모는 GitHub에 올라가지 않아요.

## Supabase 연결 (할 일이 사라지지 않게)

1. https://supabase.com 에서 무료로 가입하고 New project를 만들어요.
2. 왼쪽 메뉴 **SQL Editor** → New query에 `schema.sql` 내용을 통째로 붙여넣고 Run을 한 번 눌러요.
3. **Project Settings → API**에서 `Project URL`과 `secret` 키(또는 `service_role` 키)를 복사해요.
   `publishable`/`anon` 키가 아니라 **secret** 키예요. 이 키는 Secrets에만 넣고 다른 곳에 붙여넣지 마세요.
4. 위 Secrets에 `SUPABASE_URL`, `SUPABASE_KEY`를 넣고 저장하면 앱이 다시 시작돼요.
5. 앱의 '마무리' → '연결 상태'에서 "Supabase에 저장 중"이라고 나오면 끝이에요.

## 내 앱을 나만 보게 하기

앱 주소를 아는 사람은 누구나 열 수 있어요. 둘 중 하나를 추천해요.

- Streamlit Cloud의 앱 설정 → Sharing에서 내 이메일만 보도록 제한하기 (한 번 로그인하면 계속 유지돼요)
- 또는 Secrets에 `APP_PASSWORD`를 넣기 (열 때마다 비밀번호를 입력해요)

## 폴더

```
study-hub/
├── app.py          화면과 흐름
├── ai.py           Gemini 호출 (정리, 쪼개기, 자료 요약)
├── store.py        저장소 (Supabase 또는 임시 SQLite)와 순서 규칙
├── style.py        색, 글꼴, 실 그림
├── extractor.py    PDF/DOCX/PPTX에서 글 뽑기
├── schema.sql      Supabase에 한 번 실행할 표 정의
└── icon.png
```
