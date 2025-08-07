# Use the official AWS Lambda Python 3.11 image as the base
FROM --platform=linux/amd64 public.ecr.aws/lambda/python:3.11

# Set the working directory in the container
WORKDIR /var/task

# Copy requirements.txt

COPY requirements.txt  ${LAMBDA_TASK_ROOT} 

# Install dependencies
RUN pip3 install -r requirements.txt

# Copy the rest of your application code
COPY web_responder_main.py ${LAMBDA_TASK_ROOT} 
COPY web-responder_config.yaml ${LAMBDA_TASK_ROOT}

# Set the CMD to your handler function
# Replace "app.handler" with your actual handler function
CMD [ "web_responder_main.lambda_handler" ]