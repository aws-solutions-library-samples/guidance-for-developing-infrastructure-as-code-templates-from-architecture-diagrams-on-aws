/**
 * Bedrock Client Module
 *
 * Provides streaming integration with Amazon Bedrock for architecture
 * diagram analysis and optimization using Claude models.
 *
 * @module bedrockClient
 */

import {
  BedrockRuntimeClient,
  InvokeModelWithResponseStreamCommand,
  ResponseStream,
} from '@aws-sdk/client-bedrock-runtime';
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { formatSSEEvent } from './sseFormatter';

/**
 * Custom error class for S3 read failures
 */
export class S3ReadError extends Error {
  public readonly bucket: string;
  public readonly key: string;

  constructor(message: string, bucket: string, key: string) {
    super(`Failed to read image from S3: ${message}`);
    this.name = 'S3ReadError';
    this.bucket = bucket;
    this.key = key;
  }
}

/**
 * Custom error class for Bedrock API failures
 */
export class BedrockApiError extends Error {
  constructor(message: string) {
    super(`Bedrock API error: ${message}`);
    this.name = 'BedrockApiError';
  }
}

/**
 * Content source types for event mapping
 */
export type ContentSource = 'thinking' | 'analysis' | 'optimization';

/**
 * Maps content source to SSE event type
 */
export function mapSourceToEventType(source: ContentSource): string {
  const mapping: Record<ContentSource, string> = {
    thinking: 'thinking_stream',
    analysis: 'analysis_stream',
    optimization: 'optimization_stream',
  };
  return mapping[source];
}

/**
 * Configuration for Bedrock streaming
 */
export interface BedrockStreamConfig {
  modelId: string;
  region?: string;
}

/**
 * Callback type for streaming chunks
 */
export type StreamChunkCallback = (chunk: string) => void;

/**
 * Bedrock streaming client for architecture analysis
 */
export class BedrockStreamingClient {
  private bedrockClient: BedrockRuntimeClient;
  private s3Client: S3Client;
  private modelId: string;

  constructor(config?: Partial<BedrockStreamConfig>) {
    const region = config?.region || process.env.REGION || process.env.AWS_REGION || 'us-west-2';
    this.modelId = config?.modelId || process.env.BEDROCK_MODEL_ID || 'us.anthropic.claude-sonnet-4-5-20250929-v1:0';

    this.bedrockClient = new BedrockRuntimeClient({ region });
    this.s3Client = new S3Client({ region });
  }

  /**
   * Retrieves an image from S3 and returns it as base64
   *
   * @param bucket - S3 bucket name
   * @param key - S3 object key
   * @returns Base64 encoded image data and media type
   * @throws S3ReadError if S3 read fails
   */
  async getImageFromS3(
    bucket: string,
    key: string
  ): Promise<{ base64Data: string; mediaType: string }> {
    try {
      const command = new GetObjectCommand({
        Bucket: bucket,
        Key: key,
      });

      const response = await this.s3Client.send(command);

      if (!response.Body) {
        throw new S3ReadError('Empty response body from S3', bucket, key);
      }

      const bodyBytes = await response.Body.transformToByteArray();
      const base64Data = Buffer.from(bodyBytes).toString('base64');

      // Determine media type from content type or key extension
      let mediaType = response.ContentType || 'image/png';
      if (key.toLowerCase().endsWith('.jpg') || key.toLowerCase().endsWith('.jpeg')) {
        mediaType = 'image/jpeg';
      } else if (key.toLowerCase().endsWith('.png')) {
        mediaType = 'image/png';
      } else if (key.toLowerCase().endsWith('.gif')) {
        mediaType = 'image/gif';
      } else if (key.toLowerCase().endsWith('.webp')) {
        mediaType = 'image/webp';
      }

      return { base64Data, mediaType };
    } catch (error) {
      // Re-throw if already an S3ReadError
      if (error instanceof S3ReadError) {
        throw error;
      }
      // Wrap other errors as S3ReadError
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new S3ReadError(errorMessage, bucket, key);
    }
  }

  /**
   * Streams architecture analysis from Bedrock Claude model
   *
   * @param imageBase64 - Base64 encoded image data
   * @param mediaType - Image media type (e.g., 'image/png')
   * @param responseStream - Lambda response stream for SSE output
   * @param action - The action type ('analyze' or 'optimize')
   * @throws BedrockApiError if Bedrock API call fails
   */
  async streamAnalysis(
    imageBase64: string,
    mediaType: string,
    responseStream: NodeJS.WritableStream,
    action: 'analyze' | 'optimize'
  ): Promise<void> {
    try {
      const systemPrompt = action === 'analyze'
        ? this.getAnalysisSystemPrompt()
        : this.getOptimizationSystemPrompt();

      const userPrompt = action === 'analyze'
        ? 'Please analyze this AWS architecture diagram. Identify all services, their connections, and provide a detailed breakdown of the architecture.'
        : 'Please review this AWS architecture diagram and suggest optimizations for cost, performance, security, and reliability.';

      const requestBody = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 4096,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: imageBase64,
                },
              },
              {
                type: 'text',
                text: userPrompt,
              },
            ],
          },
        ],
      };

      const command = new InvokeModelWithResponseStreamCommand({
        modelId: this.modelId,
        contentType: 'application/json',
        accept: 'application/json',
        body: JSON.stringify(requestBody),
      });

      const response = await this.bedrockClient.send(command);

      if (!response.body) {
        throw new BedrockApiError('No response body from Bedrock');
      }

      const eventType = action === 'analyze' ? 'analysis_stream' : 'optimization_stream';
      const completeEventType = action === 'analyze' ? 'analysis_complete' : 'optimization_complete';

      // Process the streaming response
      await this.processBedrockStream(response.body, responseStream, eventType);

      // Send completion event
      responseStream.write(formatSSEEvent(completeEventType, {}));
    } catch (error) {
      // Re-throw if already a BedrockApiError
      if (error instanceof BedrockApiError) {
        throw error;
      }
      // Wrap other errors as BedrockApiError
      const errorMessage = error instanceof Error ? error.message : 'Unknown Bedrock error';
      throw new BedrockApiError(errorMessage);
    }
  }

  /**
   * Processes Bedrock streaming response and forwards chunks as SSE events
   *
   * @param stream - Bedrock response stream
   * @param responseStream - Lambda response stream for SSE output
   * @param eventType - SSE event type to use for content chunks
   */
  private async processBedrockStream(
    stream: AsyncIterable<ResponseStream>,
    responseStream: NodeJS.WritableStream,
    eventType: string
  ): Promise<void> {
    let isThinking = false;

    for await (const event of stream) {
      if (event.chunk?.bytes) {
        const chunkData = JSON.parse(new TextDecoder().decode(event.chunk.bytes));

        // Handle different event types from Claude
        if (chunkData.type === 'content_block_start') {
          // Check if this is a thinking block
          if (chunkData.content_block?.type === 'thinking') {
            isThinking = true;
          } else {
            isThinking = false;
          }
        } else if (chunkData.type === 'content_block_delta') {
          const delta = chunkData.delta;

          if (delta?.type === 'thinking_delta' && delta.thinking) {
            // Forward thinking content
            responseStream.write(
              formatSSEEvent('thinking_stream', { content: delta.thinking })
            );
          } else if (delta?.type === 'text_delta' && delta.text) {
            // Forward text content with appropriate event type
            responseStream.write(
              formatSSEEvent(eventType, { content: delta.text })
            );
          }
        } else if (chunkData.type === 'message_delta') {
          // Message completion - could include stop reason
          if (chunkData.delta?.stop_reason) {
            // Stream completed normally
          }
        }
      }
    }
  }

  /**
   * Returns the system prompt for architecture analysis
   */
  private getAnalysisSystemPrompt(): string {
    return `You are an expert AWS Solutions Architect. Your task is to analyze AWS architecture diagrams and provide detailed breakdowns.

When analyzing a diagram, you should:
1. Identify all AWS services shown in the diagram
2. Describe the data flow and connections between services
3. Explain the purpose of each component
4. Identify any patterns or best practices being used
5. Do NOT provide any recommendations or optimizations - just analyze what's there.

Provide your analysis in a clear, concise, structured format with sections for:
- Overview
- Services Identified
- Data Flow
- Architecture Patterns

Do not ask any follow-up questions.`;
  }

  /**
   * Returns the system prompt for architecture optimization
   */
  private getOptimizationSystemPrompt(): string {
    return `You are an expert AWS Solutions Architect specializing in architecture optimization. Your task is to review AWS architecture diagrams and suggest improvements.

When reviewing a diagram, focus on:
1. Cost Optimization - Identify opportunities to reduce costs
2. Performance - Suggest ways to improve performance and reduce latency
3. Security - Identify security improvements and best practices
4. Reliability - Suggest ways to improve fault tolerance and availability
5. Operational Excellence - Recommend monitoring and automation improvements

Provide your recommendations in a clear, concise, structured format with specific, actionable suggestions for each area.
Provide reference links to related offical AWS documentation at the end of the response.
Do not ask any follow-up questions.`;
  }
}

/**
 * Creates a Bedrock streaming client with default configuration
 */
export function createBedrockClient(config?: Partial<BedrockStreamConfig>): BedrockStreamingClient {
  return new BedrockStreamingClient(config);
}
