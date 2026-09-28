"""Pull plain text out of uploaded files so it can be sent to Gemini."""

import io


def extract_text(filename: str, file_bytes: bytes) -> str:
    name = filename.lower()
    try:
        if name.endswith(".pdf"):
            return _extract_pdf(file_bytes)
        if name.endswith(".docx"):
            return _extract_docx(file_bytes)
        if name.endswith(".pptx"):
            return _extract_pptx(file_bytes)
        if name.endswith((".txt", ".md")):
            return file_bytes.decode("utf-8", errors="ignore")
    except Exception as e:
        return f"[텍스트 추출 실패: {e}]"
    return "[지원하지 않는 파일 형식입니다. pdf, docx, pptx, txt만 지원합니다.]"


def _extract_pdf(file_bytes: bytes) -> str:
    import pdfplumber

    text_parts = []
    with pdfplumber.open(io.BytesIO(file_bytes)) as pdf:
        for page in pdf.pages:
            page_text = page.extract_text()
            if page_text:
                text_parts.append(page_text)
    return "\n".join(text_parts)


def _extract_docx(file_bytes: bytes) -> str:
    import docx

    doc = docx.Document(io.BytesIO(file_bytes))
    return "\n".join(p.text for p in doc.paragraphs if p.text.strip())


def _extract_pptx(file_bytes: bytes) -> str:
    from pptx import Presentation

    prs = Presentation(io.BytesIO(file_bytes))
    text_parts = []
    for i, slide in enumerate(prs.slides, start=1):
        slide_text = []
        for shape in slide.shapes:
            if shape.has_text_frame:
                for para in shape.text_frame.paragraphs:
                    line = "".join(run.text for run in para.runs)
                    if line.strip():
                        slide_text.append(line)
        if slide_text:
            text_parts.append(f"[슬라이드 {i}]\n" + "\n".join(slide_text))
    return "\n\n".join(text_parts)
