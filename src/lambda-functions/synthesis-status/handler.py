import json
import os
import boto3

dynamodb = boto3.resource('dynamodb', region_name=os.environ.get('REGION', 'us-west-2'))

CORS_HEADERS = {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': os.environ.get('ALLOWED_ORIGIN', ''),
    'Access-Control-Allow-Methods': 'OPTIONS,POST',
    'Access-Control-Allow-Headers': 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
}

def handler(event, context):
    http_method = event.get('httpMethod') or event.get('requestContext', {}).get('http', {}).get('method')

    if http_method == 'OPTIONS':
        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': '', 'isBase64Encoded': False}

    try:
        body = json.loads(event['body'])
        execution_id = body.get('executionId')
        if not execution_id:
            return {'statusCode': 400, 'headers': CORS_HEADERS, 'body': json.dumps({'error': 'executionId is required'}), 'isBase64Encoded': False}

        table = dynamodb.Table(os.environ['SYNTHESIS_PROGRESS_TABLE'])
        resp = table.get_item(Key={'executionId': execution_id})
        
        item = resp.get('Item')
        if not item:
            # Not found yet — execution just started
            return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': json.dumps({'status': 'RUNNING', 'progress': 0}), 'isBase64Encoded': False}

        result = {
            'status': item.get('status', 'RUNNING'),
            'progress': int(item.get('progress', 0)),
        }
        
        if item.get('downloadUrl'):
            result['downloadUrl'] = item['downloadUrl']
        if item.get('error'):
            result['error'] = item['error']

        return {'statusCode': 200, 'headers': CORS_HEADERS, 'body': json.dumps(result), 'isBase64Encoded': False}

    except Exception as e:
        return {'statusCode': 500, 'headers': CORS_HEADERS, 'body': json.dumps({'error': str(e)}), 'isBase64Encoded': False}
