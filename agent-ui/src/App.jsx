import React, { useState, useRef } from 'react';
import { fetchEventSource } from '@microsoft/fetch-event-source';

export default function App() {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [eventsLog, setEventsLog] = useState([]);
  
  const [interruptData, setInterruptData] = useState(null);
  const [editableGridData, setEditableGridData] = useState([]);

  // 使用 useRef 保持對話的 Thread ID
  const threadId = useRef(`thread-${Math.random().toString(36).substring(7)}`);

  // 🚀 核心：使用微軟套件發送 POST SSE 請求
  const sendStreamRequest = async (payload) => {
    // 建立 AbortController 以便隨時中斷連線
    const ctrl = new AbortController();

    try {
      await fetchEventSource('http://localhost:8000/stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: ctrl.signal,
        
        // 成功建立連線
        async onopen(response) {
          if (!response.ok) {
            throw new Error(`伺服器錯誤狀態碼: ${response.status}`);
          }
        },

        // 每次收到一個完整的 SSE 事件 (免自己 parse \n\n)
        onmessage(ev) {
          try {
            const dataObj = JSON.parse(ev.data);
            
            // 寫入 Event Logs 面板
            setEventsLog((prev) => [...prev, { event: ev.event, data: dataObj }]);
            
            // 觸發 UI 狀態切換
            handleStreamEvent(ev.event, dataObj);
          } catch (e) {
            console.error('JSON Parse Error:', e, ev.data);
          }
        },

        // 🚨 關鍵防雷：當發生錯誤時，拋出例外以阻止套件預設的「無窮重試」，避免後端重複執行 AI 邏輯
        onerror(err) {
          console.error('SSE 連線發生錯誤:', err);
          throw err; 
        },

        // 串流正常結束
        onclose() {
          console.log('伺服器已結束此段串流');
        }
      });
    } catch (error) {
      console.error('Stream Request Failed:', error);
    }
  };

  // 根據事件類型更新 UI 狀態
  const handleStreamEvent = (eventType, dataObj) => {
    if (eventType === 'message') {
      setMessages((prev) => [...prev, { 
        sender: 'bot', 
        content: dataObj.content,
        ui_type: dataObj.ui_type,
        payload: dataObj.payload 
      }]);
    } 
    else if (eventType === 'interrupt') {
      setInterruptData(dataObj);
      if (dataObj.ui_type === 'editable_table') {
        // 將後端傳來的 JSON Array 直接餵給編輯器
        setEditableGridData(dataObj.payload.data);
      }
    }
    else if (eventType === 'error') {
      alert(`發生錯誤: ${dataObj.content}`);
    }
  };

  const handleSendMessage = () => {
    if (!inputText.trim()) return;
    setMessages((prev) => [...prev, { sender: 'user', content: inputText, ui_type: 'text' }]);
    sendStreamRequest({ thread_id: threadId.current, message: inputText });
    setInputText('');
  };

  const handleSubmitInterrupt = () => {
    // 依照契約：回傳 action_id 與修改後的 JSON Array (完全無狀態設計)
    sendStreamRequest({ 
      thread_id: threadId.current, 
      action_id: interruptData.action_id,
      payload: editableGridData 
    });
    setInterruptData(null); // 關閉編輯畫面
  };

  const handleCellChange = (rowIndex, colName, newValue) => {
    const newData = [...editableGridData];
    newData[rowIndex][colName] = newValue;
    setEditableGridData(newData);
  };

  return (
    <div style={{ display: 'flex', gap: '20px', maxWidth: '1200px', margin: '40px auto', fontFamily: 'sans-serif', textAlign: 'left' }}>
      {/* 左側：對話與動態 UI 區塊 */}
      <div style={{ flex: 6, display: 'flex', flexDirection: 'column', gap: '15px' }}>
        <h2>前端 React 實作 (企業級 SSE 標準版)</h2>
        <div style={{ height: '500px', overflowY: 'auto', border: '1px solid #ccc', padding: '15px', borderRadius: '8px' }}>
          {messages.map((msg, index) => (
            <div key={index} style={{ textAlign: msg.sender === 'user' ? 'right' : 'left', margin: '15px 0' }}>
              <div style={{ 
                background: msg.sender === 'user' ? '#007bff' : '#f1f1f1', 
                color: msg.sender === 'user' ? '#fff' : '#000',
                padding: '10px 15px', borderRadius: '8px', display: 'inline-block', maxWidth: '80%', textAlign: 'left'
              }}>
                <div style={{ whiteSpace: 'pre-wrap', marginBottom: msg.ui_type !== 'text' ? '10px' : '0' }}>{msg.content}</div>
                
                {/* 動態渲染唯讀表格 */}
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

        {/* 狀態機切換輸入區 */}
        <div style={{ border: '2px solid #007bff', padding: '15px', borderRadius: '8px', background: '#f8f9fa' }}>
          {!interruptData ? (
            <div style={{ display: 'flex', gap: '10px' }}>
              <input type="text" value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()} placeholder="輸入 '唯讀' 或 '編輯' 測試流程..." style={{ flex: 1, padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }} />
              <button onClick={handleSendMessage} style={{ padding: '10px 20px', cursor: 'pointer', background: '#007bff', color: '#fff', border: 'none', borderRadius: '4px' }}>發送</button>
            </div>
          ) : (
            interruptData.ui_type === 'editable_table' && (
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
                            <input type="text" value={row[col]} onChange={(e) => handleCellChange(rowIndex, col, e.target.value)} style={{ width: '100%', boxSizing: 'border-box', padding: '4px', border: 'none', background: 'transparent' }} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div style={{ textAlign: 'right' }}>
                  <button onClick={handleSubmitInterrupt} style={{ padding: '10px 20px', background: '#28a745', color: '#fff', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}>確認無誤並送出</button>
                </div>
              </div>
            )
          )}
        </div>
      </div>

      {/* 右側：Event Logs */}
      <div style={{ flex: 4, display: 'flex', flexDirection: 'column' }}>
        <h2 style={{ color: '#555' }}>Event Logs</h2>
        <div style={{ flex: 1, background: '#1e1e1e', color: '#d4d4d4', padding: '15px', borderRadius: '8px', overflowY: 'auto', maxHeight: '600px' }}>
          {eventsLog.length === 0 ? <div style={{ color: '#888' }}>等待接收事件中...</div> : eventsLog.map((ev, idx) => (
            <div key={idx} style={{ borderBottom: '1px solid #333', paddingBottom: '10px', marginBottom: '10px' }}>
              <div style={{ fontSize: '12px', color: '#4caf50', marginBottom: '4px' }}>#{idx + 1} - event: {ev.event}</div>
              <pre style={{ margin: 0, fontSize: '12px', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                {JSON.stringify(ev.data, null, 2)}
              </pre>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}