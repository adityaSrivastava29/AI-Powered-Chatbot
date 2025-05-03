const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const path = require('path');
const OpenAI = require('openai');
const dotenv = require('dotenv');

// Load environment variables
dotenv.config();

// Initialize Express
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// Middleware
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Initialize OpenAI
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Chat history storage
const chatHistories = {};

// Socket.io connection
io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  // Initialize chat history for this client
  chatHistories[socket.id] = [];
  
  // Listen for messages from client
  socket.on('message', async (data) => {
    try {
      const { message, username } = data;
      
      // Add user message to history
      chatHistories[socket.id].push({
        role: 'user',
        content: message
      });
      
      // Get contextual history (limit to last 10 messages to save tokens)
      const recentHistory = chatHistories[socket.id].slice(-10);
      
      // Generate AI response
      const completion = await openai.chat.completions.create({
        model: "gpt-3.5-turbo",
        messages: [
          { role: "system", content: "You are a helpful assistant chatbot. Be concise, friendly, and helpful." },
          ...recentHistory
        ],
        max_tokens: 500
      });
      
      const aiResponse = completion.choices[0].message.content;
      
      // Add AI response to history
      chatHistories[socket.id].push({
        role: 'assistant',
        content: aiResponse
      });
      
      // Send response back to client
      socket.emit('botResponse', {
        message: aiResponse,
        timestamp: new Date().toISOString()
      });
      
    } catch (error) {
      console.error('Error generating response:', error);
      socket.emit('botResponse', {
        message: 'Sorry, I encountered an error. Please try again later.',
        timestamp: new Date().toISOString()
      });
    }
  });
  
  // Clean up on disconnect
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
    delete chatHistories[socket.id];
  });
});

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// API endpoint for chat history
app.get('/api/history', (req, res) => {
  const socketId = req.query.socketId;
  if (socketId && chatHistories[socketId]) {
    res.json(chatHistories[socketId]);
  } else {
    res.status(404).json({ error: 'Chat history not found' });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).send('Something broke!');
});

// Start server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
