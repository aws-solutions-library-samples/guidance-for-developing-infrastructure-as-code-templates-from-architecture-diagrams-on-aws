# Replace environment variables in the index.html file
# envsubst '${REACT_APP_API_URL}' < /usr/share/nginx/html/index.html > /usr/share/nginx/html/index.html.tmp
# mv /usr/share/nginx/html/index.html.tmp /usr/share/nginx/html/index.html

# envsubst '${REACT_APP_S3_BUCKET_NAME}' < /etc/nginx/conf.d/default.conf > /etc/nginx/conf.d/default.conf.tmp
# mv /etc/nginx/conf.d/default.conf.tmp /etc/nginx/conf.d/default.conf

# envsubst '${REACT_APP_REGION}' < /etc/nginx/conf.d/default.conf > /etc/nginx/conf.d/default.conf.tmp
# mv /etc/nginx/conf.d/default.conf.tmp /etc/nginx/conf.d/default.conf

# Start Nginx
exec "$@"