import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import * as tasks from 'aws-cdk-lib/aws-stepfunctions-tasks';
import { Construct } from 'constructs';

interface Props extends cdk.StackProps {
  recipientEmailAddresses: string[];
  diagramStorageBucket: cdk.aws_s3.Bucket;
  codeOutputBucket: cdk.aws_s3.Bucket;
  responderLambda: lambda.Function;
  applicationQualifier: string;
}

export class ProcessingStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

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

    stateMachine.grantStartExecution(props.responderLambda);
  }
}