import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import * as apigatewayv2 from 'aws-cdk-lib/aws-apigatewayv2';
import * as integrations from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { Construct } from 'constructs';

interface Props extends cdk.StackProps {
  recipientEmailAddresses: string[];
  diagramStorageBucket: cdk.aws_s3.Bucket;
  codeOutputBucket: cdk.aws_s3.Bucket;
  responderLambda?: lambda.Function;
  applicationQualifier: string;
}

export class ProcessingStack extends cdk.Stack {
  public readonly webSocketApi: apigatewayv2.WebSocketApi;
  public readonly connectionsTable: dynamodb.Table;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    // DynamoDB table for WebSocket connections
    this.connectionsTable = new dynamodb.Table(this, 'WebSocketConnections', {
      tableName: `${props.applicationQualifier}-websocket-connections`,
      partitionKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      timeToLiveAttribute: 'ttl',
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
    });

    const processingLambda = new lambda.DockerImageFunction(this, 'codeGenerator', {
      functionName: `${props.applicationQualifier}-code-generator`,
      code: lambda.DockerImageCode.fromImageAsset('src/lambda-functions/code-generator'),
      memorySize: 1024,
      timeout: cdk.Duration.minutes(15),
      environment: {
        RESULTS_BUCKET_NAME: props.codeOutputBucket.bucketName,
        REGION: this.region,
        A2CAI_PROMPTS: 'a2cai_prompts.yaml',
        MODEL_NAME: 'model_name.yaml',
        STACK_GENERATION_PROMPTS: 'stack_gen_prompts.yaml',
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
          resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:A2C_API_KEY*`],
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

    //SNS topic for notifying downstream users of processing step function completion
    const snsTopic = new sns.Topic(this, 'A2CAITopic', {
      displayName: `${props.applicationQualifier}-topic`,
      topicName: `${props.applicationQualifier}-topic`,
    });

    // Subscribe recipient email addresses to the SNS topic
    props.recipientEmailAddresses.forEach((email) => {
      snsTopic.addSubscription(
        new subscriptions.EmailSubscription(email, {
          json: false,
        }),
      );
    });

    snsTopic.grantPublish(processingLambda);

    const stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      stateMachineName: `${props.applicationQualifier}-Processing`,
      definition: lambdaProcessingTask
        .next(new tasks.SnsPublish(this, 'NotificationStep', {
          topic: snsTopic,
          message: sfn.TaskInput.fromText(sfn.JsonPath.stringAt('$.Payload.presigned_url')),
        })),
    });

    if (props.responderLambda) {
      stateMachine.grantStartExecution(props.responderLambda);
    }

    // WebSocket Lambda functions
    const connectHandler = new lambda.Function(this, 'WebSocketConnect', {
      functionName: `${props.applicationQualifier}-websocket-connect`,
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'connect.handler',
      code: lambda.Code.fromAsset('src/lambda-functions/websocket-handler'),
      environment: {
        CONNECTIONS_TABLE: this.connectionsTable.tableName,
      },
    });

    const disconnectHandler = new lambda.Function(this, 'WebSocketDisconnect', {
      functionName: `${props.applicationQualifier}-websocket-disconnect`,
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'disconnect.handler',
      code: lambda.Code.fromAsset('src/lambda-functions/websocket-handler'),
      environment: {
        CONNECTIONS_TABLE: this.connectionsTable.tableName,
      },
    });

    const messageHandler = new lambda.Function(this, 'WebSocketMessage', {
      functionName: `${props.applicationQualifier}-websocket-message`,
      runtime: lambda.Runtime.PYTHON_3_11,
      handler: 'message.handler',
      code: lambda.Code.fromAsset('src/lambda-functions/websocket-handler'),
      timeout: cdk.Duration.minutes(15),
      memorySize: 1024,
      environment: {
        CONNECTIONS_TABLE: this.connectionsTable.tableName,
        REGION: this.region,
      },
      initialPolicy: [
        new iam.PolicyStatement({
          actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
          resources: ['*'],
        }),
        new iam.PolicyStatement({
          actions: ['secretsmanager:GetSecretValue'],
          resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:A2C_API_KEY*`],
        }),
      ],
    });

    // Grant DynamoDB permissions
    this.connectionsTable.grantReadWriteData(connectHandler);
    this.connectionsTable.grantReadWriteData(disconnectHandler);
    this.connectionsTable.grantReadWriteData(messageHandler);

    // WebSocket API Gateway
    this.webSocketApi = new apigatewayv2.WebSocketApi(this, 'WebSocketApi', {
      apiName: `${props.applicationQualifier}-websocket-api`,
      connectRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration('ConnectIntegration', connectHandler),
        authorizer: undefined, // Allow unauthenticated connections
      },
      disconnectRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration('DisconnectIntegration', disconnectHandler),
      },
      defaultRouteOptions: {
        integration: new integrations.WebSocketLambdaIntegration('MessageIntegration', messageHandler),
      },
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

    // Output WebSocket URL
    new cdk.CfnOutput(this, 'WebSocketUrl', {
      value: stage.url,
      description: 'WebSocket API URL',
    });
  }
}