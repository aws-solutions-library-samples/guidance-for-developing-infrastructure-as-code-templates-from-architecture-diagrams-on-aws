import json
from code_generator_utils_v2 import *
import asyncio
import os
import boto3 
from urllib.parse import urlparse
import base64
from utils2_v2 import *
import aiohttp
import pprint
import re

bedrock_runtime = boto3.client('bedrock-runtime')

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

        # Create a boto3 client
        s3_client = boto3.client('s3')

        # Ensure the local directory exists
        if not os.path.exists(local_dir):
            os.makedirs(local_dir)

        # Define the local file path
        local_file_path = os.path.join(local_dir, os.path.basename(key_name))

        # Download the file from S3
        s3_client.download_file(bucket_name, key_name, local_file_path)
        print("File downloaded")

        return local_file_path

    except Exception as e:
        
        print(f"Error downloading file from S3: {e}")
        return None
    
def get_image_data(image_file):
    
    with open(image_file, "rb") as imagefile:
        image_data = base64.b64encode(imagefile.read()).decode("utf-8")
        print("Image data generated")
        
    return image_data


def generate_architecture_description(prompt, encoded_image):
    
    """
    Generates an architecture description using Amazon Bedrock's Claude 3.5 Sonnet model by analyzing 
    provided text prompt and image input.

    This function sends a request to the Claude 3.5 Sonnet model through Amazon Bedrock Runtime, 
    combining both text and image inputs to generate a descriptive analysis of architectural elements.

    Args:
        prompt (str): The text prompt guiding the model's analysis of the architecture.
        encoded_image (str): A base64-encoded PNG image string of the architecture to be analyzed.

    Returns:
        dict: A dictionary containing the generated architecture description with the following structure:
            {
                "architecture_description": str
            }
            If successful, contains the generated description text.
            If unsuccessful, contains the message "Unexpected response format".

    Raises:
        May raise exceptions from bedrock_runtime.invoke_model() related to:
        - Invalid model invocation
        - API throttling
        - Authentication/authorization issues
        - Invalid input format

    Example:
        >>> prompt = "Describe the architectural style and key features of this building"
        >>> encoded_image = "base64_encoded_image_string"
        >>> result = generate_architecture_description(prompt, encoded_image)
        >>> print(result["architecture_description"])

    Notes:
        - The function uses the Claude 3 Sonnet model (version 20240620-v1:0)
        - Maximum token limit is set to 2048 tokens
        - Expects PNG image format
        - Prints the generated description to stdout in addition to returning it
    """
    
    # Prepare the request body
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
                            "data": encoded_image,
                        },
                    },
                ],
            }
        ],
    }

    modelId = 'anthropic.claude-3-5-sonnet-20240620-v1:0'
    accept = 'application/json'
    contentType = 'application/json'

    # Invoke the model and get the response
    response = bedrock_runtime.invoke_model(modelId=modelId, body=json.dumps(request_body))
    response_body = json.loads(response['body'].read())

    # Extract generated text
    if isinstance(response_body['content'], list) and len(response_body['content']) > 0:
        generated_text = response_body['content'][0].get('text', '')
        print("Architecture Description",generated_text)
        
        return {"architecture_description": generated_text}
    else:
        return {"architecture_description": "Unexpected response format"}
    
    
def generate_module_descriptions(architecture_description_dict , modules_description_prompt):

    architecture_description =architecture_description_dict['architecture_description']
    
    prompt = modules_description_prompt + architecture_description
    print("MODULE DESCRIPTION PROMPT", prompt )
    
    
    
    request_body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 5048,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": prompt,
                    },
                    
                ],
            }
        ],
    }

    modelId = 'anthropic.claude-3-5-sonnet-20240620-v1:0'
    accept = 'application/json'
    contentType = 'application/json'

    # Invoke the model and get the response
    response = bedrock_runtime.invoke_model(modelId=modelId, body=json.dumps(request_body))
    response_body = json.loads(response['body'].read())

    # Extract generated text
    if isinstance(response_body['content'], list) and len(response_body['content']) > 0:
        module_descriptions = response_body['content'][0].get('text', '')
        print("Module Descriptions",module_descriptions)
        
        return json.dumps(module_descriptions)
    else:
        return {"module_descriptions": "Unexpected response format"}
    
    
def generate_deployment_sequence(modules_description , deployment_sequence_prompt):

    #modules_description =modules_description_dict['modules_description']
    
    prompt = deployment_sequence_prompt + modules_description
    
    deployment_sequence_dict ={ 'modules_description' : ''}
    
    
    request_body = {
        "anthropic_version": "bedrock-2023-05-31",
        "max_tokens": 10000,
        "messages": [
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": prompt,
                    },
                    
                ],
            }
        ],
    }

    modelId = 'anthropic.claude-3-5-sonnet-20240620-v1:0'
    accept = 'application/json'
    contentType = 'application/json'

    # Invoke the model and get the response
    response = bedrock_runtime.invoke_model(modelId=modelId, body=json.dumps(request_body))
    response_body = json.loads(response['body'].read())

    # Extract generated text
    if isinstance(response_body['content'], list) and len(response_body['content']) > 0:
        module_descriptions_with_sequence = response_body['content'][0].get('text', '')
        deployment_sequence_dict['modules_description']=module_descriptions_with_sequence
        print("DEPLOYMENT SEQUENCE", deployment_sequence_dict)
        
        
        
        return deployment_sequence_dict
    
    
def generate_module_prompts(deployment_sequence_dict, language_name):
    
    # Parse dictionary
    
    modules_description =deployment_sequence_dict['modules_description']
    print("Modules Description", modules_description)
    modules_description_dict=json.loads(modules_description)
    
    # Create empty dictionary to store prompts
    module_prompt_dict = {}    
    
    keys = list(modules_description_dict.keys())
    print(keys)
    
    stack_names = list(modules_description_dict.values())[-1] 
    print("stack_names" , stack_names)
    
    # Skip first and last keys, process only module information
    for key in keys[1:-1]:
        module_name = key
        print("Module Name", module_name) 
        module_description = modules_description_dict[key]
        print("Module Description" , module_description)
        
        # Construct prompt for each module
        prompt = (
            f"Generate a AWS CDK stack in {language_name} for module name '{module_name}' "
            f"with the following module description: {module_description}. "
            "Ensure Implementation reflects all interaction mentioned. Use the Basename of the Module as the name of the CDK stack, without the substring 'Module' included in the name of the stack"
        )
        
        # Add to prompt dictionary with module name as key
        module_prompt_dict[module_name] = prompt
    
    return module_prompt_dict,stack_names
    
    
def generate_staging_prompt(responses,template: str, stack_names: list, language_name: str):
    
    
    # Determine the file extension based on the language name
    if language_name.lower() == 'python':
        staging_file_name = 'app.py'
    elif language_name.lower() == 'typescript':
        staging_file_name = 'app.ts'
    else:
        raise ValueError("Unsupported language. Use 'python' or 'typescript'.")

    
    # Replace the placeholder stack names with the script names from parallel processing
    module_filenames_list = [path.split('/')[-1] for path in responses]
    module_filenames='\n '.join(['-' + module_filename for module_filename in module_filenames_list])
    print(module_filenames)
    
    stack_names = [name + 'Stack' for name in stack_names]
    print("StackNames:", stack_names)
    stack_imports = '\n '.join(['-' + stack for stack in stack_names])
    print("Stackimports:" ,stack_imports)
    
    prompta=template.replace('app.py' ,staging_file_name)
    promptb = prompta.replace('- StackA - StackB - StackC - StackD', stack_imports)
    
    final_staging_prompt=re.sub(r'\b{}\b'.format('stack_a.py - stack_b.py - stack_c.py - stack_d.py'), module_filenames, promptb)
    print("FINAL STAGING PROMPT")
    pprint.pprint(final_staging_prompt)
    
    
    # Prepare the dictionary
    staging_prompt_dict = {'staging_prompt': final_staging_prompt}
    
    print("STAGING_PROMPT_DICT", staging_prompt_dict)
    print("DATA TYPE STAGING PROMPT DICT" , type(staging_prompt_dict))
    
    # Return the final JSON string
    return staging_prompt_dict
    
    
async def modular_stack_generator_main(module_prompt_dict, code_language, local_dir, stack_dirname, stack_logfiles_dir,stack_generation_prompt_dict, api_key, model_name):
    
    
    
    
    # Create concurrent tasks with different prompts for each module 
   
    async with aiohttp.ClientSession() as session:
        tasks = [code_generation_do_it_all(session,module_name, module_prompt, local_dir, stack_dirname,code_language,stack_logfiles_dir,stack_generation_prompt_dict,api_key,model_name)for module_name, module_prompt in module_prompt_dict.items()]  
        responses = await asyncio.gather(*tasks)  # Run tasks concurrently and gather results
    
    
    #for module_name, module_prompt in module_prompt_dict.items():
    #    code_generation_do_it_all(module_name, module_prompt, local_dir, stack_dirname,code_language,stack_logfiles_dir,stack_generation_prompt_dict)
    
    
    
    
    
    return responses
    
async def generate_staging_file (staging_prompt_dict, code_language, local_dir, stack_logfiles_dir,stack_dirname, api_key, model_name):
    
    #staging_prompt = staging_prompt_dict[0]['staging_prompt']
    staging_prompt = staging_prompt_dict['staging_prompt']
            
    async with aiohttp.ClientSession() as session:
        staging_prompt_response= await get_ai_response(session,api_key, role, staging_prompt, model=model_name, base_url="https://api.perplexity.ai/chat/completions")
    write_log_to_file(staging_prompt_response, local_dir, stack_logfiles_dir)
            
    #local_dirpath, codefilepath = write_code_to_file(staging_prompt_response, local_dir,stack_logfiles_dir,code_language)
    #write_staging_code_to_file(code_str, local_dir,stack_dirname, code_language)
    codefilepath=write_staging_code_to_file(staging_prompt_response, local_dir, stack_dirname, code_language)
            
            
    return codefilepath
    
async def a2c_ai_do_it_all(s3_uri, local_dir,code_language, prompt_config_dict, stack_generation_prompt_dict, api_key, model_name):
    from utils2_v2 import send_progress_update
    
    stack_dirname , stack_logfiles_dir =get_stack_name()
    print("stack_dirname" , stack_dirname)


    arch_prompt=prompt_config_dict['architecture_description_prompt']      # Prompt to generate architecture description
    modules_description_prompt=prompt_config_dict['modules_description_prompt']       # Prompt to generate modules description
    staging_prompt_template=prompt_config_dict['staging_prompt_template']        # prompt Template to generate a staging file
    deployment_sequence_prompt=prompt_config_dict['deployment_sequence_prompt']  

    # Step 1: Download Architecture drawing from s3
    await send_progress_update(10)
    image_path = download_file_from_s3(s3_uri, local_dir)
    
    # Step 2: Get encoded image
    await send_progress_update(20)
    encoded_image= get_image_data(image_path)
    
    # Step 3: Get Architecture Description
    await send_progress_update(30)
    arch_description_dict=generate_architecture_description(arch_prompt, encoded_image)
    
    # Step 4: Render JSON with Modular descriptions
    await send_progress_update(40)
    module_descriptions=generate_module_descriptions(arch_description_dict , modules_description_prompt)

    # Step 5: Render JSON with Deployment Sequence
    await send_progress_update(50)
    module_descriptions=generate_deployment_sequence(module_descriptions, deployment_sequence_prompt)
    
    # Step 6: Generate Module prompts
    await send_progress_update(60)
    module_prompt_dict,modules_list = generate_module_prompts(module_descriptions, code_language)
    
    # Step 7: Generate module level stacks asynchronously
    await send_progress_update(70)
    responses=await(modular_stack_generator_main(module_prompt_dict, code_language, local_dir, stack_dirname, stack_logfiles_dir,stack_generation_prompt_dict, api_key, model_name))
    print("responses from async" , responses)
    
    # Step 8: Generate Staging Prompt
    await send_progress_update(80)
    staging_prompt_dict=generate_staging_prompt(responses, staging_prompt_template, modules_list, code_language)
    print(type(staging_prompt_dict))
    print("STAGING PROMPT DICT" , staging_prompt_dict)
    
    # Step 9: Generate Staging File
    await send_progress_update(90)
    codefilepath= await (generate_staging_file (staging_prompt_dict, code_language,  local_dir, stack_logfiles_dir,stack_dirname, api_key, model_name))
    
    # Step 10: zip the directory
    await send_progress_update(100)
    zipfilepath = zip_directory(stack_dirname)
    
    return zipfilepath
