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
    const paragraphs = text.split('\n\n');
    
    return paragraphs.map((paragraph, pIndex) => {
      if (paragraph.trim().startsWith('*')) {
        const bulletPoints = paragraph.split('\n').map((point, bIndex) => {
          const content = point.replace(/^\*\s*/, '').trim();
          
          const formattedContent = formatTextContent(content);
          
          return (
            <li key={`${pIndex}-${bIndex}`} className="bullet-point">
              {formattedContent}
            </li>
          );
        });
        
        return (
          <ul key={pIndex} className="bullet-list">
            {bulletPoints}
          </ul>
        );
      }
      
      return (
        <p key={pIndex} className="message-paragraph">
          {formatTextContent(paragraph)}
        </p>
      );
    });
  };

  const formatTextContent = (text) => {
    const boldRegex = /\*\*([^*]+)\*\*/g;
    const parts = text.split(boldRegex);
    
    return parts.map((part, index) => {
      if (index % 2 === 1) {
        return <strong key={`bold-${index}`}>{part}</strong>;
      }
      
      const urlRegex = /(https?:\/\/[^\s]+)/g;
      const urlParts = part.split(urlRegex);
      
      return urlParts.map((urlPart, urlIndex) => {
        if (urlPart.match(urlRegex)) {
          return (
            <a 
              key={`url-${index}-${urlIndex}`} 
              href={urlPart} 
              target="_blank" 
              rel="noopener noreferrer"
              className="message-link"
            >
              {urlPart}
            </a>
          );
        }
        
        const stringRegex = /"([^"]*)"/g;
        const stringParts = urlPart.split(stringRegex);
        
        return stringParts.map((stringPart, stringIndex) => {
          if (stringIndex % 2 === 1) {
            return <strong key={`string-${index}-${urlIndex}-${stringIndex}`}>{stringPart}</strong>;
          }
          return <span key={`string-${index}-${urlIndex}-${stringIndex}`}>{stringPart}</span>;
        });
      });
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
        {formatMessage(message.content)}
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