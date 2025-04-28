const axios = require('axios');
const qs = require('querystring');

class AuthService {
    constructor() {
        this.token = null;
        this.tokenExpiry = null;
        this.retryCount = 0;
        this.maxRetries = 3;
        this.retryDelay = 1000; // 1 second initial delay
    }

    async getAuthToken(forceRefresh = false) {
        try {
            // Return existing token if it's still valid (with 5 minutes buffer) and not forced to refresh
            if (!forceRefresh && this.token && this.tokenExpiry && (this.tokenExpiry - 300) > Math.floor(Date.now() / 1000)) {
                console.log(`Using existing token, expires at: ${new Date(this.tokenExpiry * 1000).toISOString()}`);
                return this.token;
            }

            // Always use production URL
            const baseUrl = 'https://api.phonepe.com/apis/identity-manager';

            console.log(`Requesting auth token from ${baseUrl}/v1/oauth/token with client_id: ${process.env.PHONEPE_CLIENT_ID?.substring(0, 5)}***`);
            
            // Check if credentials are available
            if (!process.env.PHONEPE_CLIENT_ID || !process.env.PHONEPE_CLIENT_SECRET) {
                throw new Error('PhonePe API credentials are missing. Please check your environment variables.');
            }
                
            // Always use the client_version from environment variable
            const clientVersion = process.env.PHONEPE_CLIENT_VERSION || '1';

            // Prepare request data
            const requestData = {
                client_id: process.env.PHONEPE_CLIENT_ID,
                client_secret: process.env.PHONEPE_CLIENT_SECRET,
                client_version: clientVersion,
                grant_type: 'client_credentials'
            };

            console.log(`Auth request params: client_id: ${requestData.client_id.substring(0, 5)}***, client_version: ${clientVersion}`);
            
            const response = await axios({
                method: 'post',
                url: `${baseUrl}/v1/oauth/token`,
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded'
                },
                data: qs.stringify(requestData)
            });

            if (!response.data || !response.data.access_token) {
                throw new Error('Invalid response from authentication server: Missing access token');
            }

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
                
                // If token is expired, try to refresh once
                if (error.response.status === 401 && this.retryCount < this.maxRetries) {
                    console.log(`Token might be expired. Attempt #${this.retryCount + 1} to refresh...`);
                    this.retryCount++;
                    
                    // Add exponential backoff
                    const delay = this.retryDelay * Math.pow(2, this.retryCount - 1);
                    await new Promise(resolve => setTimeout(resolve, delay));
                    
                    return this.getAuthToken(true); // Force refresh token
                }
            } else if (error.request) {
                // The request was made but no response was received
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

module.exports = new AuthService();