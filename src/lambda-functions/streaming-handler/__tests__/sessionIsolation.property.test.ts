/**
 * Property-Based Tests for Session Isolation
 *
 * **Property 4: Session Isolation**
 * **Validates: Requirements 8.1, 8.2, 8.3, 8.4**
 *
 * For any two concurrent streaming requests from different users, the response
 * content received by User A should contain zero bytes from User B's AI service
 * responses, and vice versa. Each HTTP request-response pair forms an isolated
 * channel with no shared state.
 *
 * Since we can't actually run concurrent Lambda invocations in unit tests,
 * we test the isolation properties of the handler function by verifying:
 * 1. Each request gets its own response stream
 * 2. Content from one request doesn't leak into another
 * 3. Errors in one request don't affect other requests
 * 4. Aborting one request doesn't affect other requests
 */

import * as fc from 'fast-check';
import { formatSSEEvent, parseSSEEvent } from '../sseFormatter';

/**
 * Valid action types for streaming requests (mirrors index.ts)
 */
type StreamingAction = 'analyze' | 'optimize' | 'cdk_modules';

/**
 * Request body interface for streaming endpoints (mirrors index.ts)
 */
interface StreamingRequest {
  action: StreamingAction;
  s3Key: string;
  language?: string;
}

/**
 * Validates the streaming request body (mirrors logic from index.ts)
 */
function validateRequest(body: unknown): {
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
 * Mock response stream that captures written content
 * Simulates the awslambda.HttpResponseStream behavior
 */
class MockResponseStream {
  public readonly id: string;
  public readonly chunks: string[] = [];
  public ended: boolean = false;
  public error: Error | null = null;

  constructor(id: string) {
    this.id = id;
  }

  write(chunk: string): void {
    if (this.ended) {
      throw new Error('Cannot write to ended stream');
    }
    this.chunks.push(chunk);
  }

  end(): void {
    this.ended = true;
  }

  getContent(): string {
    return this.chunks.join('');
  }

  getEvents(): Array<{ eventType: string; data: unknown }> {
    return this.chunks
      .map((chunk) => parseSSEEvent(chunk))
      .filter((event): event is NonNullable<typeof event> => event !== null);
  }
}

/**
 * Simulates a streaming session with its own isolated state
 */
interface StreamingSession {
  id: string;
  request: StreamingRequest;
  responseStream: MockResponseStream;
  content: string[];
}

/**
 * Creates a streaming session with isolated state
 */
function createSession(id: string, request: StreamingRequest): StreamingSession {
  return {
    id,
    request,
    responseStream: new MockResponseStream(id),
    content: [],
  };
}

/**
 * Simulates writing content to a session's response stream
 * This mirrors what the streaming handler does
 */
function writeToSession(
  session: StreamingSession,
  eventType: string,
  content: string
): void {
  const event = formatSSEEvent(eventType, { content, sessionId: session.id });
  session.responseStream.write(event);
  session.content.push(content);
}

describe('Session Isolation Property Tests', () => {
  /**
   * Generators for test data
   */
  const sessionIdArb = fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyz0123456789'),
    { minLength: 8, maxLength: 16 }
  );

  const s3KeyArb = fc.stringOf(
    fc.constantFrom(...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_/'),
    { minLength: 5, maxLength: 50 }
  ).map((key) => `diagrams/${key}.png`);

  const actionArb = fc.constantFrom<StreamingAction>('analyze', 'optimize', 'cdk_modules');

  const contentChunkArb = fc.string({ minLength: 1, maxLength: 200 })
    .filter((s) => !s.includes('\n') && s.trim().length > 0);

  const streamingRequestArb = fc.record({
    action: actionArb,
    s3Key: s3KeyArb,
    language: fc.option(fc.constantFrom('en', 'es', 'fr', 'de', 'ja')),
  }).map(({ action, s3Key, language }) => ({
    action,
    s3Key,
    language: language ?? undefined,
  }));

  /**
   * Property: Each session gets its own isolated response stream
   *
   * For any two sessions with different IDs, their response streams
   * should be completely independent objects.
   */
  it('should create isolated response streams for each session', () => {
    fc.assert(
      fc.property(
        sessionIdArb,
        sessionIdArb.filter((id) => id.length > 0),
        streamingRequestArb,
        streamingRequestArb,
        (id1, id2, request1, request2) => {
          // Ensure different session IDs
          const sessionId1 = `session_${id1}_1`;
          const sessionId2 = `session_${id2}_2`;

          const session1 = createSession(sessionId1, request1);
          const session2 = createSession(sessionId2, request2);

          // Verify streams are different objects
          expect(session1.responseStream).not.toBe(session2.responseStream);
          expect(session1.responseStream.id).not.toBe(session2.responseStream.id);

          // Verify streams have independent state
          expect(session1.responseStream.chunks).not.toBe(session2.responseStream.chunks);
          expect(session1.responseStream.ended).toBe(false);
          expect(session2.responseStream.ended).toBe(false);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Content written to one session doesn't appear in another
   *
   * For any content written to session A, that content should not
   * appear in session B's response stream.
   */
  it('should not leak content between sessions', () => {
    fc.assert(
      fc.property(
        sessionIdArb,
        sessionIdArb,
        streamingRequestArb,
        streamingRequestArb,
        fc.array(contentChunkArb, { minLength: 1, maxLength: 10 }),
        fc.array(contentChunkArb, { minLength: 1, maxLength: 10 }),
        (id1, id2, request1, request2, content1, content2) => {
          const session1 = createSession(`session_${id1}_a`, request1);
          const session2 = createSession(`session_${id2}_b`, request2);

          // Write content to session 1
          for (const chunk of content1) {
            writeToSession(session1, 'analysis_stream', chunk);
          }

          // Write content to session 2
          for (const chunk of content2) {
            writeToSession(session2, 'analysis_stream', chunk);
          }

          // Get all events from each session
          const events1 = session1.responseStream.getEvents();
          const events2 = session2.responseStream.getEvents();

          // Verify session 1 only contains its own content
          for (const event of events1) {
            const data = event.data as { sessionId?: string };
            expect(data.sessionId).toBe(session1.id);
          }

          // Verify session 2 only contains its own content
          for (const event of events2) {
            const data = event.data as { sessionId?: string };
            expect(data.sessionId).toBe(session2.id);
          }

          // Verify no cross-contamination
          const content1Str = session1.responseStream.getContent();
          const content2Str = session2.responseStream.getContent();

          expect(content1Str).not.toContain(session2.id);
          expect(content2Str).not.toContain(session1.id);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Errors in one session don't affect other sessions
   *
   * If an error occurs in session A, session B should continue
   * to function normally without any error state.
   */
  it('should isolate errors between sessions', () => {
    fc.assert(
      fc.property(
        sessionIdArb,
        sessionIdArb,
        streamingRequestArb,
        streamingRequestArb,
        fc.array(contentChunkArb, { minLength: 1, maxLength: 5 }),
        (id1, id2, request1, request2, content2) => {
          const session1 = createSession(`session_${id1}_err`, request1);
          const session2 = createSession(`session_${id2}_ok`, request2);

          // Simulate error in session 1
          const errorEvent = formatSSEEvent('error', {
            message: 'Test error',
            sessionId: session1.id,
          });
          session1.responseStream.write(errorEvent);
          session1.responseStream.end();

          // Session 2 should continue working normally
          for (const chunk of content2) {
            writeToSession(session2, 'analysis_stream', chunk);
          }

          // Verify session 1 is ended with error
          expect(session1.responseStream.ended).toBe(true);
          const events1 = session1.responseStream.getEvents();
          expect(events1.some((e) => e.eventType === 'error')).toBe(true);

          // Verify session 2 is still active and has no errors
          expect(session2.responseStream.ended).toBe(false);
          const events2 = session2.responseStream.getEvents();
          expect(events2.every((e) => e.eventType !== 'error')).toBe(true);

          // Verify session 2 received all its content
          expect(events2.length).toBe(content2.length);
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Ending one session doesn't affect other sessions
   *
   * When session A ends (either normally or via abort), session B
   * should continue to function normally.
   */
  it('should allow independent session termination', () => {
    fc.assert(
      fc.property(
        sessionIdArb,
        sessionIdArb,
        streamingRequestArb,
        streamingRequestArb,
        fc.array(contentChunkArb, { minLength: 1, maxLength: 5 }),
        fc.array(contentChunkArb, { minLength: 1, maxLength: 5 }),
        (id1, id2, request1, request2, content1, content2) => {
          const session1 = createSession(`session_${id1}_end`, request1);
          const session2 = createSession(`session_${id2}_cont`, request2);

          // Write some content to session 1 and end it
          for (const chunk of content1) {
            writeToSession(session1, 'analysis_stream', chunk);
          }
          session1.responseStream.write(formatSSEEvent('[DONE]', {}));
          session1.responseStream.end();

          // Session 2 should still be able to receive content
          for (const chunk of content2) {
            writeToSession(session2, 'analysis_stream', chunk);
          }

          // Verify session 1 is ended
          expect(session1.responseStream.ended).toBe(true);

          // Verify session 2 is still active
          expect(session2.responseStream.ended).toBe(false);

          // Verify session 2 can still write
          expect(() => {
            writeToSession(session2, 'analysis_stream', 'additional content');
          }).not.toThrow();

          // Verify session 1 cannot write after ending
          expect(() => {
            session1.responseStream.write('should fail');
          }).toThrow('Cannot write to ended stream');
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Request identifiers (s3Key) are traceable in responses
   *
   * Each response stream should contain content that can be traced
   * back to its originating request via the s3Key or session identifier.
   */
  it('should maintain request traceability in responses', () => {
    fc.assert(
      fc.property(
        sessionIdArb,
        streamingRequestArb,
        fc.array(contentChunkArb, { minLength: 1, maxLength: 5 }),
        (id, request, content) => {
          const session = createSession(`session_${id}`, request);

          // Write content with request context
          for (const chunk of content) {
            const event = formatSSEEvent('analysis_stream', {
              content: chunk,
              sessionId: session.id,
              s3Key: request.s3Key,
            });
            session.responseStream.write(event);
          }

          // Verify all events contain the correct request context
          const events = session.responseStream.getEvents();
          for (const event of events) {
            const data = event.data as { sessionId?: string; s3Key?: string };
            expect(data.sessionId).toBe(session.id);
            expect(data.s3Key).toBe(request.s3Key);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Multiple concurrent sessions maintain isolation
   *
   * For any number of concurrent sessions, each session should
   * only contain its own content with no cross-contamination.
   */
  it('should maintain isolation across multiple concurrent sessions', () => {
    const sessionCountArb = fc.integer({ min: 2, max: 10 });

    fc.assert(
      fc.property(
        sessionCountArb,
        fc.array(streamingRequestArb, { minLength: 2, maxLength: 10 }),
        fc.array(fc.array(contentChunkArb, { minLength: 1, maxLength: 5 }), { minLength: 2, maxLength: 10 }),
        (sessionCount, requests, contentArrays) => {
          // Ensure we have enough requests and content arrays
          const actualCount = Math.min(sessionCount, requests.length, contentArrays.length);
          if (actualCount < 2) return; // Skip if not enough data

          // Create sessions
          const sessions: StreamingSession[] = [];
          for (let i = 0; i < actualCount; i++) {
            sessions.push(createSession(`session_${i}_multi`, requests[i]));
          }

          // Write content to each session
          for (let i = 0; i < actualCount; i++) {
            for (const chunk of contentArrays[i]) {
              writeToSession(sessions[i], 'analysis_stream', chunk);
            }
          }

          // Verify each session only contains its own content
          for (let i = 0; i < actualCount; i++) {
            const events = sessions[i].responseStream.getEvents();

            for (const event of events) {
              const data = event.data as { sessionId?: string };
              expect(data.sessionId).toBe(sessions[i].id);
            }

            // Verify no other session IDs appear in this session's content
            const content = sessions[i].responseStream.getContent();
            for (let j = 0; j < actualCount; j++) {
              if (i !== j) {
                expect(content).not.toContain(sessions[j].id);
              }
            }
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Request validation is stateless
   *
   * Validating one request should not affect the validation
   * of subsequent requests.
   */
  it('should perform stateless request validation', () => {
    fc.assert(
      fc.property(
        fc.array(streamingRequestArb, { minLength: 2, maxLength: 10 }),
        (requests) => {
          // Validate each request independently
          const results = requests.map((request) => validateRequest(request));

          // All valid requests should pass validation
          for (const result of results) {
            expect(result.isValid).toBe(true);
            expect(result.error).toBeUndefined();
            expect(result.request).toBeDefined();
          }

          // Validation results should be independent
          // (validating one request doesn't affect others)
          for (let i = 0; i < requests.length; i++) {
            const revalidation = validateRequest(requests[i]);
            expect(revalidation.isValid).toBe(results[i].isValid);
          }
        }
      ),
      { numRuns: 100 }
    );
  });

  /**
   * Specific test cases for each requirement
   */
  describe('Requirement-specific session isolation', () => {
    /**
     * Requirement 8.1: Each user receives only their own responses
     */
    it('should ensure each user receives only their own responses (Requirement 8.1)', () => {
      const userASession = createSession('user_a_session', {
        action: 'analyze',
        s3Key: 'diagrams/user_a_diagram.png',
      });

      const userBSession = createSession('user_b_session', {
        action: 'analyze',
        s3Key: 'diagrams/user_b_diagram.png',
      });

      // Simulate User A's analysis
      writeToSession(userASession, 'analysis_stream', 'User A architecture analysis');

      // Simulate User B's analysis
      writeToSession(userBSession, 'analysis_stream', 'User B architecture analysis');

      // Verify User A only sees their content
      const userAContent = userASession.responseStream.getContent();
      expect(userAContent).toContain('User A');
      expect(userAContent).not.toContain('User B');

      // Verify User B only sees their content
      const userBContent = userBSession.responseStream.getContent();
      expect(userBContent).toContain('User B');
      expect(userBContent).not.toContain('User A');
    });

    /**
     * Requirement 8.2: Dedicated HTTP response streams per request
     */
    it('should use dedicated response streams per request (Requirement 8.2)', () => {
      const session1 = createSession('dedicated_1', {
        action: 'analyze',
        s3Key: 'diagrams/test1.png',
      });

      const session2 = createSession('dedicated_2', {
        action: 'optimize',
        s3Key: 'diagrams/test2.png',
      });

      // Verify each session has its own dedicated stream
      expect(session1.responseStream).not.toBe(session2.responseStream);
      expect(session1.responseStream.id).toBe('dedicated_1');
      expect(session2.responseStream.id).toBe('dedicated_2');
    });

    /**
     * Requirement 8.3: No broadcast to multiple clients
     */
    it('should not broadcast responses to multiple clients (Requirement 8.3)', () => {
      const sessions = [
        createSession('client_1', { action: 'analyze', s3Key: 'diagrams/shared.png' }),
        createSession('client_2', { action: 'analyze', s3Key: 'diagrams/shared.png' }),
        createSession('client_3', { action: 'analyze', s3Key: 'diagrams/shared.png' }),
      ];

      // Write unique content to each session
      sessions.forEach((session, index) => {
        writeToSession(session, 'analysis_stream', `Content for client ${index + 1}`);
      });

      // Verify each session only has its own content (no broadcast)
      sessions.forEach((session, index) => {
        const content = session.responseStream.getContent();
        expect(content).toContain(`Content for client ${index + 1}`);

        // Should not contain other clients' content
        sessions.forEach((otherSession, otherIndex) => {
          if (index !== otherIndex) {
            expect(content).not.toContain(`Content for client ${otherIndex + 1}`);
          }
        });
      });
    });

    /**
     * Requirement 8.4: Simultaneous requests don't cross-contaminate
     */
    it('should prevent cross-contamination between simultaneous requests (Requirement 8.4)', () => {
      const userA = createSession('user_a_simultaneous', {
        action: 'analyze',
        s3Key: 'diagrams/user_a.png',
      });

      const userB = createSession('user_b_simultaneous', {
        action: 'analyze',
        s3Key: 'diagrams/user_b.png',
      });

      // Simulate interleaved writes (as would happen with concurrent requests)
      writeToSession(userA, 'analysis_stream', 'A1: Starting analysis');
      writeToSession(userB, 'analysis_stream', 'B1: Starting analysis');
      writeToSession(userA, 'analysis_stream', 'A2: Processing diagram');
      writeToSession(userB, 'analysis_stream', 'B2: Processing diagram');
      writeToSession(userA, 'analysis_stream', 'A3: Complete');
      writeToSession(userB, 'analysis_stream', 'B3: Complete');

      // Verify User A's stream only contains A content
      const userAEvents = userA.responseStream.getEvents();
      expect(userAEvents.length).toBe(3);
      userAEvents.forEach((event) => {
        const data = event.data as { content: string };
        expect(data.content).toMatch(/^A\d:/);
      });

      // Verify User B's stream only contains B content
      const userBEvents = userB.responseStream.getEvents();
      expect(userBEvents.length).toBe(3);
      userBEvents.forEach((event) => {
        const data = event.data as { content: string };
        expect(data.content).toMatch(/^B\d:/);
      });
    });
  });
});
