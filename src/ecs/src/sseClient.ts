/**
 * SSE Client Module
 *
 * Provides a client for consuming Server-Sent Events (SSE) from the streaming API.
 * Uses Fetch API with ReadableStream for efficient streaming consumption.
 *
 * @module sseClient
 * Requirements: 4.1, 4.2, 4.8, 4.9
 */

/**
 * User-friendly error messages for different error types
 * Requirements: 4.8, 4.9
 */
export const SSE_ERROR_MESSAGES = {
  NETWORK_ERROR: 'Connection error. Please try again.',
  STREAM_UNEXPECTED_CLOSE: 'Stream ended unexpectedly',
  INVALID_RESPONSE_FORMAT: 'Invalid response format',
  SERVER_ERROR: 'Server error occurred',
} as const;

/**
 * Custom error class for SSE-specific errors with user-friendly messages
 * Requirements: 4.8, 4.9
 */
export class SSEError extends Error {
  /** User-friendly message suitable for display */
  public readonly userMessage: string;
  /** Original error that caused this SSE error, if any */
  public readonly cause?: Error;

  constructor(userMessage: string, technicalMessage?: string, cause?: Error) {
    super(technicalMessage || userMessage);
    this.name = 'SSEError';
    this.userMessage = userMessage;
    this.cause = cause;
  }
}

/**
 * Options for configuring SSE client event handlers
 */
export interface SSEClientOptions {
  /** Handler for thinking stream content */
  onThinkingStream: (content: string) => void;
  /** Handler for analysis stream content */
  onAnalysisStream: (content: string) => void;
  /** Handler for CDK modules stream content */
  onCdkModulesStream: (content: string) => void;
  /** Handler for optimization stream content */
  onOptimizationStream: (content: string) => void;
  /** Handler for stream completion events */
  onComplete: (eventType: string) => void;
  /** Handler for error events */
  onError: (error: Error) => void;
}

/**
 * Parsed SSE event structure
 */
export interface ParsedSSEEvent {
  eventType: string;
  data: Record<string, unknown>;
}

/**
 * Parses an SSE event string into its components.
 *
 * @param eventString - Raw SSE event string in format: event: <type>\ndata: <json>\n\n
 * @returns Parsed event object or null if parsing fails
 */
export function parseSSEEvent(eventString: string): ParsedSSEEvent | null {
  const trimmed = eventString.trim();
  if (!trimmed) {
    return null;
  }

  const lines = trimmed.split('\n');
  let eventType = '';
  let dataLine = '';

  for (const line of lines) {
    if (line.startsWith('event: ')) {
      eventType = line.slice(7);
    } else if (line.startsWith('data: ')) {
      dataLine = line.slice(6);
    }
  }

  if (!eventType || !dataLine) {
    return null;
  }

  try {
    const data = JSON.parse(dataLine);
    return { eventType, data };
  } catch {
    return null;
  }
}

/**
 * SSE Client for consuming streaming responses from the API.
 *
 * Uses Fetch API with ReadableStream to efficiently consume SSE events.
 * Supports stream cancellation via AbortController.
 *
 * Requirements: 4.1, 4.2, 4.8, 4.9
 */
export class SSEClient {
  private abortController: AbortController | null = null;
  /** Tracks whether a [DONE] event was received for proper stream closure detection */
  private receivedDone: boolean = false;

  /**
   * Starts a streaming request to the specified URL.
   *
   * @param url - The streaming endpoint URL
   * @param body - Request body to send (will be JSON stringified)
   * @param options - Event handlers for different stream types
   * @throws Error if the request fails or stream cannot be established
   */
  async startStream(url: string, body: object, options: SSEClientOptions): Promise<void> {
    // Cancel any existing stream
    this.abort();

    // Create new AbortController for this stream
    this.abortController = new AbortController();
    this.receivedDone = false;

    try {
      const bodyStr = JSON.stringify(body);

      // Compute SHA256 hash of the body for Lambda Function URL OAC
      // Lambda Function URLs require x-amz-content-sha256 for POST requests
      const encoder = new TextEncoder();
      const data = encoder.encode(bodyStr);
      const hashBuffer = await crypto.subtle.digest('SHA-256', data);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
          'x-amz-content-sha256': hashHex,
        },
        body: bodyStr,
        signal: this.abortController.signal,
      });

      if (!response.ok) {
        throw new SSEError(
          SSE_ERROR_MESSAGES.SERVER_ERROR,
          `HTTP error: ${response.status} ${response.statusText}`
        );
      }

      if (!response.body) {
        throw new SSEError(
          SSE_ERROR_MESSAGES.INVALID_RESPONSE_FORMAT,
          'Response body is not available'
        );
      }

      await this.processStream(response.body, options);
    } catch (error) {
      // Don't report abort errors as they are intentional (user-initiated)
      // Requirements: 4.8 - Handle abort signals without reporting as errors
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }

      // Convert network errors to user-friendly messages
      // Requirements: 4.9 - Handle connection errors with appropriate messages
      if (this.isNetworkError(error)) {
        options.onError(new SSEError(
          SSE_ERROR_MESSAGES.NETWORK_ERROR,
          error instanceof Error ? error.message : String(error),
          error instanceof Error ? error : undefined
        ));
        return;
      }

      // Pass through SSEError instances directly
      if (error instanceof SSEError) {
        options.onError(error);
        return;
      }

      // Wrap other errors
      options.onError(error instanceof Error ? error : new Error(String(error)));
    } finally {
      this.abortController = null;
    }
  }

  /**
   * Aborts the current streaming request if one is in progress.
   * Safe to call even if no stream is active.
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
  }

  /**
   * Checks if an error is a network-related error.
   * Requirements: 4.9
   *
   * @param error - The error to check
   * @returns true if the error is network-related
   */
  private isNetworkError(error: unknown): boolean {
    if (!(error instanceof Error)) {
      return false;
    }

    // TypeError is thrown by fetch for network failures
    if (error instanceof TypeError) {
      return true;
    }

    // Check for common network error messages
    const networkErrorPatterns = [
      'network',
      'failed to fetch',
      'net::',
      'connection',
      'timeout',
      'ECONNREFUSED',
      'ENOTFOUND',
      'ETIMEDOUT',
    ];

    const errorMessage = error.message.toLowerCase();
    return networkErrorPatterns.some(pattern => errorMessage.includes(pattern.toLowerCase()));
  }

  /**
   * Processes the ReadableStream and dispatches events to handlers.
   * Detects unexpected stream closure (no [DONE] event).
   *
   * @param body - The ReadableStream from the fetch response
   * @param options - Event handlers for different stream types
   * Requirements: 4.8 - Handle unexpected stream closure
   */
  private async processStream(body: ReadableStream<Uint8Array>, options: SSEClientOptions): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let hasReceivedAnyContent = false;

    try {
      while (true) {
        const { done, value } = await reader.read();

        if (done) {
          // Process any remaining data in buffer
          if (buffer.trim()) {
            this.processEventBuffer(buffer, options);
          }

          // Check for unexpected stream closure (no [DONE] event received)
          // Requirements: 4.8 - Handle unexpected stream closure
          if (hasReceivedAnyContent && !this.receivedDone) {
            options.onError(new SSEError(
              SSE_ERROR_MESSAGES.STREAM_UNEXPECTED_CLOSE,
              'Stream ended without [DONE] marker'
            ));
          }
          break;
        }

        // Decode the chunk and add to buffer
        buffer += decoder.decode(value, { stream: true });
        hasReceivedAnyContent = true;

        // Process complete events (separated by double newlines)
        const events = buffer.split('\n\n');
        
        // Keep the last incomplete event in the buffer
        buffer = events.pop() || '';

        // Process all complete events
        for (const eventString of events) {
          if (eventString.trim()) {
            this.processEventBuffer(eventString, options);
          }
        }
      }
    } catch (error) {
      // Handle stream read errors
      // Don't report abort errors
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }

      // Network errors during streaming
      if (this.isNetworkError(error)) {
        options.onError(new SSEError(
          SSE_ERROR_MESSAGES.NETWORK_ERROR,
          error instanceof Error ? error.message : String(error),
          error instanceof Error ? error : undefined
        ));
        return;
      }

      throw error;
    } finally {
      reader.releaseLock();
    }
  }

  /**
   * Processes a single SSE event and dispatches to the appropriate handler.
   * Tracks [DONE] events for proper stream closure detection.
   *
   * @param eventString - Raw SSE event string
   * @param options - Event handlers for different stream types
   * Requirements: 4.8 - Handle server error events
   */
  private processEventBuffer(eventString: string, options: SSEClientOptions): void {
    const parsed = parseSSEEvent(eventString);
    
    if (!parsed) {
      return;
    }

    const { eventType, data } = parsed;
    const content = typeof data.content === 'string' ? data.content : '';

    switch (eventType) {
      case 'thinking_stream':
        options.onThinkingStream(content);
        break;

      case 'analysis_stream':
        options.onAnalysisStream(content);
        break;

      case 'cdk_modules_stream':
        options.onCdkModulesStream(content);
        break;

      case 'optimization_stream':
        options.onOptimizationStream(content);
        break;

      case 'thinking_complete':
      case 'analysis_complete':
      case 'cdk_modules_complete':
      case 'optimization_complete':
        options.onComplete(eventType);
        break;

      case '[DONE]':
        // Mark that we received proper stream completion
        this.receivedDone = true;
        options.onComplete(eventType);
        break;

      case 'error':
        // Handle server error events
        // Requirements: 4.8 - Handle server error events from the SSE stream
        const message = typeof data.message === 'string' ? data.message : 'Unknown server error';
        const errorCode = typeof data.code === 'string' ? data.code : undefined;
        const technicalMessage = errorCode ? `${errorCode}: ${message}` : message;
        
        options.onError(new SSEError(message, technicalMessage));
        break;

      default:
        // Unknown event type - ignore
        break;
    }
  }
}
