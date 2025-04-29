const axios = require('axios');
const qs = require('querystring');

/**
 * AuthService - Handles authentication with PhonePe API
 * 
 * This service manages OAuth token retrieval and caching for the PhonePe payment gateway.
 * It implements token expiry handling and automatic refresh with exponential backoff retry logic.
 */
class AuthService {
    constructor() {
        this.token = null;            // Stores the current OAuth access token
        this.tokenExpiry = null;      // Unix timestamp when token expires
        this.retryCount = 0;          // Tracks authentication retry attempts
        this.maxRetries = 3;          // Maximum number of retry attempts
        this.retryDelay = 1000;       // Initial delay in ms (will increase exponentially)
    }

    /**
     * Gets a valid authentication token for PhonePe API calls
     * 
     * @param {boolean} forceRefresh - Force getting a new token even if current one is valid
     * @returns {Promise<string>} - The OAuth access token
     */
    async getAuthToken(forceRefresh = false) {
        try {
            // Return existing token if it's still valid (with 5 minutes buffer) and not forced to refresh
            // The 5-minute buffer ensures we don't use a token that's about to expire
            if (!forceRefresh && this.token && this.tokenExpiry && (this.tokenExpiry - 300) > Math.floor(Date.now() / 1000)) {
                console.log(`Using existing token, expires at: ${new Date(this.tokenExpiry * 1000).toISOString()}`);
                return this.token;
            }

            // Always use production URL for PhonePe auth service
            const baseUrl = 'https://api.phonepe.com/apis/identity-manager';

            console.log(`Requesting auth token from ${baseUrl}/v1/oauth/token with client_id: ${process.env.PHONEPE_CLIENT_ID?.substring(0, 5)}***`);
            
            // Check if required environment variables are set
            if (!process.env.PHONEPE_CLIENT_ID || !process.env.PHONEPE_CLIENT_SECRET) {
                throw new Error('PhonePe API credentials are missing. Please check your environment variables.');
            }
                
            // Always use the client_version from environment variable or default to '1'
            const clientVersion = process.env.PHONEPE_CLIENT_VERSION || '1';

            // Prepare OAuth token request data
            const requestData = {
                client_id: process.env.PHONEPE_CLIENT_ID,
                client_secret: process.env.PHONEPE_CLIENT_SECRET,
                client_version: clientVersion,
                grant_type: 'client_credentials'  // Standard OAuth flow for server-to-server auth
            };

            console.log(`Auth request params: client_id: ${requestData.client_id.substring(0, 5)}***, client_version: ${clientVersion}`);
            
            // Request new token from PhonePe auth server
            const response = await axios({
                method: 'post',
                url: `${baseUrl}/v1/oauth/token`,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                data: qs.stringify(requestData)  // Convert object to URL-encoded form data
            });

            // Verify we got a valid token in the response
            if (!response.data || !response.data.access_token) {
                throw new Error('Invalid response from authentication server: Missing access token');
            }

            // Store the new token and its expiry time
            this.token = response.data.access_token;
            this.tokenExpiry = response.data.expires_at;
            this.retryCount = 0; // Reset retry counter on success
            
            console.log(`Successfully obtained token, expires at: ${new Date(this.tokenExpiry * 1000).toISOString()}`);
            return this.token;
        } catch (error) {
            console.error('Error fetching auth token:');
            if (error.response) {
                // The request was made and the server responded with a status code
                console.error('Response status:', error.response.status);
                console.error('Response headers:', JSON.stringify(error.response.headers));
                console.error('Response data:', JSON.stringify(error.response.data));
                
                // If token is expired or rejected (401), retry with exponential backoff
                if (error.response.status === 401 && this.retryCount < this.maxRetries) {
                    console.log(`Token might be expired. Attempt #${this.retryCount + 1} to refresh...`);
                    this.retryCount++;
                    
                    // Implement exponential backoff retry logic
                    // Each retry waits twice as long as the previous one
                    const delay = this.retryDelay * Math.pow(2, this.retryCount - 1);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    
                    return this.getAuthToken(true); // Force refresh token on retry
                }
            } else if (error.request) {
                // The request was made but no response was received (network error)
                console.error('No response received:', error.request);
            } else {
                // Something happened in setting up the request
                console.error('Error message:', error.message);
            }
            console.error('Error config:', JSON.stringify(error.config));
            throw new Error(`Failed to obtain auth token: ${error.response?.data?.message || error.message}`);
        }
    }
}

// Export a singleton instance of the AuthService
module.exports = new AuthService();