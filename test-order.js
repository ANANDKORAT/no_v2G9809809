// Test Utility for PhonePe Payment Integration
// This script allows testing the PhonePe API directly without going through the web interface
// It creates a test payment order and logs the response for debugging purposes
require('dotenv').config({ path: '.env' });
const axios = require('axios');

// PhonePe API URL (Production endpoint)
const BASE_URL = "https://api.phonepe.com/apis/pg";

// Get server host from environment or use default
const SERVER_HOST = process.env.APP_HOST || 'http://localhost:5001';

/**
 * Gets an authentication token from PhonePe OAuth service
 * 
 * @returns {Promise<string>} - The OAuth access token
 */
async function getAuthToken() {
  try {
    console.log(`Requesting auth token with client_id: ${process.env.PHONEPE_CLIENT_ID?.substring(0, 5)}***`);
    
    // Check if required credentials are available in environment variables
    if (!process.env.PHONEPE_CLIENT_ID || !process.env.PHONEPE_CLIENT_SECRET) {
      throw new Error('PhonePe API credentials are missing. Please check your environment variables.');
    }
        
    // Get client version from env or default to '1'
    const clientVersion = process.env.PHONEPE_CLIENT_VERSION || '1';

    // Prepare OAuth request parameters
    const requestData = new URLSearchParams();
    requestData.append('client_id', process.env.PHONEPE_CLIENT_ID);
    requestData.append('client_secret', process.env.PHONEPE_CLIENT_SECRET);
    requestData.append('client_version', clientVersion);
    requestData.append('grant_type', 'client_credentials');

    console.log(`Auth request params: client_id: ${process.env.PHONEPE_CLIENT_ID.substring(0, 5)}***, client_version: ${clientVersion}`);
    
    // Request token from PhonePe OAuth service
    const response = await axios({
      method: 'post',
      url: `https://api.phonepe.com/apis/identity-manager/v1/oauth/token`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      data: requestData
    });

    // Verify response contains a valid token
    if (!response.data || !response.data.access_token) {
      throw new Error('Invalid response from authentication server: Missing access token');
    }

    console.log(`Successfully obtained token, expires at: ${new Date(response.data.expires_at * 1000).toISOString()}`);
    return response.data.access_token;
  } catch (error) {
    // Detailed error logging for authentication issues
    console.error('Error fetching auth token:');
    if (error.response) {
      console.error('Response status:', error.response.status);
      console.error('Response headers:', JSON.stringify(error.response.headers));
      console.error('Response data:', JSON.stringify(error.response.data));
    } else if (error.request) {
      console.error('No response received:', error.request);
    } else {
      console.error('Error message:', error.message);
    }
    throw new Error(`Failed to obtain auth token: ${error.response?.data?.message || error.message}`);
  }
}

/**
 * Creates a test payment order with PhonePe API
 * 
 * @returns {Promise<object>} - The PhonePe API response object
 */
async function createTestOrder() {
  try {
    console.log('Starting test order creation...');
    
    // Get authentication token
    console.log('Getting auth token...');
    const authToken = await getAuthToken();
    console.log('Auth token received:', authToken.substring(0, 10) + '...');
    
    // Create unique merchant order ID with timestamp
    const merchantOrderId = "TEST" + Date.now();

    // Prepare payment payload with test data
    const paymentPayload = {
      merchantOrderId,
      amount: 1000, // 10 INR in paise (smallest currency unit)
      expireAfter: 1200, // 20 minutes
      metaInfo: {
        udf1: "Test User",
        udf2: "9999888877",
        udf3: "TEST_API",
      },
      paymentFlow: {
        type: "PG_CHECKOUT",
        message: "Test Payment " + merchantOrderId,
        merchantUrls: {
          redirectUrl: `${SERVER_HOST}/api/phonepay/status?txnId=${merchantOrderId}`,
          cancelUrl: `${SERVER_HOST}/api/phonepay/payment-failed`,
          notifyUrl: `${SERVER_HOST}/api/phonepay/notify`
        }
      },
      userInfo: {
        name: "Test User",
        mobileNumber: "9999888877"
      }
    };
    
    console.log('Sending request to PhonePe with payload:', JSON.stringify(paymentPayload, null, 2));
    
    // Send payment creation request to PhonePe API
    const response = await axios.post(`${BASE_URL}/checkout/v2/pay`, paymentPayload, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `O-Bearer ${authToken}` // OAuth Bearer token format
      }
    });
    
    console.log('PhonePe API Response:', JSON.stringify(response.data, null, 2));
    
    return response.data;
  } catch (error) {
    // Detailed error logging for payment creation issues
    console.error('Error creating test order:');
    if (error.response) {
      console.error('PhonePe API error response:');
      console.error('Status:', error.response.status);
      console.error('Headers:', JSON.stringify(error.response.headers));
      console.error('Data:', JSON.stringify(error.response.data));
    } else if (error.request) {
      console.error('No response received from PhonePe API:', error.request);
    } else {
      console.error('Error message:', error.message);
    }
    throw error;
  }
}

// Execute the test and handle results
createTestOrder()
  .then(data => {
    console.log('Test completed successfully!');
    process.exit(0); // Exit with success code
  })
  .catch(err => {
    console.error('Test failed:', err.message);
    process.exit(1); // Exit with error code
  });