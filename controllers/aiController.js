const Search = require("../models/search");

exports.askQuestion = async (req, res) => {
  try {
    const { question, tier } = req.body;
    const apiKey = process.env.OPENROUTER_API_KEY;

    // Use Llama 3.3 70B for the free tier
    const FREE_MODEL = "meta-llama/llama-3.3-70b-instruct:free";
    const url = "https://openrouter.ai/api/v1/chat/completions";

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:5000",
        "X-Title": "Student AI Hub",
      },
      body: JSON.stringify({
        model: tier === "pro" ? "anthropic/claude-3.5-sonnet" : FREE_MODEL,
        messages: [{ role: "user", content: question }],
      }),
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "AI Error");

    const answer = data.choices[0].message.content;

    const newSearch = new Search({ question, answer, tier: tier || "free" });
    await newSearch.save();

    res.status(200).json({ answer });
  } catch (error) {
    res.status(500).json({ message: error.message });
  }
};

// !!! ENSURE THIS IS EXPORTED CORRECTLY !!!
exports.getHistory = async (req, res) => {
  try {
    const searches = await Search.find().sort({ createdAt: -1 }).limit(10);
    res.status(200).json(searches);
  } catch (error) {
    res.status(500).json({ message: "History error" });
  }
};
