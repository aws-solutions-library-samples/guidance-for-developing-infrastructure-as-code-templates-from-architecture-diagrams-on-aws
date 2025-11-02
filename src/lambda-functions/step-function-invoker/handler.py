import json
import os
import boto3

stepfunctions = boto3.client('stepfunctions')

def handler(event, context):
    # ALB event format uses different structure than API Gateway
    http_method = event.get('httpMethod') or event.get('requestContext', {}).get('http', {}).get('method')
    
    # Handle CORS preflight requests
    if http_method == 'OPTIONS':
        return {
            'statusCode': 200,
            'headers': {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'OPTIONS,POST',
                'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
                'Access-Control-Max-Age': '86400'
            },
            'body': '',
            'isBase64Encoded': False
        }

    try:
        # Parse request body
        request_body = json.loads(event["body"])
        file_path = request_body.get('file_path')
        code_language = request_body.get('code_language')
        connection_id = request_body.get('connection_id')
        
        print(f"Step function invoker received connection_id: {connection_id}")
        
        if not file_path or not code_language:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                'body': json.dumps({'error': 'file_path and code_language are required'}),
                'isBase64Encoded': False
            }
        
        # Construct Step Function ARN
        step_function_arn = f'arn:aws:states:{os.environ["REGION"]}:{os.environ["ACCOUNT_ID"]}:stateMachine:A2A-Processing'
        
        # Invoke Step Function
        step_function_input = {
            "file_path": file_path,
            "code_language": code_language
        }
        
        # Add connection_id if provided
        if connection_id:
            step_function_input["connection_id"] = connection_id
            
        print(f"Step function input: {step_function_input}")
            
        response = stepfunctions.start_execution(
            stateMachineArn=step_function_arn,
            input=json.dumps(step_function_input)
        )
        
        return {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'OPTIONS,POST',
                'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'
            },
            'body': json.dumps({
                'message': 'Step Function execution started',
                'executionArn': response['executionArn']
            }),
            'isBase64Encoded': False
        }
        
    except Exception as e:
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({'error': str(e)}),
            'isBase64Encoded': False
        }