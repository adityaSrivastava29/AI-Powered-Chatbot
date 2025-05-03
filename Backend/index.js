const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const OpenAI = require('openai');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.CLIENT_URL || "http://localhost:3000", 
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

const connectDB = async () => {
  try {
    const options = {
      useNewUrlParser: true,
      useUnifiedTopology: true,
      serverSelectionTimeoutMS: 30000, // Increase timeout to 30 seconds
      socketTimeoutMS: 45000, // Socket timeout
      connectTimeoutMS: 30000, // Connection timeout
      heartbeatFrequencyMS: 5000 // Check server status every 5 seconds
    };

    if (!process.env.MONGODB_URI) {
      console.error('MONGODB_URI is not defined in the environment variables');
      console.log('Falling back to in-memory storage mode');
      return;
    }

    await mongoose.connect(process.env.MONGODB_URI, options);
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    console.log('Falling back to in-memory storage mode');
  }
};

connectDB();

const chatSchema = new mongoose.Schema({
  sessionId: String,
  messages: [{
    role: String,
    content: String,
    timestamp: {
      type: Date,
      default: Date.now
    }
  }],
  createdAt: {
    type: Date,
    default: Date.now
  }
});

const Chat = mongoose.model('Chat', chatSchema);

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

async function generateAIResponse(messages, retryCount = 0, maxRetries = 2) {
  const model = process.env.OPENAI_MODEL || "gpt-3.5-turbo";
  
  try {
    const completion = await openai.chat.completions.create({
      model: model,
      messages: [
        { role: "system", content: "You are a helpful assistant chatbot. Be concise, friendly, and informative." },
        ...messages
      ],
      max_tokens: 500
    });
    
    return {
      success: true,
      content: completion.choices[0].message.content
    };
  } catch (error) {
    console.error(`AI response generation error (attempt ${retryCount + 1}):`, error);
    
    if ((error.status === 429 || (error.error && error.error.type === 'insufficient_quota')) && retryCount < maxRetries) {
      const waitTime = Math.pow(2, retryCount) * 1000;
      console.log(`Rate limit hit. Retrying in ${waitTime}ms...`);
      
      await new Promise(resolve => setTimeout(resolve, waitTime));
      
      if (retryCount === 1 && model !== "gpt-3.5-turbo") {
        console.log("Falling back to gpt-3.5-turbo model...");
        process.env.OPENAI_MODEL = "gpt-3.5-turbo"; // Override for the next attempt
        return generateAIResponse(messages, retryCount + 1, maxRetries);
      }
      
      return generateAIResponse(messages, retryCount + 1, maxRetries);
    } 
    
    if (error.status === 429 || (error.error && error.error.type === 'insufficient_quota')) {
      return {
        success: false,
        content: "I'm currently experiencing high demand and have reached my capacity. Please try again later",
        fallback: true
      };
    }
    
    return {
      success: false,
      content: "Sorry, I encountered an error processing your request. Please try again later.",
      error: error
    };
  }
}

io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);
  
  socket.on('message', async (data) => {
    try {
      const { message, sessionId } = data;
      
      const memoryStorage = {
        messages: [],
        addMessage: function(role, content) {
          this.messages.push({ role, content, timestamp: new Date() });
        },
        getRecentMessages: function() {
          return this.messages.slice(-10).map(msg => ({
            role: msg.role,
            content: msg.content
          }));
        }
      };
      
      let chatSession = null;
      let recentMessages = [];
      
      if (mongoose.connection.readyState === 1) { // 1 = connected
        try {
          chatSession = await Promise.race([
            Chat.findOne({ sessionId }),
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error('MongoDB query timed out')), 5000)
            )
          ]);
          
          if (!chatSession) {
            chatSession = new Chat({ 
              sessionId,
              messages: []
            });
          }
          
          chatSession.messages.push({
            role: 'user',
            content: message
          });
          
          await chatSession.save();
          
          recentMessages = chatSession.messages.slice(-10).map(msg => ({
            role: msg.role,
            content: msg.content
          }));
        } catch (dbError) {
          console.error('Error accessing MongoDB:', dbError);
          memoryStorage.addMessage('user', message);
          recentMessages = memoryStorage.getRecentMessages();
        }
      } else {
        console.log('Using in-memory storage (MongoDB not connected)');
        memoryStorage.addMessage('user', message);
        recentMessages = memoryStorage.getRecentMessages();
      }
      
      const response = await generateAIResponse(recentMessages);
      const aiResponse = response.content;
      
      if (mongoose.connection.readyState === 1 && chatSession) {
        try {
          chatSession.messages.push({
            role: 'assistant',
            content: aiResponse
          });
          
          await chatSession.save();
        } catch (saveError) {
          console.error('Error saving to MongoDB:', saveError);
          memoryStorage.addMessage('assistant', aiResponse);
        }
      } else {
        memoryStorage.addMessage('assistant', aiResponse);
      }
      
      socket.emit('botResponse', {
        message: aiResponse,
        timestamp: new Date().toISOString(),
        fallback: response.fallback || false
      });
      
    } catch (error) {
      console.error('Error generating response:', error);
      socket.emit('botResponse', {
        message: 'Sorry, I encountered an error. Please try again later.',
        timestamp: new Date().toISOString(),
        error: true
      });
    }
  });
  
  socket.on('getChatHistory', async (sessionId) => {
    try {
      if (mongoose.connection.readyState !== 1) {
        console.log('MongoDB not connected, returning empty history');
        socket.emit('chatHistory', []);
        return;
      }
      
      const chatSession = await Promise.race([
        Chat.findOne({ sessionId }),
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('MongoDB query timed out')), 5000)
        )
      ]);
      
      if (chatSession) {
        socket.emit('chatHistory', chatSession.messages);
      } else {
        socket.emit('chatHistory', []);
      }
    } catch (error) {
      console.error('Error fetching chat history:', error);
      socket.emit('dbError', {
        message: 'Unable to fetch chat history. Using temporary session.',
        error: error.message
      });
      socket.emit('chatHistory', []);
    }
  });
  
  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});

app.get('/api/ai-status', async (req, res) => {
  try {
    const models = await openai.models.list();
    res.json({ 
      status: 'OK', 
      message: 'OpenAI API connection successful',
      timestamp: new Date().toISOString() 
    });
  } catch (error) {
    res.status(error.status || 500).json({ 
      status: 'Error', 
      message: error.message || 'Error connecting to OpenAI API',
      type: error.error?.type || 'unknown',
      timestamp: new Date().toISOString() 
    });
  }
});

// API Routes
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Server error' });
});

// Start server
const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});