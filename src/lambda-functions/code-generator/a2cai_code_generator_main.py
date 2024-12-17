import asyncio
import boto3
from a2cai_v2 import *
import os
import yaml
from utils2_v2 import *
from yaml.loader import SafeLoader

async def async_lambda_handler(event, context):
    """
    AWS Lambda handler function that orchestrates the A2C AI code generation process.
    Loads configuration from YAML files, sets up prompts and parameters,
    and calls the a2c_ai_do_it_all function to generate code from an architecture diagram.

    Args:
        event (dict): Lambda event data containing S3 URI and code language information.
        context (object): Lambda context object.

    Returns:
        dict: A dictionary containing the path to the generated zip file and a success message.
    """

    # Extract S3 URI and code language from the event data
    image_s3_uri = event['file_path']
    code_language = event['code_language']

    # Check whether the required scripts and config files are present in the Lambda environment
    storage_dir = '/tmp'
    local_dir='/var/task'
    print(os.listdir(local_dir))
  
    # Load configuration from environment variables
    prompts_config_file = os.environ['A2CAI_PROMPTS']
    stack_gen_prompts_config_file = os.environ['STACK_GENERATION_PROMPTS']
    api_key_config_file = os.environ['API_KEY']
    result_bucket_name = os.environ['RESULTS_BUCKET_NAME']

    # Load the main prompts configuration from YAML file
    prompt_config_dict = load_yaml_data(os.path.join(local_dir,prompts_config_file))

    # Load additional stack generation prompts from separate YAML file
    stack_generation_prompt_dict = load_stack_generation_prompts(os.path.join(stack_gen_prompts_config_file))
    
    # Load API key configuration from YAML file
    api_key_config_dict = load_api_key(os.path.join(local_dir, api_key_config_file))

    # Call main processing function with all configured parameters
    # Returns path to generated zip file containing the code
    zipfilepath = await a2c_ai_do_it_all(image_s3_uri, storage_dir, code_language, prompt_config_dict, stack_generation_prompt_dict)

    # Upload the generated zip file to S3
    final_s3_path, s3_object_key = copy_file_to_s3(zipfilepath, result_bucket_name)

    # Generate a presigned URL for the uploaded file
    presigned_url = generate_presigned_url(result_bucket_name, s3_object_key, expiration=86400)

    # Return a dictionary with a downloadable link to the generated code and a success message
    return {
        'message': 'Code generation completed successfully',
        'presigned_url': presigned_url
    }

def lambda_handler(event, context):
    loop = asyncio.get_event_loop()
    result = loop.run_until_complete(async_lambda_handler(event, context))
    return result