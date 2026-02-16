import { useState, useRef, useEffect } from 'react';

interface ChatMessage {
  message: string;
  sender: string;
  role: string;
  timestamp: string;
}

interface ChatPanelProps {
  messages: ChatMessage[];
  onSend: (message: string) => void;
  currentUserId: string;
}

export default function ChatPanel({ messages, onSend, currentUserId }: ChatPanelProps) {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    onSend(input.trim());
    setInput('');
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 rounded-lg border border-gray-800">
      <div className="px-3 py-2 border-b border-gray-800 text-sm font-medium text-gray-400">
        Chat
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-2 space-y-2 min-h-0">
        {messages.map((msg, i) => {
          const isMe = msg.sender === currentUserId;
          return (
            <div key={i} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
              <div
                className={`max-w-[80%] rounded-lg px-3 py-1.5 text-sm ${
                  isMe ? 'bg-studio-600 text-white' : 'bg-gray-800 text-gray-200'
                }`}
              >
                {msg.message}
              </div>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSubmit} className="px-3 py-2 border-t border-gray-800">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-studio-500"
          />
          <button
            type="submit"
            className="px-3 py-1.5 bg-studio-600 text-white rounded-lg text-sm hover:bg-studio-700 transition-colors"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}
