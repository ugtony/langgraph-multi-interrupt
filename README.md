# 🚀 LangGraph Agentic UI (Human-in-the-loop) 實作範例

這是一個展示如何結合 **LangGraph (v0.2+)** 與 **前端動態介面 (Generative UI / Agentic UI)** 的全端實作範例。

透過 Server-Sent Events (SSE) 串流與 LangGraph 的 `interrupt` / `resume` 機制，當 AI Agent 需要使用者確認資料（例如編輯 CSV 表格或輸入授權碼）時，前端聊天室會自動變形為對應的互動式介面，待使用者提交後再無縫接續後端的工作流程。

## ✨ 核心特色

* **🧠 狀態機驅動的前端 (Agentic UI)：** 前端根據後端串流傳遞的 `event_type`，動態在「一般聊天」、「CSV 試算表編輯器」與「文字授權輸入框」之間切換。
* **⏸️ LangGraph 中斷與恢復 (HITL)：** 實作 Human-in-the-loop，精準暫停 Graph 執行流程，並將使用者的修改結果（Resume Data）注回流程中繼續執行。
* **⚡ 雙前端框架支援：** 提供 **React (Vite)** 與 **Streamlit** 兩種前端實作版本，可依據使用情境自由選擇。
* **📊 互動式表格編輯：** Streamlit 版本內建 `st.data_editor`，支援動態新增、刪除、修改表格資料並轉回 CSV。

---

## 🛠️ 技術堆疊

* **後端:** Python, FastAPI, LangGraph, LangChain Core, Pydantic, Uvicorn
* **前端 (Option A - Web 開發):** React, Vite, CSS Flexbox
* **前端 (Option B - 快速原型):** Streamlit, Pandas, Requests

---

## 🚀 快速啟動指南

### 1. 啟動 FastAPI 後端
後端負責運行 LangGraph 狀態機與提供 `/stream` SSE API。

```bash
# 安裝必要套件
pip install fastapi uvicorn langgraph langchain-core pydantic

# 啟動伺服器 (預設運行於 http://localhost:8000)
python main.py
```

### 2. 啟動前端 (選擇一種你喜歡的方式)
#### 選項 A：使用 Streamlit (推薦給 Python 開發者)
擁有原生的互動式 Data Grid (st.data_editor)，適合快速驗證 Agent 概念。

```Bash
# 安裝必要套件
pip install streamlit requests pandas

# 啟動 Streamlit (預設運行於 http://localhost:8501)
streamlit run app.py
```

#### 選項 B：使用 React + Vite (推薦給 Web 開發者)
提供手動解析 SSE 串流的完整實作，適合準備整合進現有 Web 產品的開發者。

```Bash
# 建立並進入專案資料夾 (若尚未建立)
npm create vite@latest agent-ui -- --template react
cd agent-ui

# 安裝依賴套件
npm install

# 啟動開發伺服器 (預設運行於 http://localhost:5173)
npm run dev
```
(註：請確保已將 App.jsx 替換為本專案提供的 React 程式碼)

## 🎮 如何測試與使用
開啟前端介面後，因為目前後端使用的是「關鍵字路由 (Keyword Router)」來模擬 LLM 的決策，你可以透過以下關鍵字觸發不同的 UI 狀態：

1. 一般對話： 輸入任何不含觸發關鍵字的句子（例如：「你好」），後端會正常回覆文字。

2. 測試 CSV 表格中斷： 在輸入框打入 我要編輯 csv。

    * 預期行為： 聊天介面會切換成表格編輯器，右側 Event Log 會收到 type: "interrupt" 的事件。修改資料後按下「確認並提交修改」，流程會繼續。

3. 測試文字輸入中斷： 在輸入框打入 我要輸入 text。

    * 預期行為： 介面會切換為需要輸入授權碼的表單。

## 📂 專案結構建議
```Plaintext
langgraph-agentic-ui/
├── backend/
│   └── main.py          # FastAPI 與 LangGraph 定義
├── frontend-streamlit/
│   └── app.py           # Streamlit 介面與 SSE 接收邏輯
├── frontend-react/
│   ├── src/
│   │   └── App.jsx      # React 聊天室元件與狀態機
│   ├── package.json
│   └── vite.config.js
└── README.md
```

## 🤝 後續擴充建議
1. 整合真實 LLM： 將 main.py 中的 router_node 替換為呼叫 OpenAI 或 Gemini API，透過 bind_tools 讓 AI 自動決定何時觸發 interrupt。

2. 持久化記憶體： 將 LangGraph 的 MemorySaver() 替換為 Postgres 或 Redis 儲存，以支援跨裝置的對話狀態保存。