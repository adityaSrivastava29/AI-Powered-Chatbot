import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { v4 as uuidv4 } from 'uuid';
import Message from './Message';
import ChatInput from './ChatInput';
import './Chat.css';

const Chat = () => {
  const [messages, setMessages] = useState([]);
  const [isTyping, setIsTyping] = useState(false);
  const [socket, setSocket] = useState(null);
  const [sessionId, setSessionId] = useState('');
  const messagesEndRef = useRef(null);

  useEffect(() => {
    const storedSessionId = localStorage.getItem('chatSessionId');
    const newSessionId = storedSessionId || uuidv4();
    
    if (!storedSessionId) {
      localStorage.setItem('chatSessionId', newSessionId);
    }
    
    setSessionId(newSessionId);
    
    const socketInstance = io(process.env.REACT_APP_API_URL || 'http://localhost:5000');
    setSocket(socketInstance);
    
    setMessages([{
      role: 'assistant',
      content: 'Hello! I\'m your AI assistant. How can I help you today?',
      timestamp: new Date().toISOString()
    }]);
    
    return () => {
      socketInstance.disconnect();
    };
  }, []);

  useEffect(() => {
    if (socket && sessionId) {
      socket.emit('getChatHistory', sessionId);
      
      socket.on('chatHistory', (history) => {
        if (history && history.length > 0) {
          setMessages(history);
        }
      });
    }
  }, [socket, sessionId]);

  useEffect(() => {
    if (!socket) return;
    
    socket.on('botResponse', (data) => {
      setIsTyping(false);
      
      setMessages(prevMessages => [
        ...prevMessages,
        {
          role: 'assistant',
          content: data.message,
          timestamp: data.timestamp
        }
      ]);
    });
    
    return () => {
      socket.off('botResponse');
    };
  }, [socket]);

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSendMessage = (message) => {
    setMessages(prevMessages => [
      ...prevMessages,
      {
        role: 'user',
        content: message,
        timestamp: new Date().toISOString()
      }
    ]);
    
    setIsTyping(true);
    
    socket.emit('message', {
      message,
      sessionId
    });
  };

  return (
    <div className="chat-container">
      <div className="chat-header">
        <h1><i className="fas fa-robot"></i> AI Chatbot</h1>
        <p>Ask me anything!</p>
      </div>
      
      <div className="chat-messages">
        {messages.map((message, index) => (
          <Message 
            key={index}
            message={message}
            isBot={message.role === 'assistant'}
          />
        ))}
        
        {isTyping && (
          <div className="typing-indicator">
            <span></span>
            <span></span>
            <span></span>
          </div>
        )}
        
        <div ref={messagesEndRef} />
      </div>
      
      <ChatInput onSendMessage={handleSendMessage} />
    </div>
  );
};

export default Chat;