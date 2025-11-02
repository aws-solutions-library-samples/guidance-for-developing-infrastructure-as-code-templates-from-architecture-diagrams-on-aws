function handler(event) {
    var request = event.request;
    
    // Handle OPTIONS requests
    if (request.method === 'OPTIONS') {
        return {
            statusCode: 200,
            statusDescription: 'OK',
            headers: {
                'access-control-allow-origin': { value: '*' },
                'access-control-allow-methods': { value: 'GET, POST, OPTIONS, PUT, DELETE' },
                'access-control-allow-headers': { value: 'Content-Type, X-Amz-Date, Authorization, X-Api-Key, X-Amz-Security-Token' },
                'access-control-max-age': { value: '86400' }
            }
        };
    }
    
    // For non-OPTIONS requests, pass through to origin
    return request;
}
