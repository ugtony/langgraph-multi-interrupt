import React, { useState, useRef } from 'react';

export default function App() {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  
  const [uiMode, setUiMode] = useState('chat');
  const [interruptData, setInterruptData] = useState(null);
  const [editorContent, setEditorContent] = useState('');

  // 👉 新增一個 State 用來儲存所有收到的 Event 日誌
  const [eventsLog, setEventsLog] = useState([]);

  const threadId = useRef(`thread-${Math.random().toString(36).substring(7)}`);

  const sendStreamRequest = async (payload) => {
    try {
      const response = await fetch('http://localhost:8000/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.body) throw new Error('ReadableStream not yet supported.');

      const reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split('\n\n');
        buffer = parts.pop();

        for (const part of parts) {
          if (part.trim().startsWith('data:')) {
            const jsonStr = part.replace(/^data:\s*/, '');
            try {
              const data = JSON.parse(jsonStr);
              
              // 👉 收到資料時，先把完整的 Event 塞進 Log 陣列中
              setEventsLog((prev) => [...prev, data]);
              
              handleStreamEvent(data);
            } catch (e) {
              console.error('JSON Parse Error:', e);
            }
          }
        }
      }
    } catch (error) {
      console.error('Stream Request Failed:', error);
    }
  };

  const handleStreamEvent = (data) => {
    if (data.type === 'message') {
      setMessages((prev) => [...prev, { sender: 'bot', text: data.content }]);
    } 
    else if (data.type === 'interrupt') {
      const { event_type, payload } = data.data;
      setInterruptData(payload);
      setUiMode(event_type);
      
      if (event_type === 'csv_editor') {
        setEditorContent(payload.csv_content);
      } else if (event_type === 'text_input') {
        setEditorContent('');
      }
    }
    else if (data.type === 'error') {
      alert(`發生錯誤: ${data.content}`);
    }
  };

  const handleSendMessage = () => {
    if (!inputText.trim()) return;
    setMessages((prev) => [...prev, { sender: 'user', text: inputText }]);
    sendStreamRequest({ thread_id: threadId.current, message: inputText });
    setInputText('');
  };

  const handleSubmitInterrupt = () => {
    sendStreamRequest({ thread_id: threadId.current, resume_data: editorContent });
    setUiMode('chat');
    setInterruptData(null);
    setEditorContent('');
  };

  // 👉 使用 Flexbox 建立左右雙欄佈局
  return (
    <div style={{ display: 'flex', gap: '20px', maxWidth: '1000px', margin: '40px auto', fontFamily: 'sans-serif' }}>
      
      {/* ===== 左側：聊天室與動態 UI ===== */}
      <div style={{ flex: 6, display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <h2>LangGraph Agentic UI</h2>
        
        <div style={{ height: '400px', overflowY: 'auto', border: '1px solid #ccc', padding: '15px', borderRadius: '8px' }}>
          {messages.map((msg, index) => (
            <div key={index} style={{ textAlign: msg.sender === 'user' ? 'right' : 'left', margin: '10px 0' }}>
              <span style={{ 
                background: msg.sender === 'user' ? '#007bff' : '#f1f1f1', 
                color: msg.sender === 'user' ? '#fff' : '#000',
                padding: '8px 12px', 
                borderRadius: '16px',
                display: 'inline-block',
                whiteSpace: 'pre-wrap'
              }}>
                {msg.text}
              </span>
            </div>
          ))}
        </div>

        <div style={{ border: '1px solid #007bff', padding: '15px', borderRadius: '8px', background: '#f9f9f9' }}>
          {uiMode === 'chat' && (
            <div style={{ display: 'flex', gap: '10px' }}>
              <input 
                type="text" 
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="輸入 'csv' 或 'text' 測試中斷..."
                style={{ flex: 1, padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
              />
              <button onClick={handleSendMessage} style={{ padding: '10px 20px', cursor: 'pointer' }}>發送</button>
            </div>
          )}

          {uiMode === 'csv_editor' && interruptData && (
            <div>
              <h4 style={{ marginTop: 0 }}>{interruptData.title}</h4>
              <textarea 
                value={editorContent}
                onChange={(e) => setEditorContent(e.target.value)}
                rows={6}
                style={{ width: '100%', fontFamily: 'monospace', padding: '8px', boxSizing: 'border-box' }}
              />
              <div style={{ marginTop: '10px', textAlign: 'right' }}>
                <button onClick={handleSubmitInterrupt} style={{ padding: '8px 16px', background: '#28a745', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                  確認並提交修改
                </button>
              </div>
            </div>
          )}

          {uiMode === 'text_input' && interruptData && (
            <div>
              <h4 style={{ marginTop: 0 }}>{interruptData.title}</h4>
              <p style={{ fontSize: '14px', color: '#666' }}>{interruptData.description}</p>
              <input 
                type="text" 
                value={editorContent}
                onChange={(e) => setEditorContent(e.target.value)}
                style={{ width: '100%', padding: '8px', boxSizing: 'border-box' }}
              />
               <div style={{ marginTop: '10px', textAlign: 'right' }}>
                <button onClick={handleSubmitInterrupt} style={{ padding: '8px 16px', background: '#ffc107', border: 'none', borderRadius: '4px', cursor: 'pointer' }}>
                  送出授權
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ===== 右側：Event 監控面板 ===== */}
      <div style={{ flex: 4, display: 'flex', flexDirection: 'column' }}>
        <h2 style={{ color: '#555' }}>Event Logs</h2>
        <div style={{ 
          flex: 1, 
          background: '#1e1e1e', 
          color: '#d4d4d4', 
          padding: '15px', 
          borderRadius: '8px', 
          overflowY: 'auto', 
          maxHeight: '520px',
          boxShadow: 'inset 0 0 10px rgba(0,0,0,0.5)'
        }}>
          {eventsLog.length === 0 ? (
            <div style={{ color: '#888', fontStyle: 'italic' }}>等待接收事件中...</div>
          ) : (
            eventsLog.map((ev, idx) => (
              <div key={idx} style={{ 
                borderBottom: '1px solid #333', 
                paddingBottom: '10px', 
                marginBottom: '10px' 
              }}>
                <div style={{ fontSize: '12px', color: '#4caf50', marginBottom: '4px' }}>
                  #{idx + 1} - {new Date().toLocaleTimeString()}
                </div>
                {/* 利用 JSON.stringify 搭配 null, 2 參數，讓 JSON 縮排漂亮印出 */}
                <pre style={{ margin: 0, fontSize: '13px', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontFamily: 'monospace' }}>
                  {JSON.stringify(ev, null, 2)}
                </pre>
              </div>
            ))
          )}
        </div>
        {/* 清空日誌按鈕 */}
        <button 
          onClick={() => setEventsLog([])} 
          style={{ marginTop: '10px', padding: '8px', cursor: 'pointer', background: '#eee', border: '1px solid #ccc', borderRadius: '4px' }}
        >
          清空 Logs
        </button>
      </div>

    </div>
  );
}