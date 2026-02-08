require("dotenv").config();
const express = require("express");
const path = require("path");
const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const { GoogleGenerativeAI } = require("@google/generative-ai");
const fs = require("fs");
const axios = require("axios");
const cron = require("node-cron"); // Kept if you want to use it later, otherwise unused
const twilio = require("twilio");

// --- 1. SOCKET.IO IMPORTS ---
const http = require("http");
const { Server } = require("socket.io");

// --- MODELS ---
const userModel = require("./models/user");
const Medication = require("./models/medication");
const Message = require("./models/message");

// --- CONFIGURATION ---
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
const client = twilio(process.env.TWILIO_SID, process.env.TWILIO_AUTH_TOKEN);
const app = express();

// --- 2. CREATE HTTP SERVER ---
const server = http.createServer(app);
const io = new Server(server);

// --- 3. TRUST PROXY (Crucial for Render) ---
app.set("trust proxy", 1);

// --- DATABASE CONNECTION ---
mongoose
  .connect(process.env.DB_URL)
  .then(() => console.log("Database connected successfully"))
  .catch((err) => console.log("Database connection error:", err));

// --- MIDDLEWARE ---
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.set("view engine", "ejs");
app.use(express.static(path.join(__dirname, "public")));

// --- MULTER CONFIG ---
const storage = multer.diskStorage({
  destination: "./public/uploads/",
  filename: (req, file, cb) =>
    cb(null, "report-" + Date.now() + path.extname(file.originalname)),
});
const upload = multer({ storage: storage });

// --- AUTH ROUTINES ---
app.get("/", (req, res) => res.render("home"));
app.get("/create", (req, res) => res.render("create"));

app.post("/create", async (req, res) => {
  let { email, password, name, phone } = req.body;
  let existingUser = await userModel.findOne({ email });
  if (existingUser) return res.send("User already exists");

  bcrypt.genSalt(10, (err, salt) => {
    bcrypt.hash(password, salt, async (err, hash) => {
      let newuser = await userModel.create({
        email,
        password: hash,
        name,
        phone,
        todayCalories: 0,
        lastScanDate: new Date().toDateString(),
      });
      let token = jwt.sign(
        { email, userid: newuser._id },
        process.env.JWT_SECRET
      );
      res.cookie("token", token);
      res.redirect("/dashboard");
    });
  });
});

app.get("/login", (req, res) => res.render("login"));
app.post("/login", async (req, res) => {
  let { email, password } = req.body;
  let user = await userModel.findOne({ email });
  if (!user) return res.send("No user found");

  bcrypt.compare(password, user.password, (err, result) => {
    if (result) {
      let token = jwt.sign({ email, userid: user._id }, process.env.JWT_SECRET);
      res.cookie("token", token);
      res.redirect("/dashboard");
    } else {
      res.send("Invalid password");
    }
  });
});

app.get("/logout", (req, res) => {
  res.cookie("token", "");
  res.redirect("/login");
});

function isloggedin(req, res, next) {
  if (!req.cookies || !req.cookies.token) return res.redirect("/login");
  try {
    let data = jwt.verify(
      req.cookies.token,
      process.env.JWT_SECRET || "secretkey"
    );
    req.user = data;
    next();
  } catch (err) {
    res.redirect("/login");
  }
}

// --- MEDICATION API ROUTES ---
app.post("/add-reminder", isloggedin, async (req, res) => {
  const user = await userModel.findById(req.user.userid);
  const reminder = new Medication({
    userid: user._id,
    name: user.name,
    phone: user.phone,
    medicine: req.body.medicine,
    reminderTime: req.body.reminderTime,
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
      userid: req.user.userid,
      createdAt: { $gte: today, $lt: tomorrow },
    }).sort({ reminderTime: 1 });
    res.json(reminders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/reminders/history", isloggedin, async (req, res) => {
  try {
    const reminders = await Medication.find({ userid: req.user.userid }).sort({
      createdAt: -1,
    });
    res.json(reminders);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/reminders", isloggedin, async (req, res) => {
  try {
    const user = await userModel.findById(req.user.userid);
    const reminder = new Medication({
      userid: user._id,
      name: user.name,
      phone: user.phone,
      medicine: req.body.medicine,
      reminderTime: req.body.reminderTime,
      status: "pending",
    });
    await reminder.save();
    res.json({ success: true, reminder });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/reminders/:id", isloggedin, async (req, res) => {
  try {
    const { medicine, reminderTime, status } = req.body;
    const update = { updatedAt: new Date() };
    if (medicine) update.medicine = medicine;
    if (reminderTime) update.reminderTime = reminderTime;
    if (status) update.status = status;
    const reminder = await Medication.findByIdAndUpdate(req.params.id, update, {
      new: true,
    });
    if (!reminder)
      return res
        .status(404)
        .json({ success: false, message: "Reminder not found" });
    res.json({ success: true, reminder });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/reminders/:id", isloggedin, async (req, res) => {
  try {
    await Medication.findByIdAndDelete(req.params.id);
    res.json({ success: true, message: "Reminder deleted" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/reminders/:id/complete", isloggedin, async (req, res) => {
  try {
    const reminder = await Medication.findByIdAndUpdate(
      req.params.id,
      { status: "completed", completedAt: new Date(), updatedAt: new Date() },
      { new: true }
    );
    res.json({ success: true, reminder });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/check-reminders", async (req, res) => {
  const data = await Medication.find();
  res.json(data);
});

// --- PAGE ROUTES ---
app.get("/medication", isloggedin, async (req, res) => {
  const user = await userModel.findById(req.user.userid);
  res.render("medication", { user });
});

app.get("/reminders", isloggedin, async (req, res) => {
  const user = await userModel.findById(req.user.userid);
  res.render("reminders", { user });
});

app.get("/food", isloggedin, async (req, res) => {
  let user = await userModel.findOne({ _id: req.user.userid });
  res.render("food", { user: user });
});

app.get("/community", isloggedin, async (req, res) => {
  try {
    const user = await userModel.findById(req.user.userid);
    // Fetch all messages, sorted by oldest to newest
    const messages = await Message.find().sort({ createdAt: 1 });
    res.render("community", { user: user, messages: messages });
  } catch (error) {
    console.error("Error loading community:", error);
    res.redirect("/dashboard");
  }
});

app.get("/chat_bot", (req, res) => res.render("chat_bot"));

// --- FOOD ANALYSIS ---
app.post("/analyze", upload.single("report"), isloggedin, async (req, res) => {
  try {
    const file = req.file;
    const mealType = req.body.mealType;
    const todayStr = new Date().toISOString().split("T")[0];
    let user = await userModel.findById(req.user.userid);

    if (user.lastResetDate !== todayStr) {
      user.nutrition = {
        calories: 0,
        protein: 0,
        carbs: 0,
        fats: 0,
        fiber: 0,
        calcium: 0,
        iron: 0,
        zinc: 0,
        magnesium: 0,
        cholesterol: 0,
      };
      user.meals = {
        breakfast: null,
        morningSnack: null,
        lunch: null,
        eveningSnack: null,
        dinner: null,
      };
      user.lastResetDate = todayStr;
      await user.save();
    }

    const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
    const prompt = `Analyze this food image. Return a pure JSON object: { "food_name": "Short Name", "calories": 0, "macros": { "protein_g": 0, "carbs_g": 0, "fats_g": 0, "fiber_g": 0 }, "micros": { "calcium_mg": 0, "iron_mg": 0, "zinc_mg": 0, "magnesium_mg": 0, "cholesterol_mg": 0 } }`;

    const parts = [prompt];
    if (file) {
      parts.push({
        inlineData: {
          data: Buffer.from(fs.readFileSync(path.resolve(file.path))).toString(
            "base64"
          ),
          mimeType: file.mimetype,
        },
      });
    }

    const result = await model.generateContent(parts);
    const cleanJson = result.response
      .text()
      .replace(/```json|```/g, "")
      .trim();
    const foodData = JSON.parse(cleanJson);

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
        "nutrition.cholesterol": foodData.micros.cholesterol_mg,
      },
    };

    if (mealType) {
      updateQuery["$set"] = {};
      updateQuery["$set"][`meals.${mealType}`] = {
        name: foodData.food_name,
        calories: foodData.calories,
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

// --- DASHBOARD ROUTE (FIXED GOOGLE FIT LOGIC) ---
app.get("/dashboard", isloggedin, async (req, res) => {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, private");

  let user = await userModel.findOne({ _id: req.user.userid });
  const googleToken = req.query.google_token;

  let graphData = {
    dates: [],
    steps: [],
    todaySteps: 0,
    todayHeartRate: 0,
    todayCaloriesBurned: 0,
    todaySleep: "--",
    isConnected: false,
  };

  if (googleToken) {
    try {
      graphData.isConnected = true;

      // ✅ SIMPLE & CORRECT TIME RANGE
      const endTime = Date.now();
      const startTime = endTime - 7 * 24 * 60 * 60 * 1000;

      // ---------- QUERY 1 : HISTORY ----------
      const responseHistory = await axios.post(
        "https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate",
        {
          aggregateBy: [
            { dataTypeName: "com.google.step_count.delta" },
            { dataTypeName: "com.google.calories.expended" },
            { dataTypeName: "com.google.sleep.segment" },
          ],
          bucketByTime: { durationMillis: 86400000 },
          startTimeMillis: startTime,
          endTimeMillis: endTime,
        },
        { headers: { Authorization: `Bearer ${googleToken}` } }
      );

      const buckets = responseHistory.data.bucket || [];
      const todayStr = new Date().toISOString().split("T")[0];

      let todayBucket = null;
      let totalSleepMillis = 0;

      buckets.forEach((bucket) => {
        const bucketDateStr = new Date(
          parseInt(bucket.startTimeMillis)
        ).toISOString().split("T")[0];

        // ---------- GRAPH DATA ----------
        graphData.dates.push(
          new Date(bucket.startTimeMillis).toLocaleDateString("en-US", {
            weekday: "short",
          })
        );

        const stepDS = bucket.dataset.find((ds) =>
          ds.dataSourceId.includes("step_count")
        );

        let daySteps = 0;
        if (stepDS) {
          stepDS.point.forEach((p) => {
            daySteps += p.value[0].intVal || 0;
          });
        }
        graphData.steps.push(daySteps);

        // ---------- IDENTIFY TODAY ----------
        if (bucketDateStr === todayStr) {
          todayBucket = bucket;
        }

        // ---------- SLEEP (SPANS MULTIPLE DAYS) ----------
        const sleepDS = bucket.dataset.find((ds) =>
          ds.dataSourceId.includes("sleep")
        );
        if (sleepDS) {
          sleepDS.point.forEach((p) => {
            const start = Number(p.startTimeNanos) / 1e6;
            const end = Number(p.endTimeNanos) / 1e6;
            totalSleepMillis += end - start;
          });
        }
      });

      // ---------- TODAY TOTALS ----------
      if (todayBucket) {
        // Steps
        const todayStepDS = todayBucket.dataset.find((ds) =>
          ds.dataSourceId.includes("step_count")
        );
        if (todayStepDS) {
          todayStepDS.point.forEach((p) => {
            graphData.todaySteps += p.value[0].intVal || 0;
          });
        }

        // Calories
        const todayCalDS = todayBucket.dataset.find((ds) =>
          ds.dataSourceId.includes("calories")
        );
        if (todayCalDS && todayCalDS.point.length > 0) {
          graphData.todayCaloriesBurned = Math.round(
            todayCalDS.point[0].value[0].fpVal || 0
          );
        }
      }

      // ---------- FINAL SLEEP FORMAT ----------
      const sleepMinutes = Math.floor(totalSleepMillis / 1000 / 60);
      const sleepHours = Math.floor(sleepMinutes / 60);
      const sleepMins = sleepMinutes % 60;
      graphData.todaySleep = `${sleepHours}h ${sleepMins}m`;

      // ---------- QUERY 2 : HEART RATE ----------
      const responseInstant = await axios.post(
        "https://www.googleapis.com/fitness/v1/users/me/dataset:aggregate",
        {
          aggregateBy: [{ dataTypeName: "com.google.heart_rate.bpm" }],
          bucketByTime: { durationMillis: 60000 },
          startTimeMillis: Date.now() - 24 * 60 * 60 * 1000,
          endTimeMillis: Date.now(),
        },
        { headers: { Authorization: `Bearer ${googleToken}` } }
      );

      const instantBuckets = responseInstant.data.bucket || [];
      for (let i = instantBuckets.length - 1; i >= 0; i--) {
        const ds = instantBuckets[i]?.dataset?.[0];
        if (ds && ds.point.length > 0) {
          graphData.todayHeartRate = Math.round(
            ds.point[ds.point.length - 1].value[0].fpVal
          );
          break;
        }
      }
    } catch (error) {
      console.error("Google Fit Fetch Error:", error.message);
    }
  }

  res.render("dashboard", {
    user: user,
    graphData: graphData,
    googleToken: googleToken,
  });
});


// --- GOOGLE AUTH ---
app.get("/auth/google", (req, res) => {
  const BASE_URL = process.env.RENDER_EXTERNAL_URL || "http://localhost:3000";
  const scope =
    "https://www.googleapis.com/auth/fitness.activity.read https://www.googleapis.com/auth/fitness.body.read https://www.googleapis.com/auth/fitness.sleep.read https://www.googleapis.com/auth/fitness.heart_rate.read";
  const redirectUri = `${BASE_URL}/auth/google/callback`;
  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${process.env.GOOGLE_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&access_type=offline`;
  res.redirect(authUrl);
});

app.get("/auth/google/callback", async (req, res) => {
  const { code } = req.query;
  const BASE_URL = process.env.RENDER_EXTERNAL_URL || "http://localhost:3000";
  try {
    const tokenResponse = await axios.post(
      "https://oauth2.googleapis.com/token",
      {
        client_id: process.env.GOOGLE_CLIENT_ID,
        client_secret: process.env.GOOGLE_CLIENT_SECRET,
        code: code,
        grant_type: "authorization_code",
        redirect_uri: `${BASE_URL}/auth/google/callback`,
      }
    );
    res.redirect(`/dashboard?google_token=${tokenResponse.data.access_token}`);
  } catch (error) {
    console.error("Google Auth Failed");
    res.send("Error logging into Google Fit");
  }
});

// --- ANDROID VERIFICATION ROUTE ---
app.get("/.well-known/assetlinks.json", (req, res) => {
  res.setHeader("Content-Type", "application/json");
  res.sendFile(__dirname + "/public/assetlinks.json");
});

// --- 3. SOCKET.IO CONNECTION HANDLER ---
io.on("connection", (socket) => {
  console.log("A user connected to community chat");

  // Listen for 'chat message' from client
  socket.on("chat message", async (msg) => {
    try {
      // 1. Save message to MongoDB
      const user = await userModel.findOne({ name: msg.sender });
      if (user) {
        const newMessage = new Message({
          userid: user._id,
          username: msg.sender,
          text: msg.text,
          time: msg.time, // Frontend sends the time string
        });
        await newMessage.save();
      }

      // 2. Broadcast message to everyone
      io.emit("chat message", msg);
    } catch (err) {
      console.error("Error saving message:", err);
    }
  });

  socket.on("disconnect", () => {
    console.log("User disconnected");
  });
});

// --- 4. START SERVER (Corrected Port) ---
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server is running on port ${PORT}`));