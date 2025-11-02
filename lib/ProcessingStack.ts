import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';

import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

interface Props extends cdk.StackProps {
  diagramStorageBucket: cdk.aws_s3.Bucket;
  codeOutputBucket: cdk.aws_s3.Bucket;
}

export class ProcessingStack extends cdk.Stack {
  public readonly webSocketApi: apigatewayv2.WebSocketApi;
  public readonly connectionsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    // DynamoDB table for WebSocket connections
    this.connectionsTable = new dynamodb.Table(this, 'WebSocketConnections', {
      tableName: `a2a-websocket-connections`,
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    // WebSocket API Gateway
    this.webSocketApi = new apigatewayv2.WebSocketApi(this, 'WebSocketApi', {
      apiName: `a2a-websocket-api`,
    });

    const processingLambda = new lambda.DockerImageFunction(this, 'codeGenerator', {
      functionName: `a2a-code-generator`,
      code: lambda.DockerImageCode.fromImageAsset('src/lambda-functions/code-generator'),
      memorySize: 1024,
      timeout: cdk.Duration.minutes(15),
      environment: {
        RESULTS_BUCKET_NAME: props.codeOutputBucket.bucketName,
        REGION: this.region,
        A2CAI_PROMPTS: 'a2cai_prompts.yaml',
        MODEL_NAME: 'model_name.yaml',
        STACK_GENERATION_PROMPTS: 'stack_gen_prompts.yaml',
        WEBSOCKET_API_ID: this.webSocketApi.apiId,
        CONNECTIONS_TABLE: this.connectionsTable.tableName,
      },
      initialPolicy: [
        new iam.PolicyStatement({
          actions: ['cloudwatch:PutMetricData'],
          resources: ['*'],
        }),
        new iam.PolicyStatement({
          actions: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: ['*'],
        }),
        new iam.PolicyStatement({
          actions: ['s3:GetObject', 's3:PutObject', 's3:ListBucket'],
          resources: [
            props.diagramStorageBucket.bucketArn,
            props.diagramStorageBucket.bucketArn.concat('/*'),
            props.codeOutputBucket.bucketArn,
            props.codeOutputBucket.bucketArn.concat('/*'),
          ],
        }),
        new iam.PolicyStatement({
          actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
          resources: ['*'],
        }),
        new iam.PolicyStatement({
          actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
          resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:A2A_API_KEY*`],
        }),
        new iam.PolicyStatement({
          actions: ['execute-api:ManageConnections'],
          resources: [`arn:aws:execute-api:${this.region}:${this.account}:${this.webSocketApi.apiId}/*`],
        }),
        new iam.PolicyStatement({
          actions: ['dynamodb:Scan'],
          resources: [this.connectionsTable.tableArn],
        }),
      ],
    });

    // Add AmazonBedrockFullAccess managed policy to the Lambda function
    processingLambda.role?.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSESFullAccess')
    );

    const lambdaProcessingTask = new tasks.LambdaInvoke(this, 'Processing', {
      lambdaFunction: processingLambda,
      inputPath: '$',
    });



    const stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      stateMachineName: `A2A-Processing`,
      definition: lambdaProcessingTask,
    });

    // WebSocket Lambda functions
    const connectHandler = new lambda.Function(this, 'WebSocketConnect', {
      functionName: `a2a-websocket-connect`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'connect.handler',
      code: lambda.Code.fromAsset('src/lambda-functions/websocket-connect'),
      environment: {
        CONNECTIONS_TABLE: this.connectionsTable.tableName,
      },
    });

    const disconnectHandler = new lambda.Function(this, 'WebSocketDisconnect', {
      functionName: `a2a-websocket-disconnect`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'disconnect.handler',
      code: lambda.Code.fromAsset('src/lambda-functions/websocket-disconnect'),
      environment: {
        CONNECTIONS_TABLE: this.connectionsTable.tableName,
      },
    });

    const messageHandler = new lambda.Function(this, 'WebSocketMessage', {
      functionName: `a2a-websocket-message`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'message.handler',
      code: lambda.Code.fromAsset('src/lambda-functions/websocket-message'),
      timeout: cdk.Duration.minutes(15),
      memorySize: 1024,
      environment: {
        CONNECTIONS_TABLE: this.connectionsTable.tableName,
        REGION: this.region,
        ACCOUNT_ID: this.account,
      },
      initialPolicy: [
        new iam.PolicyStatement({
          actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
          resources: ['*'],
        }),
        new iam.PolicyStatement({
          actions: ['secretsmanager:GetSecretValue'],
          resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:A2A_API_KEY*`],
        }),
        new iam.PolicyStatement({
          actions: ['s3:GetObject'],
          resources: [
            props.diagramStorageBucket.bucketArn,
            `${props.diagramStorageBucket.bucketArn}/*`
          ],
        }),
      ],
    });

    // Grant DynamoDB permissions
    this.connectionsTable.grantReadWriteData(connectHandler);
    this.connectionsTable.grantReadWriteData(disconnectHandler);
    this.connectionsTable.grantReadWriteData(messageHandler);

    // Configure WebSocket API routes
    this.webSocketApi.addRoute('$connect', {
      integration: new integrations.WebSocketLambdaIntegration('ConnectIntegration', connectHandler),
      authorizer: undefined, // Allow unauthenticated connections
    });
    this.webSocketApi.addRoute('$disconnect', {
      integration: new integrations.WebSocketLambdaIntegration('DisconnectIntegration', disconnectHandler),
    });
    this.webSocketApi.addRoute('$default', {
      integration: new integrations.WebSocketLambdaIntegration('MessageIntegration', messageHandler),
    });

    // WebSocket API stage
    const stage = new apigatewayv2.WebSocketStage(this, 'WebSocketStage', {
      webSocketApi: this.webSocketApi,
      stageName: 'prod',
      autoDeploy: true,
    });

    // Grant WebSocket API permissions to message handler
    messageHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['execute-api:ManageConnections'],
        resources: [`arn:aws:execute-api:${this.region}:${this.account}:${this.webSocketApi.apiId}/*`],
      })
    );

    // Grant WebSocket API permissions to connect handler
    connectHandler.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['execute-api:ManageConnections'],
        resources: [`arn:aws:execute-api:${this.region}:${this.account}:${this.webSocketApi.apiId}/*`],
      })
    );

    // Output WebSocket URL
    new cdk.CfnOutput(this, 'WebSocketUrl', {
      value: stage.url,
      description: 'WebSocket API URL',
    });
  }
}