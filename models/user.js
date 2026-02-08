const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    email: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String,
        required: true,
    },
    name: {
        type: String,
        required: true,
    },
    phone: {
        type: Number,
        required: true,
    },

    // 🗓️ TRACKING DATE
    lastResetDate: { type: String, default: "" },

    // 📊 DAILY TOTALS
    nutrition: {
        calories: { type: Number, default: 0 },
        protein: { type: Number, default: 0 },
        carbs: { type: Number, default: 0 },
        fats: { type: Number, default: 0 },
        fiber: { type: Number, default: 0 },
        calcium: { type: Number, default: 0 },
        iron: { type: Number, default: 0 },
        zinc: { type: Number, default: 0 },
        magnesium: { type: Number, default: 0 },
        cholesterol: { type: Number, default: 0 }
    },
    
    // 🍽️ THE 5 SLOTS (Corrected Structure)
    meals: {
        breakfast: {
            name: { type: String, default: "" },
            calories: { type: Number, default: 0 }
        },
        morningSnack: {
            name: { type: String, default: "" },
            calories: { type: Number, default: 0 }
        },
        lunch: {
            name: { type: String, default: "" },
            calories: { type: Number, default: 0 }
        },
        eveningSnack: {
            name: { type: String, default: "" },
            calories: { type: Number, default: 0 }
        },
        dinner: {
            name: { type: String, default: "" },
            calories: { type: Number, default: 0 }
        }
    }
});

module.exports = mongoose.model('user', userSchema);