import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { ProcessingStack } from '../../lib/ProcessingStack';

/**
 * CDK Stack Tests for ProcessingStack
 * 
 * These tests verify:
 * 1. Streaming Lambda is created with correct configuration
 * 2. IAM permissions are properly scoped
 */
describe('ProcessingStack', () => {
  let app: cdk.App;
  let stack: ProcessingStack;
  let template: Template;

  beforeAll(() => {
    app = new cdk.App();
    
    const storageStack = new cdk.Stack(app, 'TestStorageStack');
    const diagramStorageBucket = new s3.Bucket(storageStack, 'DiagramBucket');
    const codeOutputBucket = new s3.Bucket(storageStack, 'CodeOutputBucket');
    const synthesisProgressTable = new dynamodb.Table(storageStack, 'SynthesisProgressTable', {
      partitionKey: { name: 'executionId', type: dynamodb.AttributeType.STRING },
    });

    stack = new ProcessingStack(app, 'TestProcessingStack', {
      diagramStorageBucket,
      codeOutputBucket,
      synthesisProgressTable,
    });

    template = Template.fromStack(stack);
  });

  describe('Streaming Lambda Configuration', () => {
    it('should create streaming Lambda with Node.js 20.x runtime', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'a2a-streaming-handler',
        Runtime: 'nodejs20.x',
      });
    });

    it('should configure streaming Lambda with 15-minute timeout', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'a2a-streaming-handler',
        Timeout: 900,
      });
    });

    it('should configure streaming Lambda with correct handler', () => {
      template.hasResourceProperties('AWS::Lambda::Function', {
        FunctionName: 'a2a-streaming-handler',
        Handler: 'dist/index.handler',
      });
    });

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

    it('should have Bedrock permissions', () => {
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
  });

  describe('Stack Outputs', () => {
    it('should export Streaming Lambda ARN', () => {
      template.hasOutput('StreamingLambdaArn', {
        Description: 'Streaming Lambda Function ARN',
      });
    });
  });
});
