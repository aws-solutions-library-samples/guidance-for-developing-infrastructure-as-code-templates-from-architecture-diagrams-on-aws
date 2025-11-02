/**
 * @fileoverview Lambda@Edge function that handles Cognito authentication for CloudFront distributions.
 * @module edge-lambda
 * @requires ./secretsManager
 * @requires cognito-at-edge
 */
const secretsManager = require('./secretsManager.js');
const { Authenticator } = require('cognito-at-edge');

/**
 * Lambda@Edge handler that authenticates requests using Amazon Cognito.
 * This function acts as a CloudFront viewer request handler to protect content
 * behind Cognito authentication.
 * 
 */
exports.handler = async (request) => {
  try {
    console.log('Lambda@Edge handler started', JSON.stringify(request, null, 2));
    
    // Extract the URI and method from the request
    const uri = request.Records[0].cf.request.uri;
    const method = request.Records[0].cf.request.method;
    console.log('Request URI:', uri, 'Method:', method);
    
    // Handle OPTIONS requests for API endpoints with CORS headers
    if (method === 'OPTIONS' && uri.startsWith('/api/')) {
      console.log('Handling OPTIONS request for API endpoint');
      return {
        status: '200',
        statusDescription: 'OK',
        headers: {
          'access-control-allow-origin': [{
            key: 'Access-Control-Allow-Origin',
            value: '*'
          }],
          'access-control-allow-methods': [{
            key: 'Access-Control-Allow-Methods',
            value: 'GET, POST, OPTIONS, PUT, DELETE'
          }],
          'access-control-allow-headers': [{
            key: 'Access-Control-Allow-Headers',
            value: 'Content-Type, X-Amz-Date, Authorization, X-Api-Key, X-Amz-Security-Token'
          }],
          'access-control-max-age': [{
            key: 'Access-Control-Max-Age',
            value: '86400'
          }]
        },
        body: ''
      };
    }
    
    // Allow unauthenticated access to API endpoints
    if (uri.startsWith('/api/')) {
      console.log('API endpoint detected, allowing unauthenticated access');
      return request.Records[0].cf.request;
    }
    
    const secrets = await secretsManager.getSecrets();
    console.log('Secrets retrieved successfully');
    
    const authenticator = new Authenticator({
      region: secrets.Region, // user pool region
      userPoolId: secrets.UserPoolID, // user pool ID
      userPoolAppId: secrets.UserPoolAppId, // user pool app client ID
      userPoolDomain: secrets.DomainName, // user pool domain
    });
    
    console.log('Authenticator created, handling request');
    const result = await authenticator.handle(request);
    console.log('Authentication result:', JSON.stringify(result, null, 2));
    
    return result;
  } catch (error) {
    console.error('Lambda@Edge error:', error);
    // Return a proper CloudFront response for errors
    return {
      status: '500',
      statusDescription: 'Internal Server Error',
      headers: {
        'content-type': [{
          key: 'Content-Type',
          value: 'text/html'
        }]
      },
      body: '<html><body><h1>Authentication Error</h1><p>Please try again later.</p></body></html>'
    };
  }
};