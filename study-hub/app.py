"""Study Hub — 시험 자료 요약 + 연구실 정리 자동화

과목별로 강의자료를 올리면 Gemini가 시험 대비 요약본을 만들어주고,
연구실 탭에서는 논문/진행상황 자료를 올리면 연구 정리용 요약본을 만들어줍니다.

실행 방법은 README.md 참고.
"""

import os
import streamlit as st

import db
import extractor
import gemini_helper

st.set_page_config(page_title="Study Hub", page_icon="📚", layout="wide")
db.init_db()


# ---------------- Gemini API key ----------------

def get_api_key():
    # 1) Streamlit secrets (배포 시 권장: .streamlit/secrets.toml 또는 Streamlit Cloud 대시보드)
    if "GEMINI_API_KEY" in st.secrets:
        return st.secrets["GEMINI_API_KEY"]
    # 2) 환경변수 (.env를 직접 로드하지 않으므로 export 해두거나 아래 입력창 사용)
    if os.environ.get("GEMINI_API_KEY"):
        return os.environ["GEMINI_API_KEY"]
    return None


api_key = get_api_key()

with st.sidebar:
    st.title("📚 Study Hub")
    st.caption("시험 자료 요약 + 연구실 정리 자동화")

    if not api_key:
        st.warning("Gemini API 키가 설정되지 않았습니다.")
        api_key_input = st.text_input("Gemini API 키를 입력하세요", type="password")
        if api_key_input:
            api_key = api_key_input
    else:
        st.success("Gemini API 키 연결됨")

    st.markdown("---")
    st.markdown(
        "**사용 방법**\n"
        "1. 왼쪽에서 과목을 추가/선택\n"
        "2. 자료(PDF/DOCX/PPTX/TXT)를 업로드\n"
        "3. 자동으로 요약본 생성\n"
        "4. 연구실 탭에서는 논문/진행상황 자료를 같은 방식으로 정리"
    )

if api_key:
    gemini_helper.configure(api_key)

tab_exam, tab_lab = st.tabs(["📖 과목별 시험 자료", "🔬 연구실"])


# ---------------- 과목별 시험 자료 탭 ----------------

with tab_exam:
    st.header("과목별 시험 자료 요약")

    col_new, col_select = st.columns([1, 2])
    with col_new:
        new_subject = st.text_input("새 과목 추가", placeholder="예: 열역학")
        if st.button("추가", key="add_subject_btn") and new_subject.strip():
            db.add_subject(new_subject)
            st.rerun()

    subjects = db.list_subjects()
    if not subjects:
        st.info("아직 등록된 과목이 없습니다. 먼저 과목을 추가하세요.")
    else:
        subject_names = [s["name"] for s in subjects]
        with col_select:
            selected_name = st.selectbox("과목 선택", subject_names)
        selected_subject = next(s for s in subjects if s["name"] == selected_name)

        st.subheader(f"'{selected_name}' 자료 업로드")
        uploaded_files = st.file_uploader(
            "강의자료/필기 업로드 (PDF, DOCX, PPTX, TXT)",
            type=["pdf", "docx", "pptx", "txt", "md"],
            accept_multiple_files=True,
            key=f"upload_{selected_subject['id']}",
        )

        if uploaded_files and st.button("요약본 생성", key="summarize_exam_btn"):
            if not api_key:
                st.error("먼저 Gemini API 키를 입력해주세요.")
            else:
                progress = st.progress(0.0, text="처리 중...")
                for i, uf in enumerate(uploaded_files):
                    file_bytes = uf.getvalue()
                    text = extractor.extract_text(uf.name, file_bytes)
                    with st.spinner(f"'{uf.name}' 요약 생성 중..."):
                        try:
                            summary = gemini_helper.summarize(text, mode="exam")
                        except Exception as e:
                            summary = f"[요약 생성 실패: {e}]"
                    db.add_document(
                        category="subject",
                        subject_id=selected_subject["id"],
                        filename=uf.name,
                        file_blob=file_bytes,
                        extracted_text=text,
                        summary=summary,
                        summary_type="시험 대비 요약",
                    )
                    progress.progress((i + 1) / len(uploaded_files), text=f"{uf.name} 완료")
                st.success("요약본 생성이 완료되었습니다.")
                st.rerun()

        st.markdown("---")
        st.subheader("저장된 요약본")
        docs = db.list_documents("subject", selected_subject["id"])
        if not docs:
            st.caption("아직 요약본이 없습니다.")
        for d in docs:
            with st.expander(f"📄 {d['filename']}  ·  {d['created_at'][:16].replace('T', ' ')}"):
                st.markdown(d["summary"] or "(요약 없음)")
                c1, c2 = st.columns([1, 1])
                with c1:
                    full = db.get_document(d["id"])
                    st.download_button(
                        "원본 파일 다운로드",
                        data=full["file_blob"],
                        file_name=full["filename"],
                        key=f"dl_{d['id']}",
                    )
                with c2:
                    if st.button("삭제", key=f"del_exam_{d['id']}"):
                        db.delete_document(d["id"])
                        st.rerun()

        with st.expander("⚠️ 과목 삭제"):
            st.caption("과목을 삭제하면 해당 과목의 모든 자료/요약본도 함께 삭제됩니다.")
            if st.button(f"'{selected_name}' 과목 삭제", key="delete_subject_btn"):
                db.delete_subject(selected_subject["id"])
                st.rerun()


# ---------------- 연구실 탭 ----------------

with tab_lab:
    st.header("연구실 자료 정리")
    st.caption("논문 정리 또는 현재 진행 중인 연구(베어링 소싱, 터보젯 테스트 리그 등) 자료를 요약합니다.")

    lab_type = st.radio("자료 종류", ["논문 정리", "진행상황 정리"], horizontal=True)

    uploaded_lab_files = st.file_uploader(
        "논문/회의록/실험노트 업로드 (PDF, DOCX, PPTX, TXT)",
        type=["pdf", "docx", "pptx", "txt", "md"],
        accept_multiple_files=True,
        key="upload_lab",
    )

    if uploaded_lab_files and st.button("요약본 생성", key="summarize_lab_btn"):
        if not api_key:
            st.error("먼저 Gemini API 키를 입력해주세요.")
        else:
            progress = st.progress(0.0, text="처리 중...")
            for i, uf in enumerate(uploaded_lab_files):
                file_bytes = uf.getvalue()
                text = extractor.extract_text(uf.name, file_bytes)
                with st.spinner(f"'{uf.name}' 요약 생성 중..."):
                    try:
                        summary = gemini_helper.summarize(text, mode="lab")
                    except Exception as e:
                        summary = f"[요약 생성 실패: {e}]"
                db.add_document(
                    category="lab",
                    subject_id=None,
                    filename=uf.name,
                    file_blob=file_bytes,
                    extracted_text=text,
                    summary=summary,
                    summary_type=lab_type,
                )
                progress.progress((i + 1) / len(uploaded_lab_files), text=f"{uf.name} 완료")
            st.success("요약본 생성이 완료되었습니다.")
            st.rerun()

    st.markdown("---")
    st.subheader("저장된 연구실 요약본")
    lab_docs = db.list_documents("lab")
    if not lab_docs:
        st.caption("아직 요약본이 없습니다.")
    for d in lab_docs:
        badge = d["summary_type"] or ""
        with st.expander(f"🧪 [{badge}] {d['filename']}  ·  {d['created_at'][:16].replace('T', ' ')}"):
            st.markdown(d["summary"] or "(요약 없음)")
            c1, c2 = st.columns([1, 1])
            with c1:
                full = db.get_document(d["id"])
                st.download_button(
                    "원본 파일 다운로드",
                    data=full["file_blob"],
                    file_name=full["filename"],
                    key=f"dl_lab_{d['id']}",
                )
            with c2:
                if st.button("삭제", key=f"del_lab_{d['id']}"):
                    db.delete_document(d["id"])
                    st.rerun()
