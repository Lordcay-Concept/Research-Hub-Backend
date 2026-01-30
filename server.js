const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const mongoose = require("mongoose");
const cors = require("cors");

const app = express();
app.use(express.json());
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:5173",
  }),
);
// --- CONFIGURATION ---
const PORT = process.env.PORT || 5000;
const SECRET_KEY = process.env.SECRET_KEY;
const MONGO_URI = process.env.MONGO_URI;
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// --- DATABASE MODELS ---
const UserSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, unique: true, required: true },
  password: { type: String },
  profilePic: { type: String, default: "" },
  bio: { type: String, default: "" },
});

const User = mongoose.model("User", UserSchema);

const History = mongoose.model(
  "History",
  new mongoose.Schema({
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    chatId: String,
    question: String,
    answer: String,
    tier: String,
    timestamp: { type: Date, default: Date.now },
  }),
);

// --- CONNECT TO DATABASE ---
mongoose
  .connect(MONGO_URI)
  .then(() => console.log("✅ Database Connected Successfully"))
  .catch((err) => console.error("❌ Database Connection Error:", err));

// --- 1. AUTHENTICATION ROUTES ---
app.post("/api/v1/google-login", async (req, res) => {
  try {
    const { name, email, profilePic } = req.body;
    let user = await User.findOne({ email });
    if (!user) {
      user = await User.create({
        name,
        email,
        profilePic,
        password: await bcrypt.hash(Math.random().toString(36), 10),
      });
    }
    const token = jwt.sign({ userId: user._id }, SECRET_KEY, {
      expiresIn: "7d",
    });
    res.json({
      token,
      user: {
        name: user.name,
        email: user.email,
        profilePic: user.profilePic,
        bio: user.bio,
      },
    });
  } catch (e) {
    res.status(500).json({ message: "Google sync failed" });
  }
});

app.post("/api/v1/signup", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    const exists = await User.findOne({ email });
    if (exists)
      return res.status(400).json({ message: "Email already exists" });
    const hashedPassword = await bcrypt.hash(password, 10);
    await User.create({ name, email, password: hashedPassword });
    res.status(201).json({ message: "User created successfully" });
  } catch (e) {
    res.status(500).json({ message: "Signup failed" });
  }
});

app.post("/api/v1/login", async (req, res) => {
  try {
    const user = await User.findOne({ email: req.body.email });
    if (
      user &&
      user.password &&
      (await bcrypt.compare(req.body.password, user.password))
    ) {
      const token = jwt.sign({ userId: user._id }, SECRET_KEY, {
        expiresIn: "7d",
      });
      res.json({
        token,
        user: {
          name: user.name,
          email: user.email,
          profilePic: user.profilePic,
          bio: user.bio,
        },
      });
    } else {
      res.status(401).json({ message: "Invalid email or password" });
    }
  } catch (e) {
    res.status(500).json({ message: "Login failed" });
  }
});

// --- 2. USER PROFILE UPDATE ---
app.put("/api/v1/user/update", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "No token provided" });
  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    const { name, profilePic, bio } = req.body;
    const updatedUser = await User.findByIdAndUpdate(
      decoded.userId,
      { name, profilePic, bio },
      { new: true },
    ).select("-password");
    res.json({ message: "Profile updated!", user: updatedUser });
  } catch (e) {
    res.status(500).json({ message: "Failed to update profile" });
  }
});

// --- 3. AI CHAT ROUTE (UPDATED FOR REAL-TIME STREAMING) ---
app.post("/api/v1/ask", async (req, res) => {
  const { question, displayQuestion, chatId, tier } = req.body;
  const token = req.headers.authorization?.split(" ")[1];

  // Set Headers for Streaming
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  try {
    const response = await fetch(
      "https://api.groq.com/openai/v1/chat/completions",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "llama-3.3-70b-versatile",
          messages: [
            {
              role: "system",
              content: "You are a research assistant. Provide direct answers.",
            },
            { role: "user", content: question },
          ],
          stream: true, // Enable streaming from Groq
        }),
      },
    );

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let fullAnswer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value);
      const lines = chunk.split("\n");

      for (const line of lines) {
        if (line.trim() === "data: [DONE]") break;
        if (line.startsWith("data: ")) {
          try {
            const data = JSON.parse(line.substring(6));
            const content = data.choices[0]?.delta?.content || "";
            fullAnswer += content;
            // Send content chunk to frontend
            res.write(`data: ${JSON.stringify({ content })}\n\n`);
          } catch (e) {
            continue;
          }
        }
      }
    }

    // Save history after the stream is fully collected
    if (token) {
      try {
        const decoded = jwt.verify(token, SECRET_KEY);
        await History.create({
          userId: decoded.userId,
          chatId,
          question: displayQuestion || question,
          answer: fullAnswer,
          tier,
        });
      } catch (err) {
        console.log("History save error");
      }
    }
    res.end();
  } catch (error) {
    res.write(`data: ${JSON.stringify({ error: "AI Service Error" })}\n\n`);
    res.end();
  }
});

// --- 4. HISTORY ROUTES ---
app.get("/api/v1/history/:chatId", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Unauthorized" });
  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    const thread = await History.find({
      userId: decoded.userId,
      chatId: req.params.chatId,
    }).sort({ timestamp: 1 });
    res.json(thread);
  } catch (e) {
    res.status(500).json({ message: "Error fetching thread" });
  }
});

app.get("/api/v1/history", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.json([]);
  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    const history = await History.aggregate([
      { $match: { userId: new mongoose.Types.ObjectId(decoded.userId) } },
      { $sort: { timestamp: 1 } },
      {
        $group: {
          _id: "$chatId",
          question: { $first: "$question" },
          answer: { $last: "$answer" },
          timestamp: { $last: "$timestamp" },
          chatId: { $first: "$chatId" },
          tier: { $last: "$tier" },
        },
      },
      { $sort: { timestamp: -1 } },
    ]);
    res.json(history);
  } catch (e) {
    res.status(401).json({ message: "Unauthorized" });
  }
});

// --- RENAME CHAT TITLE ---
app.put("/api/v1/history/rename", async (req, res) => {
  const { chatId, newTitle } = req.body;
  const token = req.headers.authorization?.split(" ")[1];

  if (!token) return res.status(401).json({ message: "Unauthorized" });

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    // Update all entries with this chatId for this user
    await History.updateMany(
      { userId: decoded.userId, chatId: chatId },
      { $set: { question: newTitle } },
    );
    res.json({ message: "Chat renamed successfully" });
  } catch (e) {
    res.status(500).json({ message: "Error renaming chat" });
  }
});

// --- DELETE SINGLE CHAT THREAD ---
app.delete("/api/v1/history/:chatId", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Unauthorized" });

  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    await History.deleteMany({
      userId: decoded.userId,
      chatId: req.params.chatId,
    });
    res.json({ message: "Chat deleted successfully" });
  } catch (e) {
    res.status(500).json({ message: "Error deleting chat" });
  }
});

app.delete("/api/v1/history", async (req, res) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Unauthorized" });
  try {
    const decoded = jwt.verify(token, SECRET_KEY);
    await History.deleteMany({ userId: decoded.userId });
    res.json({ message: "History cleared" });
  } catch (e) {
    res.status(500).json({ message: "Error" });
  }
});

app.listen(PORT, () =>
  console.log(`🚀 Server running on http://localhost:${PORT}`),
);
