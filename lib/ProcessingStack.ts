import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';

import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';

interface Props extends cdk.StackProps {
  diagramStorageBucket: cdk.aws_s3.Bucket;
  codeOutputBucket: cdk.aws_s3.Bucket;
  synthesisProgressTable: cdk.aws_dynamodb.Table;
}

export class ProcessingStack extends cdk.Stack {
  public readonly streamingLambda: lambda.Function;
  public readonly streamingFunctionUrl: lambda.FunctionUrl;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    // Streaming Lambda function for REST API response streaming
    // Uses Node.js 20.x runtime (required for awslambda.streamifyResponse)
    this.streamingLambda = new lambda.Function(this, 'StreamingHandler', {
      functionName: `a2a-streaming-handler`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'dist/index.handler',
      code: lambda.Code.fromAsset('src/lambda-functions/streaming-handler'),
      memorySize: 1024,
      timeout: cdk.Duration.minutes(15),
      environment: {
        DIAGRAM_BUCKET: props.diagramStorageBucket.bucketName,
        REGION: this.region,
      },
      initialPolicy: [
        // S3 permissions for reading diagram images
        new iam.PolicyStatement({
          actions: ['s3:GetObject'],
          resources: [
            props.diagramStorageBucket.bucketArn,
            `${props.diagramStorageBucket.bucketArn}/*`,
          ],
        }),
        // Bedrock permissions for model invocation with streaming
        new iam.PolicyStatement({
          actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
          resources: ['*'],
        }),
        // Secrets Manager permissions for Perplexity API key
        new iam.PolicyStatement({
          actions: ['secretsmanager:GetSecretValue'],
          resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:A2A_API_KEY*`],
        }),
      ],
    });

    // Create Lambda Function URL with response streaming enabled
    // Using AWS_IAM auth - CloudFront will sign requests using OAC
    this.streamingFunctionUrl = this.streamingLambda.addFunctionUrl({
      authType: lambda.FunctionUrlAuthType.AWS_IAM,
      invokeMode: lambda.InvokeMode.RESPONSE_STREAM,
    });

    // CloudFront OAC requires both InvokeFunctionUrl (added by CDK FunctionUrlOrigin)
    // and InvokeFunction permissions. Adding InvokeFunction here to avoid circular dependency.
    this.streamingLambda.addPermission('AllowCloudFrontInvokeFunction', {
      principal: new iam.ServicePrincipal('cloudfront.amazonaws.com'),
      action: 'lambda:InvokeFunction',
      sourceArn: `arn:aws:cloudfront::${this.account}:distribution/*`,
    });

    const processingLambda = new lambda.DockerImageFunction(this, 'codeGenerator', {
      functionName: `a2a-code-generator`,
      code: lambda.DockerImageCode.fromImageAsset('src/lambda-functions/code-generator'),
      memorySize: 1024,
      timeout: cdk.Duration.minutes(15),
      environment: {
        RESULTS_BUCKET_NAME: props.codeOutputBucket.bucketName,
        SYNTHESIS_PROGRESS_TABLE: props.synthesisProgressTable.tableName,
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
          resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:A2A_API_KEY*`],
        }),
        new iam.PolicyStatement({
          actions: ['dynamodb:PutItem', 'dynamodb:UpdateItem'],
          resources: [props.synthesisProgressTable.tableArn],
        }),
      ],
    });

    const lambdaProcessingTask = new tasks.LambdaInvoke(this, 'Processing', {
      lambdaFunction: processingLambda,
      inputPath: '$',
    });



    const stateMachine = new sfn.StateMachine(this, 'StateMachine', {
      stateMachineName: `A2A-Processing`,
      definition: lambdaProcessingTask,
    });

    // Output Streaming Lambda ARN for FrontEndStack
    new cdk.CfnOutput(this, 'StreamingLambdaArn', {
      value: this.streamingLambda.functionArn,
      description: 'Streaming Lambda Function ARN',
    });

    // Output Streaming Function URL for direct access with response streaming
    new cdk.CfnOutput(this, 'StreamingFunctionUrl', {
      value: this.streamingFunctionUrl.url,
      description: 'Streaming Lambda Function URL (supports response streaming)',
    });
  }
}