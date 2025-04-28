const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const path = require("path");

// Load environment variables - production only
require('dotenv').config({ path: '.env.production' });

// Log the environment information
console.log(`Starting server in production mode`);
console.log(`Using PhonePe production APIs`);

// Database connection
const connectDB = require("./src/common/utils/db");

// Routes
const phonepeRoutes = require("./src/phonepay/routes/phonepeRoutes");
// Import the specific controller function
const { serveUniquePage } = require("./src/phonepay/controllers/phonepeController"); 

// Initialize Express
const app = express();

// Middleware
app.use(bodyParser.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors({
    origin: true, 
    credentials: true,
    allowedHeaders: ["content-type", "authorization"]
}));

// Serve static files from the views directory
app.use(express.static(path.join(__dirname, 'src/views')));

// Mount specific route for /upp
app.get("/upp", serveUniquePage);

// Serve the main payment form on root URL
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, 'src/views/index.html'));
});

// Mount general API routes
app.use("/api/phonepay", phonepeRoutes);

// Make all unmatched routes return 404
app.use('*', (req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'src/views/404.html'));
});

// Error handler
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

// Connect to Database
(async () => {
    try {
        await connectDB();
    } catch (error) {
        console.error("Failed to connect to the database:", error.message);
        process.exit(1);
    }
})();

// Start the Server
const PORT = process.env.PORT || 5001;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
});
