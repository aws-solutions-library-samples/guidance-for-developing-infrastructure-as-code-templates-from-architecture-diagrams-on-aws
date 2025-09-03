import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

interface Props extends cdk.StackProps {
  applicationQualifier: string;
}

export class StorageStack extends cdk.Stack {
  public readonly diagramStorageBucket: s3.Bucket;
  public readonly codeOutputBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, {
      ...props,
      description: 'Guidance for Generating Infrastructure-as-Code Templates from Architecture Diagrams on AWS ( SO9015 )'
    });

    //Define bucket props
    const bucketProps = {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: false,
    };

    //Create S3 bucket for user uploaded images
    this.diagramStorageBucket = new s3.Bucket(this, 'StorageBucket', {
      ...bucketProps,
      bucketName: `${this.account}-${props.applicationQualifier}-diagramstorage-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Create S3 bucket for generated CDK code
    this.codeOutputBucket = new s3.Bucket(this, 'codeOutputBucket', {
      bucketName: `${this.account}-${props.applicationQualifier}-codeoutput-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
  }
}