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
            current_event = "message" # 預設事件類型
            
            for line in response.iter_lines():
                if line:
                    decoded_line = line.decode('utf-8')
                    
                    # 抓取事件類型
                    if decoded_line.startswith("event:"):
                        current_event = decoded_line.replace("event:", "").strip()
                    
                    # 抓取資料並執行對應邏輯
                    elif decoded_line.startswith("data:"):
                        json_str = decoded_line.replace("data:", "").strip()
                        try:
                            data_obj = json.loads(json_str)
                            
                            # 記錄到 Logs (包含 event 與 data)
                            st.session_state.events_log.append({
                                "event": current_event,
                                "data": data_obj
                            })
                            
                            if current_event == "message":
                                st.session_state.messages.append({
                                    "role": "assistant", 
                                    "content": data_obj.get("content", ""),
                                    "ui_type": data_obj.get("ui_type", "text"),
                                    "payload": data_obj.get("payload")
                                })
                            
                            elif current_event == "interrupt":
                                st.session_state.interrupt_data = data_obj
                                
                            elif current_event == "error":
                                st.error(f"發生錯誤: {data_obj.get('content')}")
                                
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
    st.header("💬 LangGraph 前端介面 (標準 SSE)")
    
    chat_container = st.container(height=500)
    with chat_container:
        for msg in st.session_state.messages:
            with st.chat_message(msg["role"]):
                st.write(msg["content"])
                if msg.get("ui_type") == "readonly_table" and msg.get("payload"):
                    st.caption(msg["payload"].get("title", "報表資料"))
                    df = pd.DataFrame(msg["payload"]["data"])
                    st.dataframe(df, hide_index=True, use_container_width=True)
                
    st.divider()

    if not st.session_state.interrupt_data:
        with st.form(key="chat_form", clear_on_submit=False):
            col_input, col_btn = st.columns([8, 2])
            with col_input:
                st.text_input("輸入訊息...", key="chat_input_text", placeholder="輸入 '唯讀' 或 '編輯'...")
            with col_btn:
                st.form_submit_button("發送", use_container_width=True, on_click=handle_send_message)

    elif st.session_state.interrupt_data.get("ui_type") == "editable_table":
        interrupt_payload = st.session_state.interrupt_data["payload"]
        st.error(interrupt_payload.get("title", "請確認並編輯資料"))
        st.caption(f"Action ID: {st.session_state.interrupt_data['action_id']}")
        
        df = pd.DataFrame(interrupt_payload["data"])
        edited_df = st.data_editor(df, num_rows="dynamic", hide_index=True, use_container_width=True)
        
        if st.button("✅ 確認無誤並送出", type="primary"):
            final_data_list = edited_df.to_dict(orient="records")
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
            st.caption(f"Event #{len(st.session_state.events_log) - idx} - {ev['event']}")
            st.json(ev["data"])