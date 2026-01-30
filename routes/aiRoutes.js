const express = require("express");
const router = express.Router();
const aiController = require("../controllers/aiController");

// POST request for the AI to answer
router.post("/ask", aiController.askQuestion);

// GET request to fetch research history
router.get("/history", aiController.getHistory);

module.exports = router;
