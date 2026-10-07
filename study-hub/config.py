"""비밀 값(API 키 등)을 읽는 곳.

Streamlit Cloud의 Secrets, 로컬의 .streamlit/secrets.toml, 환경변수 순서로 찾는다.
"""

import os

import streamlit as st


def get_secret(name, default=None):
    try:
        if name in st.secrets:
            return st.secrets[name]
    except Exception:
        # secrets.toml 이 아예 없을 때도 앱이 죽지 않게 한다.
        pass
    return os.environ.get(name, default)
