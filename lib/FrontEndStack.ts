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
  applicationQualifier: string;
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

    // ===== Lambda for /api =====
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
    this.responderLambda.addPermission('AllowALBInvocation', {
      principal: new iam.ServicePrincipal('elasticloadbalancing.amazonaws.com'),
      action: 'lambda:InvokeFunction',
    });

    // ===== ECS: Docker Asset, Cluster, ALB =====
    const asset = new ecr_assets.DockerImageAsset(this, `${props.applicationQualifier}_DockerAsset`, {
      directory: './src/ecs',
      platform: ecr_assets.Platform.LINUX_AMD64,
    });

    this.cluster = new ecs.Cluster(this, `${props.applicationQualifier}-cluster`, {
      clusterName: `${props.applicationQualifier}-ECS-Cluster`,
      containerInsights: true,
    });

    // ==== ALB + Fargate ====
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

    // Create custom security group for ALB that only allows CloudFront traffic
    const albSecurityGroup = new ec2.SecurityGroup(this, 'ALBSecurityGroup', {
      vpc: this.cluster.vpc,
      description: 'Security group for ALB - CloudFront access only',
      allowAllOutbound: true
    });

    // Use AWS managed prefix list for CloudFront IP ranges
    albSecurityGroup.addIngressRule(
      ec2.Peer.prefixList('pl-82a045eb'), // AWS managed CloudFront prefix list for us-west-2
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
    const lambdaTargetGroup = new elbv2.ApplicationTargetGroup(this, 'LambdaTargetGroup', {
      targetType: elbv2.TargetType.LAMBDA,
      vpc: this.cluster.vpc,
      targets: [new targets.LambdaTarget(this.responderLambda)]
    });
    const cfnTargetGroup = lambdaTargetGroup.node.defaultChild as elbv2.CfnTargetGroup;
    cfnTargetGroup.targetGroupAttributes = [
      {
        key: 'lambda.multi_value_headers.enabled',
        value: 'true'
      }
    ];

    // Basic Routing rules (for demo; production, move routing primarily to CloudFront!)
    this.service.listener.addAction('RootPath', {
      action: elbv2.ListenerAction.forward([this.service.targetGroup]),
      conditions: [elbv2.ListenerCondition.pathPatterns(['/'])],
      priority: 1
    });
    this.service.listener.addAction('LambdaInvoke', {
      action: elbv2.ListenerAction.forward([lambdaTargetGroup]),
      conditions: [elbv2.ListenerCondition.pathPatterns(['/api', '/api/*']), elbv2.ListenerCondition.httpRequestMethods(['POST'])],
      priority: 2
    });
    this.service.listener.addAction('StaticContent', {
      action: elbv2.ListenerAction.forward([this.service.targetGroup]),
      conditions: [elbv2.ListenerCondition.pathPatterns(['/*'])],
      priority: 3
    });

    // ===== Lambda@Edge ====
    const viewerRequestEdgeLambda = new cloudfront.experimental.EdgeFunction(this, "CloudFrontAuthEdge", {
      code: lambda.Code.fromAsset(path.join(__dirname, '../src/lambda-functions/edge-lambda')),
      handler: "index.handler",
      runtime: lambda.Runtime.NODEJS_20_X,
      functionName: `${props.applicationQualifier}-cloudfront-auth`,
      description: "CloudFront Lambda@Edge for Cognito authentication",
      initialPolicy: [
          new iam.PolicyStatement({
              sid: "Secrets",
              effect: iam.Effect.ALLOW,
              actions: ["secretsmanager:GetSecretValue"],
              resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:cognitoClientSecrets-frontend*`]
          })
      ]
    });

    // ===== CloudFront Distribution pointing to ALB, auth via Edge Lambda =====
    this.cloudFrontDistribution = new cloudfront.Distribution(this, "CloudFrontDistribution", {
      defaultBehavior: {
        origin: new origins.LoadBalancerV2Origin(this.service.loadBalancer, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY
        }),
        edgeLambdas: [{
          eventType: cloudfront.LambdaEdgeEventType.VIEWER_REQUEST,
          functionVersion: viewerRequestEdgeLambda.currentVersion,
        }],
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        originRequestPolicy: cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN,
        compress: true,
      },
      additionalBehaviors: {
        '/static/*': {
          origin: new origins.LoadBalancerV2Origin(this.service.loadBalancer, {
            protocolPolicy: cloudfront.OriginProtocolPolicy.HTTP_ONLY
          }),
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          originRequestPolicy: cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN,
          compress: true,
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
      comment: `${props.applicationQualifier}-frontend-cloudfront`,
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
        domainPrefix: `${props.applicationQualifier}-auth-${this.account.substring(0, 8)}`
      }
    });
    // Save Cognito settings as Secrets for access by Lambda@Edge/CloudFront auth Lambda
    new secretsmanager.Secret(this, 'CognitoClientSecrets', {
      secretName: "cognitoClientSecrets-frontend",
      secretObjectValue: {
        Region: cdk.SecretValue.unsafePlainText(this.region),
        UserPoolID: cdk.SecretValue.unsafePlainText(this.userPool.userPoolId),
        UserPoolAppId: cdk.SecretValue.unsafePlainText(this.userPoolClient.userPoolClientId),
        DomainName: cdk.SecretValue.unsafePlainText(`${this.userPoolDomain.domainName}.auth.${this.region}.amazoncognito.com`),
        RedirectPathSignIn: cdk.SecretValue.unsafePlainText('/'),
        RedirectPathSignOut: cdk.SecretValue.unsafePlainText('/'),
        RedirectPathAuthRefresh: cdk.SecretValue.unsafePlainText('/'),
      }
    });

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
  }
}
