const express = require("express");
const router = express.Router();
const { 
  createOrder, 
  getStatus, 
  handlePaymentFailed, 
  createOrderToken,
  getOrderStatus,
  createUniqueOrder,
  handleUniqueStatus,
  handleWebhook,
} = require("../controllers/phonepeController");

// Payment endpoints
router.post("/create-order", createOrder);
router.post("/create-order-token", createOrderToken);
router.get("/status", getStatus);
router.get("/payment-failed", handlePaymentFailed);
router.get("/order-status/:merchantOrderId", getOrderStatus);

// Webhook notification endpoint
router.post("/notify", handleWebhook);

// Unique payment flow endpoints
router.post("/create-unique-order", createUniqueOrder);
router.get("/unique-status", handleUniqueStatus);

module.exports = router;
