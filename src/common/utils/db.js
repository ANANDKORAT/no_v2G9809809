const mongoose = require("mongoose");
require("dotenv").config();

/**
 * Database Connection Utility
 * 
 * Establishes connection to MongoDB using the connection string from environment variables.
 * This version handles errors gracefully and allows the application to function
 * even if the database is temporarily unavailable.
 * 
 * @returns {Promise<void>} - Promise that resolves when connection is established
 */
const connectDB = async () => {
    try {
        // Check if MONGO_URI is defined
        if (!process.env.MONGO_URI) {
            throw new Error("MongoDB connection string (MONGO_URI) is not defined in environment variables");
        }
        
        // Set mongoose options for better stability
        const options = {
            useNewUrlParser: true,
            useUnifiedTopology: true,
            serverSelectionTimeoutMS: 5000, // Timeout after 5s instead of 30s
            connectTimeoutMS: 10000, // Give up initial connection after 10s
            socketTimeoutMS: 45000, // Close sockets after 45s of inactivity
        };
        
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGO_URI, options);
        
        console.log("MongoDB connected successfully");
        
        // Add error event listeners to handle connection issues
        mongoose.connection.on('error', (err) => {
            console.error('MongoDB connection error:', err);
        });
        
        mongoose.connection.on('disconnected', () => {
            console.warn('MongoDB disconnected. Will try to reconnect automatically.');
        });
        
        mongoose.connection.on('reconnected', () => {
            console.log('MongoDB reconnected successfully');
        });
        
        return mongoose.connection;
    } catch (error) {
        console.error("MongoDB connection error:", error.message);
        // Don't exit the application, let the caller decide what to do
        throw error; 
    }
};

module.exports = connectDB;
