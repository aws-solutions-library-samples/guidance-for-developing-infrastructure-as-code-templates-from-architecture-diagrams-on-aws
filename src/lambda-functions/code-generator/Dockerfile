# Use the official AWS Lambda Python 3.11 image as the base
FROM --platform=linux/amd64 public.ecr.aws/lambda/python:3.11

# Set the working directory in the container
WORKDIR /var/task

# Copy requirements.txt

COPY requirements.txt  ${LAMBDA_TASK_ROOT} 

# Install dependencies
RUN pip3 install -r requirements.txt

# Copy the rest of your application code
COPY a2cai_code_generator_main.py ${LAMBDA_TASK_ROOT} 
COPY code_generator_utils_v2.py ${LAMBDA_TASK_ROOT} 
COPY utils2_v2.py ${LAMBDA_TASK_ROOT}
COPY a2cai_v2.py ${LAMBDA_TASK_ROOT}
COPY stack_gen_prompts.yaml ${LAMBDA_TASK_ROOT}
COPY a2cai_prompts.yaml ${LAMBDA_TASK_ROOT}
COPY model_name.yaml ${LAMBDA_TASK_ROOT}
COPY strands_utils.py ${LAMBDA_TASK_ROOT} 

# Set the CMD to your handler function
# Replace "app.handler" with your actual handler function
CMD [ "a2cai_code_generator_main.lambda_handler" ]