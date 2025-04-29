const axios = require("axios");
const crypto = require("crypto");
const path = require("path");
const fs = require("fs");
const authService = require("../services/authService");
const paymentService = require("../services/paymentService");

// Use only production URL
const BASE_URL = "https://api.phonepe.com/apis/pg";

// Log the API URL being used
console.log(`Using PhonePe production API: ${BASE_URL}`);

/**
 * Creates an order with PhonePe and handles redirect based on mode
 */
const createOrder = async (req, res) => {
  try {
    const authToken = await authService.getAuthToken();
    const { name, mobileNumber, amount, redirectMode = 'IFRAME', enabledPaymentModes } = req.body;
    const merchantOrderId = "TX" + Date.now();

    // Base payment payload
    const paymentPayload = {
      merchantOrderId,
      amount: Math.round(amount * 100), // Convert to paisa and ensure it's an integer
      expireAfter: 1200, // 20 minutes
      metaInfo: {
        udf1: name || "Customer",
        udf2: mobileNumber || "",
        udf3: redirectMode || "IFRAME",
        udf4: "",
        udf5: ""
      },
      paymentFlow: {
        type: "PG_CHECKOUT",
        message: "Payment for order " + merchantOrderId,
        merchantUrls: {
          redirectUrl: `${req.protocol}://${req.get('host')}/api/phonepay/status?txnId=${merchantOrderId}`,
          cancelUrl: `${req.protocol}://${req.get('host')}/api/phonepay/payment-failed`,
          notifyUrl: `${req.protocol}://${req.get('host')}/api/phonepay/notify`
        }
      },
      userInfo: {
        name: name || "Customer",
        mobileNumber: mobileNumber || ""
      }
    };

    // Only add paymentModeConfig if specifically requested
    if (enabledPaymentModes) {
      paymentPayload.paymentFlow.paymentModeConfig = {
        enabledPaymentModes: enabledPaymentModes === "all" ? [
          { type: "UPI_INTENT" },
          { type: "UPI_COLLECT" },
          { type: "UPI_QR" },
          { type: "NET_BANKING" },
          {
            type: "CARD",
            cardTypes: ["DEBIT_CARD", "CREDIT_CARD"]
          }
        ] : enabledPaymentModes
      };
    }

    console.log("Creating order with payload:", JSON.stringify(paymentPayload, null, 2));

    const option = {
      method: "POST",
      url: `${BASE_URL}/checkout/v2/pay`,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `O-Bearer ${authToken}`
      },
      data: paymentPayload
    };

    const response = await axios.request(option);
    
    // If successful, response should contain redirectUrl
    if (!response.data || !response.data.redirectUrl) {
      throw new Error("Invalid response from PhonePe: Missing redirectUrl");
    }

    if (redirectMode === 'IFRAME') {
      // Read the HTML file content
      const checkoutHtml = fs.readFileSync(path.join(__dirname, '../views/checkout.html'), 'utf8');
      
      // Insert the script into the HTML
      const script = `
        <script>
          window.redirectUrl = "${response.data.redirectUrl}";
          window.merchantId = "${process.env.PHONEPE_CLIENT_ID}";
          window.transactionId = "${merchantOrderId}";
          window.amount = ${Math.round(amount * 100)};
          window.failureUrl = "/api/phonepay/payment-failed";
        </script>
      `;
      
      // Send the combined HTML and script
      const finalHtml = checkoutHtml.replace('</body>', `${script}</body>`);
      res.send(finalHtml);
    } else {
      res.json({
        success: true,
        redirectUrl: response.data.redirectUrl,
        orderId: response.data.orderId,
        merchantOrderId,
        state: response.data.state,
        expireAt: response.data.expireAt
      });
    }
  } catch (error) {
    console.error("Error in create-order:", error?.response?.data || error);
    res.status(500).send({
      message: "Error creating order",
      success: false,
      details: error?.response?.data || error.message
    });
  }
};

/**
 * Creates an order token for client-side integration
 */
const createOrderToken = async (req, res) => {
  try {
    const authToken = await authService.getAuthToken();
    const { name, mobileNumber, amount } = req.body;
    const merchantOrderId = "TX" + Date.now();

    const paymentPayload = {
      merchantOrderId,
      amount: Math.round(amount * 100),
      expireAfter: 1200,
      metaInfo: {
        udf1: name,
        udf2: mobileNumber
      },
      paymentFlow: {
        type: "PG_CHECKOUT",
        message: "Payment for order " + merchantOrderId,
        merchantUrls: {
          redirectUrl: `${req.protocol}://${req.get('host')}/api/phonepay/status?txnId=${merchantOrderId}`,
          cancelUrl: `${req.protocol}://${req.get('host')}/api/phonepay/payment-failed`,
          notifyUrl: `${req.protocol}://${req.get('host')}/api/phonepay/notify`
        }
      }
    };

    const response = await axios.post(`${BASE_URL}/checkout/v2/pay`, paymentPayload, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `O-Bearer ${authToken}`
      }
    });

    res.json({
      success: true,
      tokenUrl: response.data.redirectUrl,
      merchantOrderId
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: "Error creating order",
      details: error?.response?.data || error.message
    });
  }
};

/**
 * Handles payment status checks
 */
const getStatus = async (req, res) => {
  try {
    const authToken = await authService.getAuthToken();
    const { txnId } = req.query;

    if (!txnId) {
      return res.status(400).json({
        success: false,
        message: "Transaction ID is required"
      });
    }

    const response = await axios.get(`${BASE_URL}/checkout/v2/status/${txnId}`, {
      headers: {
        "Authorization": `O-Bearer ${authToken}`
      }
    });

    // Check payment status
    const paymentStatus = response.data.state;
    
    if (paymentStatus === 'COMPLETED') {
      return res.redirect('/?status=success&txnId=' + txnId);
    } else if (paymentStatus === 'FAILED') {
      return res.redirect('/?status=failed&txnId=' + txnId);
    } else {
      return res.redirect('/?status=pending&txnId=' + txnId);
    }
  } catch (error) {
    console.error("Error checking payment status:", error?.response?.data || error);
    return res.redirect('/?status=error&message=' + encodeURIComponent(error.message));
  }
};

/**
 * Webhook handler for PhonePe notifications
 */
const handleWebhook = async (req, res) => {
  try {
    const payload = req.body;
    console.log("Received webhook notification:", JSON.stringify(payload, null, 2));
    
    // Verify the signature if PhonePe provides one
    // This would depend on PhonePe's webhook implementation
    
    // Extract the merchant order ID and status from the webhook payload
    // Note: The actual structure depends on PhonePe's webhook format
    const orderId = payload.merchantOrderId || payload.data?.merchantOrderId;
    const paymentStatus = payload.code || payload.data?.state;
    
    if (orderId) {
      // Map PhonePe status to our status format
      let dbStatus = 'pending';
      if (paymentStatus === 'PAYMENT_SUCCESS' || paymentStatus === 'COMPLETED') {
        dbStatus = 'success';
      } else if (paymentStatus === 'PAYMENT_ERROR' || paymentStatus === 'FAILED') {
        dbStatus = 'failed';
      } else if (paymentStatus === 'PAYMENT_CANCELLED' || paymentStatus === 'CANCELLED') {
        dbStatus = 'cancelled';
      }
      
      // Update payment status in database
      await paymentService.updatePaymentStatus(orderId, dbStatus, {
        'paymentDetails.webhookData': payload
      });
      
      console.log(`Updated payment status to ${dbStatus} for order ${orderId}`);
    }
    
    // Always return 200 to PhonePe to acknowledge receipt
    res.status(200).json({ status: "RECEIVED" });
  } catch (error) {
    console.error("Error processing webhook:", error);
    res.status(500).json({ error: "Internal server error" });
  }
};

const handlePaymentFailed = async (req, res) => {
  try {
    const { code, merchantOrderId, transactionId } = req.query;
    
    // Log the failure details
    console.error("Payment failed:", {
      code,
      merchantOrderId,
      transactionId,
      timestamp: new Date().toISOString()
    });

    return res.redirect('/?status=failed&code=' + (code || 'unknown'));
  } catch (error) {
    console.error("Error handling payment failure:", error);
    return res.status(500).json({
      success: false,
      message: "Error handling payment failure",
      error: error.message
    });
  }
};

const getOrderStatus = async (req, res) => {
  try {
    const authToken = await authService.getAuthToken();
    const { merchantOrderId } = req.params;

    if (!merchantOrderId) {
      return res.status(400).json({
        success: false,
        message: "Merchant Order ID is required"
      });
    }

    // Updated URL to match the correct PhonePe API endpoint (same as used in handleUniqueStatus)
    const statusCheckUrl = `${BASE_URL}/checkout/v2/order/${merchantOrderId}/status`;
    console.log(`Checking payment status for ${merchantOrderId} at ${statusCheckUrl}`);
    
    const response = await axios.get(statusCheckUrl, {
      headers: {
        "Authorization": `O-Bearer ${authToken}`,
        "Content-Type": "application/json"
      }
    });

    return res.json({
      success: true,
      data: response.data
    });
  } catch (error) {
    console.error("Error checking order status:", error?.response?.data || error);
    return res.status(500).json({
      success: false,
      message: "Error checking order status",
      details: error?.response?.data || error.message
    });
  }
};

const createUniqueOrder = async (req, res) => {
  try {
    console.log("Received request body:", JSON.stringify(req.body));
    
    // Extract parameters with defaults to prevent undefined errors
    const { 
      name = "Guest", 
      mobileNumber = "9999999999", 
      amount = 1.00 
    } = req.body;

    // Validate amount (must be a number greater than 0)
    if (!amount || isNaN(amount) || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid amount. Must be a number greater than 0",
        details: `Received amount: ${amount}`
      });
    }

    // Get auth token first
    const authToken = await authService.getAuthToken();
    
    if (!authToken) {
      console.error("Failed to get auth token from PhonePe");
      return res.status(500).json({
        success: false, 
        message: "Authentication failed with payment gateway",
        details: "Could not obtain authorization token"
      });
    }
    
    // Generate a unique merchant order ID with timestamp and random string
    const randomString = Math.random().toString(36).substring(2, 8);
    const merchantOrderId = `UNIQUE-${Date.now()}-${randomString}`;

    // Create payment payload
    const paymentPayload = {
      merchantOrderId,
      amount: Math.round(amount * 100), // Convert to paisa and ensure it's an integer
      expireAfter: 1800, // 30 minutes
      metaInfo: {
        udf1: name,
        udf2: mobileNumber,
        udf3: "UNIQUE_PAYMENT"
      },
      paymentFlow: {
        type: "PG_CHECKOUT",
        message: `Unique Payment ${merchantOrderId}`,
        merchantUrls: {
          redirectUrl: `${req.protocol}://${req.get('host')}/api/phonepay/unique-status?txnId=${merchantOrderId}`,
          cancelUrl: `${req.protocol}://${req.get('host')}/upp?status=failed&details=Payment%20was%20cancelled`,
          notifyUrl: `${req.protocol}://${req.get('host')}/api/phonepay/notify`
        },
        paymentModeConfig: {
          enabledPaymentModes: [
            { type: "UPI_INTENT" },
            { type: "UPI_COLLECT" },
            { type: "UPI_QR" },
            {
              type: "CARD",
              cardTypes: ["DEBIT_CARD", "CREDIT_CARD"]
            }
          ]
        }
      }
    };

    console.log("Creating unique order with payload:", JSON.stringify(paymentPayload, null, 2));

    const option = {
      method: "POST",
      url: `${BASE_URL}/checkout/v2/pay`,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `O-Bearer ${authToken}`
      },
      data: paymentPayload
    };

    console.log("Sending request to PhonePe:", option.url);
    const response = await axios.request(option);
    console.log("PhonePe API response:", JSON.stringify(response.data, null, 2));

    res.json({
      success: true,
      redirectUrl: response.data.redirectUrl,
      merchantOrderId
    });
    
  } catch (error) {
    console.error("Error in create-unique-order:");
    
    // Log detailed error information
    if (error.response) {
      console.error("PhonePe API error response:");
      console.error("Status:", error.response.status);
      console.error("Headers:", JSON.stringify(error.response.headers));
      console.error("Data:", JSON.stringify(error.response.data));
    } else if (error.request) {
      console.error("No response received from PhonePe API:", error.request);
    } else {
      console.error("Error message:", error.message);
    }
    
    res.status(500).json({
      success: false,
      message: "Error creating unique order",
      details: error.response?.data || error.message
    });
  }
};

const handleUniqueStatus = async (req, res) => {
  try {
    const authToken = await authService.getAuthToken();
    const { txnId } = req.query; // This is the merchantOrderId

    if (!txnId) {
      return res.redirect('/upp?status=failed&details=Missing%20transaction%20ID');
    }

    // URL exactly as specified in the documentation
    const statusCheckUrl = `${BASE_URL}/checkout/v2/order/${txnId}/status`;
    
    console.log(`Checking unique payment status for ${txnId} at ${statusCheckUrl}`);

    const response = await axios.get(statusCheckUrl, { 
      headers: {
        "Authorization": `O-Bearer ${authToken}`,
        "Content-Type": "application/json"
      }
    });

    const orderData = response.data;
    let status, details;

    console.log("Order Status API Response:", JSON.stringify(orderData, null, 2));

    // Determine payment status based on the 'state' field in the main response
    if (orderData.state === "COMPLETED") {
      status = "success";
      // Extract details from paymentDetails if available
      const paymentDetail = orderData.paymentDetails && orderData.paymentDetails.length > 0 ? orderData.paymentDetails[0] : null;
      details = `Transaction ID: ${paymentDetail ? paymentDetail.transactionId : 'N/A'}, Amount: ₹${orderData.amount / 100}`;
    } else if (orderData.state === "PENDING") {
      status = "pending";
      details = "Your payment is being processed";
    } else { // Includes FAILED and potentially other states
      status = "failed";
      details = orderData.message || `Payment ${orderData.state || 'failed'}`;
      if (orderData.errorCode) {
        details += ` (Code: ${orderData.errorCode})`;
      }
    }

    // Redirect back to the unique payment page with status
    return res.redirect(`/upp?status=${status}&details=${encodeURIComponent(details)}`); 
    
  } catch (error) {
    console.error("Error checking unique payment status:");
    let errorDetails = "Error processing payment";
    if (error.response) {
      console.error("API Response Status:", error.response.status);
      console.error("API Response Data:", JSON.stringify(error.response.data));
      errorDetails = error.response.data?.message || errorDetails; 
    } else {
      console.error("Error message:", error.message);
      errorDetails = error.message;
    }
    return res.redirect(`/upp?status=failed&details=${encodeURIComponent(errorDetails)}`); 
  }
};

const serveUniquePage = (req, res) => {
  try {
    res.sendFile(path.join(__dirname, '../views/uniquepayment.html'));
  } catch (error) {
    console.error("Error serving unique payment page:", error);
    res.status(500).send("Error loading payment page");
  }
};

const serveMultiPaymentPage = (req, res) => {
  try {
    // Check if a file exists for the multipayment page
    const multiPaymentPath = path.join(__dirname, '../views/multipayment.html');
    
    // If the file exists, serve it
    if (fs.existsSync(multiPaymentPath)) {
      res.sendFile(multiPaymentPath);
    } else {
      // If the file doesn't exist, serve the uniquepayment.html as a fallback
      console.warn("multipayment.html not found, serving uniquepayment.html instead");
      res.sendFile(path.join(__dirname, '../views/uniquepayment.html'));
    }
  } catch (error) {
    console.error("Error serving multi payment page:", error);
    res.status(500).send("Error loading payment page");
  }
};

/**
 * Creates order via GET method for multipayment endpoint
 */
const createOrderGet = async (req, res) => {
  try {
    // Extract parameters from query string
    const { name = "Guest", mobile = "9999999999", amount = 1 } = req.query;
    
    // Validate amount
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Invalid amount. Must be a number greater than 0",
        details: `Received amount: ${amount}`
      });
    }

    // Get auth token
    const authToken = await authService.getAuthToken();
    
    // Generate a unique merchant order ID
    const merchantOrderId = `MULTI-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    // Create payment payload
    const paymentPayload = {
      merchantOrderId,
      amount: Math.round(parsedAmount * 100), // Convert to paisa
      expireAfter: 1800, // 30 minutes
      metaInfo: {
        udf1: name,
        udf2: mobile,
        udf3: "MULTI_PAYMENT"
      },
      paymentFlow: {
        type: "PG_CHECKOUT",
        message: `Multi Payment ${merchantOrderId}`,
        merchantUrls: {
          redirectUrl: `${req.protocol}://${req.get('host')}/api/phonepay/multi-status?txnId=${merchantOrderId}`,
          cancelUrl: `${req.protocol}://${req.get('host')}/multipayment?status=failed&details=Payment%20was%20cancelled`,
          notifyUrl: `${req.protocol}://${req.get('host')}/api/phonepay/notify`
        },
        paymentModeConfig: {
          enabledPaymentModes: [
            { type: "UPI_INTENT" },
            { type: "UPI_COLLECT" },
            { type: "UPI_QR" },
            {
              type: "CARD",
              cardTypes: ["DEBIT_CARD", "CREDIT_CARD"]
            }
          ]
        }
      },
      userInfo: {
        name: name,
        mobileNumber: mobile
      }
    };

    console.log("Creating multi-payment order with payload:", JSON.stringify(paymentPayload, null, 2));

    // Send request to PhonePe
    const response = await axios({
      method: "POST",
      url: `${BASE_URL}/checkout/v2/pay`,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `O-Bearer ${authToken}`
      },
      data: paymentPayload
    });

    // Redirect to the PhonePe payment URL
    return res.redirect(response.data.redirectUrl);
    
  } catch (error) {
    console.error("Error in GET create-order:");
    
    // Log error details
    if (error.response) {
      console.error("PhonePe API error response:", error.response.status);
      console.error("Error data:", JSON.stringify(error.response.data));
    } else {
      console.error("Error message:", error.message);
    }
    
    // Redirect to error page or show error message
    return res.redirect(`/multipayment?status=failed&details=${encodeURIComponent(error.message || "Failed to create payment")}`);
  }
};

/**
 * Handle status updates for multi-payment orders
 */
const handleMultiStatus = async (req, res) => {
  try {
    const authToken = await authService.getAuthToken();
    const { txnId } = req.query;

    if (!txnId) {
      return res.redirect('/multipayment?status=failed&details=Missing%20transaction%20ID');
    }

    const statusCheckUrl = `${BASE_URL}/checkout/v2/order/${txnId}/status`;
    console.log(`Checking multi payment status for ${txnId}`);

    const response = await axios.get(statusCheckUrl, { 
      headers: {
        "Authorization": `O-Bearer ${authToken}`,
        "Content-Type": "application/json"
      }
    });

    const orderData = response.data;
    let status, details;

    // Determine payment status
    if (orderData.state === "COMPLETED") {
      status = "success";
      const paymentDetail = orderData.paymentDetails && orderData.paymentDetails.length > 0 ? 
        orderData.paymentDetails[0] : null;
      details = `Transaction ID: ${paymentDetail ? paymentDetail.transactionId : 'N/A'}, Amount: ₹${orderData.amount / 100}`;
    } else if (orderData.state === "PENDING") {
      status = "pending";
      details = "Your payment is being processed";
    } else {
      status = "failed";
      details = orderData.message || `Payment ${orderData.state || 'failed'}`;
      if (orderData.errorCode) {
        details += ` (Code: ${orderData.errorCode})`;
      }
    }

    // Redirect back to the multipayment page with status
    return res.redirect(`/multipayment?status=${status}&details=${encodeURIComponent(details)}`);
    
  } catch (error) {
    console.error("Error checking multi payment status:", error.message);
    let errorDetails = "Error processing payment";
    
    if (error.response) {
      console.error("API Response Data:", JSON.stringify(error.response.data));
      errorDetails = error.response.data?.message || errorDetails;
    }
    
    return res.redirect(`/multipayment?status=failed&details=${encodeURIComponent(errorDetails)}`);
  }
};

/**
 * Process a payment request from checkout page
 */
const processCheckoutPayment = async (req, res) => {
  try {
    console.log("Received checkout payment request:", JSON.stringify(req.body));
    
    // Extract parameters from request body
    const { domain, amount, name, mobile, ...otherDetails } = req.body;
    
    // Validate required parameters
    if (!domain) {
      return res.status(400).json({
        success: false,
        message: "Domain name is required"
      });
    }
    
    // Validate amount
    const paymentAmount = parseFloat(amount);
    if (isNaN(paymentAmount) || paymentAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valid payment amount is required"
      });
    }
    
    // Generate a unique order ID
    const uniqueId = crypto.randomBytes(4).toString('hex');
    const orderId = `CHECKOUT-${Date.now()}-${uniqueId}`;
    
    // Try to store payment in database, but proceed even if it fails
    try {
      await paymentService.createPayment({
        orderId,
        domainName: domain,
        amount: paymentAmount,
        paymentDetails: { name, mobile, ...otherDetails }
      });
    } catch (dbError) {
      // Log the error but continue with payment processing
      console.error("Database error (non-critical, continuing with payment):", dbError);
    }
    
    // Get auth token for PhonePe API
    const authToken = await authService.getAuthToken();
    
    // Create payment payload for PhonePe
    const paymentPayload = {
      merchantOrderId: orderId,
      amount: Math.round(paymentAmount * 100), // Convert to paisa
      expireAfter: 1800, // 30 minutes
      metaInfo: {
        udf1: domain,
        udf2: name || "Customer",
        udf3: "CHECKOUT_PAYMENT"
      },
      paymentFlow: {
        type: "PG_CHECKOUT",
        message: `Payment for ${domain}`,
        merchantUrls: {
          redirectUrl: `${req.protocol}://${req.get('host')}/api/phonepay/payment-status?txnId=${orderId}`,
          cancelUrl: `${req.protocol}://${req.get('host')}/api/phonepay/payment-cancelled?txnId=${orderId}`,
          notifyUrl: `${req.protocol}://${req.get('host')}/api/phonepay/notify`
        },
        paymentModeConfig: {
          enabledPaymentModes: [
            { type: "UPI_INTENT" },
            { type: "UPI_COLLECT" },
            { type: "UPI_QR" },
            { type: "NET_BANKING" },
            {
              type: "CARD",
              cardTypes: ["DEBIT_CARD", "CREDIT_CARD"]
            }
          ]
        }
      },
      userInfo: {
        name: name || "Customer",
        mobileNumber: mobile || ""
      }
    };
    
    console.log("Sending checkout payment request to PhonePe:", JSON.stringify(paymentPayload, null, 2));
    
    // Send request to PhonePe
    const response = await axios({
      method: "POST",
      url: `${BASE_URL}/checkout/v2/pay`,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `O-Bearer ${authToken}`
      },
      data: paymentPayload
    });
    
    console.log("PhonePe API response:", JSON.stringify(response.data, null, 2));
    
    // Return redirect URL to frontend
    return res.json({
      success: true,
      redirectUrl: response.data.redirectUrl,
      orderId: orderId
    });
  } catch (error) {
    console.error("Error processing checkout payment:", error);
    if (error.response) {
      console.error("API response status:", error.response.status);
      console.error("API response data:", JSON.stringify(error.response.data, null, 2));
    }
    
    return res.status(500).json({
      success: false,
      message: "Failed to process checkout payment",
      error: error.message
    });
  }
};

/**
 * Handle payment status update from PhonePe
 * Update database and redirect user based on payment status
 */
const handlePaymentStatus = async (req, res) => {
  try {
    const { txnId } = req.query; // This is our orderId
    
    console.log(`Payment status callback received for txnId: ${txnId}`);
    console.log(`Full query parameters:`, JSON.stringify(req.query));
    
    if (!txnId) {
      console.error("Missing transaction ID in payment status callback");
      return res.status(400).json({
        success: false,
        message: "Transaction ID is required"
      });
    }
    
    // Get auth token
    const authToken = await authService.getAuthToken();
    
    // Check payment status with PhonePe
    const statusCheckUrl = `${BASE_URL}/checkout/v2/order/${txnId}/status`;
    console.log(`Checking payment status at: ${statusCheckUrl}`);
    
    const response = await axios.get(statusCheckUrl, { 
      headers: {
        "Authorization": `O-Bearer ${authToken}`,
        "Content-Type": "application/json"
      }
    });
    
    const orderData = response.data;
    console.log(`Payment status data for ${txnId}:`, JSON.stringify(orderData, null, 2));
    
    // Get payment record from database
    console.log(`Looking up payment record for orderId: ${txnId}`);
    let paymentRecord = await paymentService.getPaymentByOrderId(txnId);
    
    // If payment record doesn't exist, try to create one from PhonePe data
    if (!paymentRecord) {
      console.warn(`Payment record not found for txnId: ${txnId}, attempting to create one`);
      
      // Extract domain from meta info if available
      const domain = orderData.metaInfo?.udf1 || "unknown-domain.com";
      
      try {
        paymentRecord = await paymentService.createPayment({
          orderId: txnId,
          domainName: domain,
          amount: orderData.amount / 100, // Convert from paisa to rupees
          paymentDetails: { 
            phonepeResponse: orderData,
            createdFromCallback: true,
            createdAt: new Date().toISOString()
          },
          status: orderData.state === "COMPLETED" ? 'success' : 
                  orderData.state === "FAILED" ? 'failed' : 'pending'
        });
        
        console.log(`Created new payment record for ${txnId} with status: ${paymentRecord.status}`);
      } catch (createError) {
        console.error(`Failed to create payment record for ${txnId}:`, createError);
      }
    }
    
    // If we still don't have a payment record, redirect to a generic error page
    if (!paymentRecord) {
      console.error(`Payment record still not available for ${txnId}, redirecting to error page`);
      return res.redirect(`/payment-error?txnId=${txnId}&reason=record_not_found`);
    }
    
    // Extract the domain name for redirection
    const domainName = paymentRecord.domainName;
    console.log(`Domain for redirection: ${domainName}`);
    
    if (orderData.state === "COMPLETED") {
      // Payment successful
      console.log(`Payment ${txnId} successful, updating status to 'success'`);
      await paymentService.updatePaymentStatus(txnId, 'success', {
        'paymentDetails.phonepeResponse': orderData
      });
      
      // Redirect to success page on client's domain
      const redirectUrl = `https://${domainName}/thankyou`;
      console.log(`Redirecting to: ${redirectUrl}`);
      return res.redirect(redirectUrl);
      
    } else {
      // Payment failed or other status
      const newStatus = orderData.state === "FAILED" ? 'failed' : 'cancelled';
      console.log(`Payment ${txnId} not completed, updating status to '${newStatus}'`);
      
      await paymentService.updatePaymentStatus(txnId, newStatus, { 
        'paymentDetails.phonepeResponse': orderData 
      });
      
      // Redirect to cart page for failed payments
      const redirectUrl = `https://${domainName}/cart`;
      console.log(`Redirecting to: ${redirectUrl}`);
      return res.redirect(redirectUrl);
    }
    
  } catch (error) {
    console.error("Error handling payment status:", error);
    
    if (error.response) {
      console.error("PhonePe API response error:", JSON.stringify({
        status: error.response.status,
        data: error.response.data
      }));
    }
    
    // Fallback to a generic error page with details
    return res.redirect(`/payment-error?reason=${encodeURIComponent(error.message)}`);
  }
};

/**
 * Handle cancelled payments
 */
const handlePaymentCancelled = async (req, res) => {
  try {
    const { txnId } = req.query;
    
    console.log(`Payment cancelled for transaction: ${txnId}`);
    console.log(`Full query parameters:`, JSON.stringify(req.query));
    
    if (!txnId) {
      console.error("Missing transaction ID in payment cancelled callback");
      return res.redirect('/payment-error?reason=missing_transaction_id');
    }
    
    // Get payment record
    let paymentRecord = await paymentService.getPaymentByOrderId(txnId);
    
    // If payment record doesn't exist, try to fetch details from PhonePe
    if (!paymentRecord) {
      console.warn(`No payment record found for cancelled payment: ${txnId}`);
      
      try {
        // Get auth token and check payment status with PhonePe
        const authToken = await authService.getAuthToken();
        const statusCheckUrl = `${BASE_URL}/checkout/v2/order/${txnId}/status`;
        
        console.log(`Checking PhonePe for cancelled payment details at ${statusCheckUrl}`);
        const response = await axios.get(statusCheckUrl, { 
          headers: {
            "Authorization": `O-Bearer ${authToken}`,
            "Content-Type": "application/json"
          }
        });
        
        const orderData = response.data;
        
        // Extract domain from meta info if available
        const domain = orderData.metaInfo?.udf1 || "unknown-domain.com";
        
        // Create payment record from PhonePe data
        paymentRecord = await paymentService.createPayment({
          orderId: txnId,
          domainName: domain,
          amount: orderData.amount / 100, // Convert from paisa to rupees
          paymentDetails: { 
            phonepeResponse: orderData,
            createdFromCancellation: true,
            createdAt: new Date().toISOString()
          },
          status: 'cancelled'
        });
        
        console.log(`Created payment record for cancelled payment: ${txnId}`);
      } catch (error) {
        console.error(`Failed to create payment record for cancelled payment ${txnId}:`, error);
      }
    }
    
    // If we have a payment record now, update it and redirect properly
    if (paymentRecord) {
      // Update payment status to cancelled if it's not already
      if (paymentRecord.status !== 'cancelled') {
        await paymentService.updatePaymentStatus(txnId, 'cancelled');
        console.log(`Updated payment status to cancelled for ${txnId}`);
      }
      
      // Redirect to cart page on client's domain
      const redirectUrl = `https://${paymentRecord.domainName}/cart`;
      console.log(`Redirecting to: ${redirectUrl}`);
      return res.redirect(redirectUrl);
    }
    
    // Fallback if we still don't have payment details
    console.error(`Cannot process cancelled payment ${txnId} - No payment record available`);
    return res.redirect('/payment-error?reason=cancelled_payment_not_found');
    
  } catch (error) {
    console.error("Error handling payment cancellation:", error);
    return res.status(500).json({
      success: false,
      message: "Error handling payment cancellation",
      details: error.message
    });
  }
};

/**
 * Process a payment request from URL parameters
 */
const processPaymentRequest = async (req, res) => {
  try {
    // Extract parameters from query string
    const { domain, amount, name, mobile, merchantOrderId } = req.query;
    
    // Log incoming parameters for debugging
    console.log("processPaymentRequest received params:", { domain, amount, name, mobile, merchantOrderId });
    
    // Validate required parameters
    if (!domain) {
      return res.status(400).json({
        success: false,
        message: "Domain name is required"
      });
    }
    
    // Validate amount
    const paymentAmount = parseFloat(amount);
    if (isNaN(paymentAmount) || paymentAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valid payment amount is required"
      });
    }
    
    // Generate a unique order ID or use the provided merchantOrderId
    const orderId = merchantOrderId || `URL-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    
    console.log(`Creating payment with orderId: ${orderId} for domain: ${domain}, amount: ${paymentAmount}`);
    
    // Determine the proper domain for redirects - handle localhost as a special case
    const redirectDomain = domain === 'localhost' ? req.get('host').split(':')[0] : domain;
    
    // Store payment in database FIRST, before continuing
    try {
      const savedPayment = await paymentService.createPayment({
        orderId,
        domainName: domain,
        amount: paymentAmount,
        paymentDetails: { 
          name: name || "Customer", 
          mobile: mobile || "",
          source: "URL_PARAMS",
          createdAt: new Date().toISOString()
        }
      });
      console.log(`Successfully created payment record in database with ID: ${savedPayment._id}`);
    } catch (dbError) {
      // Log the error but continue with payment processing
      // This is more permissive to allow payments even if DB operations fail
      console.error("Database error while creating payment:", dbError);
    }
    
    // Get auth token for PhonePe API
    const authToken = await authService.getAuthToken();
    if (!authToken) {
      console.error("Failed to get auth token from PhonePe");
      return res.status(500).json({
        success: false, 
        message: "Authentication failed with payment gateway"
      });
    }
    
    // Create payment payload for PhonePe
    const paymentPayload = {
      merchantOrderId: orderId,
      amount: Math.round(paymentAmount * 100), // Convert to paisa
      expireAfter: 1800, // 30 minutes
      metaInfo: {
        udf1: domain,
        udf2: name || "Customer",
        udf3: "URL_PAYMENT"
      },
      paymentFlow: {
        type: "PG_CHECKOUT",
        message: `Payment for ${domain}`,
        merchantUrls: {
          // Use the current protocol and host for redirect URLs to ensure they work in all environments
          redirectUrl: `${req.protocol}://${req.get('host')}/api/phonepay/payment-status?txnId=${orderId}`,
          cancelUrl: `${req.protocol}://${req.get('host')}/api/phonepay/payment-cancelled?txnId=${orderId}`,
          notifyUrl: `${req.protocol}://${req.get('host')}/api/phonepay/notify`
        },
        paymentModeConfig: {
          enabledPaymentModes: [
            { type: "UPI_INTENT" },
            { type: "UPI_COLLECT" },
            { type: "UPI_QR" },
            { type: "NET_BANKING" },
            {
              type: "CARD",
              cardTypes: ["DEBIT_CARD", "CREDIT_CARD"]
            }
          ]
        }
      },
      userInfo: {
        name: name || "Customer",
        mobileNumber: mobile || ""
      }
    };
    
    console.log("Processing URL payment request to PhonePe:", JSON.stringify(paymentPayload, null, 2));
    
    // Send request to PhonePe
    const response = await axios({
      method: "POST",
      url: `${BASE_URL}/checkout/v2/pay`,
      headers: {
        "Content-Type": "application/json",
        "Authorization": `O-Bearer ${authToken}`
      },
      data: paymentPayload
    });
    
    console.log("PhonePe API response:", JSON.stringify(response.data, null, 2));
    
    if (response.data && response.data.redirectUrl) {
      // For direct browser access, redirect the user to the PhonePe payment page
      console.log(`Redirecting to PhonePe URL: ${response.data.redirectUrl}`);
      return res.redirect(response.data.redirectUrl);
    } else {
      // This shouldn't happen, but just in case
      return res.status(500).json({
        success: false,
        message: "No redirect URL received from payment gateway"
      });
    }
    
  } catch (error) {
    console.error("Error processing URL payment request:", error);
    if (error.response) {
      console.error("API response status:", error.response.status);
      console.error("API response data:", JSON.stringify(error.response.data, null, 2));
    }
    
    // Send error response
    return res.status(500).json({
      success: false,
      message: "Failed to process payment request",
      error: error.message
    });
  }
};

/**
 * Handle payment error display
 */
const showPaymentError = (req, res) => {
  const { reason, txnId } = req.query;
  
  const errorHtml = `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Payment Error</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        display: flex;
        justify-content: center;
        align-items: center;
        flex-direction: column;
        height: 100vh;
        margin: 0;
        background-color: #f7f7f7;
      }
      .error-container {
        background-color: white;
        padding: 30px;
        border-radius: 8px;
        box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        text-align: center;
        max-width: 500px;
        width: 90%;
      }
      .error-icon {
        color: #ff4d4d;
        font-size: 60px;
        margin-bottom: 20px;
      }
      h1 {
        color: #333;
        margin-bottom: 20px;
      }
      .error-details {
        color: #666;
        margin-bottom: 30px;
      }
      .transaction-id {
        font-size: 0.9em;
        color: #888;
        margin-bottom: 30px;
        word-break: break-all;
      }
      .home-button {
        background-color: #4d79ff;
        color: white;
        border: none;
        padding: 12px 24px;
        font-size: 16px;
        border-radius: 4px;
        cursor: pointer;
        transition: background-color 0.3s;
        text-decoration: none;
      }
      .home-button:hover {
        background-color: #3a66ff;
      }
    </style>
  </head>
  <body>
    <div class="error-container">
      <div class="error-icon">&#9888;</div>
      <h1>Payment Error</h1>
      <div class="error-details">
        ${reason ? `Error: ${reason}` : 'An error occurred during payment processing.'}
      </div>
      ${txnId ? `<div class="transaction-id">Transaction ID: ${txnId}</div>` : ''}
      <a href="/" class="home-button">Return to Home</a>
    </div>
  </body>
  </html>
  `;
  
  res.send(errorHtml);
};

// Export all the functions
module.exports = {
  createOrder,
  createOrderToken,
  getStatus,
  handlePaymentFailed,
  getOrderStatus,
  createUniqueOrder,
  handleUniqueStatus,
  serveUniquePage,
  handleWebhook,
  serveMultiPaymentPage,
  createOrderGet,
  handleMultiStatus,
  // Payment flow functions
  processPaymentRequest,
  handlePaymentStatus,
  handlePaymentCancelled,
  processCheckoutPayment,
  showPaymentError
};
