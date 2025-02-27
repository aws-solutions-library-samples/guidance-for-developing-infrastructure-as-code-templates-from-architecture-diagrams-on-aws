import boto3
import botocore
from botocore.exceptions import ClientError
import os
from urllib.parse import urlparse
import base64
import json
import time


modelID="us.anthropic.claude-3-7-sonnet-20250219-v1:0"
prompt ='You are an expert AWS solutions architect and cloud infrastructure specialist with deep knowledge of AWS services, best practices, and the AWS Cloud Development Kit (CDK). Your task is to analyze the attached AWS architecture diagram and provide detailed, structured descriptions that can be used by other AI systems to generate deployable AWS CDK code.You have the following capabilities and traits:1.AWS Expertise: You have comprehensive knowledge of all AWS services, their configurations, and how they interact within complex architectures.2.Diagram Analysis: You can quickly interpret and understand AWS architecture diagrams, identifying all components and their relationships.3.Detail-Oriented: You provide thorough, specific descriptions of each component, including resource names, settings, and configuration details crucial for CDK implementation.4.Best Practices: You understand and can explain AWS best practices for security, scalability, and cost optimization.5.CDK-Focused: Your descriptions are structured in a way that aligns with AWS CDK constructs and patterns, facilitating easy code generation.6.Clear Communication: You explain complex architectures in a clear, logical manner that both humans and AI systems can understand and act upon.7.Holistic Understanding: You grasp not just individual components, but also the overall system purpose, data flow, and integration points. Your goal is to create a description that serves as a comprehensive blueprint for CDK code generation.What use case it is trying to address? Evaluate the complexity level of this architecture as level 1 or level 2 or level 3 based on the definitions described here: Level 1 : less than or equals to 4 different types of AWS services are used in the architecture diagram. Level 2 : 5 to 10 different types of AWS services are used in the architecture diagram. Level 3 : more than 10 different types of AWS services are used in the architecture diagram.At the end of your response include a numbered list of AWS resources along with their counts and names. For example, say  Resources summary: 1. ’N’ s3 buckets A, , B , C 2. ’N’ lambda functions A B  etc. and so on for all services present in the architecture diagram'

def download_file_from_s3(s3_uri, local_dir):
    """
    Download a file from an S3 bucket to a local directory.

    :param s3_uri: str, S3 URI of the file (e.g., 's3://bucket_name/key_name')
    :param local_dir: str, Local directory path where the file will be saved
    :return: str, Local file path of the downloaded file
    """
    try:
        # Parse the S3 URI
        parsed_url = urlparse(s3_uri)
        bucket_name = parsed_url.netloc
        key_name = parsed_url.path.lstrip('/')

        print("Bucket Name: " + bucket_name)
        print("Key Name: " + key_name)

        # Create a boto3 client
        s3_client = boto3.client('s3')

        # Ensure the local directory exists
        if not os.path.exists(local_dir):
            os.makedirs(local_dir)

        # Define the local file path
        local_file_path = os.path.join(local_dir, os.path.basename(key_name))

        # Download the file from S3
        s3_client.download_file(bucket_name, key_name, local_file_path)
        
        print(os.listdir('/tmp'))
        print(local_file_path)

        return local_file_path

    except Exception as e:
        
        print(f"Error downloading file from S3: {e}")
        return None
    
def get_image_data(image_file):
    
    with open(image_file, "rb") as imagefile:
        image_data = base64.b64encode(imagefile.read()).decode("utf-8")
        
    return image_data

def invoke_claude_3_multimodal(prompt, base64_image_data, modelid):
    
        """
        Invokes Anthropic Claude 3.7 Sonnet to run a multimodal inference using the input
        provided in the request body.

        :param prompt: The prompt that you want Claude 3 to use.
        :param base64_image_data: The base64-encoded image that you want to add to the request.
        :return: Inference response from the model.
        """

        # Initialize the Amazon Bedrock runtime client
        client = boto3.client(
            service_name="bedrock-runtime", region_name=os.environ["REGION"]
        )

        # Invoke the model with the prompt and the encoded image
        model_id = modelid
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
                                "media_type": "image/png",
                                "data": base64_image_data,
                            },
                        },
                    ],
                }
            ],
        }

        try:
    
            response = client.invoke_model(
                modelId=model_id,
                body=json.dumps(request_body),
            )
            print(type(response))
            print("RESPONSE" , response)   
            # Process and print the response
            result = json.loads(response.get("body").read())
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
            
        
    
def generate_response_string(result):
    
    
    """
    
    Return response string to Streamlit UI
    
    """
    
            
    output_tokens = result["content"]
    
    result_dict ={ 'response_text' : '' , 'execution_time' : '' }
    
    result_dict['response_text']= output_tokens
    
    return result_dict
    
    
    
def streamlit_responder_do_it_all(s3_uri, local_dir):
    
    """
    
    Orchestator function to perform all steps
    
    """
    
    
    start_time = time.time()
    
    # Step 1:  Download File
    
    local_filepath = download_file_from_s3(s3_uri, local_dir)
    
    # Step 2 : Get Image Data
    
    image_data=get_image_data(local_filepath)
    
    # Step 3: Get Claude Response
    
    claude_response=invoke_claude_3_multimodal(prompt, image_data, modelID)
    
    # Step 4: Extract output tokens
    
    result_dict= generate_response_string(claude_response)
    
    # Calculate execution time
    end_time = time.time()
    execution_time = end_time - start_time
    
    #Add execution time to result_dict
    result_dict['execution_time'] = execution_time
    
    
    
    return result_dict
