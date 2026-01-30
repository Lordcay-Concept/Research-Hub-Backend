// Run this with: node test-ai.js
require("dotenv").config();

async function listModels() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("❌ No API Key found in .env file");
    return;
  }

  const url = `https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (!response.ok) {
      console.error("❌ API Error:", data.error.message);
      return;
    }

    console.log("✅ SUCCESS! Here are the models your key can see:");
    console.log("------------------------------------------------");
    if (data.models) {
        data.models.forEach(m => {
            // We only care about models that support 'generateContent'
            if (m.supportedGenerationMethods.includes("generateContent")) {
                console.log(`Model Name: ${m.name}`);
            }
        });
    } else {
        console.log("No models found. Check if the API is enabled in Google Cloud Console.");
    }
    console.log("------------------------------------------------");

  } catch (error) {
    console.error("❌ Connection Failed:", error.message);
  }
}

listModels();