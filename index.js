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
const { serveUniquePage, serveMultiPaymentPage, processPaymentRequest } = require("./src/phonepay/controllers/phonepeController"); 

// Initialize Express application
const app = express();

// Set up middleware
app.use(bodyParser.json());  // Parse JSON request bodies
app.use(express.urlencoded({ extended: true }));  // Parse URL-encoded bodies

// Configure CORS to allow ALL cross-origin requests without restrictions
app.use(cors({
    origin: '*',                  // Allow any domain
    methods: '*',                 // Allow all HTTP methods
    allowedHeaders: '*',          // Allow all headers
    exposedHeaders: '*',          // Expose all headers
    credentials: true,            // Allow cookies
    preflightContinue: true,      // Pass the preflight response to the next handler
    optionsSuccessStatus: 204     // Return 204 for preflight requests
}));

// Add specific OPTIONS handler for all routes
app.options('*', cors());  // Enable preflight for all routes

// IMPORTANT: Register the process-payment route BEFORE serving static files
// This ensures it will always return JSON and won't try to serve an HTML file
app.get("/process-payment", processPaymentRequest);

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

// Start the Express server with improved error handling
const PORT = process.env.PORT || 5001;

// Wrap server startup in try/catch to catch any initialization errors
try {
  // Check for port availability before starting
  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on port ${PORT}`);
    
    // Try to connect to MongoDB but don't make it critical for server startup
    connectDB().catch(error => {
      console.error("Failed to connect to the database, but server will continue running:", error.message);
      console.warn("Database-dependent features won't work until database connection is restored");
    });
  });

  // Handle server errors
  server.on('error', (error) => {
    if (error.code === 'EADDRINUSE') {
      console.error(`Port ${PORT} is already in use. Try a different port.`);
    } else {
      console.error('Server error occurred:', error);
    }
    process.exit(1);
  });

  // Handle process termination
  process.on('SIGTERM', () => {
    console.log('SIGTERM received, shutting down gracefully');
    server.close(() => {
      console.log('Process terminated');
    });
  });

  process.on('SIGINT', () => {
    console.log('SIGINT received, shutting down gracefully');
    server.close(() => {
      console.log('Process terminated');
    });
  });

  // Unhandled promise rejections
  process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Promise Rejection:', reason);
  });

  // Uncaught exceptions
  process.on('uncaughtException', (error) => {
    console.error('Uncaught Exception:', error);
    // Don't exit immediately to allow logging to complete
    setTimeout(() => {
      process.exit(1);
    }, 1000);
  });

} catch (startupError) {
  console.error('Failed to start server:', startupError);
  process.exit(1);
}
