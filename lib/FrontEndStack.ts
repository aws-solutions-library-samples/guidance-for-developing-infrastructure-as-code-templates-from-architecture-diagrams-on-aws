import * as path from 'path';
import { Construct } from 'constructs';
import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as ecr_assets from 'aws-cdk-lib/aws-ecr-assets';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as targets from 'aws-cdk-lib/aws-elasticloadbalancingv2-targets';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';

interface Props extends cdk.StackProps {
  diagramStorageBucket: s3.Bucket;
  streamingLambda?: lambda.IFunction;
  streamingFunctionUrl?: lambda.FunctionUrl;
  synthesisProgressTable: cdk.aws_dynamodb.Table;
}

export class FrontEndStack extends cdk.Stack {
  public readonly cluster: ecs.Cluster;
  public readonly service: ecs_patterns.ApplicationLoadBalancedFargateService;
  public readonly responderLambda: lambda.Function;
  public readonly cloudFrontDistribution: cloudfront.Distribution;
  public readonly userPool: cognito.UserPool;
  public readonly userPoolClient: cognito.UserPoolClient;
  public readonly userPoolDomain: cognito.UserPoolDomain;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    // ===== Lambda for presigned URLs =====
    this.responderLambda = new lambda.Function(this, 'presignedUrlHandler', {
      functionName: `a2a-presigned-url`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('src/lambda-functions/presigned-url'),
      timeout: cdk.Duration.minutes(5),
      environment: {
        ACCOUNT_ID: this.account,
        REGION: this.region,
      },
      initialPolicy: [
        new iam.PolicyStatement({
          actions: ['s3:PutObject'],
          resources: [`${props.diagramStorageBucket.bucketArn}/*`],
        }),
      ],
    });
    // ALB permission will be added after target group is created

    // ===== Lambda for Step Function invocation =====
    const stepFunctionInvoker = new lambda.Function(this, 'stepFunctionInvoker', {
      functionName: `a2a-step-function-invoker`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('src/lambda-functions/step-function-invoker'),
      timeout: cdk.Duration.minutes(5),
      environment: {
        ACCOUNT_ID: this.account,
        REGION: this.region,
      },
      initialPolicy: [
        new iam.PolicyStatement({
          actions: ['states:StartExecution'],
          resources: [`arn:aws:states:${this.region}:${this.account}:stateMachine:A2A-Processing`],
        }),
      ],
    });
    // ALB permission will be added after target group is created

    // ===== Lambda for synthesis status polling =====
    const synthesisStatusLambda = new lambda.Function(this, 'synthesisStatusHandler', {
      functionName: `a2a-synthesis-status`,
      runtime: lambda.Runtime.PYTHON_3_12,
      handler: 'handler.handler',
      code: lambda.Code.fromAsset('src/lambda-functions/synthesis-status'),
      timeout: cdk.Duration.seconds(30),
      environment: {
        REGION: this.region,
        SYNTHESIS_PROGRESS_TABLE: props.synthesisProgressTable.tableName,
      },
      initialPolicy: [
        new iam.PolicyStatement({
          actions: ['dynamodb:GetItem'],
          resources: [props.synthesisProgressTable.tableArn],
        }),
      ],
    });

    // ===== ECS: Docker Asset, Cluster, ALB =====
    const asset = new ecr_assets.DockerImageAsset(this, `DockerAsset`, {
      directory: './src/ecs',
      platform: ecr_assets.Platform.LINUX_AMD64,
    });

    this.cluster = new ecs.Cluster(this, `cluster`, {
      clusterName: `A2A-ECS-Cluster`,
      containerInsights: true,
    });

    // ==== ALB + Fargate ====
    this.service = new ecs_patterns.ApplicationLoadBalancedFargateService(this,
      `ALB-fargate-service`, {
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

    // Custom security group for ALB that only allows CloudFront traffic
    const albSecurityGroup = new ec2.SecurityGroup(this, 'ALBSecurityGroup', {
      vpc: this.cluster.vpc,
      description: 'Security group for ALB - CloudFront access only',
      allowAllOutbound: true
    });

    // Use AWS managed prefix list for CloudFront IP ranges (region-specific)
    // us-west-2: pl-82a045eb
    // us-east-1: pl-3b927c52
    // eu-central-1: pl-a3a144ca
    // ap-northeast-1: pl-58a04531
    // ap-southeast-1: pl-31a34658
    albSecurityGroup.addIngressRule(
      ec2.Peer.prefixList('pl-82a045eb'), // us-west-2 AWS managed CloudFront prefix list
      ec2.Port.tcp(80),
      'Allow CloudFront HTTP traffic'
    );

    // Allow ALB to reach ECS tasks for health checks
    const ecsSecurityGroup = this.service.service.connections.securityGroups[0];
    ecsSecurityGroup.addIngressRule(
      ec2.Peer.securityGroupId(albSecurityGroup.securityGroupId),
      ec2.Port.tcp(80),
      'Allow ALB health checks to ECS tasks'
    );

    // Replace the default security group
    const cfnLoadBalancer = this.service.loadBalancer.node.defaultChild as elbv2.CfnLoadBalancer;
    cfnLoadBalancer.securityGroups = [albSecurityGroup.securityGroupId];

    // Forward /api requests to Lambda, static to Fargate
    const presignedUrlTargetGroup = new elbv2.ApplicationTargetGroup(this, 'PresignedUrlTargetGroup', {
      targetType: elbv2.TargetType.LAMBDA,
      vpc: this.cluster.vpc,
      targets: [new targets.LambdaTarget(this.responderLambda)]
    });
    const cfnPresignedTargetGroup = presignedUrlTargetGroup.node.defaultChild as elbv2.CfnTargetGroup;
    cfnPresignedTargetGroup.targetGroupAttributes = [
      {
        key: 'lambda.multi_value_headers.enabled',
        value: 'true'
      }
    ];
    // Note: LambdaTarget automatically grants invoke permission
    // The permission is scoped to elasticloadbalancing.amazonaws.com service principal

    const stepFunctionTargetGroup = new elbv2.ApplicationTargetGroup(this, 'StepFunctionTargetGroup', {
      targetType: elbv2.TargetType.LAMBDA,
      vpc: this.cluster.vpc,
      targets: [new targets.LambdaTarget(stepFunctionInvoker)]
    });
    const cfnStepFunctionTargetGroup = stepFunctionTargetGroup.node.defaultChild as elbv2.CfnTargetGroup;
    cfnStepFunctionTargetGroup.targetGroupAttributes = [
      {
        key: 'lambda.multi_value_headers.enabled',
        value: 'true'
      }
    ];
    // Note: LambdaTarget automatically grants invoke permission

    // ===== Synthesis Status Target Group =====
    const synthesisStatusTargetGroup = new elbv2.ApplicationTargetGroup(this, 'SynthesisStatusTargetGroup', {
      targetType: elbv2.TargetType.LAMBDA,
      vpc: this.cluster.vpc,
      targets: [new targets.LambdaTarget(synthesisStatusLambda)]
    });
    const cfnSynthesisStatusTargetGroup = synthesisStatusTargetGroup.node.defaultChild as elbv2.CfnTargetGroup;
    cfnSynthesisStatusTargetGroup.targetGroupAttributes = [
      { key: 'lambda.multi_value_headers.enabled', value: 'true' }
    ];

    // ===== Streaming Lambda Target Group =====
    // Create target group for streaming Lambda if provided
    let streamingTargetGroup: elbv2.ApplicationTargetGroup | undefined;
    if (props.streamingLambda) {
      streamingTargetGroup = new elbv2.ApplicationTargetGroup(this, 'StreamingLambdaTargetGroup', {
        targetType: elbv2.TargetType.LAMBDA,
        vpc: this.cluster.vpc,
        targets: [new targets.LambdaTarget(props.streamingLambda)]
      });

      // Enable multi-value headers for Lambda integration
      const cfnStreamingTargetGroup = streamingTargetGroup.node.defaultChild as elbv2.CfnTargetGroup;
      cfnStreamingTargetGroup.targetGroupAttributes = [
        {
          key: 'lambda.multi_value_headers.enabled',
          value: 'true'
        }
      ];

      // Note: ALB permission for streaming Lambda is granted in ProcessingStack
      // to avoid circular dependency between stacks
    }

    // Basic Routing rules (for demo; production, move routing primarily to CloudFront!)
    this.service.listener.addAction('RootPath', {
      action: elbv2.ListenerAction.forward([this.service.targetGroup]),
      conditions: [elbv2.ListenerCondition.pathPatterns(['/'])],
      priority: 1
    });
    this.service.listener.addAction('PresignedUrlRoute', {
      action: elbv2.ListenerAction.forward([presignedUrlTargetGroup]),
      conditions: [elbv2.ListenerCondition.pathPatterns(['/api/presigned-url']), elbv2.ListenerCondition.httpRequestMethods(['POST', 'OPTIONS'])],
      priority: 2
    });
    this.service.listener.addAction('StepFunctionRoute', {
      action: elbv2.ListenerAction.forward([stepFunctionTargetGroup]),
      conditions: [elbv2.ListenerCondition.pathPatterns(['/api/step-function']), elbv2.ListenerCondition.httpRequestMethods(['POST', 'OPTIONS'])],
      priority: 3
    });
    this.service.listener.addAction('SynthesisStatusRoute', {
      action: elbv2.ListenerAction.forward([synthesisStatusTargetGroup]),
      conditions: [elbv2.ListenerCondition.pathPatterns(['/api/synthesis-status']), elbv2.ListenerCondition.httpRequestMethods(['POST', 'OPTIONS'])],
      priority: 4
    });

    // Add streaming endpoint routes if streaming Lambda is configured
    // These must have lower priority numbers than StaticContent to be evaluated first
    if (streamingTargetGroup) {
      this.service.listener.addAction('StreamAnalyzeRoute', {
        action: elbv2.ListenerAction.forward([streamingTargetGroup]),
        conditions: [elbv2.ListenerCondition.pathPatterns(['/api/stream/analyze']), elbv2.ListenerCondition.httpRequestMethods(['POST', 'OPTIONS'])],
        priority: 5
      });
      this.service.listener.addAction('StreamOptimizeRoute', {
        action: elbv2.ListenerAction.forward([streamingTargetGroup]),
        conditions: [elbv2.ListenerCondition.pathPatterns(['/api/stream/optimize']), elbv2.ListenerCondition.httpRequestMethods(['POST', 'OPTIONS'])],
        priority: 6
      });
      this.service.listener.addAction('StreamCdkModulesRoute', {
        action: elbv2.ListenerAction.forward([streamingTargetGroup]),
        conditions: [elbv2.ListenerCondition.pathPatterns(['/api/stream/cdk-modules']), elbv2.ListenerCondition.httpRequestMethods(['POST', 'OPTIONS'])],
        priority: 7
      });
    }

    // Static content catch-all - must have highest priority number (lowest precedence)
    this.service.listener.addAction('StaticContent', {
      action: elbv2.ListenerAction.forward([this.service.targetGroup]),
      conditions: [elbv2.ListenerCondition.pathPatterns(['/*'])],
      priority: 100
    });

    // ===== Lambda@Edge ====
    const viewerRequestEdgeLambda = new cloudfront.experimental.EdgeFunction(this, "CloudFrontAuthEdge", {
      code: lambda.Code.fromAsset(path.join(__dirname, '../src/lambda-functions/edge-lambda')),
      handler: "index.handler",
      runtime: lambda.Runtime.NODEJS_22_X,
      functionName: `a2a-cloudfront-auth`,
      description: "CloudFront Lambda@Edge for Cognito authentication",
      initialPolicy: [
          new iam.PolicyStatement({
              sid: "Secrets",
              effect: iam.Effect.ALLOW,
              actions: ["secretsmanager:GetSecretValue"],
              resources: [
                `arn:aws:secretsmanager:us-east-1:${this.account}:secret:a2a-cognitoClientSecrets-frontend*`,
                `arn:aws:secretsmanager:${this.region}:${this.account}:secret:a2a-cognitoClientSecrets-frontend*`
              ]
          })
      ]
    });

    // ===== Lambda Function URL Origin for streaming =====
    // Create origin for Lambda Function URL with OAC (Origin Access Control)
    // Uses CDK's built-in FunctionUrlOrigin.withOriginAccessControl for proper OAC setup
    let streamingLambdaOrigin: cloudfront.IOrigin | undefined;
    if (props.streamingFunctionUrl && props.streamingLambda) {
      streamingLambdaOrigin = origins.FunctionUrlOrigin.withOriginAccessControl(props.streamingFunctionUrl, {
        originAccessControl: new cloudfront.FunctionUrlOriginAccessControl(this, 'StreamingLambdaOAC', {
          originAccessControlName: 'a2a-streaming-lambda-oac-v2',
          signing: cloudfront.Signing.SIGV4_ALWAYS,
        }),
        readTimeout: cdk.Duration.seconds(60),
        originId: 'streaming-lambda-origin',
      });
    }
    // ===== CloudFront Distribution pointing to ALB, auth via Edge Lambda =====
    
    // CloudFront function to handle CORS OPTIONS requests
    const corsFunction = new cloudfront.Function(this, 'CorsFunction', {
      functionName: `a2a-cors-function`,
      code: cloudfront.FunctionCode.fromFile({
        filePath: path.join(__dirname, '../src/lambda-functions/cors-function/index.js')
      }),
    });

    // Create ALB origin with extended timeout for streaming endpoints
    // CloudFront origin readTimeout default max is 60 seconds (can request quota increase to 180s)
    // For longer streaming operations, the Lambda will keep the connection alive with periodic heartbeats
    const streamingAlbOrigin = new origins.LoadBalancerV2Origin(this.service.loadBalancer, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
      readTimeout: cdk.Duration.seconds(60)
    });

    this.cloudFrontDistribution = new cloudfront.Distribution(this, "CloudFrontDistribution", {
      defaultBehavior: {
        origin: new origins.LoadBalancerV2Origin(this.service.loadBalancer, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
          readTimeout: cdk.Duration.seconds(60)
        }),
        edgeLambdas: [{
          eventType: cloudfront.LambdaEdgeEventType.VIEWER_REQUEST,
          functionVersion: viewerRequestEdgeLambda.currentVersion,
        }],
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
        compress: false,
      },
      additionalBehaviors: {
        // Streaming endpoints behavior - uses Lambda Function URL with OAC
        '/api/stream/*': {
          origin: streamingLambdaOrigin || streamingAlbOrigin,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          // Must NOT forward Host header - OAC signs with the origin's host
          // ALL_VIEWER_EXCEPT_HOST_HEADER forwards all viewer headers except Host
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
          responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS,
          functionAssociations: [{
            function: corsFunction,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          }],
          compress: false,
        },
        '/api/*': {
          origin: new origins.LoadBalancerV2Origin(this.service.loadBalancer, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY,
            readTimeout: cdk.Duration.seconds(60)
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
          cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER,
          responseHeadersPolicy: cloudfront.ResponseHeadersPolicy.CORS_ALLOW_ALL_ORIGINS,
          functionAssociations: [{
            function: corsFunction,
            eventType: cloudfront.FunctionEventType.VIEWER_REQUEST,
          }],
          compress: false,
        }
      },
      errorResponses: [
        {
          httpStatus: 403,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        },
        {
          httpStatus: 404,
          responseHttpStatus: 200,
          responsePagePath: '/index.html',
        }
      ],
      minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
      comment: `a2a-frontend-cloudfront`,
      enableLogging: false,
    });

    // ===== Cognito (User Pool, Client, Domain) =====
    this.userPool = new cognito.UserPool(this, "UserPool", {
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      passwordPolicy: {
        minLength: 8,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: true,
      },
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Use RETAIN in prod!
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
    });
    this.userPoolClient = this.userPool.addClient("UserPoolClient", {
      generateSecret: false,
      authFlows: {
        userPassword: true,
        userSrp: true,
        adminUserPassword: true,
      },
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
          implicitCodeGrant: true
        },
        scopes: [
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.PROFILE,
        ],
        callbackUrls: [
          `https://${this.cloudFrontDistribution.distributionDomainName}`,
          `https://${this.cloudFrontDistribution.distributionDomainName}/`
        ],
        logoutUrls: [`https://${this.cloudFrontDistribution.distributionDomainName}`]
      },
    });
    this.userPoolDomain = this.userPool.addDomain('UserPoolDomain', {
      cognitoDomain: {
        domainPrefix: `a2a-auth-${this.account.substring(0, 8)}`
      }
    });
    // Save Cognito settings as Secrets for access by Lambda@Edge/CloudFront auth Lambda
    const cognitoSecret = new secretsmanager.Secret(this, 'CognitoClientSecrets', {
      secretName: "a2a-cognitoClientSecrets-frontend",
      secretObjectValue: {
        Region: cdk.SecretValue.unsafePlainText(this.region),
        UserPoolID: cdk.SecretValue.unsafePlainText(this.userPool.userPoolId),
        UserPoolAppId: cdk.SecretValue.unsafePlainText(this.userPoolClient.userPoolClientId),
        DomainName: cdk.SecretValue.unsafePlainText(`${this.userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`),
      },
      // Only replicate to us-east-1 if we're not already deploying there (Lambda@Edge requirement)
      ...(this.region !== 'us-east-1' && {
        replicaRegions: [{
          region: 'us-east-1',
          encryptionKey: undefined
        }]
      })
    });

    // Add streaming API URL as environment variable for ECS
    // Route through CloudFront for authentication (Lambda@Edge) and OAC signing
    this.service.taskDefinition.defaultContainer?.addEnvironment(
      'REACT_APP_STREAMING_API_URL',
      `https://${this.cloudFrontDistribution.distributionDomainName}/api/stream`
    );
    
    // Add AWS account ID and region for S3 bucket name construction
    this.service.taskDefinition.defaultContainer?.addEnvironment('AWS_ACCOUNT_ID', this.account);
    this.service.taskDefinition.defaultContainer?.addEnvironment('AWS_REGION', this.region);

    // Set ALLOWED_ORIGIN for CORS on all Lambdas (restricts Access-Control-Allow-Origin)
    const allowedOrigin = `https://${this.cloudFrontDistribution.distributionDomainName}`;
    this.responderLambda.addEnvironment('ALLOWED_ORIGIN', allowedOrigin);
    stepFunctionInvoker.addEnvironment('ALLOWED_ORIGIN', allowedOrigin);
    synthesisStatusLambda.addEnvironment('ALLOWED_ORIGIN', allowedOrigin);

    // Update the streaming Lambda's ALLOWED_ORIGIN env var using a custom resource
    // This avoids a circular dependency between ProcessingStack and FrontEndStack
    if (props.streamingLambda) {
      new cdk.custom_resources.AwsCustomResource(this, 'UpdateStreamingLambdaOrigin', {
        onUpdate: {
          service: 'Lambda',
          action: 'updateFunctionConfiguration',
          parameters: {
            FunctionName: props.streamingLambda.functionName,
            Environment: {
              Variables: {
                DIAGRAM_BUCKET: props.diagramStorageBucket.bucketName,
                REGION: this.region,
                ALLOWED_ORIGIN: allowedOrigin,
              },
            },
          },
          physicalResourceId: cdk.custom_resources.PhysicalResourceId.of('streaming-lambda-origin-update'),
        },
        policy: cdk.custom_resources.AwsCustomResourcePolicy.fromStatements([
          new iam.PolicyStatement({
            actions: ['lambda:UpdateFunctionConfiguration'],
            resources: [props.streamingLambda.functionArn],
          }),
        ]),
      });
    }

    // ===== Output URLs and UserPool IDs =====
    new cdk.CfnOutput(this, 'CloudFrontUrl', {
      value: `https://${this.cloudFrontDistribution.distributionDomainName}`,
      description: 'The CloudFront distribution URL'
    });
    new cdk.CfnOutput(this, 'CognitoUserPoolId', {
      value: this.userPool.userPoolId,
    });
    new cdk.CfnOutput(this, 'CognitoUserPoolClientId', {
      value: this.userPoolClient.userPoolClientId,
    });
    new cdk.CfnOutput(this, 'CognitoUserPoolDomain', {
      value: `${this.userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`,
    });
    new cdk.CfnOutput(this, 'StreamingApiUrl', {
      value: `https://${this.cloudFrontDistribution.distributionDomainName}/api/stream`,
      description: 'Streaming API URL (routed through CloudFront with auth)',
    });
  }
}
