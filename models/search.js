const mongoose = require("mongoose");
const SearchSchema = new mongoose.Schema({
  question: { type: String, required: true },
  answer: { type: String, required: true },
  tier: { type: String, default: "free" },
  createdAt: { type: Date, default: Date.now },
});
module.exports = mongoose.model("Search", SearchSchema);