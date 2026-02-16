/**
 * ChatPanel.tsx — Real-time text chat sidebar for the recording studio.
 *
 * Provides a simple messaging UI between the host and guest participants
 * during a recording session. Messages are relayed through the server's
 * Socket.IO `chat-message` event — there is no persistence (messages are
 * lost on page refresh).
 *
 * ## How it works
 *
 * 1. Parent (Studio) maintains the message list state and passes it in.
 * 2. When the user types and submits, `onSend(message)` is called, which
 *    the parent hooks to `socket.emit(SOCKET_EVENTS.CHAT_MESSAGE, ...)`.
 * 3. The server broadcasts the message to all participants in the room,
 *    adding a timestamp. The sending client also sees its own message
 *    in the broadcast.
 * 4. Messages from the current user are right-aligned (blue), messages
 *    from the peer are left-aligned (gray) — identified by comparing
 *    `msg.sender` to `currentUserId`.
 *
 * ## Socket.IO event flow
 *
 * Client → Server:
 *   `chat-message` — { roomId, message, sender (userId), role }
 *
 * Server → Room:
 *   `chat-message` — { message, sender, role, timestamp }
 */

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

  /** Ref to the bottom sentinel — used for auto-scrolling on new messages */
  const bottomRef = useRef<HTMLDivElement>(null);

  /** Auto-scroll to bottom whenever a new message arrives */
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  /** Submit handler — trim whitespace, emit via parent, clear input */
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim()) return;
    onSend(input.trim());
    setInput('');
  };

  return (
    <div className="flex flex-col h-full bg-gray-900 border border-gray-800 rounded-lg">
      {/* Panel header */}
      <div className="px-3 py-2 text-sm font-medium text-gray-400 border-b border-gray-800">
        Chat
      </div>

      {/* Message list — scrollable, grows to fill available space */}
      <div className="flex-1 min-h-0 px-3 py-2 space-y-2 overflow-y-auto">
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
        {/* Scroll anchor — scrollIntoView targets this empty div */}
        <div ref={bottomRef} />
      </div>

      {/* Message input form */}
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
