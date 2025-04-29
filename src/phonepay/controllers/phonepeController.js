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
    
    if (!txnId) {
      return res.status(400).json({
        success: false,
        message: "Transaction ID is required"
      });
    }
    
    // Get auth token
    const authToken = await authService.getAuthToken();
    
    // Check payment status with PhonePe
    const statusCheckUrl = `${BASE_URL}/checkout/v2/order/${txnId}/status`;
    const response = await axios.get(statusCheckUrl, { 
      headers: {
        "Authorization": `O-Bearer ${authToken}`,
        "Content-Type": "application/json"
      }
    });
    
    const orderData = response.data;
    console.log("Payment status data:", JSON.stringify(orderData, null, 2));
    
    // Get payment record from database
    const paymentRecord = await paymentService.getPaymentByOrderId(txnId);
    
    if (!paymentRecord) {
      return res.status(404).json({
        success: false,
        message: "Payment record not found"
      });
    }
    
    // Extract the domain name for redirection
    const domainName = paymentRecord.domainName;
    
    if (orderData.state === "COMPLETED") {
      // Payment successful
      await paymentService.updatePaymentStatus(txnId, 'success', {
        'paymentDetails.phonepeResponse': orderData
      });
      
      // Redirect to success page on client's domain
      return res.redirect(`https://${domainName}/thankyou`);
      
    } else {
      // Payment failed or other status
      await paymentService.updatePaymentStatus(txnId, 
        orderData.state === "FAILED" ? 'failed' : 'cancelled', 
        { 'paymentDetails.phonepeResponse': orderData }
      );
      
      // Redirect to cart page for failed payments
      return res.redirect(`https://${domainName}/cart`);
    }
    
  } catch (error) {
    console.error("Error handling payment status:", error);
    return res.status(500).json({
      success: false,
      message: "Error processing payment status",
      details: error.message
    });
  }
};

/**
 * Handle cancelled payments
 */
const handlePaymentCancelled = async (req, res) => {
  try {
    const { txnId } = req.query;
    
    if (!txnId) {
      return res.status(400).json({
        success: false,
        message: "Transaction ID is required"
      });
    }
    
    // Get payment record
    const paymentRecord = await paymentService.getPaymentByOrderId(txnId);
    
    if (!paymentRecord) {
      return res.status(404).json({
        success: false,
        message: "Payment record not found"
      });
    }
    
    // Update payment status to cancelled
    await paymentService.updatePaymentStatus(txnId, 'cancelled');
    
    // Redirect to cart page on client's domain
    return res.redirect(`https://${paymentRecord.domainName}/cart`);
    
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
    const { domain, amount, name, mobile } = req.query;
    
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
    const orderId = `URL-${Date.now()}-${uniqueId}`;
    
    // Store payment in database
    try {
      await paymentService.createPayment({
        orderId,
        domainName: domain,
        amount: paymentAmount,
        paymentDetails: { 
          name: name || "Customer", 
          mobile: mobile || "",
          source: "URL_PARAMS"
        }
      });
    } catch (dbError) {
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
        udf3: "URL_PAYMENT"
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
    
    // Redirect user directly to the payment page
    return res.redirect(response.data.redirectUrl);
    
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
  // Add the checkout payment function
  processCheckoutPayment
};
