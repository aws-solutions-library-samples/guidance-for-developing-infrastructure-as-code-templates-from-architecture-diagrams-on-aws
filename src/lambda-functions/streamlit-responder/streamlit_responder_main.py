import json
import boto3
from streamlit_responder_utils import *
import os

def lambda_handler(event, context):
    
    """
    
    1. Recieve s3 uri from event notifications
    2. Invoke do it all function
    3. Return result to streamlit app
    
    """
    # Initialize the AWS Step Functions client
    stepfunctions = boto3.client('stepfunctions')
    
    print("Event: ", event)

    # Extract the S3 URI from the event
    #s3_info = event['file_path']['s3']
    #bucket_name = s3_info['bucket']['name']
    #object_key = s3_info['object']['key']
    s3_uri = event['file_path']
    
    
    # set local_dir
    local_dir = '/tmp'
    
    # Process the S3 URI using the imported function
    result = streamlit_responder_do_it_all(s3_uri, local_dir)
    
    result_json= json.dumps(result)
    
    # Replace with your actual Step Function ARN
    step_function_arn = f'arn:aws:states:{os.environ["REGION"]}:{os.environ["ACCOUNT_ID"]}:stateMachine:{os.environ["CDK_QUALIFIER"]}-Processing'
    
    # Invoke the Step Function
    response = stepfunctions.start_execution(
        stateMachineArn=step_function_arn,
        input=json.dumps(event)  # Pass the entire event as input
    )
    
    print(response)

    
    return result_json