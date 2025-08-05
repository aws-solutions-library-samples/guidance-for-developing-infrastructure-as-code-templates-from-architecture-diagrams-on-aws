/**
 * @fileoverview Simple Lambda@Edge function that passes through requests without authentication.
 * @module edge-lambda
 */

/**
 * Lambda@Edge handler that passes through all requests.
 * This is a simplified version to avoid authentication issues.
 */
exports.handler = async (event) => {
  try {
    console.log('Event received:', JSON.stringify(event, null, 2));
    
    // Simply return the request as-is to pass it through
    const request = event.Records[0].cf.request;
    
    return request;
  } catch (error) {
    console.error('Edge function error:', error);
    
    // Return the original request on error to avoid blocking
    return event.Records[0].cf.request;
  }
};