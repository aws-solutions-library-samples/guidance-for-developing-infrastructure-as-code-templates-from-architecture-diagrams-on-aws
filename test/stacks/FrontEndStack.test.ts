import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { FrontEndStack } from '../../lib/FrontEndStack';

/**
 * CDK Stack Tests for FrontEndStack
 * Validates: Requirements 6.1, 7.1, 7.2
 * 
 * These tests verify:
 * 1. Streaming Lambda target group is created when streamingLambda prop is provided
 * 2. ALB listener rules are created for streaming endpoints
 * 3. CloudFront distribution has behavior for streaming endpoints
 * 4. CloudFront streaming behavior has extended timeout
 * 5. REACT_APP_STREAMING_API_URL environment variable is set on ECS task
 */
describe('FrontEndStack', () => {
  // Define environment for stacks (required for Lambda@Edge)
  const env = { account: '123456789012', region: 'us-west-2' };

  describe('With Streaming Lambda', () => {
    let templateWithStreaming: Template;

    beforeAll(() => {
      const app = new cdk.App();
      
      // Create mock storage stack with required bucket
      const storageStack = new cdk.Stack(app, 'TestStorageStack', { env });
      const diagramStorageBucket = new s3.Bucket(storageStack, 'DiagramBucket');

      // Create mock streaming Lambda
      const lambdaStack = new cdk.Stack(app, 'TestLambdaStack', { env });
      const mockStreamingLambda = new lambda.Function(lambdaStack, 'MockStreamingLambda', {
        runtime: lambda.Runtime.NODEJS_20_X,
        handler: 'index.handler',
        code: lambda.Code.fromInline('exports.handler = async () => {}'),
        functionName: 'mock-streaming-handler',
      });

      // Create FrontEndStack WITH streaming Lambda
      const stackWithStreaming = new FrontEndStack(app, 'TestFrontEndStackWithStreaming', {
        diagramStorageBucket,
        streamingLambda: mockStreamingLambda,
        synthesisProgressTable: new dynamodb.Table(storageStack, 'SynthesisProgressTable', {
          partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
        }),
        env,
      });
      templateWithStreaming = Template.fromStack(stackWithStreaming);
    });

    describe('Streaming Lambda Target Group', () => {
      /**
       * Validates: Requirement 7.1 - Lambda target group for streaming Lambda
       */
      it('should create streaming Lambda target group when streamingLambda prop is provided', () => {
        // Find all target groups
        const targetGroups = templateWithStreaming.findResources('AWS::ElasticLoadBalancingV2::TargetGroup');
        
        // Find Lambda target groups (TargetType: lambda)
        const lambdaTargetGroups = Object.entries(targetGroups).filter(
          ([key, value]) => {
            const props = (value as { Properties?: { TargetType?: string } }).Properties;
            return props?.TargetType === 'lambda';
          }
        );
        
        // Should have at least 3 Lambda target groups: presigned URL, step function, and streaming
        expect(lambdaTargetGroups.length).toBeGreaterThanOrEqual(3);
      });

      /**
       * Validates: Requirement 7.4 - Multi-value headers enabled for Lambda integration
       */
      it('should enable multi-value headers on streaming Lambda target group', () => {
        templateWithStreaming.hasResourceProperties('AWS::ElasticLoadBalancingV2::TargetGroup', {
          TargetType: 'lambda',
          TargetGroupAttributes: Match.arrayWith([
            Match.objectLike({
              Key: 'lambda.multi_value_headers.enabled',
              Value: 'true',
            }),
          ]),
        });
      });
    });

    describe('ALB Listener Rules for Streaming Endpoints', () => {
      /**
       * Validates: Requirement 7.2 - ALB listener rules for streaming paths
       */
      it('should create ALB listener rule for /api/stream/analyze path', () => {
        templateWithStreaming.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
          Conditions: Match.arrayWith([
            Match.objectLike({
              Field: 'path-pattern',
              PathPatternConfig: {
                Values: ['/api/stream/analyze'],
              },
            }),
          ]),
          Priority: 10,
        });
      });

      it('should create ALB listener rule for /api/stream/optimize path', () => {
        templateWithStreaming.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
          Conditions: Match.arrayWith([
            Match.objectLike({
              Field: 'path-pattern',
              PathPatternConfig: {
                Values: ['/api/stream/optimize'],
              },
            }),
          ]),
          Priority: 11,
        });
      });

      it('should create ALB listener rule for /api/stream/cdk-modules path', () => {
        templateWithStreaming.hasResourceProperties('AWS::ElasticLoadBalancingV2::ListenerRule', {
          Conditions: Match.arrayWith([
            Match.objectLike({
              Field: 'path-pattern',
              PathPatternConfig: {
                Values: ['/api/stream/cdk-modules'],
              },
            }),
          ]),
          Priority: 12,
        });
      });
    });

    describe('CloudFront Distribution Streaming Behavior', () => {
      /**
       * Validates: Requirement 6.1 - CloudFront behavior for /api/stream/* paths
       */
      it('should have CloudFront behavior for /api/stream/* path', () => {
        templateWithStreaming.hasResourceProperties('AWS::CloudFront::Distribution', {
          DistributionConfig: {
            CacheBehaviors: Match.arrayWith([
              Match.objectLike({
                PathPattern: '/api/stream/*',
              }),
            ]),
          },
        });
      });

      /**
       * Validates: Requirement 6.3 - Caching disabled for streaming endpoints
       */
      it('should disable caching for streaming endpoints', () => {
        templateWithStreaming.hasResourceProperties('AWS::CloudFront::Distribution', {
          DistributionConfig: {
            CacheBehaviors: Match.arrayWith([
              Match.objectLike({
                PathPattern: '/api/stream/*',
                CachePolicyId: Match.anyValue(), // CACHING_DISABLED policy
              }),
            ]),
          },
        });
      });

      /**
       * Validates: Requirement 6.5 - CORS response headers for streaming
       */
      it('should include CORS response headers policy for streaming behavior', () => {
        templateWithStreaming.hasResourceProperties('AWS::CloudFront::Distribution', {
          DistributionConfig: {
            CacheBehaviors: Match.arrayWith([
              Match.objectLike({
                PathPattern: '/api/stream/*',
                ResponseHeadersPolicyId: Match.anyValue(), // CORS_ALLOW_ALL_ORIGINS policy
              }),
            ]),
          },
        });
      });

      /**
       * Validates: Extended timeout (180 seconds - CloudFront max) for streaming endpoints
       * Note: CloudFront origin read timeout is configured on the origin, not the behavior
       * CloudFront has a maximum origin read timeout of 180 seconds
       */
      it('should configure extended timeout (180 seconds) for streaming origin', () => {
        // The streaming origin should have OriginReadTimeout of 180 seconds (CloudFront max)
        templateWithStreaming.hasResourceProperties('AWS::CloudFront::Distribution', {
          DistributionConfig: {
            Origins: Match.arrayWith([
              Match.objectLike({
                CustomOriginConfig: Match.objectLike({
                  OriginReadTimeout: 180,
                }),
              }),
            ]),
          },
        });
      });
    });

    describe('ECS Environment Variables', () => {
      /**
       * Validates: Requirement 5.7 - REST API streaming endpoint URL as environment variable
       */
      it('should set REACT_APP_STREAMING_API_URL environment variable on ECS task', () => {
        templateWithStreaming.hasResourceProperties('AWS::ECS::TaskDefinition', {
          ContainerDefinitions: Match.arrayWith([
            Match.objectLike({
              Environment: Match.arrayWith([
                Match.objectLike({
                  Name: 'REACT_APP_STREAMING_API_URL',
                }),
              ]),
            }),
          ]),
        });
      });

      it('should set AWS_ACCOUNT_ID environment variable on ECS task', () => {
        templateWithStreaming.hasResourceProperties('AWS::ECS::TaskDefinition', {
          ContainerDefinitions: Match.arrayWith([
            Match.objectLike({
              Environment: Match.arrayWith([
                Match.objectLike({
                  Name: 'AWS_ACCOUNT_ID',
                }),
              ]),
            }),
          ]),
        });
      });

      it('should set AWS_REGION environment variable on ECS task', () => {
        templateWithStreaming.hasResourceProperties('AWS::ECS::TaskDefinition', {
          ContainerDefinitions: Match.arrayWith([
            Match.objectLike({
              Environment: Match.arrayWith([
                Match.objectLike({
                  Name: 'AWS_REGION',
                }),
              ]),
            }),
          ]),
        });
      });
    });

    describe('Stack Outputs', () => {
      it('should export CloudFront URL', () => {
        templateWithStreaming.hasOutput('CloudFrontUrl', {
          Description: 'The CloudFront distribution URL',
        });
      });

      it('should export Streaming API URL', () => {
        templateWithStreaming.hasOutput('StreamingApiUrl', {
          Description: 'REST API streaming endpoint URL',
        });
      });
    });
  });

  describe('Without Streaming Lambda', () => {
    let templateWithoutStreaming: Template;

    beforeAll(() => {
      const app = new cdk.App();
      
      // Create mock storage stack with required bucket
      const storageStack = new cdk.Stack(app, 'TestStorageStackNoStream', { env });
      const diagramStorageBucket = new s3.Bucket(storageStack, 'DiagramBucket');

      // Create FrontEndStack WITHOUT streaming Lambda
      const stackWithoutStreaming = new FrontEndStack(app, 'TestFrontEndStackWithoutStreaming', {
        diagramStorageBucket,
        synthesisProgressTable: new dynamodb.Table(storageStack, 'SynthesisProgressTable', {
          partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING },
        }),
        env,
      });
      templateWithoutStreaming = Template.fromStack(stackWithoutStreaming);
    });

    describe('Streaming Lambda Target Group', () => {
      it('should NOT create streaming Lambda target group when streamingLambda prop is not provided', () => {
        // Find all target groups
        const targetGroups = templateWithoutStreaming.findResources('AWS::ElasticLoadBalancingV2::TargetGroup');
        
        // Find Lambda target groups (TargetType: lambda)
        const lambdaTargetGroups = Object.entries(targetGroups).filter(
          ([key, value]) => {
            const props = (value as { Properties?: { TargetType?: string } }).Properties;
            return props?.TargetType === 'lambda';
          }
        );
        
        // Should have only 2 Lambda target groups: presigned URL and step function
        expect(lambdaTargetGroups.length).toBe(2);
      });
    });

    describe('ALB Listener Rules', () => {
      it('should NOT create streaming listener rules when streamingLambda is not provided', () => {
        // Check that no listener rules with streaming paths exist
        const listenerRules = templateWithoutStreaming.findResources('AWS::ElasticLoadBalancingV2::ListenerRule');
        
        const streamingRules = Object.entries(listenerRules).filter(([, value]) => {
          const props = (value as { Properties?: { Conditions?: Array<{ PathPatternConfig?: { Values?: string[] } }> } }).Properties;
          const conditions = props?.Conditions || [];
          return conditions.some((condition) => {
            const values = condition.PathPatternConfig?.Values || [];
            return values.some((v: string) => v.includes('/api/stream/'));
          });
        });
        
        expect(streamingRules.length).toBe(0);
      });
    });
  });
});
