import json
import os
import boto3

# Configure S3 client with regional endpoint
s3_client = boto3.client('s3', 
    region_name=os.environ['REGION'],
    config=boto3.session.Config(
        s3={'addressing_style': 'virtual'},
        signature_version='s3v4'
    )
)

def handler(event, context):
    print(f"Event: {json.dumps(event)}")
    
    # ALB event format uses different structure than API Gateway
    http_method = event.get('httpMethod') or event.get('requestContext', {}).get('http', {}).get('method')
    
    # Handle CORS preflight requests
    if http_method == 'OPTIONS':
        print("Handling OPTIONS request")
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
        print("Handling POST request")
        request_body = json.loads(event["body"])
        s3_key = request_body.get('key')
        content_type = request_body.get('contentType')
        
        if not s3_key or not content_type:
            return {
                'statusCode': 400,
                'headers': {
                    'Content-Type': 'application/json',
                    'Access-Control-Allow-Origin': '*'
                },
                'body': json.dumps({'error': 'key and contentType are required'}),
                'isBase64Encoded': False
            }
        
        # S3 bucket name
        s3_image_bucket = f'a2a-{os.environ["ACCOUNT_ID"]}-diagramstorage-{os.environ["REGION"]}'
        
        # Generate presigned URL for upload with correct configuration
        presigned_url = s3_client.generate_presigned_url(
            'put_object',
            Params={
                'Bucket': s3_image_bucket, 
                'Key': s3_key, 
                'ContentType': content_type
            },
            ExpiresIn=3600,
            HttpMethod='PUT'
        )
        
        response = {
            'statusCode': 200,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'OPTIONS,POST',
                'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token'
            },
            'body': json.dumps({'uploadUrl': presigned_url}),
            'isBase64Encoded': False
        }
        print(f"Response: {json.dumps(response)}")
        return response
    except Exception as e:
        print(f"Error: {str(e)}")
        return {
            'statusCode': 500,
            'headers': {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            'body': json.dumps({'error': str(e)}),
            'isBase64Encoded': False
        }