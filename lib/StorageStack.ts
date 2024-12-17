import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import * as path from 'path';
import { Construct } from 'constructs';

interface Props extends cdk.StackProps {
  applicationQualifier: string;
}

export class StorageStack extends cdk.Stack {
  public readonly storageBucket: s3.Bucket;
  public readonly diagramStorageBucket: s3.Bucket;
  public readonly streamlitServerBucket: s3.Bucket;
  public readonly codeOutputBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

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

    // Create S3 bucket for EC2 folder
    this.streamlitServerBucket = new s3.Bucket(this, 'streamlitServerBucket', {
      bucketName: `${this.account}-${props.applicationQualifier}-streamlitserver-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // Deploy EC2 folder contents to S3
    new s3deploy.BucketDeployment(this, 'DeployEC2Files', {
      sources: [s3deploy.Source.asset(path.join(__dirname, '../src/ec2'))],
      destinationBucket: this.streamlitServerBucket,
      destinationKeyPrefix: 'ec2-files',
    });

    // Create S3 bucket for generated CDK code
    this.codeOutputBucket = new s3.Bucket(this, 'codeOutputBucket', {
      bucketName: `${this.account}-${props.applicationQualifier}-codeoutput-${this.region}`,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });
  }
}