exports.handler = async (event) => {
  const request = event.Records[0].cf.request;
  const headers = request.headers;
  const uri = request.uri;
  const querystring = request.querystring;
  
  // Always allow API requests to pass through without authentication
  if (uri.startsWith('/api')) {
    return request;
  }
  
  // Check if this is a callback from Cognito (has tokens in hash)
  if (uri === '/' && (querystring.includes('access_token') || request.headers.referer)) {
    // Allow callback through to the application
    return request;
  }
  
  // Check for authentication cookie
  const cookies = headers.cookie || [];
  let hasAuthCookie = false;
  
  for (const cookie of cookies) {
    if (cookie.value.includes('CognitoIdentityServiceProvider') || 
        cookie.value.includes('AWSELBAuthSessionCookie') ||
        cookie.value.includes('access_token')) {
      hasAuthCookie = true;
      break;
    }
  }
  
  // If no auth cookie and not a callback, redirect to Cognito
  if (!hasAuthCookie) {
    const cognitoDomain = 'a2c-auth-27863956.auth.us-west-2.amazoncognito.com';
    const clientId = '4rf3on70tl20mna4pkroni02j9';
    const redirectUri = `https://${request.headers.host[0].value}`;
    
    const loginUrl = `https://${cognitoDomain}/login?client_id=${clientId}&response_type=token&scope=email+openid+profile&redirect_uri=${encodeURIComponent(redirectUri)}`;
    
    return {
      status: '302',
      statusDescription: 'Found',
      headers: {
        location: [{
          key: 'Location',
          value: loginUrl
        }]
      }
    };
  }
  
  // Allow authenticated requests through
  return request;
};