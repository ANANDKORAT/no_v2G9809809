const express = require("express");  // Web framework for Node.js
const cors = require("cors");  // Enable Cross-Origin Resource Sharing
const bodyParser = require("body-parser");  // Parse incoming request bodies
const path = require("path");  // Utilities for working with file paths

// Load environment variables from main .env file
require('dotenv').config();

// Log environment information for debugging and monitoring
console.log(`Starting server in production mode`);
console.log(`Using PhonePe production APIs`);

// Import database connection utility
// This handles connection to MongoDB using Mongoose
const connectDB = require("./src/common/utils/db");

// Import route handlers
// phonepeRoutes contains all API endpoints for payment processing
const phonepeRoutes = require("./src/phonepay/routes/phonepeRoutes");
// Import specific controller functions for standalone payment pages
const { serveUniquePage, serveMultiPaymentPage } = require("./src/phonepay/controllers/phonepeController"); 

// Initialize Express application
const app = express();

// Set up middleware
app.use(bodyParser.json());  // Parse JSON request bodies
app.use(express.urlencoded({ extended: true }));  // Parse URL-encoded bodies
// Configure CORS to allow cross-origin requests
app.use(cors({
    origin: true,  // Allow all origins
    credentials: true,  // Allow cookies to be sent
    allowedHeaders: ["content-type", "authorization"]  // Allow these headers
}));

// Serve static files from the views directory
// This allows direct access to HTML, CSS, and client-side JS files
app.use(express.static(path.join(__dirname, 'src/views')));

// Direct payment page routes
// /upp - Unique Payment Page - Simple, one-off payment flow
app.get("/upp", serveUniquePage);
// /multipayment - Multiple payment methods page
app.get("/multipayment", serveMultiPaymentPage);

// Serve the main payment form at root URL (homepage)
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, 'src/views/index.html'));
});

// API Routes - All PhonePe payment API endpoints are prefixed with /api/phonepay
app.use("/api/phonepay", phonepeRoutes);

// 404 Handler - Show custom 404 page for all unmatched routes
app.use('*', (req, res) => {
    res.status(404).sendFile(path.join(__dirname, 'src/views/404.html'));
});

// Global error handler
// Catches any errors thrown during request processing
app.use((err, req, res, next) => {
    console.error(err.stack);
    res.status(500).send('Something broke!');
});

// Start the Express server
const PORT = process.env.PORT || 5001;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    
    // Try to connect to MongoDB but don't make it critical for server startup
    connectDB().catch(error => {
        console.error("Failed to connect to the database, but server will continue running:", error.message);
        console.warn("Database-dependent features won't work until database connection is restored");
    });
});
