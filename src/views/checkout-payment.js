/**
 * PhonePe Checkout Integration Script
 * Include this script on your checkout/address page to enable payment processing
 */

// Configuration for payment processing
const config = {
  apiBaseUrl: 'http://localhost:5001/api/phonepay',  // Base URL for API endpoints
  debug: true  // Enable debugging logs
};

// Function to log debug messages
function debug(message, data = null) {
  if (config.debug) {
    console.log(`[PhonePe Payment]: ${message}`, data || '');
  }
}

// Function to handle direct payment processing
async function processDirectPayment(params) {
  try {
    debug('Processing direct payment with params', params);
    
    // Build the API URL with query parameters
    const queryParams = new URLSearchParams();
    
    // Add required parameters
    if (!params.domain) {
      throw new Error('Domain parameter is required');
    }
    queryParams.append('domain', params.domain);
    
    if (!params.amount || isNaN(parseFloat(params.amount)) || parseFloat(params.amount) <= 0) {
      throw new Error('Valid amount parameter is required');
    }
    queryParams.append('amount', params.amount);
    
    // Add optional parameters
    if (params.name) queryParams.append('name', params.name);
    if (params.mobile) queryParams.append('mobile', params.mobile);
    
    // Add any additional parameters
    Object.keys(params).forEach(key => {
      if (!['domain', 'amount', 'name', 'mobile'].includes(key)) {
        queryParams.append(key, params[key]);
      }
    });
    
    const apiUrl = `${config.apiBaseUrl}/process-payment?${queryParams.toString()}`;
    debug('Calling API endpoint', apiUrl);
    
    // Make the request - using window.location.href for direct redirect
    window.location.href = apiUrl;
    
    return true;
  } catch (error) {
    debug('Error processing direct payment', error.message);
    alert(`Payment Error: ${error.message}`);
    return false;
  }
}

// Function to handle payment via AJAX request
async function processAjaxPayment(params) {
  try {
    debug('Processing AJAX payment with params', params);
    
    // Build request data
    const requestData = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        domain: params.domain || window.location.hostname,
        amount: params.amount,
        name: params.name || 'Customer',
        mobile: params.mobile || '',
        ...params.additionalParams
      })
    };
    
    // Show loading indicator
    showPaymentLoader();
    
    // Make API request
    const response = await fetch(`${config.apiBaseUrl}/create-order`, requestData);
    const result = await response.json();
    
    if (result.success && result.redirectUrl) {
      debug('Payment order created successfully', result);
      // Redirect to payment gateway
      window.location.href = result.redirectUrl;
      return true;
    } else {
      hidePaymentLoader();
      throw new Error(result.message || 'Failed to create payment order');
    }
  } catch (error) {
    hidePaymentLoader();
    debug('Error processing AJAX payment', error.message);
    alert(`Payment Error: ${error.message}`);
    return false;
  }
}

// Function to show payment loading indicator
function showPaymentLoader() {
  // Check if loader already exists
  if (document.getElementById('phonepay-loader')) return;
  
  // Create loader element
  const loaderEl = document.createElement('div');
  loaderEl.id = 'phonepay-loader';
  loaderEl.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    color: white;
    font-family: Arial, sans-serif;
  `;
  
  // Create spinner
  const spinnerEl = document.createElement('div');
  spinnerEl.style.cssText = `
    width: 50px;
    height: 50px;
    border: 5px solid #f3f3f3;
    border-top: 5px solid #3498db;
    border-radius: 50%;
    animation: spin 2s linear infinite;
    margin-bottom: 20px;
  `;
  
  // Add animation
  const styleEl = document.createElement('style');
  styleEl.textContent = `
    @keyframes spin {
      0% { transform: rotate(0deg); }
      100% { transform: rotate(360deg); }
    }
  `;
  
  // Add message
  const messageEl = document.createElement('div');
  messageEl.textContent = 'Processing Your Payment...';
  
  // Append elements
  loaderEl.appendChild(spinnerEl);
  loaderEl.appendChild(messageEl);
  document.head.appendChild(styleEl);
  document.body.appendChild(loaderEl);
}

// Function to hide payment loading indicator
function hidePaymentLoader() {
  const loaderEl = document.getElementById('phonepay-loader');
  if (loaderEl) {
    loaderEl.remove();
  }
}

// Function to initialize payment buttons
function initPaymentButtons() {
  debug('Initializing payment buttons');
  
  // Find payment buttons with data-payment attributes
  const paymentButtons = document.querySelectorAll('[data-payment="true"], .phonepay-button');
  
  paymentButtons.forEach(button => {
    debug('Found payment button', button);
    
    button.addEventListener('click', function(event) {
      event.preventDefault();
      
      // Get payment parameters from data attributes
      const params = {
        domain: button.getAttribute('data-domain') || window.location.hostname,
        amount: button.getAttribute('data-amount'),
        name: button.getAttribute('data-name') || '',
        mobile: button.getAttribute('data-mobile') || '',
        method: button.getAttribute('data-method') || 'direct'
      };
      
      // Check for required parameters
      if (!params.amount) {
        // Try to find amount in a nearby form
        const form = button.closest('form');
        if (form) {
          const amountField = form.querySelector('[name="amount"], [id="amount"], [class*="amount"]');
          if (amountField) {
            params.amount = amountField.value;
          }
        }
      }
      
      // Process payment
      if (params.method === 'ajax') {
        processAjaxPayment(params);
      } else {
        processDirectPayment(params);
      }
    });
  });
}

/**
 * NEW: React-specific helper for PhonePe integration
 * Use this in your React components
 */
const PhonePeReactHelper = {
  // Initialize PhonePe checkout API config
  init: function(options = {}) {
    if (options.apiBaseUrl) config.apiBaseUrl = options.apiBaseUrl;
    if (typeof options.debug === 'boolean') config.debug = options.debug;
    debug('PhonePe React helper initialized with config:', config);
  },
  
  // Make direct payment using window location redirect
  // This is important for React - doesn't use fetch/AJAX which can cause issues
  makePayment: function(params) {
    return processDirectPayment(params);
  },
  
  // Create a payment link that can be opened in new tab/window
  getPaymentLink: function(params) {
    try {
      const queryParams = new URLSearchParams();
      
      // Add required parameters
      if (!params.domain) throw new Error('Domain parameter is required');
      queryParams.append('domain', params.domain);
      
      if (!params.amount || isNaN(parseFloat(params.amount)) || parseFloat(params.amount) <= 0) {
        throw new Error('Valid amount parameter is required');
      }
      queryParams.append('amount', params.amount);
      
      // Add optional parameters
      if (params.name) queryParams.append('name', params.name);
      if (params.mobile) queryParams.append('mobile', params.mobile);
      
      // Add any additional parameters
      Object.keys(params).forEach(key => {
        if (!['domain', 'amount', 'name', 'mobile'].includes(key)) {
          queryParams.append(key, params[key]);
        }
      });
      
      return `${config.apiBaseUrl}/process-payment?${queryParams.toString()}`;
    } catch (error) {
      debug('Error creating payment link', error.message);
      return null;
    }
  }
};

// Expose global API for direct use in HTML
window.PhonePeCheckout = {
  processDirectPayment,
  processAjaxPayment,
  config,
  // Add React helper
  React: PhonePeReactHelper
};

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPaymentButtons);
} else {
  initPaymentButtons();
}