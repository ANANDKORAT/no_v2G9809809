const express = require("express");
const router = express.Router();
const cors = require("cors");  // Import cors for route-level CORS handling

// Configure all routes to have wide open CORS
const openCors = cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: '*',
  credentials: true
});

// Apply openCors to all routes
router.use(openCors);

const { 
  createOrder,           // Creates a payment order with option for iframe or redirect
  getStatus,             // Checks payment status by transaction ID
  handlePaymentFailed,   // Handles failed payment redirects
  createOrderToken,      // Creates a payment token for client-side integration
  getOrderStatus,        // Gets detailed status of an order by merchant order ID
  createUniqueOrder,     // Creates one-off unique payment orders
  handleUniqueStatus,    // Handles status updates for unique payment flow
  handleWebhook,         // Processes PhonePe webhook notifications
  createOrderGet,        // Creates orders via GET request (for direct URL access)
  handleMultiStatus,     // Handles status updates for multi-payment flow
  // Payment flow functions
  processPaymentRequest, // Processes payment data received from frontend via GET
  handlePaymentStatus,   // Handles payment status and redirects based on outcome
  handlePaymentCancelled, // Handles payment cancellations
  processCheckoutPayment, // Handles checkout payments
  showPaymentError      // Displays payment error page
} = require("../controllers/phonepeController");

// Standard payment flow endpoints
// POST /api/phonepay/create-order - Creates a new payment order
router.post("/create-order", openCors, createOrder);
// POST /api/phonepay/create-order-token - Creates a payment token for client integration
router.post("/create-order-token", openCors, createOrderToken);
// GET /api/phonepay/status - Checks payment status and redirects accordingly
router.get("/status", openCors, getStatus);
// GET /api/phonepay/payment-failed - Handles failed payment redirection
router.get("/payment-failed", openCors, handlePaymentFailed);
// GET /api/phonepay/order-status/:merchantOrderId - Gets detailed order status
router.get("/order-status/:merchantOrderId", openCors, getOrderStatus);

// PhonePe Webhook endpoint
// POST /api/phonepay/notify - Receives payment notifications from PhonePe
router.post("/notify", openCors, handleWebhook);

// Unique payment flow endpoints (simplified one-off payments)
// POST /api/phonepay/create-unique-order - Creates a unique payment order
router.post("/create-unique-order", openCors, createUniqueOrder);
// GET /api/phonepay/unique-status - Handles status updates for unique payment flow
router.get("/unique-status", openCors, handleUniqueStatus);

// Multi-payment flow endpoints (supports GET requests for easy integration)
// GET /api/phonepay/create-order-get - Creates order via GET (for sharable links)
router.get("/create-order-get", openCors, createOrderGet);
// GET /api/phonepay/multi-status - Handles status for multi-payment flow
router.get("/multi-status", openCors, handleMultiStatus);

// New routes for the custom payment flow
// GET /api/phonepay/process-payment - Processes payment data from frontend
router.get("/process-payment", openCors, processPaymentRequest);
// GET /api/phonepay/payment-status - Handles payment status and redirects user accordingly
router.get("/payment-status", openCors, handlePaymentStatus);
// GET /api/phonepay/payment-cancelled - Handles payment cancellations
router.get("/payment-cancelled", openCors, handlePaymentCancelled);

// Checkout payment integration endpoint
// POST /api/phonepay/checkout-payment - Processes payment from checkout page
router.post("/checkout-payment", openCors, processCheckoutPayment);

// Error handling page
// GET /api/phonepay/payment-error - Shows payment error page
router.get("/payment-error", openCors, showPaymentError);

// Add OPTIONS handling for all routes to support preflight requests
router.options("*", openCors);

module.exports = router;
