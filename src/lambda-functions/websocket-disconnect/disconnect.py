import json
import os
import boto3

dynamodb = boto3.resource('dynamodb')
table = dynamodb.Table(os.environ['CONNECTIONS_TABLE'])

def handler(event, context):
    connection_id = event['requestContext']['connectionId']
    
    # Remove connection from table
    table.delete_item(
        Key={'connectionId': connection_id}
    )
    
    return {'statusCode': 200}