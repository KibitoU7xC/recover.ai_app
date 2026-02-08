const mongoose = require("mongoose");

const medicationSchema = new mongoose.Schema({
    userid: String,
    name: String,
    phone: String,
    medicine: String,
    reminderTime: String,
    status: { type: String, enum: ["pending", "completed", "skipped"], default: "pending" },
    sent: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    updatedAt: { type: Date, default: Date.now },
    completedAt: { type: Date, default: null }
});

module.exports = mongoose.model("Medication", medicationSchema);
