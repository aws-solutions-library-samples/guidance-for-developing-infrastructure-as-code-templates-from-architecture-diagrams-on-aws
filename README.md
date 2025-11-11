# Guidance for Generating IaC Templates Directly from Architecture Diagrams

## Table of Contents
- [Overview](#overview)
  - [Cost](#cost)
- [Demo](#demo)
- [Architecture Components](#architecture-components)
- [Prerequisites](#prerequisites)
  - [Operating System](#operating-system)
- [Deployment Steps](#deployment-steps)
- [Deployment Validation](#deployment-validation)
- [Running the Guidance](#running-the-guidance)
- [Next Steps](#next-steps)
- [Cleanup](#cleanup)
- [FAQ, Known Issues, Additional Considerations, and Limitations](#faq-known-issues-additional-considerations-and-limitations)
- [Revisions](#revisions)
- [Notices](#notices)
- [Authors](#authors)

## Overview
The Journey from Architecture drawings to their deployment can be vastly accelerated by leveraging the potential of Large Language Models. However, given that IaC tools like AWS CDK(Cloud Development Kit) evolve rapidly with frequent new releases/updates, leveraging stand alone LLMs trained in the past often leads to inaccuracies and hallucinations when they are used to produce IaC stacks using AWS CDK.

In addition, for architecture drawings that have higher levels of complexity, highly elaborate and nuanced prompts are essential to produce truly deployable IaC templates. Prompting efforts from the user also scale exponentially as the complexity levels of the architecture under consideration are increased. Architec2App-AI only expects a nuanced Architecture drawing with no additional prompts required from the user. 

This guidance helps users to produce accurate, natively modular, nuanced AWS CDK stacks in Python and TypeScript with the CDK constructs/syntax retrieved from the latest AWS CDK release, only using an architecture drawing. In addition, the required IAM Roles and permissions are also identified automatically and added to the stacks automatically during the code generation process. This is achieved using highly optimized Chain of Thought (CoT)  prompting for IaC generation in combination with multi step reasoning and search grounding capabilities of online LLM’s.

Architec2App-AI with its intrinsic multi-agentic design, leverages the multimodal capabilities of LLMs in combination with carefully optimized Prompts to produce a nuanced understanding of the provided architecture - analyzing not only the individual resources present, but distinct functional modules, interactions between AWS resources or account boundaries that maybe depicted in the architecture, informing the code generation process accordingly.

## Demo

*Watch the A2A-AI solution in action: Upload an architecture diagram and see real-time CDK code generation*

https://private-user-images.githubusercontent.com/120046505/512905487-5695ddeb-4253-4c70-b998-ed2b53f6d50c.mp4?jwt=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJnaXRodWIuY29tIiwiYXVkIjoicmF3LmdpdGh1YnVzZXJjb250ZW50LmNvbSIsImtleSI6ImtleTUiLCJleHAiOjE3NjI4OTE4NjgsIm5iZiI6MTc2Mjg5MTU2OCwicGF0aCI6Ii8xMjAwNDY1MDUvNTEyOTA1NDg3LTU2OTVkZGViLTQyNTMtNGM3MC1iOTk4LWVkMmI1M2Y2ZDUwYy5tcDQ_WC1BbXotQWxnb3JpdGhtPUFXUzQtSE1BQy1TSEEyNTYmWC1BbXotQ3JlZGVudGlhbD1BS0lBVkNPRFlMU0E1M1BRSzRaQSUyRjIwMjUxMTExJTJGdXMtZWFzdC0xJTJGczMlMkZhd3M0X3JlcXVlc3QmWC1BbXotRGF0ZT0yMDI1MTExMVQyMDA2MDhaJlgtQW16LUV4cGlyZXM9MzAwJlgtQW16LVNpZ25hdHVyZT0wZmFkYzBiNzc3MTBlY2Y4Yjc5NWI5ZTVmNzM4YTZiOTViMmFkZjQyMTNiMDQ5NjUzYjI5MThhNGY4OTc2ODMyJlgtQW16LVNpZ25lZEhlYWRlcnM9aG9zdCJ9.ahi6vyyi03qDsNuMzYpzPhLnX181eyoXWA--lO-M53A

## Architecture Components

![Solution Architecture](docs/SolutionArchitecture.png)

1. A CloudFront distribution provides secure HTTPS access to the application with Lambda@Edge authentication using Amazon Cognito
2. An Amazon ECS Fargate service behind an Application Load Balancer hosts the React webserver for the application frontend
3. Amazon Cognito User Pool provides user authentication and authorization
4. WebSocket API Gateway enables real-time communication between frontend and backend services
5. The uploaded diagrams are stored in an Amazon S3 bucket with CORS configuration for direct uploads
6. Lambda functions handle presigned URL generation, WebSocket connections, and Step Function invocation
7. The web responder Lambda invokes Amazon Bedrock API to perform image analysis using Claude models
8. A comprehensive summary of the architecture is generated and sent via WebSocket for real-time updates
9. The generated architecture description is passed to a Step Function workflow for AWS CDK code generation
10. The code generator Lambda (containerized) uses Perplexity API with multi-step reasoning to generate modular CDK stacks
11. Generated code is stored in an Amazon S3 bucket and users receive download links via WebSocket notifications

### Cost
You are responsible for the cost of the AWS services used while running this Guidance. The cost for running this Guidance with the default settings in the us-west-2 (Oregon) region is approximately $20 per month for conversion of around 50 architecture diagrams to IaC. Also major portion of the costs is a fixed cost related to the ECS, Fargate, and Application Load Balancer services being used to host the React web application. 
 We recommend creating a Budget through AWS Cost Explorer to help manage costs. Prices are subject to change. For full details, refer to the pricing webpage for each AWS service used in this Guidance.

## Prerequisites

### Operating System
- This Guidance can be deployed using Windows, MacOS, or Linux. 
- An IDE, AWS CDK and AWS CLI are required.
- NPM installed
- Docker - IMPORTANT: In your Docker settings, verify that "Use containerd for pulling and storing images" is disabled. This setting causes issues with pushing Docker images to AWS ECR

### Third Party Tools
Perplexity API Key - Perplexity account and subscription required. The default model is `sonar-pro` configured in `model_name.yaml`.
NOTE: Our team has evaluated Perplexity to provide the best results for this use case. Other providers can be substituted in place of Perplexity as is determined to best suit your requirements. To replace Perplexity with another model, update the code_generator_utils_v2.py file within the code-generator Lambda function with the url of the alternative model and obtain an API key. Customer's use of Perplexity or another third-party tool of their choosing is subject to the terms and conditions of such tool and it is Customer's sole responsibility to ensure they oblige by such terms.

### AWS Account Requirements
Approved Bedrock access to Claude 4.0 Sonnet in the desired deployment region.

### Supported Regions
Any region that supports the required Claude models on Bedrock is a viable deployment target. 
This currently includes: us-east-1, us-west-2, eu-central-1, ap-northeast-1, and ap-southeast-1.
NOTE: us-east-1 is currently experiencing throttling issues with Claude 4.0 Sonnet. Deployment to other regions is strongly advised.

## Deployment Steps

### 1. Clone Repository
Clone the Github repo.
```bash
git clone git@github.com:aws-solutions-library-samples/guidance-for-developing-infrastructure-as-code-templates-from-architecture-diagrams-on-aws.git
```
### 2. Edit configuration files
Open the project folder in your IDE and edit the following files:
- export_vars.sh - This file contains all of the necessary deployment configuration environment variables. Update the placeholder values with the correct ones for your targeted deployment account.
- (OPTIONAL) package.json  - The config section of this file can be modified to change the Application Name

### 3. Make the script executable and source the variables
Open your IDE CLI and run the follwing commands:
```bash
chmod +x export_vars.sh
source export_vars.sh
```
NOTE: For updates and future deplyoments, the 'source' command needs to be run every time a new CLI session is created to set the environment variables.

### 4. Install dependencies
Install the required CDK dependencies for the project.
```bash
npm ci
```
Install the required dependencies for the Node.js CloudFront edge lambda function
```bash
cd src/lambda-functions/edge-lambda
npm install
cd ../../..
```

### 5. Bootstrap the account
Prepare the account for CDK deployment. 
Bootstrap the us-east-1 region. This is required for CloudFront deployment.
```bash
cdk bootstrap --profile $AWS_PROFILE aws://${AWS_ACCOUNT_ID}/us-east-1
```
Bootstrap the region targeted for application deployment. This command is only necessary if a region other than us-east-1 is used.
```bash
cdk bootstrap --profile $AWS_PROFILE aws://${AWS_ACCOUNT_ID}/${AWS_REGION}
```

### 6. Create AWS Secret and Upload API Key
In the AWS Console, navigate to Secrets Manager in the target deployment region and create a new secret with the name 'A2A_API_KEY' and value set to your Perplexity API key.

**Note:** The application will automatically create additional Cognito authentication secrets during deployment.

### 7. Deploy
Deploy the project using CDK.
```bash
cdk deploy --all --require-approval never
```

## Deployment Validation

1. **CloudFormation Verification**  
   - Confirm successful creation of three stacks in CloudFormation:  
     - `A2A-AI-StorageStack`  
     - `A2A-AI-ProcessingStack`  
     - `A2A-AI-FrontEndStack`  

2. **ECS Service Validation**  
   - In the Amazon ECS console, verify:  
     - The `ECS-Cluster` is in **ACTIVE** status  
     - There are running tasks for the `A2A-AI-FrontEndStack-ALBfargateserviceService` family  
     - The number of healthy tasks matches the desired count  

3. **Load Balancer Check**  
   - In the EC2 Console under Load Balancers:  
     - Confirm the Application Load Balancer (`A2A-AI-AL`) is healthy  
     - The associated target group shows healthy ECS tasks as registered targets  

4. **CloudFront Distribution Access**  
   - Retrieve the CloudFront URL from the **Outputs** tab of the `A2A-AI-FrontEndStack` in CloudFormation  
   - Access the application via `https://<CLOUDFRONT-DOMAIN>`  
   - **Note:** The application uses HTTPS with Cognito authentication. You'll be redirected to sign up/sign in on first access.

5. **Authentication Setup**  
   - The application uses Amazon Cognito for user authentication  
   - Users can self-register with email verification  
   - Lambda@Edge handles authentication at the CloudFront edge  

> Allow 5–7 minutes after stack completion for ECS service initialization and container provisioning. The ALB health checks may take 2–3 minutes to show healthy status after tasks become active.


## Running the Guidance
1. Navigate to the CloudFront URL and authenticate using Cognito (sign up if first time)
2. Upload a high quality PNG image of an AWS Architecture diagram for any Data Platform type architecture. These are generally derived from the AWS Modern Data Architecture Framework - reflecting capabilities for streaming, ETL, ingestion type architectures encompassing AWS Data, Analytics and Database services. A folder of architecture diagram samples has been provided in this repo.
3. A2A-AI will first analyze the drawing and provide real-time updates via WebSocket connection showing the analysis progress
4. The system provides a comprehensive description of what it sees and initiates the workflow for code synthesis in parallel
5. Real-time progress updates are displayed as the multi-step code generation process executes
6. Once code synthesis is completed, results are uploaded to the code output S3 bucket with a download link provided through the web interface

## Next Steps
Users can explore the following customizations to adapt/optimize the solution to their preferences

1. Model Selection: The model used for code generation can be selected from the list of supported models by the API provider. For Perplexity, the information can be found here. For Architecture diagram analysis, review the list of available foundation models with multimodal capabilities here to experiment with other models. To adjust the model for code generation, change the model name in the `model_name.yaml` file. The default is set to `sonar-pro` with inbuilt multi step reasoning for precise code generation. 

2. Email notifications to end users: By default, this solution deploys an SNS topic that is intended for administrators to add their emails to. They will automatically be subscribed to the topic upon solution deployment and will receive a notification every time the service is used, along with a link to download the code output from S3. In order to enable webpage email input, SES can be integrated into the solution by having the Processing Lambda function send its output notifications to SES in addition to SNS. The solution is already configured to pass along a user’s email in the event payload to the Processing Lambda. Proper IAM permissions must be added to the function and SES configuration must be completed in the account separately.

## Cleanup
Delete all 3 A2A Cloudformation stacks using the Cloudformation console or CDK destroy commands. All three S3 buckets deployed in this solution will automatically be emptied and deleted upon stack removal. Remove stacks in the following order to avoid failures due to cross-stack dependencies.
```bash
cdk destroy A2A-AI-FrontEndStack
cdk destroy A2A-AI-ProcessingStack
cdk destroy A2A-AI-StorageStack
```
NOTE: If the Front-End stack was deployed using default settings, a new VPC has been created for the ALB. This CloudFormation stack deletion will fail and require manual component deletion of a VPC endpoint and associated subnet.

## FAQ, known issues, additional considerations, and limitations

### FAQ
1. What other best practices can the user follow while using this solution  to maximise the quality of the code/AWS CDK  Stack produced?

a. Pay attention to the image clarity and the conceptual clarity of the architecture being depicted. Are all resources described clearly. Check whether the different functional modules  /Account boundaries if any represented clearly. consider adding short phrases as guiding text if parts of the drawing are particularly complex. 

b. For reviewing and further optimizing the generated CDK stacks, consider using the Amazon Q Developer extension on your IDE /Q Developer Agent CLI. Use the inline chat feature and ask Q to review the correctness and further optimize the generated stack for any additional best practices.  Consider using the “@workspace“ decorator for any queries to Q developer that required the context of the entire codebase.The authors highly recommend the use of A2A-AI in combination with Amazon Q developer for rapid implementation of AWS architectures to produce ready to deploy Infrastructure as Code, to realize a truly Next Generation Developer Experience. Use the documentation generation features of Amazon Q to generate detailed README’s for the CDK Stack generated.


2. How can we adapt this solution so that the generated code is natively compatible with the user’s/organization’s development practices/specifications ?


In order to customize the implementation already during the code generation process, the module_prompts.yaml needs to be edited to list the requirements. Examples are shown depicting how naming conventions can be specified for s3 buckets , applying default attribute preferences for AWS Lambda constructs, should these resources be present in the user provided architecture. The same pattern can be extended for other services. 

3. How can  the user modify the model used for the code generation process? 

As described above in the Next Steps section

4. What programming languages are currently supported by the solution?

The solution supports and has been tested for CDK Stack generation in Python and in Typescript. To generate Stacks in other programming languages supported by CDK such as C#, Go and others, the module_prompts.yaml file would need to be adjustment. However, It is important to note that the performance of the solution in these additional languages has not been validated by the authors. 

5. Is it mandatory to use the Perplexity API? what are the alternatives?

It is not mandatory to use the Perplexity API.  Model API’s from other providers with inbuilt search grounding can also be used. The function that makes the request to the API within the code generator lambda has to be modified accordingly. Another alternative would also be to build a custom agent with inbuilt function calling to a search index using tools such as langgraph and using its endpoint in this solution.


6. Are there any limitations and known issues in the current IaC templates generated?

For Architecture involving multiple accounts, the application will not produce multiple staging files(app.py/app.ts). These have be written-refactored accordingly. There maybe slight imprecision in the relative imports of the module level stacks  in the staging file. These should be quick and easy to identify and correct. 


## Notices
Customers are responsible for making their own independent assessment of the information in this Guidance. This Guidance: (a) is for informational purposes only, (b) represents AWS current product offerings and practices, which are subject to change without notice, and (c) does not create any commitments or assurances from AWS and its affiliates, suppliers or licensors. AWS products or services are provided “as is” without warranties, representations, or conditions of any kind, whether express or implied. AWS responsibilities and liabilities to its customers are controlled by AWS agreements, and this Guidance is not part of, nor does it modify, any agreement between AWS and its customers.

Online LLM icon- AI icon  by Merlin D, from The Noun Project CC BY 3.0
Search Index Icon - Search icon by Wilson Joseph, from The Noun Project CC BY 3.0 

## Improvements Coming Soon
- Front End improvements
- Support for Terraform output
- Generation of supporting files such as Lambda function source code

## Authors
Srikrishna Chaitanya Konduru, Benjamin Pawlowski, Srikanth Potu, Bertram Varga