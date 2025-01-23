import * as cdk from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { Construct } from 'constructs';

interface Props extends cdk.StackProps {
  diagramStorageBucket: cdk.aws_s3.Bucket;
  streamlitServerBucket: cdk.aws_s3.Bucket;
  applicationQualifier: string;
}

export class FrontEndStack extends cdk.Stack {
  public readonly responderLambda: lambda.Function;

  constructor(scope: Construct, id: string, props: Props) {
    super(scope, id, props);

    // Get the default VPC
    const vpc = ec2.Vpc.fromLookup(this, 'DefaultVPC', { isDefault: true });

    // Create a security group
    const securityGroup = new ec2.SecurityGroup(this, 'EC2SecurityGroup', {
      vpc,
      description: 'Security group for streamlit server',
      allowAllOutbound: true,
    });

    // Add inbound rules
    securityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow inbound HTTP traffic on port 80');

    // Create Lambda function
    this.responderLambda = new lambda.DockerImageFunction(this, 'streamlitResponder', {
      functionName: `${props.applicationQualifier}-streamlit-responder`,
      code: lambda.DockerImageCode.fromImageAsset('src/lambda-functions/streamlit-responder'),
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
      ],
    });

    // Add AmazonBedrockFullAccess managed policy to the Lambda function
    this.responderLambda.role?.addManagedPolicy(
      iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonBedrockFullAccess')
    );

    // User data script for EC2 configuration
    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'sleep 10',
      'sudo apt-get update -y',
      'sudo apt-get upgrade -y',
      'sudo apt-get install -y awscli',
      'curl -fsSL https://get.docker.com -o get-docker.sh',
      'sudo sh get-docker.sh',
      'sudo usermod -aG docker ubuntu',
      'curl -O https://bootstrap.pypa.io/get-pip.py',
      'sudo python3 get-pip.py',
      'mkdir ec2-files',
      `aws s3 cp s3://${props.streamlitServerBucket.bucketName}/ec2-files/ ec2-files/ --recursive`,
      'cd ec2-files',
      'sudo docker build -t streamlit:latest .',
      `sudo docker run --network host -e S3_BUCKET_NAME=${props.diagramStorageBucket.bucketName} -e LAMBDA_FUNCTION_NAME=${this.responderLambda.functionName} -e REGION=${this.region} -d -p 80:80 streamlit`,
    );

    const instanceRole = new iam.Role(this, 'InstanceRole', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com')
    });
    
    instanceRole.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));
    instanceRole.addToPolicy(new iam.PolicyStatement({
      actions: ['s3:GetObject', 's3:ListBucket'],
      resources: [props.streamlitServerBucket.bucketArn, `${props.streamlitServerBucket.bucketArn}/*`],
    }));

    // Create the EC2 instance
    const streamlitServer = new ec2.Instance(this, 'StreamlitServer', {
      vpc,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T2, ec2.InstanceSize.SMALL),
      machineImage: ec2.MachineImage.fromSsmParameter('/aws/service/canonical/ubuntu/server/focal/stable/current/amd64/hvm/ebs-gp2/ami-id'),
      securityGroup: securityGroup,
      userData: userData,
      role: instanceRole,
      requireImdsv2: true,
    });

    props.diagramStorageBucket.grantReadWrite(streamlitServer);
    this.responderLambda.grantInvoke(streamlitServer);

    // Associate Elastic IP (EIP) with the EC2 instance
    const eip = new ec2.CfnEIP(this, 'EIP');
    new ec2.CfnEIPAssociation(this, 'EIPAssociation', {
      instanceId: streamlitServer.instanceId,
      eip: eip.ref,
    });

    // Output the web page
    new cdk.CfnOutput(this, 'WebPage', {
      value: `${streamlitServer.instancePublicDnsName}`,
      description: 'Web page to upload architecture diagram and receive output. Only reachable over HTTP, not HTTPS',
    });
  }
}