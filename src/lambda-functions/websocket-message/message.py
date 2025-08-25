import json
import os
import base64
import boto3
import urllib3
from botocore.exceptions import ClientError

# Load configuration
with open('websocket_config.json', 'r') as f:
    config = json.load(f)

dynamodb = boto3.resource('dynamodb')
s3_client = boto3.client('s3')
bedrock = boto3.client('bedrock-runtime', region_name=os.environ['REGION'])
secrets_client = boto3.client('secretsmanager', region_name=os.environ['REGION'])
table = dynamodb.Table(os.environ['CONNECTIONS_TABLE'])

def get_perplexity_api_key():
    """Get Perplexity API key from Secrets Manager"""
    try:
        print("Retrieving API key from Secrets Manager")
        response = secrets_client.get_secret_value(SecretId='A2C_API_KEY')
        secret_string = response['SecretString']
        print(f"Secret retrieved, length: {len(secret_string)}")
        
        # Try to parse as JSON first, fallback to plain string
        try:
            secret_data = json.loads(secret_string)
            if isinstance(secret_data, dict) and 'api_key' in secret_data:
                return secret_data['api_key']
            elif isinstance(secret_data, dict):
                # Return first value if it's a dict but no 'api_key' key
                return list(secret_data.values())[0]
        except json.JSONDecodeError:
            pass
        
        # Return as plain string
        return secret_string
    except Exception as e:
        print(f"Error getting API key: {str(e)}")
        raise

# S3 bucket for images
s3_image_bucket = f'{os.environ["ACCOUNT_ID"]}-a2c-diagramstorage-{os.environ["REGION"]}'

def send_message(connection_id, message, event_context):
    try:
        domain_name = event_context['domainName']
        stage = event_context['stage']
        endpoint_url = f"https://{domain_name}/{stage}"
        
        print(f"Sending message to {connection_id} via {endpoint_url}")
        
        apigateway = boto3.client('apigatewaymanagementapi', endpoint_url=endpoint_url)
        apigateway.post_to_connection(
            ConnectionId=connection_id,
            Data=json.dumps(message)
        )
        print(f"Message sent successfully to {connection_id}")
    except ClientError as e:
        print(f"Error sending message to {connection_id}: {str(e)}")
        if e.response['Error']['Code'] == 'GoneException':
            # Connection is stale, remove from table
            table.delete_item(Key={'connectionId': connection_id})
    except Exception as e:
        print(f"Unexpected error sending message: {str(e)}")

def process_perplexity_request(connection_id, s3_key, request_context):
    """Process Perplexity request for CDK modules breakdown"""
    print(f"Starting Perplexity CDK modules for connection: {connection_id}, S3 key: {s3_key}")
    
    try:
        # Get image from S3
        response = s3_client.get_object(Bucket=s3_image_bucket, Key=s3_key)
        image_bytes = response['Body'].read()
        image_data = base64.b64encode(image_bytes).decode('utf-8')
        
        # Get API key
        api_key = get_perplexity_api_key()
        
        # Create image data URI
        image_data_uri = f"data:image/png;base64,{image_data}"
        
        # Prepare request for Perplexity with image
        headers = {
            'Authorization': f'Bearer {api_key}',
            'Content-Type': 'application/json'
        }
        
        payload = {
            'model': 'sonar-pro',
            'messages': [
                {
                    'role': 'user',
                    'content': [
                        {'type': 'text', 'text': config['cdk_modules_prompt']},
                        {'type': 'image_url', 'image_url': {'url': image_data_uri}}
                    ]
                }
            ],
            'stream': True
        }
        
        # Make streaming request to Perplexity
        http = urllib3.PoolManager()
        response = http.request(
            'POST',
            'https://api.perplexity.ai/chat/completions',
            headers=headers,
            body=json.dumps(payload),
            preload_content=False
        )
        
        if response.status != 200:
            raise Exception(f"Perplexity API error: {response.status} - {response.data.decode('utf-8')}")
        
        print(f"Perplexity API response status: {response.status}")
        
        # Process streaming response
        buffer = ""
        for chunk in response.stream(1024):
            if chunk:
                buffer += chunk.decode('utf-8')
                lines = buffer.split('\n')
                buffer = lines[-1]  # Keep incomplete line in buffer
                
                for line in lines[:-1]:
                    line = line.strip()
                    print(f"Processing line: {line}")
                    
                    if line.startswith('data: '):
                        data = line[6:].strip()
                        print(f"Data content: {data}")
                        
                        if data == '[DONE]':
                            print("Received [DONE], sending completion")
                            send_message(connection_id, {
                                'type': 'cdk_modules_complete'
                            }, request_context)
                            return
                        
                        if data and data != '':
                            try:
                                chunk_data = json.loads(data)
                                print(f"Parsed chunk: {chunk_data}")
                                
                                if 'choices' in chunk_data and len(chunk_data['choices']) > 0:
                                    delta = chunk_data['choices'][0].get('delta', {})
                                    content = delta.get('content', '')
                                    if content:
                                        print(f"Sending content: {content}")
                                        send_message(connection_id, {
                                            'type': 'cdk_modules_stream',
                                            'content': content
                                        }, request_context)
                            except json.JSONDecodeError as e:
                                print(f"JSON decode error: {e}, data: {data}")
                                continue
        
        # Send completion if we exit the loop without [DONE]
        send_message(connection_id, {
            'type': 'cdk_modules_complete'
        }, request_context)
        
    except Exception as error:
        print(f"Perplexity CDK modules error: {str(error)}")
        send_message(connection_id, {
            'type': 'error',
            'message': f'CDK modules analysis failed: {str(error)}'
        }, request_context)
        raise

def process_bedrock_request(connection_id, s3_key, prompt_type, request_context):
    """Process Bedrock request with image from S3 (analysis and optimization only)"""
    print(f"Starting Bedrock {prompt_type} for connection: {connection_id}, S3 key: {s3_key}")
    
    try:
        # Get image from S3
        response = s3_client.get_object(Bucket=s3_image_bucket, Key=s3_key)
        image_bytes = response['Body'].read()
        image_data = base64.b64encode(image_bytes).decode('utf-8')
        
        # Select prompt based on type (only analysis and optimization)
        if prompt_type == "analysis":
            prompt = config["analysis_prompt"]
        else:  # optimization
            prompt = config["optimization_prompt"]
        
        # Bedrock streaming request with thinking enabled
        request_body = {
            "anthropic_version": config["anthropic_version"],
            "max_tokens": config["max_tokens"],
            "messages": [{
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image", "source": {"type": "base64", "media_type": "image/png", "data": image_data}}
                ]
            }],
            "thinking": {
                "type": "enabled",
                "budget_tokens": 2000
            }
        }
        
        # Stream response from Bedrock
        response = bedrock.invoke_model_with_response_stream(
            modelId=config["model_id"],
            body=json.dumps(request_body)
        )
        
        # Process streaming response
        for event_chunk in response['body']:
            chunk = json.loads(event_chunk['chunk']['bytes'])
            
            if chunk['type'] == 'content_block_delta':
                delta = chunk.get('delta', {})
                # Handle thinking content
                if delta.get('type') == 'thinking_delta':
                    thinking = delta.get('thinking', '')
                    if thinking:
                        message_type = 'thinking_stream' if prompt_type == 'analysis' else f'{prompt_type}_thinking_stream'
                        send_message(connection_id, {
                            'type': message_type,
                            'content': thinking
                        }, request_context)
                # Handle text content
                elif delta.get('type') == 'text_delta':
                    text = delta.get('text', '')
                    if text:
                        message_type = 'stream' if prompt_type == 'analysis' else f'{prompt_type}_stream'
                        send_message(connection_id, {
                            'type': message_type,
                            'content': text
                        }, request_context)
            elif chunk['type'] == 'message_stop':
                message_type = 'complete' if prompt_type == 'analysis' else f'{prompt_type}_complete'
                send_message(connection_id, {
                    'type': message_type
                }, request_context)
                break
        
    except Exception as error:
        print(f"{prompt_type} error: {str(error)}")
        send_message(connection_id, {
            'type': 'error',
            'message': f'{prompt_type} failed: {str(error)}'
        }, request_context)
        raise

def handler(event, context):
    print(f"Message handler event: {json.dumps(event)}")
    
    connection_id = event['requestContext']['connectionId']
    request_context = event['requestContext']
    
    try:
        # Parse the message body
        if 'body' not in event or not event['body']:
            print("No body in event")
            return {'statusCode': 400}
            
        body = json.loads(event['body'])
        action = body.get('action')
        
        print(f"Processing action: {action} for connection: {connection_id}")
        
        if action == 'analyze':
            # Get S3 key for image
            s3_key = body.get('s3Key')
            
            if not s3_key:
                send_message(connection_id, {
                    'type': 'error',
                    'message': 'S3 key is required'
                }, request_context)
                return {'statusCode': 400}
            
            # Process analysis first
            process_bedrock_request(connection_id, s3_key, 'analysis', request_context)
            
            # Then process CDK modules using Perplexity
            process_perplexity_request(connection_id, s3_key, request_context)
            
        elif action == 'cdk_modules':
            # Get S3 key for image
            s3_key = body.get('s3Key')
            
            if not s3_key:
                send_message(connection_id, {
                    'type': 'error',
                    'message': 'S3 key is required'
                }, request_context)
                return {'statusCode': 400}
            
            process_perplexity_request(connection_id, s3_key, request_context)
            
        elif action == 'optimize':
            # Get S3 key for image
            s3_key = body.get('s3Key')
            
            if not s3_key:
                send_message(connection_id, {
                    'type': 'error',
                    'message': 'S3 key is required'
                }, request_context)
                return {'statusCode': 400}
            
            process_bedrock_request(connection_id, s3_key, 'optimization', request_context)
                    
        else:
            send_message(connection_id, {
                'type': 'error',
                'message': f'Unknown action: {action}'
            }, request_context)
            return {'statusCode': 400}
            
        return {'statusCode': 200}
        
    except json.JSONDecodeError as e:
        print(f"JSON decode error: {str(e)}")
        return {'statusCode': 400}
    except Exception as e:
        print(f"Handler error: {str(e)}")
        try:
            send_message(connection_id, {
                'type': 'error',
                'message': f'Server error: {str(e)}'
            }, request_context)
        except:
            print("Failed to send error message")
        return {'statusCode': 500}