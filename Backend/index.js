const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const mongoose = require('mongoose');
const dotenv = require('dotenv');

const { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } = require("@google/generative-ai");


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
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 30000,
      heartbeatFrequencyMS: 5000
    };

    if (!process.env.MONGODB_URI) {
      console.error('MONGODB_URI is not defined in the environment variables');
      console.log('Falling back to in-memory storage mode');
      global.isDbConnected = false; // Keep track of DB status
      return;
    }

    await mongoose.connect(process.env.MONGODB_URI, options);
    console.log('Connected to MongoDB');
    global.isDbConnected = true;
  } catch (err) {
    console.error('MongoDB connection error:', err);
    console.log('Falling back to in-memory storage mode');
    global.isDbConnected = false;
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

// --- Gemini Initialization ---
if (!process.env.GEMINI_API_KEY) {
  console.error("Error: GEMINI_API_KEY is not defined in the environment variables.");
}
const genAI = process.env.GEMINI_API_KEY ? new GoogleGenerativeAI(process.env.GEMINI_API_KEY) : null;


const geminiModelName = "gemini-1.5-flash-latest"; // TRY THIS MODEL


const generationConfig = {
  // temperature: 0.9,
  // topK: 1,
  // topP: 1,
  maxOutputTokens: 500,
};

const safetySettings = [
  { category: HarmCategory.HARM_CATEGORY_HARASSMENT,        threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,       threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
  { category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT, threshold: HarmBlockThreshold.BLOCK_MEDIUM_AND_ABOVE },
];


io.on('connection', (socket) => {
  console.log('New client connected:', socket.id);

  socket.on('message', async (data) => {
    const { message, sessionId } = data;

    if (!message || !sessionId) {
      console.error("Received invalid message data:", data);
      return; // Ignore invalid messages
    }
     // Check if Gemini client is initialized
     if (!genAI) {
        console.error("Gemini AI client not initialized. Cannot process message.");
        socket.emit('botResponse', {
            message: "Sorry, the AI service is not configured correctly.",
            timestamp: new Date().toISOString(),
            error: true
        });
        return;
     }

    try {
      const memoryStorage = {
        messages: [],
        addMessage: function(role, content) {
          this.messages.push({ role, content, timestamp: new Date() });
        },
        getRecentMessages: function() {
          return this.messages.slice(-20); // Use a slightly larger window
        }
      };

      let chatSession = null;
      let conversationHistory = [];

      if (global.isDbConnected) {
        try {
          chatSession = await Promise.race([
            Chat.findOne({ sessionId }).lean(),
            new Promise((_, reject) =>
              setTimeout(() => reject(new Error('MongoDB query timed out')), 5000)
            )
          ]);

          if (!chatSession) {
             chatSession = {
                 sessionId,
                 messages: [{ role: 'user', content: message, timestamp: new Date() }]
             };
             conversationHistory = chatSession.messages;
             console.log("New session created in memory for:", sessionId);
          } else {
             if (!Array.isArray(chatSession.messages)) {
                 chatSession.messages = [];
             }
             chatSession.messages.push({ role: 'user', content: message, timestamp: new Date() });
             conversationHistory = chatSession.messages;
             console.log("Loaded history for session:", sessionId, "Length:", conversationHistory.length);
          }

        } catch (dbError) {
          console.error('Error accessing MongoDB:', dbError);
          global.isDbConnected = false;
          console.log('Falling back to in-memory storage for this request.');
          memoryStorage.addMessage('user', message);
          conversationHistory = memoryStorage.getRecentMessages();
          chatSession = null; // Ensure we don't try to save later if DB failed
        }
      } else {
        console.log('Using in-memory storage (MongoDB not connected)');
        memoryStorage.addMessage('user', message);
        conversationHistory = memoryStorage.getRecentMessages();
      }

      const fullConversationHistory = conversationHistory;
      let recentHistoryForAI = fullConversationHistory.slice(-20);

      const firstUserIndex = recentHistoryForAI.findIndex(msg => msg.role === 'user');

      if (firstUserIndex > 0) {
          console.log(`Trimming history: Original start role was '${recentHistoryForAI[0]?.role}'. Slicing from index ${firstUserIndex}.`);
          recentHistoryForAI = recentHistoryForAI.slice(firstUserIndex);
      } else if (firstUserIndex === -1 && recentHistoryForAI.length > 0) {
          console.warn("Warning: No 'user' message found in the recent history slice. Sending empty history to API.");
          recentHistoryForAI = [];
      } else if (firstUserIndex === 0 && recentHistoryForAI.length > 0 && recentHistoryForAI[0].role !== 'user') {
           console.warn("Warning: History slice started with non-user role despite findIndex=0. Clearing history.");
           recentHistoryForAI = [];
      }

      const geminiHistory = recentHistoryForAI
        .filter(msg => msg && msg.content)
        .map(msg => ({
          role: msg.role === 'user' ? 'user' : 'model',
          parts: [{ text: msg.content }]
        }));

      let lastUserMessageForGemini = message;
      let historyForGeminiChat = [];

      if (geminiHistory.length > 0) {
           if (geminiHistory[geminiHistory.length - 1].role === 'user' && geminiHistory[geminiHistory.length - 1].parts[0].text === message) {
               historyForGeminiChat = geminiHistory.slice(0, -1);
           } else {
               console.warn("Warning: Last message in mapped history doesn't match current user message. Using full mapped history potentially ending in user.");
               //@aditya Checking here  if the full history ends in user. If so, remove last element for startChat.
               if(geminiHistory.length > 0 && geminiHistory[geminiHistory.length - 1].role === 'user') {
                   console.warn("Correcting: Removing last user message from history for startChat");
                   historyForGeminiChat = geminiHistory.slice(0, -1);
               } else {
                   historyForGeminiChat = geminiHistory; // Use as is if it doesn't end in user
               }
           }
      } else {
          historyForGeminiChat = [];
      }


     if (historyForGeminiChat.length > 0) {
         if (historyForGeminiChat[0].role !== 'user') {
             console.error("CRITICAL ERROR: History for startChat does NOT start with 'user' after processing. Clearing history.", JSON.stringify(historyForGeminiChat));
             historyForGeminiChat = [];
         }
         else if (historyForGeminiChat[historyForGeminiChat.length - 1].role !== 'model') {
             console.error("CRITICAL ERROR: History for startChat does NOT end with 'model' after processing. Attempting recovery by removing last element.", JSON.stringify(historyForGeminiChat));
             if(historyForGeminiChat[historyForGeminiChat.length - 1].role === 'user') {
                 historyForGeminiChat.pop();
                 if (historyForGeminiChat.length > 0 && historyForGeminiChat[historyForGeminiChat.length - 1].role !== 'model') {
                     console.error("CRITICAL ERROR: Recovery failed. History still invalid. Clearing history.");
                     historyForGeminiChat = [];
                 } else if (historyForGeminiChat.length === 0) {
                     console.log("Recovery resulted in empty history.");
                 } else {
                     console.log("Recovery successful. History now ends with 'model'.");
                 }
             } else {
                  console.error("CRITICAL ERROR: History ends with unexpected role. Clearing history.");
                  historyForGeminiChat = [];
             }
         }
     }

     if (!lastUserMessageForGemini) {
        console.error("CRITICAL ERROR: lastUserMessageForGemini is empty!");
        socket.emit('botResponse', { message: 'Internal error: Missing user message.', timestamp: new Date().toISOString(), error: true });
        return;
     }


      // --- Generate AI Response using Gemini ---
      let aiResponse = "Sorry, I encountered an issue generating a response.";
      let responseBlocked = false;

      try {
        const model = genAI.getGenerativeModel({ model: geminiModelName, safetySettings, generationConfig });

        console.log("--- Calling Gemini ---");
        console.log("Model:", geminiModelName);
        console.log(`History for startChat (${historyForGeminiChat.length} items):`, JSON.stringify(historyForGeminiChat, null, 2));
        console.log("Message to send:", lastUserMessageForGemini);
        console.log("----------------------");

        const chat = model.startChat({
            history: historyForGeminiChat,
        });

        const result = await chat.sendMessage(lastUserMessageForGemini);
        const response = result.response;

        if (!response) {
            console.warn("Gemini response object is undefined.");
            aiResponse = "Sorry, I received an empty response from the AI. Please try again.";
            responseBlocked = true;
        } else if (!response.candidates || response.candidates.length === 0 || response.promptFeedback?.blockReason) {
             console.warn("Gemini response potentially blocked or empty.");
             console.warn("Prompt Feedback:", response.promptFeedback);
             console.warn("Candidates:", response.candidates);
             aiResponse = "I cannot provide a response based on the input or it may violate safety guidelines. Please try phrasing your request differently.";
             responseBlocked = true;
        } else {
             aiResponse = response.text();
        }

      } catch (aiError) {
         console.error('Gemini API call error:', aiError);
         aiResponse = "Sorry, I encountered an internal error while thinking. Please try again."; // Generic error for client
         if (aiError instanceof Error && aiError.message.includes('API key not valid')) {
            aiResponse = "Sorry, the AI service API key is invalid. Please contact support.";
         } else if (aiError.status === 429) {
             aiResponse = "I'm experiencing high demand right now. Please try again in a moment.";
         } else if (aiError instanceof Error && aiError.message.includes("RESOURCE_EXHAUSTED")) {
              aiResponse = "The AI service is currently overloaded. Please try again later.";
         } else if (aiError.status === 404 && aiError.message.includes("v1beta")) {
             aiResponse = "Sorry, there's an issue communicating with the AI model version. Please contact support.";
             console.error("Persistent 404 error with v1beta endpoint detected. Ensure @google/generative-ai SDK is up-to-date (`npm update @google/generative-ai` or `yarn upgrade`).")
         }
         console.error(`Gemini Error Status: ${aiError.status}, Message: ${aiError.message}`);
      }


      const aiMessageData = {
          role: 'assistant',
          content: aiResponse,
          timestamp: new Date()
      };

      if (global.isDbConnected && chatSession) {
        try {
            if (chatSession.messages) {
               chatSession.messages.push(aiMessageData);
            } else {
               chatSession.messages = [aiMessageData];
            }

            const updateResult = await Chat.updateOne(
               { sessionId: sessionId },
               {
                   $set: { messages: chatSession.messages },
                   $setOnInsert: { createdAt: new Date() }
               },
               { upsert: true }
            );
            console.log("DB Update Result:", updateResult);

        } catch (saveError) {
          console.error('Error saving AI response to MongoDB:', saveError);
          if (memoryStorage) {
             memoryStorage.addMessage('assistant', aiResponse);
          }
        }
      } else if (!global.isDbConnected && memoryStorage) {
          console.log("Saving AI response to in-memory storage.");
          memoryStorage.addMessage('assistant', aiResponse);
      } else {
          console.log("Not saving AI response (DB not connected/session object missing).");
      }

      socket.emit('botResponse', {
        message: aiResponse,
        timestamp: new Date().toISOString(),
        error: responseBlocked || aiResponse.startsWith("Sorry,") || aiResponse.startsWith("I cannot provide"),
        blocked: responseBlocked
      });

    } catch (error) {
      console.error('General error in message handler:', error);
      socket.emit('botResponse', {
        message: 'Sorry, a server error occurred. Please try again later.',
        timestamp: new Date().toISOString(),
        error: true
      });
    }
  });

  socket.on('getChatHistory', async (sessionId) => {
    try {
      if (!global.isDbConnected) {
        console.log('MongoDB not connected, returning empty history for:', sessionId);
        socket.emit('chatHistory', []);
        return;
      }

      const chatSession = await Promise.race([
        Chat.findOne({ sessionId }).lean(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('MongoDB query timed out getting history')), 5000)
        )
      ]);

      if (chatSession && chatSession.messages) {
        socket.emit('chatHistory', chatSession.messages);
      } else {
        socket.emit('chatHistory', []);
      }
    } catch (error) {
      console.error('Error fetching chat history:', error);
      socket.emit('chatHistory', []);
      console.error(`Failed to get history for session ${sessionId}: ${error.message}`);
    }
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected:', socket.id);
  });
});


app.get('/api/health', (req, res) => {
  res.json({
      status: 'OK',
      databaseConnected: global.isDbConnected === true,
      aiService: genAI ? `Gemini Initialized (${geminiModelName})` : 'Gemini Not Initialized (Check API Key)',
      timestamp: new Date().toISOString()
  });
});

app.use((err, req, res, next) => {
  console.error("Unhandled Error:", err.stack);
  res.status(500).json({ error: 'Server error' });
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});