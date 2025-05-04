import React from 'react';
import Chat from './components/Chat';
import './App.css';

function App() {
  return (
    <div className="app">
      <div className="container">
        <Chat />
        
        <div className="features">
          <div className="feature">
            <i className="fas fa-brain"></i>
            <h3>AI Powered</h3>
            <p>Utilizes Gemini's advanced language models</p>
          </div>
          <div className="feature">
            <i className="fas fa-bolt"></i>
            <h3>Real-time</h3>
            <p>Instant responses with Socket.io</p>
          </div>
          <div className="feature">
            <i className="fas fa-database"></i>
            <h3>MongoDB Storage</h3>
            <p>Persistent chat history across sessions</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default App;