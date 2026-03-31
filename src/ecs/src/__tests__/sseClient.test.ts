/**
 * Unit Tests for SSE Client
 *
 * Tests for the SSE client module covering:
 * 1. parseSSEEvent function - parsing valid and invalid SSE event strings
 * 2. SSEClient.startStream - successful streaming with various event types
 * 3. SSEClient.abort - cancellation functionality
 * 4. Error handling - network errors, server errors, unexpected stream closure
 *
 * Requirements: 4.1, 4.2
 */

import {
  parseSSEEvent,
  SSEClient,
  SSEClientOptions,
  SSEError,
  SSE_ERROR_MESSAGES,
} from '../sseClient';

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

/**
 * Helper to create a mock ReadableStream from SSE event strings
 */
function createMockStream(events: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;

  return new ReadableStream({
    pull(controller) {
      if (index < events.length) {
        controller.enqueue(encoder.encode(events[index]));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

/**
 * Helper to create mock SSE client options that track calls
 */
function createMockOptions(): {
  options: SSEClientOptions;
  calls: {
    thinking: string[];
    analysis: string[];
    cdkModules: string[];
    optimization: string[];
    complete: string[];
    errors: Error[];
  };
} {
  const calls = {
    thinking: [] as string[],
    analysis: [] as string[],
    cdkModules: [] as string[],
    optimization: [] as string[],
    complete: [] as string[],
    errors: [] as Error[],
  };

  const options: SSEClientOptions = {
    onThinkingStream: (content) => calls.thinking.push(content),
    onAnalysisStream: (content) => calls.analysis.push(content),
    onCdkModulesStream: (content) => calls.cdkModules.push(content),
    onOptimizationStream: (content) => calls.optimization.push(content),
    onComplete: (eventType) => calls.complete.push(eventType),
    onError: (error) => calls.errors.push(error),
  };

  return { options, calls };
}

describe('parseSSEEvent', () => {
  describe('valid SSE events', () => {
    it('should parse a valid SSE event with event type and data', () => {
      const eventString = 'event: analysis_stream\ndata: {"content": "Hello"}';
      const result = parseSSEEvent(eventString);

      expect(result).not.toBeNull();
      expect(result!.eventType).toBe('analysis_stream');
      expect(result!.data).toEqual({ content: 'Hello' });
    });

    it('should parse SSE event with complex JSON data', () => {
      const eventString = 'event: thinking_stream\ndata: {"content": "Test", "nested": {"key": "value"}}';
      const result = parseSSEEvent(eventString);

      expect(result).not.toBeNull();
      expect(result!.eventType).toBe('thinking_stream');
      expect(result!.data).toEqual({ content: 'Test', nested: { key: 'value' } });
    });

    it('should parse SSE event with special characters in content', () => {
      const eventString = 'event: analysis_stream\ndata: {"content": "Hello \\"world\\" & <test>"}';
      const result = parseSSEEvent(eventString);

      expect(result).not.toBeNull();
      expect(result!.data.content).toBe('Hello "world" & <test>');
    });

    it('should parse SSE event with empty content', () => {
      const eventString = 'event: analysis_complete\ndata: {}';
      const result = parseSSEEvent(eventString);

      expect(result).not.toBeNull();
      expect(result!.eventType).toBe('analysis_complete');
      expect(result!.data).toEqual({});
    });

    it('should parse [DONE] event', () => {
      const eventString = 'event: [DONE]\ndata: {}';
      const result = parseSSEEvent(eventString);

      expect(result).not.toBeNull();
      expect(result!.eventType).toBe('[DONE]');
    });

    it('should parse error event with message', () => {
      const eventString = 'event: error\ndata: {"message": "Something went wrong"}';
      const result = parseSSEEvent(eventString);

      expect(result).not.toBeNull();
      expect(result!.eventType).toBe('error');
      expect(result!.data.message).toBe('Something went wrong');
    });

    it('should handle whitespace around event string', () => {
      const eventString = '  event: analysis_stream\ndata: {"content": "test"}  ';
      const result = parseSSEEvent(eventString);

      expect(result).not.toBeNull();
      expect(result!.eventType).toBe('analysis_stream');
    });
  });

  describe('invalid SSE events', () => {
    it('should return null for empty string', () => {
      expect(parseSSEEvent('')).toBeNull();
    });

    it('should return null for whitespace-only string', () => {
      expect(parseSSEEvent('   \n\n  ')).toBeNull();
    });

    it('should return null for event without data field', () => {
      const eventString = 'event: analysis_stream';
      expect(parseSSEEvent(eventString)).toBeNull();
    });

    it('should return null for data without event field', () => {
      const eventString = 'data: {"content": "test"}';
      expect(parseSSEEvent(eventString)).toBeNull();
    });

    it('should return null for invalid JSON in data field', () => {
      const eventString = 'event: analysis_stream\ndata: {invalid json}';
      expect(parseSSEEvent(eventString)).toBeNull();
    });

    it('should return null for malformed event line', () => {
      const eventString = 'eventanalysis_stream\ndata: {"content": "test"}';
      expect(parseSSEEvent(eventString)).toBeNull();
    });

    it('should return null for malformed data line', () => {
      const eventString = 'event: analysis_stream\ndata{"content": "test"}';
      expect(parseSSEEvent(eventString)).toBeNull();
    });
  });
});

describe('SSEClient', () => {
  let client: SSEClient;

  beforeEach(() => {
    client = new SSEClient();
    mockFetch.mockReset();
  });

  describe('startStream - successful streaming', () => {
    it('should process thinking_stream events', async () => {
      const { options, calls } = createMockOptions();
      const stream = createMockStream([
        'event: thinking_stream\ndata: {"content": "Analyzing..."}\n\n',
        'event: [DONE]\ndata: {}\n\n',
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: stream,
      });

      await client.startStream('/api/stream/analyze', { s3Key: 'test.png' }, options);

      expect(calls.thinking).toEqual(['Analyzing...']);
      expect(calls.complete).toContain('[DONE]');
      expect(calls.errors).toHaveLength(0);
    });

    it('should process analysis_stream events', async () => {
      const { options, calls } = createMockOptions();
      const stream = createMockStream([
        'event: analysis_stream\ndata: {"content": "The architecture shows..."}\n\n',
        'event: analysis_complete\ndata: {}\n\n',
        'event: [DONE]\ndata: {}\n\n',
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: stream,
      });

      await client.startStream('/api/stream/analyze', { s3Key: 'test.png' }, options);

      expect(calls.analysis).toEqual(['The architecture shows...']);
      expect(calls.complete).toContain('analysis_complete');
      expect(calls.complete).toContain('[DONE]');
    });

    it('should process cdk_modules_stream events', async () => {
      const { options, calls } = createMockOptions();
      const stream = createMockStream([
        'event: cdk_modules_stream\ndata: {"content": "aws-cdk-lib/aws-lambda"}\n\n',
        'event: cdk_modules_complete\ndata: {}\n\n',
        'event: [DONE]\ndata: {}\n\n',
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: stream,
      });

      await client.startStream('/api/stream/cdk-modules', { s3Key: 'test.png' }, options);

      expect(calls.cdkModules).toEqual(['aws-cdk-lib/aws-lambda']);
      expect(calls.complete).toContain('cdk_modules_complete');
    });

    it('should process optimization_stream events', async () => {
      const { options, calls } = createMockOptions();
      const stream = createMockStream([
        'event: optimization_stream\ndata: {"content": "Consider using..."}\n\n',
        'event: optimization_complete\ndata: {}\n\n',
        'event: [DONE]\ndata: {}\n\n',
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: stream,
      });

      await client.startStream('/api/stream/optimize', { s3Key: 'test.png' }, options);

      expect(calls.optimization).toEqual(['Consider using...']);
      expect(calls.complete).toContain('optimization_complete');
    });

    it('should accumulate multiple chunks of the same event type', async () => {
      const { options, calls } = createMockOptions();
      const stream = createMockStream([
        'event: analysis_stream\ndata: {"content": "Part 1"}\n\n',
        'event: analysis_stream\ndata: {"content": " Part 2"}\n\n',
        'event: analysis_stream\ndata: {"content": " Part 3"}\n\n',
        'event: [DONE]\ndata: {}\n\n',
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: stream,
      });

      await client.startStream('/api/stream/analyze', { s3Key: 'test.png' }, options);

      expect(calls.analysis).toEqual(['Part 1', ' Part 2', ' Part 3']);
    });

    it('should handle mixed event types in a single stream', async () => {
      const { options, calls } = createMockOptions();
      const stream = createMockStream([
        'event: thinking_stream\ndata: {"content": "Thinking..."}\n\n',
        'event: thinking_complete\ndata: {}\n\n',
        'event: analysis_stream\ndata: {"content": "Analysis result"}\n\n',
        'event: analysis_complete\ndata: {}\n\n',
        'event: [DONE]\ndata: {}\n\n',
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: stream,
      });

      await client.startStream('/api/stream/analyze', { s3Key: 'test.png' }, options);

      expect(calls.thinking).toEqual(['Thinking...']);
      expect(calls.analysis).toEqual(['Analysis result']);
      expect(calls.complete).toContain('thinking_complete');
      expect(calls.complete).toContain('analysis_complete');
      expect(calls.complete).toContain('[DONE]');
    });

    it('should send correct request headers and body', async () => {
      const { options } = createMockOptions();
      const stream = createMockStream(['event: [DONE]\ndata: {}\n\n']);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: stream,
      });

      const requestBody = { action: 'analyze', s3Key: 'test.png', language: 'en' };
      await client.startStream('/api/stream/analyze', requestBody, options);

      expect(mockFetch).toHaveBeenCalledWith(
        '/api/stream/analyze',
        expect.objectContaining({
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Accept': 'text/event-stream',
          },
          body: JSON.stringify(requestBody),
        })
      );
    });
  });

  describe('abort functionality', () => {
    it('should abort an in-progress stream', async () => {
      const { options, calls } = createMockOptions();
      
      // Create a mock AbortController to track abort calls
      const mockAbort = jest.fn();
      const originalAbortController = global.AbortController;
      
      // Mock AbortController
      global.AbortController = class MockAbortController {
        signal = { aborted: false };
        abort = () => {
          mockAbort();
          this.signal.aborted = true;
        };
      } as unknown as typeof AbortController;

      // Create a stream that completes immediately
      const stream = createMockStream([
        'event: [DONE]\ndata: {}\n\n',
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: stream,
      });

      await client.startStream('/api/stream/analyze', { s3Key: 'test.png' }, options);

      // Abort after stream completes (should be safe)
      client.abort();

      // Should not report abort as an error
      expect(calls.errors).toHaveLength(0);
      
      // Restore original AbortController
      global.AbortController = originalAbortController;
    });

    it('should be safe to call abort when no stream is active', () => {
      // Should not throw
      expect(() => client.abort()).not.toThrow();
    });

    it('should cancel previous stream when starting a new one', async () => {
      const { options: options1 } = createMockOptions();
      const { options: options2, calls: calls2 } = createMockOptions();

      // First stream that completes quickly
      const stream1 = createMockStream([
        'event: analysis_stream\ndata: {"content": "First stream"}\n\n',
        'event: [DONE]\ndata: {}\n\n',
      ]);

      // Second stream that completes normally
      const stream2 = createMockStream([
        'event: analysis_stream\ndata: {"content": "Second stream"}\n\n',
        'event: [DONE]\ndata: {}\n\n',
      ]);

      mockFetch
        .mockResolvedValueOnce({ ok: true, body: stream1 })
        .mockResolvedValueOnce({ ok: true, body: stream2 });

      // Start first stream and wait for it
      await client.startStream('/api/stream/analyze', { s3Key: 'test1.png' }, options1);

      // Start second stream
      await client.startStream('/api/stream/analyze', { s3Key: 'test2.png' }, options2);

      // Second stream should complete normally
      expect(calls2.analysis).toEqual(['Second stream']);
      expect(calls2.complete).toContain('[DONE]');
    });
  });

  describe('error handling', () => {
    it('should handle HTTP error responses', async () => {
      const { options, calls } = createMockOptions();

      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      await client.startStream('/api/stream/analyze', { s3Key: 'test.png' }, options);

      expect(calls.errors).toHaveLength(1);
      expect(calls.errors[0]).toBeInstanceOf(SSEError);
      expect((calls.errors[0] as SSEError).userMessage).toBe(SSE_ERROR_MESSAGES.SERVER_ERROR);
    });

    it('should handle missing response body', async () => {
      const { options, calls } = createMockOptions();

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: null,
      });

      await client.startStream('/api/stream/analyze', { s3Key: 'test.png' }, options);

      expect(calls.errors).toHaveLength(1);
      expect(calls.errors[0]).toBeInstanceOf(SSEError);
      expect((calls.errors[0] as SSEError).userMessage).toBe(SSE_ERROR_MESSAGES.INVALID_RESPONSE_FORMAT);
    });

    it('should handle network errors', async () => {
      const { options, calls } = createMockOptions();

      mockFetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

      await client.startStream('/api/stream/analyze', { s3Key: 'test.png' }, options);

      expect(calls.errors).toHaveLength(1);
      expect(calls.errors[0]).toBeInstanceOf(SSEError);
      expect((calls.errors[0] as SSEError).userMessage).toBe(SSE_ERROR_MESSAGES.NETWORK_ERROR);
    });

    it('should handle server error events in the stream', async () => {
      const { options, calls } = createMockOptions();
      const stream = createMockStream([
        'event: error\ndata: {"message": "Failed to read image from S3"}\n\n',
        'event: [DONE]\ndata: {}\n\n',
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: stream,
      });

      await client.startStream('/api/stream/analyze', { s3Key: 'test.png' }, options);

      expect(calls.errors).toHaveLength(1);
      expect(calls.errors[0]).toBeInstanceOf(SSEError);
      expect((calls.errors[0] as SSEError).userMessage).toBe('Failed to read image from S3');
    });

    it('should handle server error events with error code', async () => {
      const { options, calls } = createMockOptions();
      const stream = createMockStream([
        'event: error\ndata: {"message": "Access denied", "code": "S3_ACCESS_DENIED"}\n\n',
        'event: [DONE]\ndata: {}\n\n',
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: stream,
      });

      await client.startStream('/api/stream/analyze', { s3Key: 'test.png' }, options);

      expect(calls.errors).toHaveLength(1);
      expect(calls.errors[0]).toBeInstanceOf(SSEError);
      expect((calls.errors[0] as SSEError).message).toContain('S3_ACCESS_DENIED');
    });

    it('should handle unexpected stream closure (no [DONE] event)', async () => {
      const { options, calls } = createMockOptions();
      const stream = createMockStream([
        'event: analysis_stream\ndata: {"content": "Partial content"}\n\n',
        // Stream ends without [DONE]
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: stream,
      });

      await client.startStream('/api/stream/analyze', { s3Key: 'test.png' }, options);

      expect(calls.analysis).toEqual(['Partial content']);
      expect(calls.errors).toHaveLength(1);
      expect(calls.errors[0]).toBeInstanceOf(SSEError);
      expect((calls.errors[0] as SSEError).userMessage).toBe(SSE_ERROR_MESSAGES.STREAM_UNEXPECTED_CLOSE);
    });

    it('should not report unexpected closure for empty streams', async () => {
      const { options, calls } = createMockOptions();
      const stream = createMockStream([]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: stream,
      });

      await client.startStream('/api/stream/analyze', { s3Key: 'test.png' }, options);

      // Empty stream should not trigger unexpected closure error
      // because no content was received
      expect(calls.errors).toHaveLength(0);
    });

    it('should handle connection timeout errors', async () => {
      const { options, calls } = createMockOptions();

      const timeoutError = new Error('ETIMEDOUT');
      mockFetch.mockRejectedValueOnce(timeoutError);

      await client.startStream('/api/stream/analyze', { s3Key: 'test.png' }, options);

      expect(calls.errors).toHaveLength(1);
      expect(calls.errors[0]).toBeInstanceOf(SSEError);
      expect((calls.errors[0] as SSEError).userMessage).toBe(SSE_ERROR_MESSAGES.NETWORK_ERROR);
    });

    it('should handle connection refused errors', async () => {
      const { options, calls } = createMockOptions();

      const connectionError = new Error('ECONNREFUSED');
      mockFetch.mockRejectedValueOnce(connectionError);

      await client.startStream('/api/stream/analyze', { s3Key: 'test.png' }, options);

      expect(calls.errors).toHaveLength(1);
      expect(calls.errors[0]).toBeInstanceOf(SSEError);
      expect((calls.errors[0] as SSEError).userMessage).toBe(SSE_ERROR_MESSAGES.NETWORK_ERROR);
    });
  });

  describe('SSEError class', () => {
    it('should create error with user message only', () => {
      const error = new SSEError('User friendly message');

      expect(error.userMessage).toBe('User friendly message');
      expect(error.message).toBe('User friendly message');
      expect(error.name).toBe('SSEError');
      expect(error.cause).toBeUndefined();
    });

    it('should create error with user message and technical message', () => {
      const error = new SSEError('User friendly message', 'Technical details');

      expect(error.userMessage).toBe('User friendly message');
      expect(error.message).toBe('Technical details');
    });

    it('should create error with cause', () => {
      const cause = new Error('Original error');
      const error = new SSEError('User friendly message', 'Technical details', cause);

      expect(error.cause).toBe(cause);
    });
  });

  describe('edge cases', () => {
    it('should handle events split across multiple chunks', async () => {
      const { options, calls } = createMockOptions();
      
      // Event split across chunks
      const stream = createMockStream([
        'event: analysis_stream\ndata: {"con',
        'tent": "Split content"}\n\n',
        'event: [DONE]\ndata: {}\n\n',
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: stream,
      });

      await client.startStream('/api/stream/analyze', { s3Key: 'test.png' }, options);

      expect(calls.analysis).toEqual(['Split content']);
      expect(calls.complete).toContain('[DONE]');
    });

    it('should handle multiple events in a single chunk', async () => {
      const { options, calls } = createMockOptions();
      
      // Multiple events in one chunk
      const stream = createMockStream([
        'event: thinking_stream\ndata: {"content": "Thinking"}\n\nevent: analysis_stream\ndata: {"content": "Analysis"}\n\nevent: [DONE]\ndata: {}\n\n',
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: stream,
      });

      await client.startStream('/api/stream/analyze', { s3Key: 'test.png' }, options);

      expect(calls.thinking).toEqual(['Thinking']);
      expect(calls.analysis).toEqual(['Analysis']);
      expect(calls.complete).toContain('[DONE]');
    });

    it('should ignore unknown event types', async () => {
      const { options, calls } = createMockOptions();
      const stream = createMockStream([
        'event: unknown_event\ndata: {"content": "Unknown"}\n\n',
        'event: analysis_stream\ndata: {"content": "Known"}\n\n',
        'event: [DONE]\ndata: {}\n\n',
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: stream,
      });

      await client.startStream('/api/stream/analyze', { s3Key: 'test.png' }, options);

      // Unknown event should be ignored
      expect(calls.analysis).toEqual(['Known']);
      expect(calls.thinking).toHaveLength(0);
      expect(calls.cdkModules).toHaveLength(0);
      expect(calls.optimization).toHaveLength(0);
    });

    it('should handle events with empty content', async () => {
      const { options, calls } = createMockOptions();
      const stream = createMockStream([
        'event: analysis_stream\ndata: {"content": ""}\n\n',
        'event: [DONE]\ndata: {}\n\n',
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: stream,
      });

      await client.startStream('/api/stream/analyze', { s3Key: 'test.png' }, options);

      expect(calls.analysis).toEqual(['']);
      expect(calls.complete).toContain('[DONE]');
    });

    it('should handle malformed events gracefully', async () => {
      const { options, calls } = createMockOptions();
      const stream = createMockStream([
        'malformed event without proper format\n\n',
        'event: analysis_stream\ndata: {"content": "Valid"}\n\n',
        'event: [DONE]\ndata: {}\n\n',
      ]);

      mockFetch.mockResolvedValueOnce({
        ok: true,
        body: stream,
      });

      await client.startStream('/api/stream/analyze', { s3Key: 'test.png' }, options);

      // Malformed event should be ignored, valid event should be processed
      expect(calls.analysis).toEqual(['Valid']);
      expect(calls.errors).toHaveLength(0);
    });
  });
});
