#!/bin/sh

# Create config.js file with Streaming API URL
if [ -n "$REACT_APP_STREAMING_API_URL" ]; then
    echo "Creating config with Streaming API URL: $REACT_APP_STREAMING_API_URL"
    cat > /usr/share/nginx/html/config.js << EOF
window.APP_CONFIG = {
  STREAMING_API_URL: '$REACT_APP_STREAMING_API_URL'
};
EOF
else
    echo "Warning: REACT_APP_STREAMING_API_URL not set"
    cat > /usr/share/nginx/html/config.js << EOF
window.APP_CONFIG = {
  STREAMING_API_URL: ''
};
EOF
fi

# Replace S3 bucket placeholders in JS files
if [ -n "$AWS_ACCOUNT_ID" ] && [ -n "$AWS_REGION" ]; then
    echo "Injecting S3 bucket info: Account $AWS_ACCOUNT_ID, Region $AWS_REGION"
    find /usr/share/nginx/html/static/js -name "*.js" -exec sed -i "s|a2a-ACCOUNT_ID-diagramstorage-REGION|a2a-$AWS_ACCOUNT_ID-diagramstorage-$AWS_REGION|g" {} \;
fi

# Start Nginx
exec "$@"