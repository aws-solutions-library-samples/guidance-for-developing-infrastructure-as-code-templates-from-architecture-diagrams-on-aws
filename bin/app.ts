#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AwsSolutionsChecks } from 'cdk-nag';
import { AppConfig } from '../config/AppConfig';
import { FrontEndStack } from '../lib/FrontEndStack';
import { ProcessingStack } from '../lib/ProcessingStack';
import { StorageStack } from '../lib/StorageStack';

const app = new cdk.App();

const storageStack = new StorageStack(app, `${AppConfig.applicationName}-StorageStack`, {
  env: { account: AppConfig.deploymentAccount, region: AppConfig.region },
  applicationQualifier: AppConfig.applicationQualifier,
});

const processingStack = new ProcessingStack(app, `${AppConfig.applicationName}-ProcessingStack`, {
  env: { account: AppConfig.deploymentAccount, region: AppConfig.region },
  diagramStorageBucket: storageStack.diagramStorageBucket,
  codeOutputBucket: storageStack.codeOutputBucket,
  applicationQualifier: AppConfig.applicationQualifier,
});

const frontEndStack = new FrontEndStack(app, `${AppConfig.applicationName}-FrontEndStack`, {
  env: { account: AppConfig.deploymentAccount, region: AppConfig.region },
  diagramStorageBucket: storageStack.diagramStorageBucket,
  applicationQualifier: AppConfig.applicationQualifier,
  webSocketUrl: `wss://${processingStack.webSocketApi.apiId}.execute-api.${AppConfig.region}.amazonaws.com/prod`,
});

// Add CDK Nag checks
// cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));