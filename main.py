import json
import uuid
import uvicorn
from typing import TypedDict, Any
from fastapi import FastAPI
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from fastapi.middleware.cors import CORSMiddleware

from langgraph.graph import StateGraph, START, END
from langgraph.types import interrupt, Command
from langgraph.checkpoint.memory import MemorySaver
from langchain_core.messages import HumanMessage, AIMessage

# ==========================================
# 1. 定義 LangGraph 狀態與圖 (Graph)
# ==========================================
class State(TypedDict):
    messages: list

def router_node(state: State):
    """根據關鍵字路由到不同的 UI 測試節點"""
    last_msg = state["messages"][-1].content.lower()
    
    if "唯讀" in last_msg or "readonly" in last_msg:
        return Command(goto="readonly_table_node")
    elif "編輯" in last_msg or "edit" in last_msg:
        return Command(goto="editable_table_node")
    else:
        return Command(goto="chat_node")

def chat_node(state: State):
    """1. 一般文字訊息 (ui_type: text)"""
    last_msg = state["messages"][-1].content
    response_text = f"伺服器收到：'{last_msg}'。\n(提示：輸入 '唯讀' 測試靜態表格，輸入 '編輯' 測試中斷表格)"
    
    # 預設不帶 additional_kwargs，攔截器會自動判斷為 ui_type: text
    return {"messages": [AIMessage(content=response_text)]}

def readonly_table_node(state: State):
    """2. 純展示用表格 (ui_type: readonly_table)"""
    table_payload = {
        "title": "📊 2026年 第一季銷售總覽 (純展示)",
        "columns": ["月份", "營收 (萬)", "達成率"],
        "data": [
            {"月份": "1月", "營收": 150, "達成率": "95%"},
            {"月份": "2月", "營收": 180, "達成率": "110%"}
        ]
    }
    
    # 將 UI Schema 藏在 additional_kwargs 中
    msg = AIMessage(
        content="為您產生了最新的報表：", 
        additional_kwargs={
            "ui_type": "readonly_table",
            "payload": table_payload
        }
    )
    return {"messages": [msg]}

def editable_table_node(state: State):
    """3. 需要使用者編輯/確認的表格 (ui_type: editable_table)"""
    
    # 產生一個唯一的 action_id 給前端
    action_id = f"confirm_users_{uuid.uuid4().hex[:6]}"
    
    table_payload = {
        "title": "⚠️ 系統即將匯入以下名單，請確認並編輯欄位：",
        "columns": ["姓名", "部門", "權限"],
        "data": [
            {"姓名": "Alice", "部門": "RD", "權限": "Admin"},
            {"姓名": "Bob", "部門": "Sales", "權限": "User"}
        ]
    }
    
    # 觸發中斷，直接依照 API 契約回傳所需的 JSON 結構
    user_edited_data = interrupt({
        "ui_type": "editable_table",
        "action_id": action_id,
        "payload": table_payload
    })
    
    # 當前端打回 Resume API 喚醒此節點後，user_edited_data 就是前端傳回來的新陣列
    msg = AIMessage(content=f"✅ 已收到前端回傳的修改資料：\n{json.dumps(user_edited_data, ensure_ascii=False)}")
    return {"messages": [msg]}

# 組裝 Graph
builder = StateGraph(State)
builder.add_node("router_node", router_node)
builder.add_node("chat_node", chat_node)
builder.add_node("readonly_table_node", readonly_table_node)
builder.add_node("editable_table_node", editable_table_node)

builder.add_edge(START, "router_node")
builder.add_edge("chat_node", END)
builder.add_edge("readonly_table_node", END)
builder.add_edge("editable_table_node", END)

memory = MemorySaver()
graph = builder.compile(checkpointer=memory)

# ==========================================
# 2. 定義 FastAPI 應用程式與串流 API
# ==========================================
app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    thread_id: str
    message: str | None = None
    # 為了配合前端統一打回來的規格，新增這兩個欄位
    action_id: str | None = None
    payload: Any = None  # 接收前端修改後的陣列資料

@app.post("/stream")
async def chat_stream(req: ChatRequest):
    async def event_generator():
        config = {"configurable": {"thread_id": req.thread_id}}
        
        try:
            # 判斷是「恢復流程(Resume)」還是「新對話」
            if req.action_id is not None and req.payload is not None:
                # 把前端編輯完的 payload 當作 resume 的值傳進去喚醒 Graph
                stream = graph.astream(Command(resume=req.payload), config, stream_mode="updates")
            else:
                if not req.message:
                    yield f"data: {json.dumps({'type': 'error', 'content': 'Message cannot be empty'})}\n\n"
                    return
                stream = graph.astream({"messages": [HumanMessage(content=req.message)]}, config, stream_mode="updates")
            
            # === 攔截並格式化輸出 (API 契約轉換層) ===
            async for chunk in stream:
                
                # A. 處理中斷事件 (Interrupt)
                if "__interrupt__" in chunk:
                    interrupt_data = chunk["__interrupt__"][0].value
                    
                    # 按照契約，打包 type="interrupt"，加上節點吐出的 ui_type, action_id, payload
                    response_event = {
                        "type": "interrupt",
                        **interrupt_data 
                    }
                    yield f"data: {json.dumps(response_event, ensure_ascii=False)}\n\n"
                
                # B. 處理一般節點更新 (Message)
                else:
                    for node_name, node_data in chunk.items():
                        if node_data is not None and "messages" in node_data:
                            last_msg = node_data["messages"][-1]
                            
                            # 嘗試從 additional_kwargs 提取隱藏的 UI 資訊，預設為一般 text
                            ui_type = last_msg.additional_kwargs.get("ui_type", "text")
                            payload = last_msg.additional_kwargs.get("payload", None)
                            
                            response_event = {
                                "type": "message",
                                "ui_type": ui_type,
                                "content": last_msg.content
                            }
                            if payload is not None:
                                response_event["payload"] = payload
                                
                            yield f"data: {json.dumps(response_event, ensure_ascii=False)}\n\n"
                            
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)