import streamlit as st
import requests
import json
import uuid
import pandas as pd
import io

# 1. 初始化 Session State
if "thread_id" not in st.session_state:
    st.session_state.thread_id = f"thread-{uuid.uuid4().hex[:8]}"
if "messages" not in st.session_state:
    st.session_state.messages = []
if "events_log" not in st.session_state:
    st.session_state.events_log = []
if "ui_mode" not in st.session_state:
    st.session_state.ui_mode = "chat" # 'chat' | 'csv_editor' | 'text_input'
if "interrupt_data" not in st.session_state:
    st.session_state.interrupt_data = None
if "editor_content" not in st.session_state:
    st.session_state.editor_content = ""

# 2. 核心邏輯：發送請求並處理 SSE 串流
def send_stream_request(payload):
    url = "http://localhost:8000/stream"
    try:
        with requests.post(url, json=payload, stream=True) as response:
            for line in response.iter_lines():
                if line:
                    decoded_line = line.decode('utf-8')
                    if decoded_line.startswith("data:"):
                        json_str = decoded_line.replace("data:", "").strip()
                        try:
                            data = json.loads(json_str)
                            st.session_state.events_log.append(data)
                            
                            if data.get("type") == "message":
                                st.session_state.messages.append({"role": "assistant", "content": data["content"]})
                            
                            elif data.get("type") == "interrupt":
                                event_type = data["data"]["event_type"]
                                payload_data = data["data"]["payload"]
                                
                                st.session_state.interrupt_data = payload_data
                                st.session_state.ui_mode = event_type
                                
                                if event_type == "text_input":
                                    st.session_state.editor_content = ""
                                    
                            elif data.get("type") == "error":
                                st.error(f"發生錯誤: {data['content']}")
                                
                        except json.JSONDecodeError:
                            pass
    except Exception as e:
        st.error(f"無法連線到後端，錯誤: {e}")

# 3. 處理一般訊息與文字中斷的 Callbacks
def handle_send_message():
    user_input = st.session_state.chat_input_text
    if not user_input.strip():
        return
    st.session_state.messages.append({"role": "user", "content": user_input})
    st.session_state.chat_input_text = ""
    send_stream_request({
        "thread_id": st.session_state.thread_id,
        "message": user_input
    })

def handle_submit_text_interrupt():
    send_stream_request({
        "thread_id": st.session_state.thread_id,
        "resume_data": st.session_state.editor_content
    })
    st.session_state.ui_mode = "chat"
    st.session_state.interrupt_data = None
    st.session_state.editor_content = ""

def clear_logs():
    st.session_state.events_log = []


# ==========================================
# 4. Streamlit 介面佈局
# ==========================================
st.set_page_config(page_title="LangGraph Agentic UI", layout="wide")
col_left, col_right = st.columns([6, 4])

# ===== 左側：聊天室與動態 UI =====
with col_left:
    st.header("💬 LangGraph Agentic UI")
    
    chat_container = st.container(height=450)
    with chat_container:
        for msg in st.session_state.messages:
            with st.chat_message(msg["role"]):
                st.write(msg["content"])
                
    st.divider()

    # 狀態機：一般聊天模式
    if st.session_state.ui_mode == "chat":
        with st.form(key="chat_form", clear_on_submit=False):
            col_input, col_btn = st.columns([8, 2])
            with col_input:
                st.text_input("輸入訊息...", key="chat_input_text", placeholder="輸入 'csv' 或 'text' 測試中斷...")
            with col_btn:
                st.form_submit_button("發送", use_container_width=True, on_click=handle_send_message)

    # 狀態機：進階 CSV 表格編輯器模式
    elif st.session_state.ui_mode == "csv_editor" and st.session_state.interrupt_data:
        st.subheader(st.session_state.interrupt_data.get("title", "請確認並編輯資料"))
        
        # 將後端傳來的 CSV 字串轉換為 pandas DataFrame
        csv_str = st.session_state.interrupt_data.get("csv_content", "")
        df = pd.read_csv(io.StringIO(csv_str))
        
        # 使用 st.data_editor 渲染互動式表格 (支援新增/刪除列)
        edited_df = st.data_editor(
            df, 
            num_rows="dynamic", # 允許使用者動態新增或刪除資料列
            use_container_width=True,
            hide_index=True
        )
        
        # 這裡不使用 callback，直接用 if st.button 抓取最新的 edited_df
        if st.button("✅ 確認並提交修改", type="primary"):
            # 將編輯後的 DataFrame 轉回 CSV 字串
            final_csv_str = edited_df.to_csv(index=False)
            
            # 打回後端喚醒 Graph
            send_stream_request({
                "thread_id": st.session_state.thread_id,
                "resume_data": final_csv_str
            })
            
            # 重置狀態並強制重繪畫面
            st.session_state.ui_mode = "chat"
            st.session_state.interrupt_data = None
            st.rerun()

    # 狀態機：一般文字輸入模式
    elif st.session_state.ui_mode == "text_input" and st.session_state.interrupt_data:
        st.subheader(st.session_state.interrupt_data.get("title", "請輸入資訊"))
        st.caption(st.session_state.interrupt_data.get("description", ""))
        st.session_state.editor_content = st.text_input("輸入內容：", value=st.session_state.editor_content)
        st.button("🚀 送出授權", on_click=handle_submit_text_interrupt, type="primary")

# ===== 右側：Event 監控面板 =====
with col_right:
    st.header("📡 Event Logs")
    st.button("🗑️ 清空 Logs", on_click=clear_logs)
    
    log_container = st.container(height=550)
    with log_container:
        if not st.session_state.events_log:
            st.info("等待接收事件中...")
        else:
            for idx, ev in enumerate(reversed(st.session_state.events_log)):
                real_idx = len(st.session_state.events_log) - idx
                st.caption(f"Event #{real_idx}")
                st.json(ev)