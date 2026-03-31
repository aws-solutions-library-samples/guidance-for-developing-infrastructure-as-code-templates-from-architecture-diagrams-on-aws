/**
 * Perplexity Client Module
 *
 * Provides streaming integration with Perplexity API for CDK modules
 * breakdown using OpenAI-compatible streaming format.
 *
 * @module perplexityClient
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from '@aws-sdk/client-secrets-manager';
import { formatSSEEvent } from './sseFormatter';

/**
 * Custom error class for Secrets Manager failures
 */
export class SecretsManagerError extends Error {
  public readonly secretName: string;

  constructor(message: string, secretName: string) {
    super(`Failed to retrieve API key from Secrets Manager: ${message}`);
    this.name = 'SecretsManagerError';
    this.secretName = secretName;
  }
}

/**
 * Custom error class for Perplexity API failures
 */
export class PerplexityApiError extends Error {
  public readonly statusCode?: number;

  constructor(message: string, statusCode?: number) {
    super(`Perplexity API error: ${message}`);
    this.name = 'PerplexityApiError';
    this.statusCode = statusCode;
  }
}

/**
 * Configuration for Perplexity streaming
 */
export interface PerplexityStreamConfig {
  secretName?: string;
  region?: string;
  model?: string;
}

/**
 * Perplexity API response chunk structure (OpenAI-compatible)
 */
interface PerplexityStreamChunk {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    delta: {
      role?: string;
      content?: string;
    };
    finish_reason: string | null;
  }>;
}

/**
 * Perplexity streaming client for CDK modules breakdown
 */
export class PerplexityStreamingClient {
  private secretsClient: SecretsManagerClient;
  private secretName: string;
  private model: string;
  private apiKey: string | null = null;

  private static readonly PERPLEXITY_API_URL = 'https://api.perplexity.ai/chat/completions';

  constructor(config?: Partial<PerplexityStreamConfig>) {
    const region = config?.region || process.env.AWS_REGION || 'us-east-1';
    this.secretName = config?.secretName || process.env.PERPLEXITY_SECRET_NAME || 'perplexity-api-key';
    this.model = config?.model || process.env.PERPLEXITY_MODEL || 'llama-3.1-sonar-small-128k-online';

    this.secretsClient = new SecretsManagerClient({ region });
  }

  /**
   * Retrieves the Perplexity API key from Secrets Manager
   *
   * @returns The API key string
   * @throws SecretsManagerError if secret retrieval fails
   */
  async getApiKey(): Promise<string> {
    if (this.apiKey) {
      return this.apiKey;
    }

    try {
      const command = new GetSecretValueCommand({
        SecretId: this.secretName,
      });

      const response = await this.secretsClient.send(command);

      if (!response.SecretString) {
        throw new SecretsManagerError('Empty secret value', this.secretName);
      }

      // The secret may be a JSON object with an 'apiKey' field or a plain string
      try {
        const secretData = JSON.parse(response.SecretString);
        this.apiKey = secretData.apiKey || secretData.api_key || secretData.PERPLEXITY_API_KEY || response.SecretString;
      } catch {
        // If not JSON, use the raw string
        this.apiKey = response.SecretString;
      }

      return this.apiKey!;
    } catch (error) {
      // Re-throw if already a SecretsManagerError
      if (error instanceof SecretsManagerError) {
        throw error;
      }
      // Wrap other errors as SecretsManagerError
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      throw new SecretsManagerError(errorMessage, this.secretName);
    }
  }

  /**
   * Streams CDK modules breakdown from Perplexity API
   *
   * @param analysisContext - The architecture analysis context to use for CDK modules lookup
   * @param responseStream - Lambda response stream for SSE output
   * @throws PerplexityApiError if Perplexity API call fails
   * @throws SecretsManagerError if API key retrieval fails
   */
  async streamCdkModules(
    analysisContext: string,
    responseStream: NodeJS.WritableStream
  ): Promise<void> {
    const apiKey = await this.getApiKey();

    const systemPrompt = this.getCdkModulesSystemPrompt();
    const userPrompt = this.getCdkModulesUserPrompt(analysisContext);

    const requestBody = {
      model: this.model,
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: userPrompt,
        },
      ],
      stream: true,
      max_tokens: 4096,
    };

    try {
      const response = await fetch(PerplexityStreamingClient.PERPLEXITY_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new PerplexityApiError(`${response.status} - ${errorText}`, response.status);
      }

      if (!response.body) {
        throw new PerplexityApiError('No response body from Perplexity API');
      }

      // Process the streaming response
      await this.processPerplexityStream(response.body, responseStream);

      // Send completion event
      responseStream.write(formatSSEEvent('cdk_modules_complete', {}));
    } catch (error) {
      // Re-throw if already a PerplexityApiError or SecretsManagerError
      if (error instanceof PerplexityApiError || error instanceof SecretsManagerError) {
        throw error;
      }
      // Wrap other errors as PerplexityApiError
      const errorMessage = error instanceof Error ? error.message : 'Unknown Perplexity error';
      throw new PerplexityApiError(errorMessage);
    }
  }

  /**
   * Processes Perplexity streaming response and forwards chunks as SSE events
   *
   * @param stream - Perplexity response stream (ReadableStream)
   * @param responseStream - Lambda response stream for SSE output
   */
  private async processPerplexityStream(
    stream: ReadableStream<Uint8Array>,
    responseStream: NodeJS.WritableStream
  ): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          break;
        }

        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE lines from the buffer
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          const trimmedLine = line.trim();

          // Skip empty lines and comments
          if (!trimmedLine || trimmedLine.startsWith(':')) {
            continue;
          }

          // Handle SSE data lines
          if (trimmedLine.startsWith('data: ')) {
            const data = trimmedLine.slice(6);

            // Check for stream end marker
            if (data === '[DONE]') {
              continue;
            }

            try {
              const chunk: PerplexityStreamChunk = JSON.parse(data);

              // Extract content from the delta
              if (chunk.choices && chunk.choices.length > 0) {
                const delta = chunk.choices[0].delta;
                if (delta?.content) {
                  responseStream.write(
                    formatSSEEvent('cdk_modules_stream', { content: delta.content })
                  );
                }
              }
            } catch (parseError) {
              // Skip malformed JSON chunks
              console.warn('Failed to parse Perplexity chunk:', data);
            }
          }
        }
      }

      // Process any remaining data in the buffer
      if (buffer.trim()) {
        const trimmedLine = buffer.trim();
        if (trimmedLine.startsWith('data: ') && trimmedLine.slice(6) !== '[DONE]') {
          try {
            const chunk: PerplexityStreamChunk = JSON.parse(trimmedLine.slice(6));
            if (chunk.choices && chunk.choices.length > 0) {
              const delta = chunk.choices[0].delta;
              if (delta?.content) {
                responseStream.write(
                  formatSSEEvent('cdk_modules_stream', { content: delta.content })
                );
              }
            }
          } catch {
            // Ignore final malformed chunk
          }
        }
      }
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Returns the system prompt for CDK modules breakdown
   */
  private getCdkModulesSystemPrompt(): string {
    return `You are an expert AWS CDK developer. Your task is to identify the AWS CDK modules and constructs needed to implement an AWS architecture.

When analyzing an architecture, you should:
1. Identify all AWS services that need CDK modules
2. List the specific CDK construct library packages required (e.g., @aws-cdk/aws-lambda, @aws-cdk/aws-s3)
3. Suggest the appropriate L2 or L3 constructs for each service
4. Provide code snippets showing how to instantiate key constructs
5. Note any dependencies between constructs

Provide your response in a clear, structured format with:
- Required CDK Packages
- Construct Recommendations
- Code Examples
- Integration Notes`;
  }

  /**
   * Returns the user prompt for CDK modules breakdown
   *
   * @param analysisContext - The architecture analysis context
   */
  private getCdkModulesUserPrompt(analysisContext: string): string {
    return `Based on the following AWS architecture analysis, identify the CDK modules and constructs needed to implement this architecture:

${analysisContext}

Please provide a comprehensive breakdown of the CDK modules required, including specific construct recommendations and code examples.`;
  }
}

/**
 * Creates a Perplexity streaming client with default configuration
 */
export function createPerplexityClient(config?: Partial<PerplexityStreamConfig>): PerplexityStreamingClient {
  return new PerplexityStreamingClient(config);
}
