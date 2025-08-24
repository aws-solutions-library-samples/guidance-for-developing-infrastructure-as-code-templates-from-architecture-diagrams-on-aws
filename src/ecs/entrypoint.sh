#!/bin/sh

# Create config.js file with WebSocket URL
if [ -n "$REACT_APP_WEBSOCKET_URL" ]; then
    echo "Creating config with WebSocket URL: $REACT_APP_WEBSOCKET_URL"
    cat > /usr/share/nginx/html/config.js << EOF
window.APP_CONFIG = {
  WEBSOCKET_URL: '$REACT_APP_WEBSOCKET_URL'
};
EOF
else
    echo "Warning: REACT_APP_WEBSOCKET_URL not set"
    cat > /usr/share/nginx/html/config.js << EOF
window.APP_CONFIG = {
  WEBSOCKET_URL: ''
};
EOF
fi

# Replace S3 bucket placeholders in JS files
if [ -n "$AWS_ACCOUNT_ID" ] && [ -n "$AWS_REGION" ]; then
    echo "Injecting S3 bucket info: Account $AWS_ACCOUNT_ID, Region $AWS_REGION"
    find /usr/share/nginx/html/static/js -name "*.js" -exec sed -i "s|ACCOUNT_ID-a2c-diagramstorage-REGION|$AWS_ACCOUNT_ID-a2c-diagramstorage-$AWS_REGION|g" {} \;
fi

# Start Nginx
exec "$@"