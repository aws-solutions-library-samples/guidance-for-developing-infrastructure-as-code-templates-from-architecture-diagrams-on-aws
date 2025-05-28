import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
import * as logs from 'aws-cdk-lib/aws-logs';
import {Construct} from 'constructs';

interface Props extends cdk.StackProps {
  diagramStorageBucket: cdk.aws_s3.Bucket;
  applicationQualifier: string;
}

export class FrontEndStack extends cdk.Stack {
    public readonly cluster: ecs.Cluster;
    public readonly service: ecs_patterns.ApplicationLoadBalancedFargateService;
    public readonly responderLambda: lambda.Function;

    constructor(scope: Construct, id: string, props: Props) {
        super(scope, id, props);

        this.responderLambda = new lambda.DockerImageFunction(this, 'webResponder', {
          functionName: `${props.applicationQualifier}-web-responder`,
          code: lambda.DockerImageCode.fromImageAsset('src/lambda-functions/web-responder'),
          memorySize: 1024,
          timeout: cdk.Duration.minutes(10),
          environment: {
            ACCOUNT_ID: this.account,
            REGION: this.region,
            CDK_QUALIFIER: props.applicationQualifier,
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
                `${props.diagramStorageBucket.bucketArn}/*`
              ],
            }),
            new iam.PolicyStatement({
                actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
                resources: ['*'],
            }),
          ],
        });

        // Add permission for ALB to invoke Lambda
        this.responderLambda.addPermission('AllowALBInvocation', {
          principal: new iam.ServicePrincipal('elasticloadbalancing.amazonaws.com'),
          action: 'lambda:InvokeFunction'
        });

        const asset = new ecr_assets.DockerImageAsset(this, `${props.applicationQualifier}_DockerAsset`, {
            directory: './src/ecs',
            platform: ecr_assets.Platform.LINUX_AMD64,
        });

        this.cluster = new ecs.Cluster(this, `${props.applicationQualifier}-cluster`, {
            clusterName: `${props.applicationQualifier}-ECS-Cluster`,
            containerInsights: true,
        });

        // Create ALB
        this.service = new ecs_patterns.ApplicationLoadBalancedFargateService(this,
            `${props.applicationQualifier}-ALB-fargate-service`, {
                cluster: this.cluster,
                cpu: 512,
                memoryLimitMiB: 1024,
                desiredCount: 1,
                taskImageOptions: {
                    image: ecs.ContainerImage.fromDockerImageAsset(asset),
                    containerPort: 80,
                    logDriver: ecs.LogDrivers.awsLogs({
                        streamPrefix: 'ecs',
                        logRetention: logs.RetentionDays.ONE_MONTH,
                    })
                },
                publicLoadBalancer: true,
                protocol: elbv2.ApplicationProtocol.HTTP
            });
        
        // Add Lambda integration target
        const lambdaTarget = new targets.LambdaTarget(this.responderLambda);

        const lambdaTargetGroup = new elbv2.ApplicationTargetGroup(this, 'LambdaTargetGroup', {
          targetType: elbv2.TargetType.LAMBDA,
          vpc: this.cluster.vpc,
          targets: [new targets.LambdaTarget(this.responderLambda)]
        });

        // Enable multi-value headers
        const cfnTargetGroup = lambdaTargetGroup.node.defaultChild as elbv2.CfnTargetGroup;
        cfnTargetGroup.targetGroupAttributes = [
          {
            key: 'lambda.multi_value_headers.enabled',
            value: 'true'
          }
        ];

        // Add CORS configuration
        const corsResponseHeaders = [
          { key: 'Access-Control-Allow-Origin', value: '*' }, // Replace '*' with your specific origin if needed
          { key: 'Access-Control-Allow-Headers', value: 'Content-Type,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token' },
          { key: 'Access-Control-Allow-Methods', value: 'OPTIONS,POST,GET' },
        ];

        corsResponseHeaders.forEach((header, index) => {
          new elbv2.ApplicationListenerRule(this, `CorsRule${index}`, {
            listener: this.service.listener,
            priority: 10 + index,
            conditions: [elbv2.ListenerCondition.httpHeader(header.key, [header.value])],
            action: elbv2.ListenerAction.fixedResponse(200, {
              messageBody: '',
              contentType: 'text/plain'
            }),
          });
        });

        // Add root path routing without authentication
        this.service.listener.addAction('RootPath', {
          action: elbv2.ListenerAction.forward([this.service.targetGroup]),
          conditions: [
            elbv2.ListenerCondition.pathPatterns(['/'])
          ],
          priority: 1
        });

        // Add Lambda invocation path for all other paths
        this.service.listener.addAction('LambdaInvoke', {
          action: elbv2.ListenerAction.forward([lambdaTargetGroup]),
          conditions: [
            elbv2.ListenerCondition.pathPatterns(['/api', '/api/*']),
            elbv2.ListenerCondition.httpRequestMethods(['POST']),
          ],
          priority: 2
        });

        // Static content routing (priority 3)
        this.service.listener.addAction('StaticContent', {
        action: elbv2.ListenerAction.forward([this.service.targetGroup]),
        conditions: [
            elbv2.ListenerCondition.pathPatterns(['/*'])
          ],
          priority: 3
        });

    }
}
   