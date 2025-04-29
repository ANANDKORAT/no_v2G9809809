const mongoose = require('mongoose');

/**
 * Payment Schema
 * Stores information about payments processed through the system
 */
const paymentSchema = new mongoose.Schema({
  // Unique order ID generated for this payment
  orderId: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  // Domain name that originated the payment
  domainName: {
    type: String,
    required: true
  },
  // Payment amount in rupees (stored as a number)
  amount: {
    type: Number,
    required: true
  },
  // Additional payment details (can store various properties)
  paymentDetails: {
    type: Object,
    default: {}
  },
  // Payment status: 'pending', 'success', 'failed', 'cancelled'
  status: {
    type: String,
    enum: ['pending', 'success', 'failed', 'cancelled'],
    default: 'pending'
  },
  // When the payment record was created
  createdAt: {
    type: Date,
    default: Date.now
  },
  // When the payment status was last updated
  updatedAt: {
    type: Date,
    default: Date.now
  }
});

// Update the updatedAt timestamp before saving
paymentSchema.pre('save', function(next) {
  if (this.isModified() && !this.isNew) {
    this.updatedAt = Date.now();
  }
  next();
});

const Payment = mongoose.model('Payment', paymentSchema);

module.exports = Payment;