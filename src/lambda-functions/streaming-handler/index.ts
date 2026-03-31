/**
 * Streaming Lambda Handler
 *
 * Uses AWS Lambda response streaming to deliver SSE events for
 * architecture diagram analysis, optimization, and CDK modules breakdown.
 *
 * @module streaming-handler
 */

// Type imports only - awslambda global is provided by Lambda runtime
import type { APIGatewayProxyEvent, Context } from 'aws-lambda';
import { formatSSEEvent } from './sseFormatter';
import { createBedrockClient, S3ReadError, BedrockApiError } from './bedrockClient';
import { createPerplexityClient, PerplexityApiError, SecretsManagerError } from './perplexityClient';

/**
 * Valid action types for streaming requests
 */
export type StreamingAction = 'analyze' | 'optimize' | 'cdk_modules';

/**
 * Request body interface for streaming endpoints
 */
export interface StreamingRequest {
  action: StreamingAction;
  s3Key: string;
  language?: string;
}

/**
 * SSE response headers for streaming
 */
/**
 * SSE response headers for streaming
 */
function getSSEHeaders(): Record<string, string> {
  return {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': process.env.ALLOWED_ORIGIN || '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

/**
 * Validates the streaming request body
 *
 * @param body - The parsed request body
 * @returns Object with isValid flag and optional error message
 */
export function validateRequest(body: unknown): {
  isValid: boolean;
  error?: string;
  request?: StreamingRequest;
} {
  if (!body || typeof body !== 'object') {
    return { isValid: false, error: 'Request body is required' };
  }

  const request = body as Record<string, unknown>;

  if (!request.action) {
    return { isValid: false, error: 'Missing required field: action' };
  }

  if (!request.s3Key) {
    return { isValid: false, error: 'Missing required field: s3Key' };
  }

  const validActions: StreamingAction[] = ['analyze', 'optimize', 'cdk_modules'];
  if (!validActions.includes(request.action as StreamingAction)) {
    return {
      isValid: false,
      error: `Invalid action: ${request.action}. Must be one of: ${validActions.join(', ')}`,
    };
  }

  if (typeof request.s3Key !== 'string' || request.s3Key.trim() === '') {
    return { isValid: false, error: 's3Key must be a non-empty string' };
  }

  return {
    isValid: true,
    request: {
      action: request.action as StreamingAction,
      s3Key: request.s3Key as string,
      language: typeof request.language === 'string' ? request.language : undefined,
    },
  };
}

/**
 * Parses the request body from the API Gateway event
 *
 * @param event - The API Gateway proxy event
 * @returns Parsed body object or null if parsing fails
 */
export function parseRequestBody(event: APIGatewayProxyEvent): unknown {
  if (!event.body) {
    return null;
  }

  try {
    const body = event.isBase64Encoded
      ? Buffer.from(event.body, 'base64').toString('utf-8')
      : event.body;
    return JSON.parse(body);
  } catch {
    return null;
  }
}

/**
 * Streaming Lambda handler using awslambda.streamifyResponse
 *
 * This handler:
 * 1. Parses and validates the incoming request
 * 2. Sets up SSE response headers
 * 3. Streams events based on the requested action
 * 4. Handles errors gracefully with error events
 *
 * Note: Authentication is handled by AWS IAM via CloudFront OAC.
 * Direct access to the Lambda Function URL requires valid AWS credentials.
 *
 * @param event - API Gateway proxy event
 * @param responseStream - HTTP response stream for SSE output
 * @param _context - Lambda context (unused but required by signature)
 */
export const handler = awslambda.streamifyResponse(
  async (
    event: APIGatewayProxyEvent,
    responseStream: awslambda.HttpResponseStream,
    _context: Context
  ): Promise<void> => {
    // Log the incoming event for debugging
    console.log('Event received:', JSON.stringify({
      httpMethod: event.httpMethod,
      requestContext: event.requestContext,
      path: event.path,
      hasBody: !!event.body,
      isBase64Encoded: event.isBase64Encoded,
      bodyLength: event.body?.length,
      headers: event.headers,
    }));

    // Set up response metadata with SSE headers
    const metadata: Record<string, unknown> = {
      statusCode: 200,
      headers: getSSEHeaders(),
    };

    // Create the HTTP response stream with metadata
    responseStream = awslambda.HttpResponseStream.from(responseStream, metadata);

    try {
      // Parse request body
      const body = parseRequestBody(event);
      console.log('Parsed body:', JSON.stringify(body));
      if (body === null) {
        responseStream.write(
          formatSSEEvent('error', { message: 'Invalid or missing request body' })
        );
        responseStream.end();
        return;
      }

      // Validate request
      const validation = validateRequest(body);
      if (!validation.isValid) {
        responseStream.write(
          formatSSEEvent('error', { message: validation.error })
        );
        responseStream.end();
        return;
      }

      const request = validation.request!;

      // Get the diagram bucket from environment variable
      const diagramBucket = process.env.DIAGRAM_BUCKET;
      if (!diagramBucket) {
        responseStream.write(
          formatSSEEvent('error', { message: 'DIAGRAM_BUCKET environment variable not configured' })
        );
        responseStream.end();
        return;
      }

      // Handle analyze and optimize actions with Bedrock
      if (request.action === 'analyze' || request.action === 'optimize') {
        const bedrockClient = createBedrockClient();

        // Retrieve image from S3
        const { base64Data, mediaType } = await bedrockClient.getImageFromS3(
          diagramBucket,
          request.s3Key
        );

        // Stream analysis/optimization from Bedrock
        await bedrockClient.streamAnalysis(
          base64Data,
          mediaType,
          responseStream,
          request.action
        );

        // Send completion marker
        responseStream.write(formatSSEEvent('[DONE]', {}));
      } else if (request.action === 'cdk_modules') {
        // Get analysis context - for now use a placeholder based on s3Key
        // In a full implementation, this would retrieve the previous analysis result
        const analysisContext = `Architecture diagram from S3 key: ${request.s3Key}. Please identify the CDK modules needed to implement this architecture.`;

        // Create Perplexity client and stream CDK modules breakdown
        const perplexityClient = createPerplexityClient();

        await perplexityClient.streamCdkModules(analysisContext, responseStream);

        // Send completion marker
        responseStream.write(formatSSEEvent('[DONE]', {}));
      }
    } catch (error) {
      // Handle specific error types with descriptive messages
      let errorMessage: string;

      if (error instanceof S3ReadError) {
        errorMessage = `Failed to read image from S3: ${error.message.replace('Failed to read image from S3: ', '')}`;
      } else if (error instanceof BedrockApiError) {
        errorMessage = error.message;
      } else if (error instanceof PerplexityApiError) {
        errorMessage = error.message;
      } else if (error instanceof SecretsManagerError) {
        errorMessage = error.message;
      } else {
        errorMessage = error instanceof Error ? error.message : 'An unexpected error occurred';
      }

      responseStream.write(formatSSEEvent('error', { message: errorMessage }));
    } finally {
      // Always close the stream gracefully
      responseStream.end();
    }
  }
);
