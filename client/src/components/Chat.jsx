import { useEffect, useRef, useState } from 'react';
import { socket } from '../lib/socket';

export default function Chat({ roomId, name }) {
  const [messages, setMessages] = useState([]);
  const [text, setText] = useState('');
  const bottomRef = useRef(null);

  useEffect(() => {
    const handler = (msg) => setMessages((prev) => [...prev, msg]);
    socket.on('chat-message', handler);
    return () => socket.off('chat-message', handler);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = (e) => {
    e.preventDefault();
    if (!text.trim()) return;
    socket.emit('chat-message', { roomId, message: text.trim(), name });
    setText('');
  };

  return (
    <div className="chat-panel">
      <div className="chat-messages">
        {messages.map((m) => (
          <div key={m.id} className="chat-message">
            <span className="chat-name">{m.name}:</span> {m.message}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
      <form onSubmit={send} className="chat-input-row">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Type a message..."
          maxLength={500}
        />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
