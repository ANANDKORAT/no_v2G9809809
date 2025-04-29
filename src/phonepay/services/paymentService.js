const Payment = require('../../models/Payment');

/**
 * Service for handling payment database operations
 */
const paymentService = {
  /**
   * Create a new payment record in the database
   * 
   * @param {Object} paymentData - Payment data object
   * @param {String} paymentData.orderId - Unique order ID
   * @param {String} paymentData.domainName - Domain name that originated the payment
   * @param {Number} paymentData.amount - Payment amount in rupees
   * @param {Object} paymentData.paymentDetails - Additional payment details
   * @returns {Promise<Object>} Created payment document
   */
  createPayment: async (paymentData) => {
    try {
      const payment = new Payment({
        orderId: paymentData.orderId,
        domainName: paymentData.domainName,
        amount: paymentData.amount,
        paymentDetails: paymentData.paymentDetails,
        status: 'pending'
      });

      const savedPayment = await payment.save();
      return savedPayment;
    } catch (error) {
      console.error('Error creating payment record:', error);
      throw error;
    }
  },

  /**
   * Update payment status by order ID
   * 
   * @param {String} orderId - The unique order ID
   * @param {String} status - New payment status ('pending', 'success', 'failed', 'cancelled')
   * @param {Object} additionalDetails - Any additional details to update
   * @returns {Promise<Object>} Updated payment document
   */
  updatePaymentStatus: async (orderId, status, additionalDetails = {}) => {
    try {
      // Create update object with status and additional details
      const updateData = {
        status,
        updatedAt: new Date(),
        ...additionalDetails
      };
      
      // Update the payment record and return the updated document
      const updatedPayment = await Payment.findOneAndUpdate(
        { orderId },
        { $set: updateData },
        { new: true }
      );
      
      if (!updatedPayment) {
        throw new Error(`Payment with orderId ${orderId} not found`);
      }
      
      return updatedPayment;
    } catch (error) {
      console.error('Error updating payment status:', error);
      throw error;
    }
  },

  /**
   * Get payment by order ID
   * 
   * @param {String} orderId - The unique order ID
   * @returns {Promise<Object>} Payment document
   */
  getPaymentByOrderId: async (orderId) => {
    try {
      const payment = await Payment.findOne({ orderId });
      return payment;
    } catch (error) {
      console.error('Error fetching payment:', error);
      throw error;
    }
  }
};

module.exports = paymentService;