#!/bin/bash
export AWS_REGION="us-west-2"
export CDK_QUALIFIER="a2a"; ### The CDK Qualifier name must match the qualifiers in package.json and cdk.json
export AWS_PROFILE="Admin"; ### Name of AWS profile created during CDK CLI configuration
export AWS_ACCOUNT_ID="123456789012"