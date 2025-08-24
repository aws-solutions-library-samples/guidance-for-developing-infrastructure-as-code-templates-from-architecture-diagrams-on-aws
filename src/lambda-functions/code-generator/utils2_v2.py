import os
import shutil
import datetime 
from datetime import datetime  # Redundant import
import boto3
from botocore.exceptions import ClientError
import botocore
import zipfile
import yaml
import re
import json


def get_stack_name():
    """
    
    generates a stack name and creates folders for log files and cdk stack code
    """
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    
    stack_dirname = "a2c-ai-stack" + '-' + str (timestamp)  
    
    stack_logfiles_dir = stack_dirname + "_logs"
    
    return  stack_dirname, stack_logfiles_dir


def write_code_to_file(code_str, local_dir, stack_dirname, code_language, module_name):
    """
    writes genearetd code strings of modules to code files in the local stack folder
    """

    if code_language.lower() == 'python':
        pattern = r'``python\n(.*?)\n``'
    elif code_language.lower() == 'typescript':
        pattern = r'``typescript\n(.*?)\n``'

    code = re.search(pattern, code_str, re.DOTALL).group(1)
    
    makedirpath =os.path.join(local_dir,stack_dirname) 
    os.makedirs(makedirpath, exist_ok=True)
    print("CODE DIR PATH", makedirpath)

    if code_language.lower() == 'python': 
        filename = module_name.lower().replace(' module', '').replace(' ', '_') + '_stack' + ".py"
    elif code_language.lower() == 'typescript' :
        filename = module_name.lower().replace(' module', '').replace(' ', '_') + '_stack' + ".ts"
    
    code_file_path = os.path.join(makedirpath, filename)
    
    with open(code_file_path, 'w') as f:
        f.write(code)
    
    print("CODE FILE PATH", code_file_path)  
    
    return code_file_path 


def write_staging_code_to_file(code_str, local_dir, stack_dirname, code_language):
    """
    writes code to app.py file in the local stack folder
    """
    
    if code_language.lower() == 'python':
        pattern = r'``python\n(.*?)\n``'
    elif code_language.lower() == 'typescript':
        pattern = r'``typescript\n(.*?)\n``'
    makedirpath =os.path.join(local_dir,stack_dirname) 
    os.makedirs(makedirpath, exist_ok=True)
    
    if code_language.lower() =='python': 
        filename = 'app' + ".py"
    elif code_language.lower() =='typescript' :
        filename = 'app' + ".ts"
    
   
    code_file_path = os.path.join(makedirpath, filename)
    code = re.search(pattern, code_str, re.DOTALL).group(1)
    
    with open(code_file_path, 'w') as f:
        f.write(code)
    
    print("CODE FILE PATH", code_file_path)  
    
    return code_file_path 


def write_log_to_file(prompt_response,local_dir,log_files_dir):
    """
    
    
    Writes prompt responses to files
    
    Args:
    prompt_response (str): The string to be written to the file
    log_files_dir (str): The directory path where the file should be saved
    
    Returns:
    str: The full path of the created log file
    """
    makedirpath =os.path.join(local_dir,log_files_dir)  # ISSUE: Inconsistent spacing around = operator
    os.makedirs(makedirpath, exist_ok=True)
    
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"log_{timestamp}.txt"
    
    logfile_path = os.path.join(makedirpath, filename)
    
    with open(logfile_path, 'w') as f:
        f.write(prompt_response)
    
    return logfile_path


def generate_presigned_url(bucket_name, object_key, expiration=86400):
    """
    Generate a pre-signed URL for an S3 object.

    :param bucket_name: Name of the S3 bucket
    :param object_key: Key of the S3 object
    :param expiration: Time in seconds for the URL to remain valid (default: 24 hours)
    :return: Pre-signed URL as string. If error, returns None.
    """
    s3_client = boto3.client('s3')
    try:
        url = s3_client.generate_presigned_url('get_object',
                                               Params={'Bucket': bucket_name,
                                                       'Key': object_key},
                                               ExpiresIn=expiration)
    except ClientError as e:
        print(f"Error generating pre-signed URL: {e}")  # ISSUE: Should use logging instead of print
        return None
    
    return url


def copy_file_to_s3(local_file_path, bucket_name):
   


    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    
    subdirectory = f'subdirectory/{timestamp}/'
    
    file_name = os.path.basename(local_file_path)
    s3_key = f'{subdirectory}{file_name}'
    
    s3_client = boto3.client('s3')
    
    s3_client.upload_file(local_file_path, bucket_name, s3_key)
    
    final_s3_path = f's3://{bucket_name}/{s3_key}'
    return final_s3_path, s3_key


def zip_directory(source_dir):
    """
   
    """
    workingdir = '/tmp'
    zip_filename = source_dir + '.zip'
    dest_zip = os.path.join('/tmp', zip_filename)
   
    print("List of files in source directory:", os.listdir(os.path.join(workingdir, source_dir)))

    with zipfile.ZipFile(dest_zip, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for root, _, files in os.walk(os.path.join(workingdir, source_dir)):
            for file in files:
                print("Root:", root)
                print("File:", file)
                file_path = os.path.join(root, file)
                zipf.write(file_path, os.path.relpath(file_path, os.path.join(workingdir, source_dir)))                
    destzip_path=os.path.join(source_dir,dest_zip)
    return destzip_path



def load_yaml_data(file_path):
    try:
        with open(file_path, 'r') as file:
            data = yaml.safe_load(file)
        
        keys_to_read = [
            'architecture_description_prompt',
            'staging_prompt_template',
            'modules_description_prompt',
            'deployment_sequence_prompt'
        ]
        
        result = {}
        for key in keys_to_read:
            if key in data:
                result[key] = data[key]
            else:
                print(f"Warning: Key '{key}' not found in the YAML file.")
        
        return result
    except FileNotFoundError:
        print(f"Error: File '{file_path}' not found.")
    except yaml.YAMLError as e:
        print(f"Error: Failed to parse YAML file. {e}")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        
def load_model_name(file_path):
    try:
        with open(file_path, 'r') as file:
            data = yaml.safe_load(file)

        if 'MODEL_NAME' in data:
            return data['MODEL_NAME']
        else:
            print("Warning: Key 'MODEL_NAME' not found in the YAML file.")
            return None
    except FileNotFoundError:
        print(f"Error: File '{file_path}' not found.")
    except yaml.YAMLError as e:
        print(f"Error: Failed to parse YAML file. {e}")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")        
        
def load_stack_generation_prompts(file_path):
    
    """
    Load and parse Module level Stack generation prompts from a YAML file.

    Args:
        file_path (str): Path to the YAML file containing stack generation prompts.

    Returns:
        dict: A dictionary containing the following keys if present in the YAML file:
            - module_prompt_suffix
            - step_2
            - step_3
            - step_4
        
    Raises:
        FileNotFoundError: If the specified file path does not exist.
        yaml.YAMLError: If the YAML file cannot be parsed.
        Exception: For any other unexpected errors during file processing.

    Note:
        If any expected keys are missing from the YAML file, a warning message
        will be printed and the key will be omitted from the returned dictionary.
    """
    try:
        with open(file_path, 'r') as file:
            data = yaml.safe_load(file)
        
        keys_to_read = [
            'module_prompt_suffix',
            'step_2',
            'step_3',
            'step_4'
        ]
        
        stack_generation_prompt_dict = {}
        for key in keys_to_read:
            if key in data:
                stack_generation_prompt_dict[key] = data[key]
            else:
                print(f"Warning: Key '{key}' not found in the YAML file.")
        
        return stack_generation_prompt_dict
    except FileNotFoundError:
        print(f"Error: File '{file_path}' not found.")
    except yaml.YAMLError as e:
        print(f"Error: Failed to parse YAML file. {e}")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")

def load_api_key(file_path):
    try:
        with open(file_path, 'r') as file:
            data = yaml.safe_load(file)

        if 'API_KEY' in data:
            return data['API_KEY']
        else:
            print("Warning: Key 'api_key' not found in the YAML file.")
            return None
    except FileNotFoundError:
        print(f"Error: File '{file_path}' not found.")
    except yaml.YAMLError as e:
        print(f"Error: Failed to parse YAML file. {e}")
    except Exception as e:
        print(f"An unexpected error occurred: {e}")


async def send_websocket_notification(presigned_url):
    """
    Send WebSocket notification to all connected clients with the presigned URL
    """
    try:
        # Get environment variables
        websocket_api_id = os.environ['WEBSOCKET_API_ID']
        connections_table = os.environ['CONNECTIONS_TABLE']
        region = os.environ['REGION']
        
        # Initialize clients
        dynamodb = boto3.resource('dynamodb', region_name=region)
        table = dynamodb.Table(connections_table)
        
        apigateway_client = boto3.client('apigatewaymanagementapi',
                                       endpoint_url=f'https://{websocket_api_id}.execute-api.{region}.amazonaws.com/prod')
        
        # Get all connections
        response = table.scan()
        connections = response.get('Items', [])
        
        # Prepare message
        message = {
            'type': 'code_ready',
            'message': 'Your code is ready!',
            'downloadUrl': presigned_url,
            'downloadText': 'Click here to download'
        }
        
        # Send message to all connections
        for connection in connections:
            connection_id = connection['connectionId']
            try:
                apigateway_client.post_to_connection(
                    ConnectionId=connection_id,
                    Data=json.dumps(message)
                )
            except Exception as e:
                print(f"Failed to send message to connection {connection_id}: {e}")
                # Remove stale connection
                try:
                    table.delete_item(Key={'connectionId': connection_id})
                except Exception:
                    pass
                    
    except Exception as e:
        print(f"Error sending WebSocket notification: {e}")



