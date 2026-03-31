/**
 * Property-Based Tests for Error Event Handling
 *
 * **Property 6: Error Event Handling**
 * **Validates: Requirements 2.6, 4.8, 4.9**
 *
 * For any error that occurs during streaming (S3 read failure, Bedrock error,
 * Perplexity error, timeout), the Streaming Lambda should emit an error event
 * with a descriptive message, and the SSE Client should display the error
 * and abort the stream.
 */

import * as fc from 'fast-check';
import { formatSSEEvent, parseSSEEvent } from '../sseFormatter';
import { S3ReadError, BedrockApiError } from '../bedrockClient';
import { PerplexityApiError, SecretsManagerError } from '../perplexityClient';

describe('Error Event Handling Property Tests', () => {
  /**
   * Helper function to create an error SSE event from an Error instance
   * This mirrors the error handling logic in the streaming handler
   */
  function createErrorSSEEvent(error: Error): string {
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
      errorMessage = error.message || 'An unexpected error occurred';
    }

    return formatSSEEvent('error', { message: errorMessage });
  }

  /**
   * Generators for different error types
   */
  const s3BucketArb = fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789-'),
    { minLength: 3, maxLength: 63 }
  );

  const s3KeyArb = fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_./'),
    { minLength: 1, maxLength: 100 }
  );

  const errorMessageArb = fc.string({ minLength: 1, maxLength: 200 })
    .filter((s) => !s.includes('\n') && s.trim().length > 0);

  const httpStatusCodeArb = fc.integer({ min: 400, max: 599 });

  const secretNameArb = fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_/'),
    { minLength: 1, maxLength: 100 }
  );

  /**
   * Property: All error types produce valid SSE error events
   *
   * For any error type (S3ReadError, BedrockApiError, PerplexityApiError,
   * SecretsManagerError), the generated SSE event should have the correct format.
   */
  it('should produce valid SSE error events for all error types', () => {
    // Generator for S3ReadError
    const s3ReadErrorArb = fc.tuple(errorMessageArb, s3BucketArb, s3KeyArb)
      .map(([message, bucket, key]) => new S3ReadError(message, bucket, key));

    // Generator for BedrockApiError
    const bedrockApiErrorArb = errorMessageArb
      .map((message) => new BedrockApiError(message));

    // Generator for PerplexityApiError
    const perplexityApiErrorArb = fc.tuple(errorMessageArb, fc.option(httpStatusCodeArb))
      .map(([message, statusCode]) => new PerplexityApiError(message, statusCode ?? undefined));

    // Generator for SecretsManagerError
    const secretsManagerErrorArb = fc.tuple(errorMessageArb, secretNameArb)
      .map(([message, secretName]) => new SecretsManagerError(message, secretName));

    // Combined generator for all error types
    const anyErrorArb = fc.oneof(
      s3ReadErrorArb,
      bedrockApiErrorArb,
      perplexityApiErrorArb,
      secretsManagerErrorArb
    );

    fc.assert(
      fc.property(anyErrorArb, (error) => {
        const sseEvent = createErrorSSEEvent(error);

        // Verify SSE format: event: error\ndata: {...}\n\n
        expect(sseEvent).toMatch(/^event: error\ndata: \{.*\}\n\n$/);

        // Verify it starts with the correct event type
        expect(sseEvent.startsWith('event: error\n')).toBe(true);

        // Verify it ends with double newline
        expect(sseEvent.endsWith('\n\n')).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Error events have the correct format with message field
   *
   * The data payload of error events should contain a 'message' field
   * with a non-empty string value.
   */
  it('should produce error events with correct data format containing message field', () => {
    const anyErrorArb = fc.oneof(
      fc.tuple(errorMessageArb, s3BucketArb, s3KeyArb)
        .map(([message, bucket, key]) => new S3ReadError(message, bucket, key)),
      errorMessageArb.map((message) => new BedrockApiError(message)),
      fc.tuple(errorMessageArb, fc.option(httpStatusCodeArb))
        .map(([message, statusCode]) => new PerplexityApiError(message, statusCode ?? undefined)),
      fc.tuple(errorMessageArb, secretNameArb)
        .map(([message, secretName]) => new SecretsManagerError(message, secretName))
    );

    fc.assert(
      fc.property(anyErrorArb, (error) => {
        const sseEvent = createErrorSSEEvent(error);
        const parsed = parseSSEEvent(sseEvent);

        // Verify parsing succeeded
        expect(parsed).not.toBeNull();

        // Verify event type is 'error'
        expect(parsed!.eventType).toBe('error');

        // Verify data has message field
        const data = parsed!.data as { message?: unknown };
        expect(data).toHaveProperty('message');
        expect(typeof data.message).toBe('string');
        expect((data.message as string).length).toBeGreaterThan(0);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Error messages are descriptive and include relevant context
   *
   * Each error type should include contextual information in its message:
   * - S3ReadError: mentions S3 and the failure
   * - BedrockApiError: mentions Bedrock
   * - PerplexityApiError: mentions Perplexity
   * - SecretsManagerError: mentions Secrets Manager
   */
  it('should include relevant context in error messages', () => {
    // Test S3ReadError includes S3 context
    fc.assert(
      fc.property(
        fc.tuple(errorMessageArb, s3BucketArb, s3KeyArb),
        ([message, bucket, key]) => {
          const error = new S3ReadError(message, bucket, key);
          const sseEvent = createErrorSSEEvent(error);
          const parsed = parseSSEEvent(sseEvent);

          const errorMessage = (parsed!.data as { message: string }).message;
          expect(errorMessage.toLowerCase()).toContain('s3');
        }
      ),
      { numRuns: 100 }
    );

    // Test BedrockApiError includes Bedrock context
    fc.assert(
      fc.property(errorMessageArb, (message) => {
        const error = new BedrockApiError(message);
        const sseEvent = createErrorSSEEvent(error);
        const parsed = parseSSEEvent(sseEvent);

        const errorMessage = (parsed!.data as { message: string }).message;
        expect(errorMessage.toLowerCase()).toContain('bedrock');
      }),
      { numRuns: 100 }
    );

    // Test PerplexityApiError includes Perplexity context
    fc.assert(
      fc.property(
        fc.tuple(errorMessageArb, fc.option(httpStatusCodeArb)),
        ([message, statusCode]) => {
          const error = new PerplexityApiError(message, statusCode ?? undefined);
          const sseEvent = createErrorSSEEvent(error);
          const parsed = parseSSEEvent(sseEvent);

          const errorMessage = (parsed!.data as { message: string }).message;
          expect(errorMessage.toLowerCase()).toContain('perplexity');
        }
      ),
      { numRuns: 100 }
    );

    // Test SecretsManagerError includes Secrets Manager context
    fc.assert(
      fc.property(
        fc.tuple(errorMessageArb, secretNameArb),
        ([message, secretName]) => {
          const error = new SecretsManagerError(message, secretName);
          const sseEvent = createErrorSSEEvent(error);
          const parsed = parseSSEEvent(sseEvent);

          const errorMessage = (parsed!.data as { message: string }).message;
          expect(errorMessage.toLowerCase()).toContain('secrets manager');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Error events can be parsed back correctly (round-trip)
   *
   * For any error event, parsing the SSE string should correctly extract
   * the event type and data fields.
   */
  it('should round-trip error events correctly', () => {
    const anyErrorArb = fc.oneof(
      fc.tuple(errorMessageArb, s3BucketArb, s3KeyArb)
        .map(([message, bucket, key]) => new S3ReadError(message, bucket, key)),
      errorMessageArb.map((message) => new BedrockApiError(message)),
      fc.tuple(errorMessageArb, fc.option(httpStatusCodeArb))
        .map(([message, statusCode]) => new PerplexityApiError(message, statusCode ?? undefined)),
      fc.tuple(errorMessageArb, secretNameArb)
        .map(([message, secretName]) => new SecretsManagerError(message, secretName))
    );

    fc.assert(
      fc.property(anyErrorArb, (error) => {
        const sseEvent = createErrorSSEEvent(error);

        // Parse the event
        const parsed = parseSSEEvent(sseEvent);
        expect(parsed).not.toBeNull();

        // Re-serialize and verify equivalence
        const reserialized = formatSSEEvent(parsed!.eventType, parsed!.data);
        expect(reserialized).toBe(sseEvent);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Error event type is always 'error'
   *
   * Regardless of the underlying error type, the SSE event type
   * should always be 'error'.
   */
  it('should always use error event type for all error types', () => {
    const anyErrorArb = fc.oneof(
      fc.tuple(errorMessageArb, s3BucketArb, s3KeyArb)
        .map(([message, bucket, key]) => new S3ReadError(message, bucket, key)),
      errorMessageArb.map((message) => new BedrockApiError(message)),
      fc.tuple(errorMessageArb, fc.option(httpStatusCodeArb))
        .map(([message, statusCode]) => new PerplexityApiError(message, statusCode ?? undefined)),
      fc.tuple(errorMessageArb, secretNameArb)
        .map(([message, secretName]) => new SecretsManagerError(message, secretName))
    );

    fc.assert(
      fc.property(anyErrorArb, (error) => {
        const sseEvent = createErrorSSEEvent(error);
        const parsed = parseSSEEvent(sseEvent);

        expect(parsed!.eventType).toBe('error');
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Error properties are preserved in custom error classes
   *
   * Custom error classes should preserve their additional properties
   * (bucket, key for S3ReadError; statusCode for PerplexityApiError; etc.)
   */
  describe('Error class property preservation', () => {
    it('should preserve S3ReadError properties', () => {
      fc.assert(
        fc.property(
          fc.tuple(errorMessageArb, s3BucketArb, s3KeyArb),
          ([message, bucket, key]) => {
            const error = new S3ReadError(message, bucket, key);

            expect(error.name).toBe('S3ReadError');
            expect(error.bucket).toBe(bucket);
            expect(error.key).toBe(key);
            expect(error.message).toContain(message);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve BedrockApiError properties', () => {
      fc.assert(
        fc.property(errorMessageArb, (message) => {
          const error = new BedrockApiError(message);

          expect(error.name).toBe('BedrockApiError');
          expect(error.message).toContain('Bedrock');
          expect(error.message).toContain(message);
        }),
        { numRuns: 100 }
      );
    });

    it('should preserve PerplexityApiError properties', () => {
      fc.assert(
        fc.property(
          fc.tuple(errorMessageArb, fc.option(httpStatusCodeArb)),
          ([message, statusCode]) => {
            const error = new PerplexityApiError(message, statusCode ?? undefined);

            expect(error.name).toBe('PerplexityApiError');
            expect(error.statusCode).toBe(statusCode ?? undefined);
            expect(error.message).toContain('Perplexity');
            expect(error.message).toContain(message);
          }
        ),
        { numRuns: 100 }
      );
    });

    it('should preserve SecretsManagerError properties', () => {
      fc.assert(
        fc.property(
          fc.tuple(errorMessageArb, secretNameArb),
          ([message, secretName]) => {
            const error = new SecretsManagerError(message, secretName);

            expect(error.name).toBe('SecretsManagerError');
            expect(error.secretName).toBe(secretName);
            expect(error.message).toContain('Secrets Manager');
            expect(error.message).toContain(message);
          }
        ),
        { numRuns: 100 }
      );
    });
  });

  /**
   * Specific test cases for each requirement
   */
  describe('Requirement-specific error handling', () => {
    /**
     * Requirement 2.6: Error events should be sent when errors occur
     */
    it('should emit error event for S3 read failure (Requirement 2.6)', () => {
      const error = new S3ReadError('Access Denied', 'my-bucket', 'diagrams/test.png');
      const sseEvent = createErrorSSEEvent(error);
      const parsed = parseSSEEvent(sseEvent);

      expect(parsed!.eventType).toBe('error');
      expect((parsed!.data as { message: string }).message).toContain('S3');
    });

    /**
     * Requirement 2.6: Error events should be sent for Bedrock errors
     */
    it('should emit error event for Bedrock API error (Requirement 2.6)', () => {
      const error = new BedrockApiError('Model not available');
      const sseEvent = createErrorSSEEvent(error);
      const parsed = parseSSEEvent(sseEvent);

      expect(parsed!.eventType).toBe('error');
      expect((parsed!.data as { message: string }).message).toContain('Bedrock');
    });

    /**
     * Requirement 2.6: Error events should be sent for Perplexity errors
     */
    it('should emit error event for Perplexity API error (Requirement 2.6)', () => {
      const error = new PerplexityApiError('Rate limit exceeded', 429);
      const sseEvent = createErrorSSEEvent(error);
      const parsed = parseSSEEvent(sseEvent);

      expect(parsed!.eventType).toBe('error');
      expect((parsed!.data as { message: string }).message).toContain('Perplexity');
    });

    /**
     * Requirement 4.8, 4.9: SSE Client should be able to parse error events
     */
    it('should produce parseable error events for SSE Client (Requirements 4.8, 4.9)', () => {
      const errors = [
        new S3ReadError('Not Found', 'bucket', 'key'),
        new BedrockApiError('Timeout'),
        new PerplexityApiError('Service unavailable', 503),
        new SecretsManagerError('Secret not found', 'my-secret'),
      ];

      for (const error of errors) {
        const sseEvent = createErrorSSEEvent(error);
        const parsed = parseSSEEvent(sseEvent);

        // SSE Client should be able to parse the event
        expect(parsed).not.toBeNull();
        expect(parsed!.eventType).toBe('error');

        // SSE Client should be able to display the error message
        const data = parsed!.data as { message: string };
        expect(data.message).toBeTruthy();
        expect(typeof data.message).toBe('string');
      }
    });
  });
});
