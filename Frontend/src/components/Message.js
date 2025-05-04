import React from 'react';
import './Message.css';

const Message = ({ message, isBot }) => {
  const formatTimestamp = (timestamp) => {
    const date = new Date(timestamp);
    const now = new Date();
    
    if (date.toDateString() === now.toDateString()) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    
    return date.toLocaleString([], { 
      month: 'short', 
      day: 'numeric',
      hour: '2-digit', 
      minute: '2-digit'
    });
  };

  const formatMessage = (text) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g;
    const parts = text.split(urlRegex);
    
    return parts.map((part, index) => {
      if (part.match(urlRegex)) {
        return (
          <a 
            key={index} 
            href={part} 
            target="_blank" 
            rel="noopener noreferrer"
            className="message-link"
          >
            {part}
          </a>
        );
      }
      return <span key={index}>{part}</span>;
    });
  };

  const getStatusIcon = (status) => {
    switch (status) {
      case 'sent':
        return <i className="fas fa-check"></i>;
      case 'delivered':
        return <i className="fas fa-check-double"></i>;
      case 'read':
        return <i className="fas fa-check-double" style={{ color: '#2ecc71' }}></i>;
      default:
        return null;
    }
  };

  return (
    <div className={`message ${isBot ? 'bot-message' : 'user-message'}`}>
      <div className="message-content">
        <p>{formatMessage(message.content)}</p>
      </div>
      <div className="message-footer">
        <div className="message-timestamp">
          {formatTimestamp(message.timestamp)}
        </div>
        {!isBot && message.status && (
          <div className={`message-status ${message.status}`}>
            {getStatusIcon(message.status)}
          </div>
        )}
      </div>
    </div>
  );
};

export default Message;