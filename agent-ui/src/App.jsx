import React, { useState, useRef, useEffect } from 'react';

export default function App() {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [eventsLog, setEventsLog] = useState([]);
  
  // 中斷狀態現在只需要存一包完整的 API Event 即可
  const [interruptData, setInterruptData] = useState(null);
  const [editableGridData, setEditableGridData] = useState([]);

  const threadId = useRef(`thread-${Math.random().toString(36).substring(7)}`);

  const sendStreamRequest = async (payload) => {
    try {
      const response = await fetch('http://localhost:8000/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

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
      // 將後端傳來的 ui_type 與 payload 一起存入歷史紀錄
      setMessages((prev) => [...prev, { 
        sender: 'bot', 
        content: data.content,
        ui_type: data.ui_type,
        payload: data.payload 
      }]);
    } 
    else if (data.type === 'interrupt') {
      // 收到中斷，直接把整包 event 存起來
      setInterruptData(data);
      if (data.ui_type === 'editable_table') {
        // 將 JSON Array 初始化進編輯器的 State
        setEditableGridData(data.payload.data);
      }
    }
  };

  const handleSendMessage = () => {
    if (!inputText.trim()) return;
    setMessages((prev) => [...prev, { sender: 'user', content: inputText, ui_type: 'text' }]);
    sendStreamRequest({ thread_id: threadId.current, message: inputText });
    setInputText('');
  };

  const handleSubmitInterrupt = () => {
    // 依照契約：回傳 action_id 與修改後的 payload 陣列
    sendStreamRequest({ 
      thread_id: threadId.current, 
      action_id: interruptData.action_id,
      payload: editableGridData 
    });
    setInterruptData(null); // 清空並關閉中斷畫面
  };

  // 處理表格欄位變更
  const handleCellChange = (rowIndex, colName, newValue) => {
    const newData = [...editableGridData];
    newData[rowIndex][colName] = newValue;
    setEditableGridData(newData);
  };

  return (
    <div style={{ display: 'flex', gap: '20px', maxWidth: '1200px', margin: '40px auto', fontFamily: 'sans-serif' }}>
      
      {/* 左側：對話區塊 */}
      <div style={{ flex: 6, display: 'flex', flexDirection: 'column', gap: '15px' }}>
        <h2>前端 React 實作 (Server-Driven UI)</h2>
        
        {/* 歷史對話區 */}
        <div style={{ height: '500px', overflowY: 'auto', border: '1px solid #ccc', padding: '15px', borderRadius: '8px' }}>
          {messages.map((msg, index) => (
            <div key={index} style={{ textAlign: msg.sender === 'user' ? 'right' : 'left', margin: '15px 0' }}>
              <div style={{ 
                background: msg.sender === 'user' ? '#007bff' : '#f1f1f1', 
                color: msg.sender === 'user' ? '#fff' : '#000',
                padding: '10px 15px', borderRadius: '8px', display: 'inline-block', maxWidth: '80%', textAlign: 'left'
              }}>
                <div style={{ whiteSpace: 'pre-wrap', marginBottom: msg.ui_type !== 'text' ? '10px' : '0' }}>
                  {msg.content}
                </div>
                
                {/* 根據 ui_type 動態渲染歷史訊息中的唯讀表格 */}
                {msg.ui_type === 'readonly_table' && msg.payload && (
                  <div style={{ background: '#fff', color: '#000', padding: '10px', borderRadius: '4px', border: '1px solid #ddd' }}>
                    <h4 style={{ margin: '0 0 10px 0' }}>{msg.payload.title}</h4>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '14px' }}>
                      <thead>
                        <tr style={{ background: '#eee' }}>
                          {msg.payload.columns.map(col => <th key={col} style={{ border: '1px solid #ccc', padding: '6px' }}>{col}</th>)}
                        </tr>
                      </thead>
                      <tbody>
                        {msg.payload.data.map((row, i) => (
                          <tr key={i}>
                            {msg.payload.columns.map(col => <td key={col} style={{ border: '1px solid #ccc', padding: '6px' }}>{row[col]}</td>)}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* 動態輸入區塊 (狀態機切換) */}
        <div style={{ border: '2px solid #007bff', padding: '15px', borderRadius: '8px', background: '#f8f9fa' }}>
          
          {/* 一般對話模式 */}
          {!interruptData && (
            <div style={{ display: 'flex', gap: '10px' }}>
              <input 
                type="text" 
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()}
                placeholder="輸入 '唯讀' 或 '編輯' 測試流程..."
                style={{ flex: 1, padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }}
              />
              <button onClick={handleSendMessage} style={{ padding: '10px 20px', cursor: 'pointer', background: '#007bff', color: '#fff', border: 'none', borderRadius: '4px' }}>發送</button>
            </div>
          )}

          {/* 編輯表格模式 (Interrupt) */}
          {interruptData && interruptData.ui_type === 'editable_table' && (
            <div>
              <h3 style={{ marginTop: 0, color: '#d9534f' }}>{interruptData.payload.title}</h3>
              <p style={{ fontSize: '12px', color: '#666' }}>Action ID: {interruptData.action_id}</p>
              
              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '15px', background: '#fff' }}>
                <thead>
                  <tr style={{ background: '#e9ecef' }}>
                    {interruptData.payload.columns.map(col => <th key={col} style={{ border: '1px solid #ccc', padding: '8px' }}>{col}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {editableGridData.map((row, rowIndex) => (
                    <tr key={rowIndex}>
                      {interruptData.payload.columns.map(col => (
                        <td key={col} style={{ border: '1px solid #ccc', padding: '4px' }}>
                          <input 
                            type="text" 
                            value={row[col]} 
                            onChange={(e) => handleCellChange(rowIndex, col, e.target.value)}
                            style={{ width: '100%', boxSizing: 'border-box', padding: '4px', border: 'none', background: 'transparent' }}
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <div style={{ textAlign: 'right' }}>
                <button onClick={handleSubmitInterrupt} style={{ padding: '10px 20px', background: '#28a745', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>
                  確認無誤並送出
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 右側：Event Logs 面板保持不變 */}
      <div style={{ flex: 4, display: 'flex', flexDirection: 'column' }}>
        <h2 style={{ color: '#555' }}>Event Logs 契約監控</h2>
        <div style={{ flex: 1, background: '#1e1e1e', color: '#d4d4d4', padding: '15px', borderRadius: '8px', overflowY: 'auto', maxHeight: '600px' }}>
          {eventsLog.length === 0 ? <div style={{ color: '#888' }}>等待接收事件中...</div> : eventsLog.map((ev, idx) => (
            <div key={idx} style={{ borderBottom: '1px solid #333', paddingBottom: '10px', marginBottom: '10px' }}>
              <div style={{ fontSize: '12px', color: '#4caf50', marginBottom: '4px' }}>#{idx + 1}</div>
              <pre style={{ margin: 0, fontSize: '12px', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                {JSON.stringify(ev, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}