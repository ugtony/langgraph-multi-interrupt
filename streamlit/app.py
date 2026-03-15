import streamlit as st
import requests
import json
import uuid
import pandas as pd

if "thread_id" not in st.session_state:
    st.session_state.thread_id = f"thread-{uuid.uuid4().hex[:8]}"
if "messages" not in st.session_state:
    st.session_state.messages = []
if "events_log" not in st.session_state:
    st.session_state.events_log = []
if "interrupt_data" not in st.session_state:
    st.session_state.interrupt_data = None

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
                                # 將 ui_type 和 payload 存進歷史訊息中
                                st.session_state.messages.append({
                                    "role": "assistant", 
                                    "content": data["content"],
                                    "ui_type": data.get("ui_type", "text"),
                                    "payload": data.get("payload")
                                })
                            
                            elif data.get("type") == "interrupt":
                                # 完整記錄整個 Interrupt 契約 (包含 action_id 等)
                                st.session_state.interrupt_data = data
                                
                            elif data.get("type") == "error":
                                st.error(f"發生錯誤: {data['content']}")
                                
                        except json.JSONDecodeError:
                            pass
    except Exception as e:
        st.error(f"連線失敗: {e}")

def handle_send_message():
    user_input = st.session_state.chat_input_text
    if not user_input.strip(): return
    
    st.session_state.messages.append({"role": "user", "content": user_input, "ui_type": "text"})
    st.session_state.chat_input_text = ""
    send_stream_request({"thread_id": st.session_state.thread_id, "message": user_input})

st.set_page_config(page_title="Server-Driven UI (Streamlit)", layout="wide")
col_left, col_right = st.columns([6, 4])

with col_left:
    st.header("💬 LangGraph 前端介面 (API 契約驅動)")
    
    # === 1. 歷史訊息與唯讀表格渲染區 ===
    chat_container = st.container(height=500)
    with chat_container:
        for msg in st.session_state.messages:
            with st.chat_message(msg["role"]):
                st.write(msg["content"])
                
                # 若歷史訊息帶有唯讀表格，在此動態渲染
                if msg.get("ui_type") == "readonly_table" and msg.get("payload"):
                    st.caption(msg["payload"].get("title", "報表資料"))
                    # 將 JSON Array 轉成 DataFrame 並用內建唯讀表格顯示
                    df = pd.DataFrame(msg["payload"]["data"])
                    st.dataframe(df, hide_index=True, use_container_width=True)
                
    st.divider()

    # === 2. 動態輸入區塊 (狀態機判斷) ===
    if not st.session_state.interrupt_data:
        # 一般對話模式
        with st.form(key="chat_form", clear_on_submit=False):
            col_input, col_btn = st.columns([8, 2])
            with col_input:
                st.text_input("輸入訊息...", key="chat_input_text", placeholder="輸入 '唯讀' 或 '編輯' 測試流程...")
            with col_btn:
                st.form_submit_button("發送", use_container_width=True, on_click=handle_send_message)

    elif st.session_state.interrupt_data.get("ui_type") == "editable_table":
        # 編輯器中斷模式
        interrupt_payload = st.session_state.interrupt_data["payload"]
        st.error(interrupt_payload.get("title", "請確認並編輯資料"))
        st.caption(f"Action ID: {st.session_state.interrupt_data['action_id']}")
        
        # 將傳來的 JSON Array 轉換為 DataFrame 供編輯
        df = pd.DataFrame(interrupt_payload["data"])
        
        # 渲染資料編輯器
        edited_df = st.data_editor(
            df, 
            num_rows="dynamic",
            hide_index=True,
            use_container_width=True
        )
        
        if st.button("✅ 確認無誤並送出", type="primary"):
            # 將編輯後的 DataFrame 轉回 JSON Array (List of Dicts)
            final_data_list = edited_df.to_dict(orient="records")
            
            # 打回後端，帶上 action_id 與修改後的陣列
            send_stream_request({
                "thread_id": st.session_state.thread_id,
                "action_id": st.session_state.interrupt_data["action_id"],
                "payload": final_data_list
            })
            
            st.session_state.interrupt_data = None
            st.rerun()

with col_right:
    st.header("📡 Event Logs 契約監控")
    st.button("🗑️ 清空 Logs", on_click=lambda: st.session_state.events_log.clear())
    log_container = st.container(height=600)
    with log_container:
        for idx, ev in enumerate(reversed(st.session_state.events_log)):
            st.caption(f"Event #{len(st.session_state.events_log) - idx}")
            st.json(ev)