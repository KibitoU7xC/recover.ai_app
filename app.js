require("dotenv").config();
const express = require('express');
const path = require('path');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const cookieParser = require('cookie-parser');
const multer = require('multer');
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require('fs');
const axios = require('axios');
const cron = require("node-cron");
const twilio = require("twilio");

// --- MODELS ---
const userModel = require('./models/user'); 
const Medication = require("./models/medication");

// --- CONFIGURATION ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
const app = express();

// --- DATABASE CONNECTION ---
mongoose.connect(process.env.DB_URL)
    .then(() => console.log('Database connected successfully'))
    .catch((err) => console.log('Database connection error:', err));

// --- MIDDLEWARE ---
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(cookieParser());
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, "public")));

// --- 🛠️ FIX: MULTER CONFIG (Must be at the top) ---
const storage = multer.diskStorage({
    destination: './public/uploads/',
    filename: (req, file, cb) => cb(null, 'report-' + Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage: storage });

// --- BACKFILL LOGIC (Preserved) ---
async function backfillReminderPhones() {
    try {
        const missing = await Medication.find({ $or: [{ phone: { $exists: false } }, { phone: null }, { phone: '' }] });
        if (!missing.length) return console.log('No reminder phone backfill needed');
        console.log(`Backfilling ${missing.length} reminders missing phone numbers...`);
        for (const r of missing) {
            try {
                const u = await userModel.findById(r.userid);
                if (u && u.phone) {
                    r.phone = u.phone;
                    await r.save();
                    console.log(`Backfilled reminder ${r._id} with phone ${u.phone}`);
                }
            } catch (innerErr) { console.error('Error backfilling reminder', r._id); }
        }
    } catch (err) { console.error('Reminder phone backfill failed:', err); }
}
backfillReminderPhones().catch(err => console.error('Backfill error:', err));

// --- AUTH ROUTINES ---
app.get('/', (req, res) => res.render('home'));
app.get('/create', (req, res) => res.render('create'));

app.post('/create', async (req, res) => {
    let { email, password, name, phone } = req.body;
    let existingUser = await userModel.findOne({ email });
    if (existingUser) return res.send('User already exists');
    
    bcrypt.genSalt(10, (err, salt) => {
        bcrypt.hash(password, salt, async (err, hash) => {
            let newuser = await userModel.create({ 
                email, password: hash, name, phone, 
                todayCalories: 0, 
                lastScanDate: new Date().toDateString() // ✅ Standardized to lastScanDate
            });
            let token = jwt.sign({ email, userid: newuser._id }, process.env.JWT_SECRET);
            res.cookie('token', token);
            res.redirect('/dashboard');
        })
    })
});

app.get('/login', (req, res) => res.render('login'));
app.post('/login', async (req, res) => {
    let { email, password } = req.body;
    let user = await userModel.findOne({ email });
    if (!user) return res.send('No user found');
    
    bcrypt.compare(password, user.password, (err, result) => {
        if (result) {
            let token = jwt.sign({ email, userid: user._id }, process.env.JWT_SECRET);
            res.cookie('token', token);
            res.redirect('/dashboard');
        } else {
            res.send('Invalid password');
        }
    })
});

app.get('/logout', (req, res) => {
    res.cookie('token', '');
    res.redirect('/login');
});

function isloggedin(req, res, next) {
    if (!req.cookies || !req.cookies.token) return res.redirect('/login');
    try {
        let data = jwt.verify(req.cookies.token, process.env.JWT_SECRET || "secretkey");
        req.user = data;
        next();
    } catch (err) { res.redirect('/login'); }
}

// --- MEDICATION ROUTES ---
app.post("/add-reminder", isloggedin, async (req,res)=>{
    const user = await userModel.findById(req.user.userid);
    const reminder = new Medication({
        userid: user._id, name: user.name, phone: user.phone,
        medicine: req.body.medicine, reminderTime: req.body.reminderTime
    });
    await reminder.save();
    res.send("Reminder saved successfully");
});

app.get("/reminders/today", isloggedin, async (req, res) => {
    try {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const reminders = await Medication.find({
            userid: req.user.userid, createdAt: { $gte: today, $lt: tomorrow }
        }).sort({ reminderTime: 1 });
        res.json(reminders);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get("/reminders/history", isloggedin, async (req, res) => {
    try {
        const reminders = await Medication.find({ userid: req.user.userid }).sort({ createdAt: -1 });
        res.json(reminders);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post("/reminders", isloggedin, async (req, res) => {
    try {
        const user = await userModel.findById(req.user.userid);
        const reminder = new Medication({
            userid: user._id, name: user.name, phone: user.phone,
            medicine: req.body.medicine, reminderTime: req.body.reminderTime, status: "pending"
        });
        await reminder.save();
        res.json({ success: true, reminder });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put("/reminders/:id", isloggedin, async (req, res) => {
    try {
        const { medicine, reminderTime, status } = req.body;
        const update = { updatedAt: new Date() };
        if (medicine) update.medicine = medicine;
        if (reminderTime) update.reminderTime = reminderTime;
        if (status) update.status = status;
        const reminder = await Medication.findByIdAndUpdate(req.params.id, update, { new: true });
        if (!reminder) return res.status(404).json({ success: false, message: 'Reminder not found' });
        res.json({ success: true, reminder });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete("/reminders/:id", isloggedin, async (req, res) => {
    try {
        await Medication.findByIdAndDelete(req.params.id);
        res.json({ success: true, message: "Reminder deleted" });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put("/reminders/:id/complete", isloggedin, async (req, res) => {
    try {
        const reminder = await Medication.findByIdAndUpdate(
            req.params.id,
            { status: "completed", completedAt: new Date(), updatedAt: new Date() },
            { new: true }
        );
        res.json({ success: true, reminder });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get("/check-reminders", async (req,res)=>{
    const data = await Medication.find();
    res.json(data);
});

app.get('/medication', isloggedin, async (req,res)=>{
    const user = await userModel.findById(req.user.userid);
    res.render('medication', { user });
});

app.get('/reminders', isloggedin, async (req,res)=>{
    const user = await userModel.findById(req.user.userid);
    res.render('reminders', { user });
});

// --- FOOD & AI ANALYSIS ROUTE ---
// --- FOOD PAGE ROUTE (Fixes "user is not defined" error) ---
app.get('/food', isloggedin, async (req, res) => {
    // 1. Fetch the user so we can show their meals/macros
    let user = await userModel.findOne({ _id: req.user.userid });

    // 2. Render the page AND pass the user data
    res.render('food', { user: user }); 
});

// --- 5-SLOT FOOD ANALYSIS ROUTE ---
app.post('/analyze', upload.single('report'), isloggedin, async (req, res) => {
    try {
        const file = req.file;
        const mealType = req.body.mealType; // e.g., "breakfast", "lunch"
        
        // 1. DATE CHECK & RESET LOGIC
        const todayStr = new Date().toISOString().split('T')[0]; // "2026-02-08"
        let user = await userModel.findById(req.user.userid);

        if (user.lastResetDate !== todayStr) {
            console.log(`🔄 New Day Detected for ${user.email}. Resetting totals.`);
            // Reset totals to 0
            user.nutrition = {
                calories: 0, protein: 0, carbs: 0, fats: 0, fiber: 0,
                calcium: 0, iron: 0, zinc: 0, magnesium: 0, cholesterol: 0
            };
            // Clear meal slots
            user.meals = {
                breakfast: null, morningSnack: null, lunch: null, eveningSnack: null, dinner: null
            };
            user.lastResetDate = todayStr;
            await user.save();
        }

        // 2. AI ANALYSIS
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        const prompt = `
            Analyze this food image. Return a pure JSON object with this exact structure:
            {
                "food_name": "Short Name",
                "calories": 0,
                "macros": { "protein_g": 0, "carbs_g": 0, "fats_g": 0, "fiber_g": 0 },
                "micros": { "calcium_mg": 0, "iron_mg": 0, "zinc_mg": 0, "magnesium_mg": 0, "cholesterol_mg": 0 }
            }
            Return ONLY valid JSON.
        `;
        
        const parts = [prompt];
        if (file) {
            parts.push({
                inlineData: {
                    data: Buffer.from(fs.readFileSync(path.resolve(file.path))).toString("base64"),
                    mimeType: file.mimetype
                }
            });
        }

        const result = await model.generateContent(parts);
        const cleanJson = result.response.text().replace(/```json|```/g, '').trim();
        const foodData = JSON.parse(cleanJson);

        // 3. UPDATE DATABASE (Add to Total + Save to Slot)
        // We use $inc for totals, but $set for the specific meal slot
        let updateQuery = {
            $inc: {
                "nutrition.calories": foodData.calories,
                "nutrition.protein": foodData.macros.protein_g,
                "nutrition.carbs": foodData.macros.carbs_g,
                "nutrition.fats": foodData.macros.fats_g,
                "nutrition.fiber": foodData.macros.fiber_g,
                "nutrition.calcium": foodData.micros.calcium_mg,
                "nutrition.iron": foodData.micros.iron_mg,
                "nutrition.zinc": foodData.micros.zinc_mg,
                "nutrition.magnesium": foodData.micros.magnesium_mg,
                "nutrition.cholesterol": foodData.micros.cholesterol_mg
            }
        };

        // Save the specific food name to the slot (e.g. meals.lunch)
        if (mealType) {
            updateQuery["$set"] = {};
            updateQuery["$set"][`meals.${mealType}`] = {
                name: foodData.food_name,
                calories: foodData.calories
            };
        }

        await userModel.findByIdAndUpdate(req.user.userid, updateQuery);

        if (file) fs.unlinkSync(file.path);
        res.json({ success: true, data: foodData });

    } catch (error) {
        console.error("Analysis Error:", error);
        res.status(500).json({ success: false, error: "Analysis failed." });
    }
});

// --- MASTER DASHBOARD ROUTE (All Metrics Real) ---
app.get('/dashboard', isloggedin, async (req, res) => {
    res.set('Cache-Control', 'no-store, no-cache, must-revalidate, private');

    let user = await userModel.findOne({ _id: req.user.userid });
    const googleToken = req.query.google_token;
    
    let graphData = {
        dates: [], steps: [], 
        todaySteps: 0, 
        todayHeartRate: 0, 
        todayCaloriesBurned: 0,
        todaySleep: "--", // Default to empty if no data
        isConnected: false
    };

    if (googleToken) {
        try {
            graphData.isConnected = true;
            
            // 1. Time Setup (Midnight Aligned)
            const todayEnd = new Date();
            const todayStart = new Date();
            todayStart.setHours(0, 0, 0, 0); 
            
            const sevenDaysAgo = new Date();
            sevenDaysAgo.setDate(todayEnd.getDate() - 6);
            sevenDaysAgo.setHours(0, 0, 0, 0);

            // --- QUERY 1: HISTORY (Steps, Calories, Sleep) ---
            const responseHistory = await axios.post(
                'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',
                {
                    "aggregateBy": [
                        { "dataTypeName": "com.google.step_count.delta" },
                        { "dataTypeName": "com.google.calories.expended" },
                        { "dataTypeName": "com.google.sleep.segment" } // Request Sleep
                    ],
                    "bucketByTime": { "durationMillis": 86400000 }, // 1 Day
                    "startTimeMillis": sevenDaysAgo.getTime(),
                    "endTimeMillis": todayEnd.getTime()
                },
                { headers: { Authorization: `Bearer ${googleToken}` } }
            );

            const buckets = responseHistory.data.bucket;
            if (buckets && buckets.length > 0) {
                graphData.dates = [];
                graphData.steps = [];

                buckets.forEach(bucket => {
                    const date = new Date(parseInt(bucket.startTimeMillis));
                    graphData.dates.push(date.toLocaleDateString('en-US', { weekday: 'short' }));

                    // Steps for Graph
                    const stepDS = bucket.dataset.find(ds => ds.dataSourceId.includes("step_count"));
                    let stepVal = 0;
                    if (stepDS && stepDS.point.length > 0) stepVal = stepDS.point[0].value[0].intVal;
                    graphData.steps.push(stepVal);
                });

                // --- GET TODAY'S TOTALS ---
                const todayBucket = buckets[buckets.length - 1];

                // A. Steps
                const todayStepDS = todayBucket.dataset.find(ds => ds.dataSourceId.includes("step_count"));
                if (todayStepDS && todayStepDS.point.length > 0) {
                    graphData.todaySteps = todayStepDS.point[0].value[0].intVal;
                }

                // B. Calories Burned
                const todayCalDS = todayBucket.dataset.find(ds => ds.dataSourceId.includes("calories"));
                if (todayCalDS && todayCalDS.point.length > 0) {
                    graphData.todayCaloriesBurned = Math.round(todayCalDS.point[0].value[0].fpVal);
                }

                // C. Sleep (The New Logic!)
                const todaySleepDS = todayBucket.dataset.find(ds => ds.dataSourceId.includes("sleep"));
                if (todaySleepDS && todaySleepDS.point.length > 0) {
                    // Google returns sleep in "segments" (e.g., Deep Sleep 2h + Light Sleep 4h)
                    // We must sum them all up.
                    let totalSleepMillis = 0;
                    todaySleepDS.point.forEach(p => {
                        // value[0] is usually the type (Light/Deep), not duration.
                        // We calculate duration using (endTime - startTime) of the segment.
                        const start = parseInt(p.startTimeNanos) / 1000000;
                        const end = parseInt(p.endTimeNanos) / 1000000;
                        totalSleepMillis += (end - start);
                    });

                    // Convert to Hours and Minutes
                    const totalMinutes = Math.floor(totalSleepMillis / 1000 / 60);
                    const hours = Math.floor(totalMinutes / 60);
                    const mins = totalMinutes % 60;
                    graphData.todaySleep = `${hours}h ${mins}m`;
                }
            }

            // --- QUERY 2: INSTANT HEART RATE ---
            const responseInstant = await axios.post(
                'https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate',
                {
                    "aggregateBy": [{ "dataTypeName": "com.google.heart_rate.bpm" }],
                    "bucketByTime": { "durationMillis": 60000 }, 
                    "startTimeMillis": Date.now() - (24 * 60 * 60 * 1000), 
                    "endTimeMillis": Date.now()
                },
                { headers: { Authorization: `Bearer ${googleToken}` } }
            );

            // Find latest heart rate
            const instantBuckets = responseInstant.data.bucket;
            if (instantBuckets && instantBuckets.length > 0) {
                for (let i = instantBuckets.length - 1; i >= 0; i--) {
                    const ds = instantBuckets[i].dataset[0];
                    if (ds.point.length > 0) {
                        graphData.todayHeartRate = Math.round(ds.point[0].value[0].fpVal);
                        break; 
                    }
                }
            }

        } catch (error) {
            console.error("Google Fit Fetch Error:", error.message);
        }
    }

    res.render('dashboard', { 
        user: user, 
        graphData: graphData, 
        googleToken: googleToken 
    });
});
app.get('/chat_bot', (req, res) => res.render('chat_bot'));

// --- GOOGLE AUTH ---
app.get('/auth/google', (req, res) => {
    const BASE_URL = process.env.RENDER_EXTERNAL_URL || "http://localhost:3000";
    const scope = "https://www.googleapis.com/auth/fitness.activity.read https://www.googleapis.com/auth/fitness.body.read https://www.googleapis.com/auth/fitness.sleep.read https://www.googleapis.com/auth/fitness.heart_rate.read";
    const redirectUri = `${BASE_URL}/auth/google/callback`;
    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&access_type=offline`;
    res.redirect(authUrl);
});

app.get('/auth/google/callback', async (req, res) => {
    const { code } = req.query;
    const BASE_URL = process.env.RENDER_EXTERNAL_URL || "http://localhost:3000";
    try {
        const tokenResponse = await axios.post('https://oauth2.googleapis.com/token', {
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            code: code,
            grant_type: 'authorization_code',
            redirect_uri: `${BASE_URL}/auth/google/callback`
        });
        res.redirect(`/dashboard?google_token=${tokenResponse.data.access_token}`);
    } catch (error) {
        console.error('Google Auth Failed');
        res.send("Error logging into Google Fit");
    }
});

// --- CRON JOB ---
cron.schedule("* * * * *", async () => {
    const now = new Date();
    const currentTime = now.toTimeString().slice(0,5);
    console.log("Cron running at:", currentTime);
    try {
        const reminders = await Medication.find({ reminderTime: currentTime });
        for (const r of reminders) {
            let displayName = r.name;
            let rawPhone = r.phone;
            let userDoc = null;
            if (!displayName || !rawPhone) {
                try {
                    userDoc = await userModel.findById(r.userid);
                    if (userDoc) {
                        if (!displayName) displayName = userDoc.name;
                        if (!rawPhone) rawPhone = userDoc.phone;
                    }
                } catch (lookupErr) { console.error(`Failed lookup`, lookupErr.message); }
            }
            if (!rawPhone) rawPhone = process.env.DEFAULT_NOTIFY_PHONE || process.env.TWILIO_TEST_TO || '';
            const digits = String(rawPhone || '').replace(/\D/g, '');
            if (!digits) continue;
            let toNumber = digits;
            if (toNumber.length === 10) toNumber = '91' + toNumber;
            const e164 = '+' + toNumber;
            if (!displayName) displayName = (userDoc && userDoc.name) ? userDoc.name : 'there';
            const medicineText = r.medicine || 'your medicine';
            try {
                await client.messages.create({
                    body: `Hello ${displayName}, take ${medicineText}`,
                    from: process.env.TWILIO_PHONE,
                    to: e164
                });
                console.log(`SMS sent to ${e164}`);
            } catch (twErr) { console.error(`Failed SMS`, twErr.message); }
        }
    } catch (err) { console.error('Error in reminders cron:', err); }
});

// ✅ COMMUNITY PAGE ROUTE (UPDATED to fetch messages)
app.get("/community", isloggedin, async (req, res) => {
  try {
    const user = await userModel.findById(req.user.userid);
    // Fetch all messages, sorted by oldest to newest
    const messages = await Message.find().sort({ createdAt: 1 });

    res.render("community", {
      user: user,
      messages: messages,
    });
  } catch (error) {
    console.error("Error loading community:", error);
    res.redirect("/dashboard");
  }
});
const Message = require('./models/message');

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server is running on port ${PORT}`));