const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  sender: String, // Name of the person (instead of userid)
  text: String,   // The message content
  time: String,   // String timestamp (e.g. "10:05 AM")
  createdAt: { type: Date, default: Date.now }, // For sorting
});

module.exports = mongoose.model("Message", messageSchema);