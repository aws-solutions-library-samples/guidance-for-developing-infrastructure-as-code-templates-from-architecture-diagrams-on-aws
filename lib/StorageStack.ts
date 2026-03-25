import * as cdk from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import { Construct } from 'constructs';

interface Props extends cdk.StackProps {
}

export class StorageStack extends cdk.Stack {
  public readonly diagramStorageBucket: s3.Bucket;
  public readonly codeOutputBucket: s3.Bucket;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    // Common security settings for all buckets
    const securityProps = {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      versioned: true,
    };

    //Create S3 bucket for user uploaded images
    this.diagramStorageBucket = new s3.Bucket(this, 'StorageBucket', {
      ...securityProps,
      bucketName: `a2a-${this.account}-diagramstorage-${this.region}`,
      // CORS is required for presigned URL uploads from browser
      // Origins will be restricted after CloudFront domain is known
      cors: [{
        allowedMethods: [s3.HttpMethods.GET, s3.HttpMethods.PUT, s3.HttpMethods.POST],
        allowedOrigins: ['https://*.cloudfront.net'],
        allowedHeaders: ['*'],
        maxAge: 3000
      }]
    });

    // Create S3 bucket for generated CDK code
    this.codeOutputBucket = new s3.Bucket(this, 'codeOutputBucket', {
      ...securityProps,
      bucketName: `a2a-${this.account}-codeoutput-${this.region}`,
    });
  }
}