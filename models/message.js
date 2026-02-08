const mongoose = require("mongoose");

const messageSchema = new mongoose.Schema({
  sender: String, // Name of the person who sent it
  text: String, // The message content
  time: String, // Timestamp (e.g. "10:05 AM")
  createdAt: { type: Date, default: Date.now }, // For sorting
});

module.exports = mongoose.model("Message", messageSchema);
