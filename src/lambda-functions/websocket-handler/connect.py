import json
import os
import time
import boto3

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['CONNECTIONS_TABLE'])

def handler(event, context):
    print(f"Connect event: {json.dumps(event)}")
    connection_id = event['requestContext']['connectionId']
    
    try:
        # Store connection with TTL (2 hours)
        ttl = int(time.time()) + 7200
        
        table.put_item(
            Item={
                'connectionId': connection_id,
                'ttl': ttl,
                'timestamp': int(time.time())
            }
        )
        
        print(f"Connection {connection_id} stored successfully")
        return {'statusCode': 200}
    except Exception as e:
        print(f"Error storing connection: {str(e)}")
        return {'statusCode': 500}