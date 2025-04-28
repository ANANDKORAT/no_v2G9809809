// This is a test script to create an order and log the response from PhonePe API
require('dotenv').config({ path: '.env' });
const axios = require('axios');

// PhonePe API URL
const BASE_URL = "https://api.phonepe.com/apis/pg";

// Function to get auth token
async function getAuthToken() {
  try {
    console.log(`Requesting auth token with client_id: ${process.env.PHONEPE_CLIENT_ID?.substring(0, 5)}***`);
    
    // Check if credentials are available
    if (!process.env.PHONEPE_CLIENT_ID || !process.env.PHONEPE_CLIENT_SECRET) {
      throw new Error('PhonePe API credentials are missing. Please check your environment variables.');
    }
        
    const clientVersion = process.env.PHONEPE_CLIENT_VERSION || '1';

    // Prepare request data
    const requestData = new URLSearchParams();
    requestData.append('client_id', process.env.PHONEPE_CLIENT_ID);
    requestData.append('client_secret', process.env.PHONEPE_CLIENT_SECRET);
    requestData.append('client_version', clientVersion);
    requestData.append('grant_type', 'client_credentials');

    console.log(`Auth request params: client_id: ${process.env.PHONEPE_CLIENT_ID.substring(0, 5)}***, client_version: ${clientVersion}`);
    
    const response = await axios({
      method: 'post',
      url: `https://api.phonepe.com/apis/identity-manager/v1/oauth/token`,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      data: requestData
    });

    if (!response.data || !response.data.access_token) {
      throw new Error('Invalid response from authentication server: Missing access token');
    }

    console.log(`Successfully obtained token, expires at: ${new Date(response.data.expires_at * 1000).toISOString()}`);
    return response.data.access_token;
  } catch (error) {
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

async function createTestOrder() {
  try {
    console.log('Starting test order creation...');
    
    // Get auth token
    console.log('Getting auth token...');
    const authToken = await getAuthToken();
    console.log('Auth token received:', authToken.substring(0, 10) + '...');
    
    // Create order data
    const merchantOrderId = "TEST" + Date.now();
    const paymentPayload = {
      merchantOrderId,
      amount: 1000, // 10 INR in paise
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
          redirectUrl: `http://localhost:5001/api/phonepay/status?txnId=${merchantOrderId}`,
          cancelUrl: `http://localhost:5001/api/phonepay/payment-failed`,
          notifyUrl: `http://localhost:5001/api/phonepay/notify`
        }
      },
      userInfo: {
        name: "Test User",
        mobileNumber: "9999888877"
      }
    };
    
    console.log('Sending request to PhonePe with payload:', JSON.stringify(paymentPayload, null, 2));
    
    // Send request to PhonePe
    const response = await axios.post(`${BASE_URL}/checkout/v2/pay`, paymentPayload, {
      headers: {
        "Content-Type": "application/json",
        "Authorization": `O-Bearer ${authToken}`
      }
    });
    
    console.log('PhonePe API Response:', JSON.stringify(response.data, null, 2));
    
    return response.data;
  } catch (error) {
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

// Run the test
createTestOrder()
  .then(data => {
    console.log('Test completed successfully!');
    process.exit(0);
  })
  .catch(err => {
    console.error('Test failed:', err.message);
    process.exit(1);
  });