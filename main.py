import json
import uvicorn
from typing import TypedDict
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
    """
    這是一個扮演 Router 的節點。
    實務上你可以用 LLM 判斷意圖，這裡用關鍵字來示範兩種不同的 Interrupt 分支。
    """
    last_msg = state["messages"][-1].content.lower()
    
    if "csv" in last_msg:
        # 使用 Command(goto=...) 讓流程跳轉到對應節點 (LangGraph 0.2+ 寫法)
        return Command(goto="csv_interrupt_node")
    elif "text" in last_msg or "文字" in last_msg:
        return Command(goto="text_interrupt_node")
    else:
        return Command(goto="chat_node")

def chat_node(state: State):
    """處理一般對話的節點"""
    last_msg = state["messages"][-1].content
    response_text = f"伺服器收到一般訊息：'{last_msg}'。\n(提示：輸入 'csv' 測試表格中斷，輸入 'text' 測試文字中斷)"
    return {"messages": [AIMessage(content=response_text)]}

def csv_interrupt_node(state: State):
    """處理 CSV 編輯的中斷節點"""
    # 觸發中斷，這包 dict 會被拋到前端
    user_edited_csv = interrupt({
        "event_type": "csv_editor",
        "payload": {
            "title": "請確認並編輯以下 CSV 資料",
            "csv_content": "id,name,role\n1,Alice,Admin\n2,Bob,User"
        }
    })
    
    # 當前端呼叫 Resume 喚醒此節點後，user_edited_csv 就會是前端傳回來的資料
    return {"messages": [AIMessage(content=f"太棒了！已收到前端回傳的 CSV 更新：\n{user_edited_csv}")]}

def text_interrupt_node(state: State):
    """處理一般文字輸入的中斷節點"""
    user_text = interrupt({
        "event_type": "text_input",
        "payload": {
            "title": "系統需要你的進階授權",
            "description": "請輸入 4 碼數字授權碼以繼續執行動作："
        }
    })
    
    return {"messages": [AIMessage(content=f"授權成功！你輸入的授權碼為：{user_text}，流程繼續執行。")]}

# 組裝 Graph
builder = StateGraph(State)
builder.add_node("router_node", router_node)
builder.add_node("chat_node", chat_node)
builder.add_node("csv_interrupt_node", csv_interrupt_node)
builder.add_node("text_interrupt_node", text_interrupt_node)

builder.add_edge(START, "router_node")
builder.add_edge("chat_node", END)
builder.add_edge("csv_interrupt_node", END)
builder.add_edge("text_interrupt_node", END)

# 必須加上 Checkpointer 才能使用 interrupt 暫停/恢復功能
memory = MemorySaver()
graph = builder.compile(checkpointer=memory)


# ==========================================
# 2. 定義 FastAPI 應用程式與串流 API
# ==========================================
app = FastAPI()

# 允許跨域請求 (開發前端時會用到)
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
    resume_data: str | None = None  # 前端打回來恢復流程的資料

@app.post("/stream")
async def chat_stream(req: ChatRequest):
    async def event_generator():
        # 設定 thread_id 以維持對話與中斷狀態
        config = {"configurable": {"thread_id": req.thread_id}}
        
        try:
            if req.resume_data is not None:
                # 1. 若為 Resume 請求：帶入前端的回傳資料，喚醒暫停的 Graph
                stream = graph.astream(Command(resume=req.resume_data), config, stream_mode="updates")
            else:
                # 2. 若為一般請求：將新訊息傳入 Graph
                if not req.message:
                    yield f"data: {json.dumps({'type': 'error', 'content': 'Message cannot be empty'})}\n\n"
                    return
                inputs = {"messages": [HumanMessage(content=req.message)]}
                stream = graph.astream(inputs, config, stream_mode="updates")
            
            # 處理 LangGraph 產生的串流事件 (Server-Sent Events)
            async for chunk in stream:
                # LangGraph 0.2 在 updates 模式下，會以 "__interrupt__" key 拋出中斷
                if "__interrupt__" in chunk:
                    # 取出我們在 interrupt() 中定義的字典 payload
                    # (chunk["__interrupt__"] 是一個 Tuple，包含 Interrupt 物件)
                    interrupt_value = chunk["__interrupt__"][0].value
                    yield f"data: {json.dumps({'type': 'interrupt', 'data': interrupt_value}, ensure_ascii=False)}\n\n"
                
                else:
                    # 擷取一般 Node 的狀態更新並回傳對話文字
                    for node_name, node_data in chunk.items():
                        # 👉 新增 node_data is not None 的判斷
                        if node_data is not None and "messages" in node_data:
                            last_msg = node_data["messages"][-1].content
                            yield f"data: {json.dumps({'type': 'message', 'node': node_name, 'content': last_msg}, ensure_ascii=False)}\n\n"
                            
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000)