import React, { useState, useRef } from 'react';

export default function App() {
  const [messages, setMessages] = useState([]);
  const [inputText, setInputText] = useState('');
  const [eventsLog, setEventsLog] = useState([]);
  
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
          if (!part.trim()) continue;
          
          // 解析標準 SSE 格式 (event: ... \n data: ...)
          const lines = part.split('\n');
          let eventType = 'message'; // SSE 預設事件
          let dataStr = '';

          for (const line of lines) {
            if (line.startsWith('event:')) {
              eventType = line.substring(6).trim();
            } else if (line.startsWith('data:')) {
              dataStr += line.substring(5).trim();
            }
          }

          if (dataStr) {
            try {
              const dataObj = JSON.parse(dataStr);
              // 將解析出的 event 記錄下來方便 Debug
              setEventsLog((prev) => [...prev, { event: eventType, data: dataObj }]);
              handleStreamEvent(eventType, dataObj);
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

  // 接收 eventType 與 dataObj 兩個參數
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
    sendStreamRequest({ 
      thread_id: threadId.current, 
      action_id: interruptData.action_id,
      payload: editableGridData 
    });
    setInterruptData(null);
  };

  const handleCellChange = (rowIndex, colName, newValue) => {
    const newData = [...editableGridData];
    newData[rowIndex][colName] = newValue;
    setEditableGridData(newData);
  };

  return (
    <div style={{ display: 'flex', gap: '20px', maxWidth: '1200px', margin: '40px auto', fontFamily: 'sans-serif' }}>
      <div style={{ flex: 6, display: 'flex', flexDirection: 'column', gap: '15px' }}>
        <h2>前端 React 實作 (標準 SSE)</h2>
        <div style={{ height: '500px', overflowY: 'auto', border: '1px solid #ccc', padding: '15px', borderRadius: '8px' }}>
          {messages.map((msg, index) => (
            <div key={index} style={{ textAlign: msg.sender === 'user' ? 'right' : 'left', margin: '15px 0' }}>
              <div style={{ 
                background: msg.sender === 'user' ? '#007bff' : '#f1f1f1', 
                color: msg.sender === 'user' ? '#fff' : '#000',
                padding: '10px 15px', borderRadius: '8px', display: 'inline-block', maxWidth: '80%', textAlign: 'left'
              }}>
                <div style={{ whiteSpace: 'pre-wrap', marginBottom: msg.ui_type !== 'text' ? '10px' : '0' }}>{msg.content}</div>
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

        <div style={{ border: '2px solid #007bff', padding: '15px', borderRadius: '8px', background: '#f8f9fa' }}>
          {!interruptData && (
            <div style={{ display: 'flex', gap: '10px' }}>
              <input type="text" value={inputText} onChange={(e) => setInputText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && handleSendMessage()} placeholder="輸入 '唯讀' 或 '編輯'..." style={{ flex: 1, padding: '10px', borderRadius: '4px', border: '1px solid #ccc' }} />
              <button onClick={handleSendMessage} style={{ padding: '10px 20px', cursor: 'pointer', background: '#007bff', color: '#fff', border: 'none', borderRadius: '4px' }}>發送</button>
            </div>
          )}

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
          )}
        </div>
      </div>

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