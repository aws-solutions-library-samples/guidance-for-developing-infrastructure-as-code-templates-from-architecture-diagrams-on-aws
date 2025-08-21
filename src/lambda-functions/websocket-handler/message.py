import json
import os
import base64
import boto3
import time
import random
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
bedrock = boto3.client('bedrock-runtime', region_name=os.environ['REGION'])
s3_client = boto3.client('s3')
table = dynamodb.Table(os.environ['CONNECTIONS_TABLE'])

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

def process_bedrock_analysis(connection_id, s3_key, request_context):
    """Process Bedrock analysis with image from S3 with retry logic"""
    print(f"Starting Bedrock analysis for connection: {connection_id}, S3 key: {s3_key}")
    
    max_retries = 3
    base_delay = 2
    
    for attempt in range(max_retries + 1):
        try:
            # Get image from S3
            response = s3_client.get_object(Bucket=s3_image_bucket, Key=s3_key)
            image_bytes = response['Body'].read()
            image_data = base64.b64encode(image_bytes).decode('utf-8')
            
            # Bedrock streaming request
            request_body = {
                "anthropic_version": "bedrock-2023-05-31",
                "max_tokens": 2048,
                "messages": [{
                    "role": "user",
                    "content": [
                        {
                            "type": "text",
                            "text": "You are an expert AWS solutions architect. Analyze this architecture diagram and provide a detailed description of the AWS services, their configurations, and relationships. Include use case analysis and complexity level (1-3 based on number of services: 1=≤4 services, 2=5-10 services, 3=>10 services)."
                        },
                        {
                            "type": "image",
                            "source": {
                                "type": "base64",
                                "media_type": "image/png",
                                "data": image_data
                            }
                        }
                    ]
                }]
            }
            
            # Stream response from Bedrock with retry logic
            response = bedrock.invoke_model_with_response_stream(
                modelId='us.anthropic.claude-sonnet-4-20250514-v1:0',
                body=json.dumps(request_body)
            )
            
            print(f"Bedrock streaming started for connection: {connection_id}")
            
            # Process streaming response
            for event_chunk in response['body']:
                chunk = json.loads(event_chunk['chunk']['bytes'])
                
                if chunk['type'] == 'content_block_delta':
                    text = chunk['delta'].get('text', '')
                    if text:
                        send_message(connection_id, {
                            'type': 'stream',
                            'content': text
                        }, request_context)
                elif chunk['type'] == 'message_stop':
                    send_message(connection_id, {
                        'type': 'complete'
                    }, request_context)
                    break
            
            # If we get here, the request succeeded
            return
            
        except ClientError as e:
            error_code = e.response['Error']['Code']
            if error_code == 'ServiceUnavailableException' and attempt < max_retries:
                # Exponential backoff with jitter
                delay = base_delay * (2 ** attempt) + random.uniform(0, 1)
                print(f"Bedrock throttled, retrying in {delay:.2f}s (attempt {attempt + 1}/{max_retries + 1})")
                
                send_message(connection_id, {
                    'type': 'stream',
                    'content': f"\n\n⏳ Service busy, retrying in {int(delay)}s... (attempt {attempt + 1})\n\n"
                }, request_context)
                
                time.sleep(delay)
                continue
            else:
                # Non-retryable error or max retries exceeded
                raise e
        except Exception as error:
            print(f"Analysis error: {str(error)}")
            send_message(connection_id, {
                'type': 'error',
                'message': f'Analysis failed: {str(error)}'
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
            
            process_bedrock_analysis(connection_id, s3_key, request_context)
                    
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