import base64
import io
import json
import os
import time
from typing import TYPE_CHECKING, TypedDict, Dict, List

import boto3
import botocore
from botocore.exceptions import ClientError

if TYPE_CHECKING:
    from aws_lambda_typing.events import APIGatewayProxyEventV2
    from types_boto3_stepfunctions import SFNClient
    from types_boto3_s3 import S3Client
    from types_boto3_bedrock_runtime import BedrockRuntimeClient

modelID = "us.anthropic.claude-3-7-sonnet-20250219-v1:0"
prompt = 'You are an expert AWS solutions architect and cloud infrastructure specialist with deep knowledge of AWS services, best practices, and the AWS Cloud Development Kit (CDK). Your task is to analyze the attached AWS architecture diagram and provide detailed, structured descriptions that can be used by other AI systems to generate deployable AWS CDK code.You have the following capabilities and traits:1.AWS Expertise: You have comprehensive knowledge of all AWS services, their configurations, and how they interact within complex architectures.2.Diagram Analysis: You can quickly interpret and understand AWS architecture diagrams, identifying all components and their relationships.3.Detail-Oriented: You provide thorough, specific descriptions of each component, including resource names, settings, and configuration details crucial for CDK implementation.4.Best Practices: You understand and can explain AWS best practices for security, scalability, and cost optimization.5.CDK-Focused: Your descriptions are structured in a way that aligns with AWS CDK constructs and patterns, facilitating easy code generation.6.Clear Communication: You explain complex architectures in a clear, logical manner that both humans and AI systems can understand and act upon.7.Holistic Understanding: You grasp not just individual components, but also the overall system purpose, data flow, and integration points. Your goal is to create a description that serves as a comprehensive blueprint for CDK code generation.What use case it is trying to address? Evaluate the complexity level of this architecture as level 1 or level 2 or level 3 based on the definitions described here: Level 1 : less than or equals to 4 different types of AWS services are used in the architecture diagram. Level 2 : 5 to 10 different types of AWS services are used in the architecture diagram. Level 3 : more than 10 different types of AWS services are used in the architecture diagram.At the end of your response include a numbered list of AWS resources along with their counts and names. For example, say  Resources summary: 1. ’N’ s3 buckets A, , B , C 2. ’N’ lambda functions A B  etc. and so on for all services present in the architecture diagram'

stepfunctions: 'SFNClient' = boto3.client('stepfunctions')
s3_client: 'S3Client' = boto3.client('s3')
bedrock_client: 'BedrockRuntimeClient' = boto3.client(service_name="bedrock-runtime", region_name=os.environ["REGION"])

step_function_arn = f'arn:aws:states:{os.environ["REGION"]}:{os.environ["ACCOUNT_ID"]}:stateMachine:{os.environ["CDK_QUALIFIER"]}-Processing'
s3_image_bucket = f''


class AnalysisRequest(TypedDict):
    image_data: str
    image_filename: str


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


# Expecting https://docs.aws.amazon.com/lambda/latest/dg/urls-invocation.html
def lambda_handler(event: 'APIGatewayProxyEventV2', context) -> 'LambdaResponse':
    """
    1. Receive s3 uri from event notifications
    2. Invoke do it all function
    3. Return result to web app

    """

        # Initialize the AWS Step Functions client
    print("Event: ", event)

    analysis_request: AnalysisRequest = json.loads(event["body"])

    mime = "image/png"  # TODO: Detect

    img_bytes = io.BytesIO(base64.b64decode(analysis_request["image_data"]))
    s3_client.upload_fileobj(img_bytes,
                             s3_image_bucket,
                             analysis_request["image_filename"],
                             ExtraArgs={"ContentType": mime}
                             )

    # Process the S3 URI using the imported function
    result: AnalysisResponse = web_responder_do_it_all(analysis_request["image_data"], mime)

    # Replace with your actual Step Function ARN

    # Invoke the Step Function
    response = stepfunctions.start_execution(
        stateMachineArn=step_function_arn,
        input=json.dumps(event)  # Pass the entire event as input
    )

    print(response)

    return {
        "statusCode": 200,
        "body": json.dumps(result),
        "headers": {
            "Content-Type": "application/text",
        }
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
    claude_response: ClaudeResponse = invoke_claude_3_multimodal(prompt, image_data_base64, image_mime, modelID)
    execution_time = time.time() - start_time

    return {
        # Step 4: Extract output tokens
        'response_text': claude_response["content"],
        'execution_time': str(execution_time)
    }
