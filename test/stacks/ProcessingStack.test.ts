import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { ProcessingStack } from '../../lib/ProcessingStack';

/**
 * CDK Stack Tests for ProcessingStack
 * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5
 * 
 * These tests verify:
 * 1. Streaming Lambda is created with correct configuration
 * 2. WebSocket infrastructure is NOT present (removed)
 */
describe('ProcessingStack', () => {
  let app: cdk.App;
  let stack: ProcessingStack;
  let template: Template;

  beforeAll(() => {
    app = new cdk.App();
    
    // Create mock storage stack with required buckets
    const storageStack = new cdk.Stack(app, 'TestStorageStack');
    const diagramStorageBucket = new s3.Bucket(storageStack, 'DiagramBucket');
    const codeOutputBucket = new s3.Bucket(storageStack, 'CodeOutputBucket');

    // Create ProcessingStack with mock buckets
    stack = new ProcessingStack(app, 'TestProcessingStack', {
      diagramStorageBucket,
      codeOutputBucket,
    });

    template = Template.fromStack(stack);
  });

  describe('Streaming Lambda Configuration', () => {
    /**
     * Validates: Requirement 2.1 - Streaming Lambda uses Node.js 20.x runtime
     */
    it('should create streaming Lambda with Node.js 20.x runtime', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'a2a-streaming-handler',
        Runtime: 'nodejs20.x',
      });
    });

    /**
     * Validates: Requirement 2.3 - Streaming Lambda has 15-minute timeout
     */
    it('should configure streaming Lambda with 15-minute timeout', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'a2a-streaming-handler',
        Timeout: 900, // 15 minutes in seconds
      });
    });

    /**
     * Validates: Requirement 2.1 - Streaming Lambda has correct handler
     */
    it('should configure streaming Lambda with correct handler', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'a2a-streaming-handler',
        Handler: 'dist/index.handler',
      });
    });

    /**
     * Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5 - IAM permissions
     */
    it('should have S3 GetObject permission for diagram bucket', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 's3:GetObject',
              Effect: 'Allow',
            }),
          ]),
        },
      });
    });

    it('should have Bedrock InvokeModel and InvokeModelWithResponseStream permissions', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
              Effect: 'Allow',
              Resource: '*',
            }),
          ]),
        },
      });
    });

    it('should have Secrets Manager GetSecretValue permission for API key', () => {
      template.hasResourceProperties('AWS::IAM::Policy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Action: 'secretsmanager:GetSecretValue',
              Effect: 'Allow',
            }),
          ]),
        },
      });
    });
  });

  describe('WebSocket Infrastructure Removal', () => {
    /**
     * Validates: Requirement 5.1 - WebSocket API Gateway is removed
     */
    it('should NOT have WebSocket API Gateway', () => {
      // WebSocket API would be AWS::ApiGatewayV2::Api with ProtocolType: WEBSOCKET
      const apis = template.findResources('AWS::ApiGatewayV2::Api');
      const websocketApis = Object.values(apis).filter(
        (api: Record<string, unknown>) => 
          (api as { Properties?: { ProtocolType?: string } }).Properties?.ProtocolType === 'WEBSOCKET'
      );
      expect(websocketApis).toHaveLength(0);
    });

    /**
     * Validates: Requirement 5.2 - DynamoDB connections table is removed
     */
    it('should NOT have DynamoDB connections table', () => {
      // Check that no DynamoDB table exists for WebSocket connections
      const tables = template.findResources('AWS::DynamoDB::Table');
      const connectionTables = Object.entries(tables).filter(
        ([key]) => key.toLowerCase().includes('connection') || key.toLowerCase().includes('websocket')
      );
      expect(connectionTables).toHaveLength(0);
    });

    /**
     * Validates: Requirements 5.3, 5.4, 5.5 - WebSocket Lambda functions are removed
     */
    it('should NOT have WebSocket connect Lambda function', () => {
      const functions = template.findResources('AWS::Lambda::Function');
      const connectFunctions = Object.entries(functions).filter(
        ([key, value]) => {
          const props = (value as { Properties?: { FunctionName?: string } }).Properties;
          return key.toLowerCase().includes('connect') || 
                 (props?.FunctionName && props.FunctionName.toLowerCase().includes('connect'));
        }
      );
      // Filter out any that are the streaming handler
      const websocketConnectFunctions = connectFunctions.filter(
        ([, value]) => {
          const props = (value as { Properties?: { FunctionName?: string } }).Properties;
          return props?.FunctionName !== 'a2a-streaming-handler';
        }
      );
      expect(websocketConnectFunctions).toHaveLength(0);
    });

    it('should NOT have WebSocket disconnect Lambda function', () => {
      const functions = template.findResources('AWS::Lambda::Function');
      const disconnectFunctions = Object.entries(functions).filter(
        ([key, value]) => {
          const props = (value as { Properties?: { FunctionName?: string } }).Properties;
          return key.toLowerCase().includes('disconnect') || 
                 (props?.FunctionName && props.FunctionName.toLowerCase().includes('disconnect'));
        }
      );
      expect(disconnectFunctions).toHaveLength(0);
    });

    it('should NOT have WebSocket message Lambda function', () => {
      const functions = template.findResources('AWS::Lambda::Function');
      const messageFunctions = Object.entries(functions).filter(
        ([key, value]) => {
          const props = (value as { Properties?: { FunctionName?: string } }).Properties;
          return key.toLowerCase().includes('message') || 
                 (props?.FunctionName && props.FunctionName.toLowerCase().includes('message'));
        }
      );
      expect(messageFunctions).toHaveLength(0);
    });

    /**
     * Validates: WebSocket stage is removed
     */
    it('should NOT have WebSocket stage', () => {
      const stages = template.findResources('AWS::ApiGatewayV2::Stage');
      expect(Object.keys(stages)).toHaveLength(0);
    });
  });

  describe('Stack Outputs', () => {
    it('should export Streaming Lambda ARN', () => {
      template.hasOutput('StreamingLambdaArn', {
        Description: 'Streaming Lambda Function ARN',
      });
    });
  });
});
