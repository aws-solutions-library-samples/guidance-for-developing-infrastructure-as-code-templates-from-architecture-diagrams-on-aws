import json
import os
import base64
import time
import boto3
from botocore.exceptions import ClientError

dynamodb = boto3.resource('dynamodb')
bedrock = boto3.client('bedrock-runtime', region_name=os.environ['REGION'])
table = dynamodb.Table(os.environ['CONNECTIONS_TABLE'])

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

# Use DynamoDB for chunked data storage
def get_chunked_session(connection_id):
    try:
        response = table.get_item(Key={'connectionId': f"{connection_id}_chunks"})
        return response.get('Item')
    except:
        return None

def save_chunked_session(connection_id, session_data):
    table.put_item(
        Item={
            'connectionId': f"{connection_id}_chunks",
            'ttl': int(time.time()) + 3600,  # 1 hour TTL
            **session_data
        }
    )

def delete_chunked_session(connection_id):
    table.delete_item(Key={'connectionId': f"{connection_id}_chunks"})

def process_bedrock_analysis(connection_id, image_data, request_context):
    """Process Bedrock analysis with the complete image data"""
    print(f"Starting Bedrock analysis for connection: {connection_id}")
    
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
    
    try:
        # Stream response from Bedrock
        response = bedrock.invoke_model_with_response_stream(
            modelId='anthropic.claude-3-5-sonnet-20241022-v2:0',
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
                
    except Exception as bedrock_error:
        print(f"Bedrock error: {str(bedrock_error)}")
        send_message(connection_id, {
            'type': 'error',
            'message': f'Bedrock analysis failed: {str(bedrock_error)}'
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
            # Single message with complete image data
            image_data = body.get('imageData')
            
            if not image_data:
                send_message(connection_id, {
                    'type': 'error',
                    'message': 'No image data provided'
                }, request_context)
                return {'statusCode': 400}
            
            process_bedrock_analysis(connection_id, image_data, request_context)
            
        elif action == 'analyze_start':
            # Initialize chunked data collection
            total_chunks = body.get('totalChunks', 0)
            session_data = {
                'chunks': {},
                'total_chunks': total_chunks,
                'language': body.get('language')
            }
            save_chunked_session(connection_id, session_data)
            print(f"Started chunked upload for {connection_id}: {total_chunks} chunks")
            
        elif action == 'analyze_chunk':
            # Collect chunk data
            session = get_chunked_session(connection_id)
            if not session:
                send_message(connection_id, {
                    'type': 'error',
                    'message': 'No active chunked upload session'
                }, request_context)
                return {'statusCode': 400}
                
            chunk_index = body.get('chunkIndex')
            chunk_data = body.get('chunkData')
            
            # Update chunks in session
            chunks = session.get('chunks', {})
            chunks[str(chunk_index)] = chunk_data
            session['chunks'] = chunks
            
            save_chunked_session(connection_id, session)
            print(f"Received chunk {chunk_index} for {connection_id}")
            
        elif action == 'analyze_end':
            # Process complete chunked data
            session = get_chunked_session(connection_id)
            if not session:
                send_message(connection_id, {
                    'type': 'error',
                    'message': 'No active chunked upload session'
                }, request_context)
                return {'statusCode': 400}
                
            # Reconstruct complete image data
            complete_data = ''
            chunks = session.get('chunks', {})
            total_chunks = int(session['total_chunks'])  # Convert Decimal to int
            for i in range(total_chunks):
                chunk_key = str(i)
                if chunk_key in chunks:
                    complete_data += chunks[chunk_key]
                else:
                    send_message(connection_id, {
                        'type': 'error',
                        'message': f'Missing chunk {i}'
                    }, request_context)
                    return {'statusCode': 400}
            
            print(f"Reconstructed complete image data for {connection_id}: {len(complete_data)} chars")
            
            # Clean up session data
            delete_chunked_session(connection_id)
            
            # Process with Bedrock
            process_bedrock_analysis(connection_id, complete_data, request_context)
                    
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