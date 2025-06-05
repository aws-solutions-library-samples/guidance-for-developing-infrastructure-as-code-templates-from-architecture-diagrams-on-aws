import base64
import io
import json
import os
import time
from typing import TYPE_CHECKING, TypedDict, Dict, List
from datetime import datetime
import yaml

import boto3
import botocore
from botocore.exceptions import ClientError

if TYPE_CHECKING:
    from types_boto3_stepfunctions import SFNClient
    from types_boto3_s3 import S3Client
    from types_boto3_bedrock_runtime import BedrockRuntimeClient


with open('web-responder_config.yaml', 'r') as file:
    config = yaml.safe_load(file)
    model_id = config['model_id']
    prompt=config['prompt']
    


stepfunctions: 'SFNClient' = boto3.client('stepfunctions')
s3_client: 'S3Client' = boto3.client('s3')
bedrock_client: 'BedrockRuntimeClient' = boto3.client(service_name="bedrock-runtime", region_name=os.environ["REGION"])


s3_image_bucket = f'{os.environ["ACCOUNT_ID"]}-a2c-diagramstorage-{os.environ["REGION"]}'
s3_prefix = datetime.now().strftime('%Y/%m/%d/')

class AnalysisRequest(TypedDict):
    image_data: str
    mime: str
    language: str


class AnalysisResponse(TypedDict):
    execution_time: str
    response_text: str


class ClaudeResponseContent(TypedDict):
    type: str
    text: str
    name: str
    image: str  # json string


class ClaudeResponse(TypedDict):
    usage: Dict[str, int]
    content: List[ClaudeResponseContent]


# same as aws_lambda_typing.responses.APIGatewayProxyResponseV2
class LambdaResponse(TypedDict):
    statusCode: int
    body: str
    headers: Dict[str, str]

# Expecting invocation from ALB

def lambda_handler(event, context) -> 'LambdaResponse':
    """
    1. Receive encoded image data from ALB
    2. Invoke do it all function
    3. Return result to web app
    4. Store the Image to a S3 bucket.

    """

    # Initialize the AWS Step Functions client
    print("Event: ", event)

    analysis_request: AnalysisRequest = json.loads(event["body"])

    mime = "image/png"  
    
    image_data = analysis_request.get('imageData')
    print("IMAGE DATA" , image_data)
    mime = analysis_request.get('mime')
    language = analysis_request.get('language')

    # Construct a file name variable with the following format: a2c-drawing-TIMESTAMP
    fileName = f"a2c-drawing-{int(time.time())}.png"
    img_bytes = io.BytesIO(base64.b64decode(image_data))
    s3_client.upload_fileobj(img_bytes,
                            s3_image_bucket, 
                            s3_prefix + fileName,
                            ExtraArgs={"ContentType": mime}
                            )

    # Process the S3 URI using the imported function
    result: AnalysisResponse = web_responder_do_it_all(image_data, mime)

    # Construct Step Fucntion ARN
    step_function_arn = f'arn:aws:states:{os.environ["REGION"]}:{os.environ["ACCOUNT_ID"]}:stateMachine:{os.environ["CDK_QUALIFIER"]}-Processing'

    # Invoke the Step Function
    response = stepfunctions.start_execution(
        stateMachineArn=step_function_arn,
        input=json.dumps({
            #"s3_uri": f"s3://{s3_image_bucket}/{s3_prefix}{analysis_request['image_filename']}",
            "file_path": f"s3://{s3_image_bucket}/{s3_prefix}{fileName}",
            "code_language": language
        })
    )

    print("STEP FUNCTION RESPONSE" , response)
    
    
    print("MESSAGE TO UI" )
    message_to_ui ={
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',  # For CORS support
                'Access-Control-Allow-Methods': 'OPTIONS,POST,GET', # Allowed HTTP methods
                'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token' # Allowed headers
            },
            'body': json.dumps({
                'message': 'Success',
                'result': result
            }),
            'isBase64Encoded': False 
        }

    try:
        return message_to_ui
    except Exception as e:
        return {
            'statusCode': 500, 
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'OPTIONS,POST,GET',
                'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'
            },
            'body': json.dumps({
                'message': 'Error processing request',
                'error': str(e)
            }),
            'isBase64Encoded': False
        }

def invoke_claude_3_multimodal(prompt: str, base64_image_data: str, mime_type_image: str,
                               model_id: str) -> ClaudeResponse:
    """
    Invokes Anthropic Claude 3.7 Sonnet to run a multimodal inference using the input
    provided in the request body.

    :param mime_type_image: mime type eg. image/png
    :param model_id: model id
    :param prompt: The prompt that you want Claude 3 to use.
    :param base64_image_data: The base64-encoded image that you want to add to the request.
    :return: Inference response from the model.
    """

    # Invoke the model with the prompt and the encoded image
    request_body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 2048,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": prompt,
                    },
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": mime_type_image,
                            "data": base64_image_data,
                        },
                    },
                ],
            }
        ],
    }

    try:

        response = bedrock_client.invoke_model(
            modelId=model_id,
            body=json.dumps(request_body),
        )

        print(type(response))
        print("RESPONSE", response)
        # Process and print the response
        result: ClaudeResponse = json.loads(response.get("body").read())
        input_tokens = result["usage"]["input_tokens"]
        output_tokens = result["usage"]["output_tokens"]
        output_list = result.get("content", [])

        print("Invocation details:")
        print(f"- The input length is {input_tokens} tokens.")
        print(f"- The output length is {output_tokens} tokens.")

        print(f"- The model returned {len(output_list)} response(s):")
        for output in output_list:
            print(output["text"])

        return result
    except botocore.exceptions.ParamValidationError as error:
        raise ValueError('The parameters you provided are incorrect: {}'.format(error))


def web_responder_do_it_all(image_data_base64: str, image_mime: str) -> AnalysisResponse:
    """
    Orchestator function to perform all steps
    """

    start_time = time.time()
    # Step 3: Get Claude Response
    claude_response: ClaudeResponse = invoke_claude_3_multimodal(prompt, image_data_base64, image_mime, model_id)
    execution_time = time.time() - start_time

    return {
        # Step 4: Extract output tokens
        'response_text': claude_response["content"],
        'execution_time': str(execution_time)
    }
