import json
import os
import boto3

stepfunctions = boto3.client('stepfunctions')

def handler(event, context):
    # Handle CORS preflight requests
    if event.get('httpMethod') == 'OPTIONS' or event.get('requestContext', {}).get('http', {}).get('method') == 'OPTIONS':
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
        step_function_arn = f'arn:aws:states:{os.environ["REGION"]}:{os.environ["ACCOUNT_ID"]}:stateMachine:{os.environ["CDK_QUALIFIER"]}-Processing'
        
        # Invoke Step Function
        response = stepfunctions.start_execution(
            stateMachineArn=step_function_arn,
            input=json.dumps({
                "file_path": file_path,
                "code_language": code_language
            })
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