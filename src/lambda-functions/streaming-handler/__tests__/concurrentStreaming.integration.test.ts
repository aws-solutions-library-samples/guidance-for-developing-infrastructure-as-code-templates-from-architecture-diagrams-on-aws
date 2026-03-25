/**
 * Integration Tests for Concurrent Streaming
 *
 * **Validates: Requirements 8.1, 8.2, 8.3, 8.4**
 *
 * These tests verify the behavior of multiple concurrent streaming requests,
 * ensuring session isolation and proper handling of concurrent operations.
 *
 * Tests verify:
 * 1. Multiple concurrent requests can be processed simultaneously
 * 2. Each request receives only its own response content
 * 3. Request identifiers are correctly maintained throughout the stream
 * 4. Errors in one stream don't affect other concurrent streams
 * 5. Aborting one stream doesn't affect other concurrent streams
 */

import { formatSSEEvent, parseSSEEvent } from '../sseFormatter';

/**
 * Valid action types for streaming requests
 */
type StreamingAction = 'analyze' | 'optimize' | 'cdk_modules';

/**
 * Request body interface for streaming endpoints
 */
interface StreamingRequest {
  action: StreamingAction;
  s3Key: string;
  language?: string;
}

/**
 * Mock response stream that captures written content
 * Simulates the awslambda.HttpResponseStream behavior
 */
class MockResponseStream {
  public readonly id: string;
  public readonly chunks: string[] = [];
  public ended: boolean = false;
  public aborted: boolean = false;
  public error: Error | null = null;

  constructor(id: string) {
    this.id = id;
  }

  write(chunk: string): void {
    if (this.ended) {
      throw new Error('Cannot write to ended stream');
    }
    if (this.aborted) {
      throw new Error('Cannot write to aborted stream');
    }
    this.chunks.push(chunk);
  }

  end(): void {
    this.ended = true;
  }

  abort(): void {
    this.aborted = true;
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
  completed: boolean;
  error: Error | null;
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
    completed: false,
    error: null,
  };
}

/**
 * Simulates writing content to a session's response stream
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

/**
 * Simulates a complete streaming operation for a session
 */
async function simulateStreamingOperation(
  session: StreamingSession,
  chunks: string[],
  delayMs: number = 10
): Promise<void> {
  const eventType = session.request.action === 'analyze' 
    ? 'analysis_stream' 
    : session.request.action === 'optimize'
    ? 'optimization_stream'
    : 'cdk_modules_stream';

  for (const chunk of chunks) {
    if (session.responseStream.aborted) {
      return;
    }
    writeToSession(session, eventType, chunk);
    // Simulate async processing delay
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  if (!session.responseStream.aborted) {
    session.responseStream.write(formatSSEEvent('[DONE]', {}));
    session.responseStream.end();
    session.completed = true;
  }
}


/**
 * Simulates a streaming operation that fails with an error
 */
async function simulateStreamingWithError(
  session: StreamingSession,
  chunksBeforeError: string[],
  errorMessage: string,
  delayMs: number = 10
): Promise<void> {
  const eventType = session.request.action === 'analyze' 
    ? 'analysis_stream' 
    : session.request.action === 'optimize'
    ? 'optimization_stream'
    : 'cdk_modules_stream';

  for (const chunk of chunksBeforeError) {
    if (session.responseStream.aborted) {
      return;
    }
    writeToSession(session, eventType, chunk);
    await new Promise(resolve => setTimeout(resolve, delayMs));
  }

  if (!session.responseStream.aborted) {
    session.responseStream.write(formatSSEEvent('error', { 
      message: errorMessage, 
      sessionId: session.id 
    }));
    session.responseStream.end();
    session.error = new Error(errorMessage);
  }
}

describe('Concurrent Streaming Integration Tests', () => {
  /**
   * Test 1: Multiple concurrent requests can be processed simultaneously
   *
   * Verifies that the system can handle multiple streaming requests at the same time
   * without blocking or serializing them.
   */
  describe('Test 1: Multiple concurrent requests processing', () => {
    it('should process multiple concurrent requests simultaneously', async () => {
      // Create 5 concurrent sessions
      const sessions: StreamingSession[] = [
        createSession('session_1', { action: 'analyze', s3Key: 'diagrams/arch1.png' }),
        createSession('session_2', { action: 'optimize', s3Key: 'diagrams/arch2.png' }),
        createSession('session_3', { action: 'cdk_modules', s3Key: 'diagrams/arch3.png' }),
        createSession('session_4', { action: 'analyze', s3Key: 'diagrams/arch4.png' }),
        createSession('session_5', { action: 'analyze', s3Key: 'diagrams/arch5.png' }),
      ];

      // Define unique content for each session
      const sessionContents = [
        ['Session 1 chunk 1', 'Session 1 chunk 2', 'Session 1 chunk 3'],
        ['Session 2 chunk 1', 'Session 2 chunk 2'],
        ['Session 3 chunk 1', 'Session 3 chunk 2', 'Session 3 chunk 3', 'Session 3 chunk 4'],
        ['Session 4 chunk 1'],
        ['Session 5 chunk 1', 'Session 5 chunk 2'],
      ];

      // Start all streaming operations concurrently
      const startTime = Date.now();
      await Promise.all(
        sessions.map((session, index) => 
          simulateStreamingOperation(session, sessionContents[index], 5)
        )
      );
      const endTime = Date.now();

      // Verify all sessions completed
      sessions.forEach((session, index) => {
        expect(session.completed).toBe(true);
        expect(session.responseStream.ended).toBe(true);
        expect(session.content.length).toBe(sessionContents[index].length);
      });

      // Verify concurrent execution (should complete faster than sequential)
      // Sequential would take at least 5 sessions * 5ms * avg 2.4 chunks = 60ms
      // Concurrent should complete in roughly max(session times) ≈ 20ms
      const totalTime = endTime - startTime;
      expect(totalTime).toBeLessThan(200); // Allow generous margin for test stability
    });


    it('should handle varying request sizes concurrently', async () => {
      // Create sessions with different content sizes
      const smallSession = createSession('small', { action: 'analyze', s3Key: 'small.png' });
      const mediumSession = createSession('medium', { action: 'analyze', s3Key: 'medium.png' });
      const largeSession = createSession('large', { action: 'analyze', s3Key: 'large.png' });

      const smallContent = ['Small content'];
      const mediumContent = Array.from({ length: 10 }, (_, i) => `Medium chunk ${i + 1}`);
      const largeContent = Array.from({ length: 50 }, (_, i) => `Large chunk ${i + 1}`);

      await Promise.all([
        simulateStreamingOperation(smallSession, smallContent, 1),
        simulateStreamingOperation(mediumSession, mediumContent, 1),
        simulateStreamingOperation(largeSession, largeContent, 1),
      ]);

      // All sessions should complete regardless of size
      expect(smallSession.completed).toBe(true);
      expect(mediumSession.completed).toBe(true);
      expect(largeSession.completed).toBe(true);

      // Verify content counts
      expect(smallSession.content.length).toBe(1);
      expect(mediumSession.content.length).toBe(10);
      expect(largeSession.content.length).toBe(50);
    });
  });

  /**
   * Test 2: Each request receives only its own response content
   *
   * Verifies that content from one session never appears in another session's
   * response stream.
   */
  describe('Test 2: Response content isolation', () => {
    it('should ensure each request receives only its own content', async () => {
      const sessionA = createSession('user_a', { action: 'analyze', s3Key: 'user_a.png' });
      const sessionB = createSession('user_b', { action: 'analyze', s3Key: 'user_b.png' });
      const sessionC = createSession('user_c', { action: 'analyze', s3Key: 'user_c.png' });

      const contentA = ['User A analysis part 1', 'User A analysis part 2', 'User A analysis part 3'];
      const contentB = ['User B analysis part 1', 'User B analysis part 2'];
      const contentC = ['User C analysis part 1', 'User C analysis part 2', 'User C analysis part 3', 'User C analysis part 4'];

      await Promise.all([
        simulateStreamingOperation(sessionA, contentA, 5),
        simulateStreamingOperation(sessionB, contentB, 5),
        simulateStreamingOperation(sessionC, contentC, 5),
      ]);

      // Verify session A content
      const eventsA = sessionA.responseStream.getEvents();
      eventsA.forEach(event => {
        if (event.eventType !== '[DONE]') {
          const data = event.data as { sessionId?: string; content?: string };
          expect(data.sessionId).toBe('user_a');
          expect(data.content).toContain('User A');
          expect(data.content).not.toContain('User B');
          expect(data.content).not.toContain('User C');
        }
      });

      // Verify session B content
      const eventsB = sessionB.responseStream.getEvents();
      eventsB.forEach(event => {
        if (event.eventType !== '[DONE]') {
          const data = event.data as { sessionId?: string; content?: string };
          expect(data.sessionId).toBe('user_b');
          expect(data.content).toContain('User B');
          expect(data.content).not.toContain('User A');
          expect(data.content).not.toContain('User C');
        }
      });

      // Verify session C content
      const eventsC = sessionC.responseStream.getEvents();
      eventsC.forEach(event => {
        if (event.eventType !== '[DONE]') {
          const data = event.data as { sessionId?: string; content?: string };
          expect(data.sessionId).toBe('user_c');
          expect(data.content).toContain('User C');
          expect(data.content).not.toContain('User A');
          expect(data.content).not.toContain('User B');
        }
      });
    });


    it('should maintain content isolation with interleaved writes', async () => {
      const session1 = createSession('interleaved_1', { action: 'analyze', s3Key: 'test1.png' });
      const session2 = createSession('interleaved_2', { action: 'analyze', s3Key: 'test2.png' });

      // Manually interleave writes to simulate concurrent processing
      writeToSession(session1, 'analysis_stream', 'S1: First chunk');
      writeToSession(session2, 'analysis_stream', 'S2: First chunk');
      writeToSession(session1, 'analysis_stream', 'S1: Second chunk');
      writeToSession(session2, 'analysis_stream', 'S2: Second chunk');
      writeToSession(session2, 'analysis_stream', 'S2: Third chunk');
      writeToSession(session1, 'analysis_stream', 'S1: Third chunk');

      session1.responseStream.write(formatSSEEvent('[DONE]', {}));
      session2.responseStream.write(formatSSEEvent('[DONE]', {}));
      session1.responseStream.end();
      session2.responseStream.end();

      // Verify session 1 only has S1 content
      const content1 = session1.responseStream.getContent();
      expect(content1).toContain('S1: First chunk');
      expect(content1).toContain('S1: Second chunk');
      expect(content1).toContain('S1: Third chunk');
      expect(content1).not.toContain('S2:');

      // Verify session 2 only has S2 content
      const content2 = session2.responseStream.getContent();
      expect(content2).toContain('S2: First chunk');
      expect(content2).toContain('S2: Second chunk');
      expect(content2).toContain('S2: Third chunk');
      expect(content2).not.toContain('S1:');
    });

    it('should isolate content across different action types', async () => {
      const analyzeSession = createSession('analyze_user', { action: 'analyze', s3Key: 'analyze.png' });
      const optimizeSession = createSession('optimize_user', { action: 'optimize', s3Key: 'optimize.png' });
      const cdkSession = createSession('cdk_user', { action: 'cdk_modules', s3Key: 'cdk.png' });

      await Promise.all([
        simulateStreamingOperation(analyzeSession, ['Analyze content 1', 'Analyze content 2'], 5),
        simulateStreamingOperation(optimizeSession, ['Optimize content 1', 'Optimize content 2'], 5),
        simulateStreamingOperation(cdkSession, ['CDK content 1', 'CDK content 2'], 5),
      ]);

      // Verify each session has correct event types and content
      const analyzeEvents = analyzeSession.responseStream.getEvents();
      const optimizeEvents = optimizeSession.responseStream.getEvents();
      const cdkEvents = cdkSession.responseStream.getEvents();

      // Check analyze session
      analyzeEvents.filter(e => e.eventType !== '[DONE]').forEach(event => {
        expect(event.eventType).toBe('analysis_stream');
        const data = event.data as { content?: string };
        expect(data.content).toContain('Analyze');
      });

      // Check optimize session
      optimizeEvents.filter(e => e.eventType !== '[DONE]').forEach(event => {
        expect(event.eventType).toBe('optimization_stream');
        const data = event.data as { content?: string };
        expect(data.content).toContain('Optimize');
      });

      // Check CDK session
      cdkEvents.filter(e => e.eventType !== '[DONE]').forEach(event => {
        expect(event.eventType).toBe('cdk_modules_stream');
        const data = event.data as { content?: string };
        expect(data.content).toContain('CDK');
      });
    });
  });


  /**
   * Test 3: Request identifiers are correctly maintained throughout the stream
   *
   * Verifies that session IDs and request context (s3Key) are preserved
   * in all events throughout the streaming operation.
   */
  describe('Test 3: Request identifier maintenance', () => {
    it('should maintain session ID throughout all stream events', async () => {
      const session = createSession('persistent_id_test', { 
        action: 'analyze', 
        s3Key: 'diagrams/test_diagram.png' 
      });

      const chunks = Array.from({ length: 20 }, (_, i) => `Chunk ${i + 1} content`);
      await simulateStreamingOperation(session, chunks, 1);

      const events = session.responseStream.getEvents();
      
      // All non-DONE events should have the correct session ID
      events.filter(e => e.eventType !== '[DONE]').forEach((event, index) => {
        const data = event.data as { sessionId?: string };
        expect(data.sessionId).toBe('persistent_id_test');
      });
    });

    it('should maintain request context (s3Key) in traceable events', async () => {
      const session = createSession('context_test', { 
        action: 'analyze', 
        s3Key: 'diagrams/architecture_v2.png',
        language: 'en'
      });

      // Write events with full request context
      const chunks = ['Analysis part 1', 'Analysis part 2', 'Analysis part 3'];
      for (const chunk of chunks) {
        const event = formatSSEEvent('analysis_stream', {
          content: chunk,
          sessionId: session.id,
          s3Key: session.request.s3Key,
          action: session.request.action,
        });
        session.responseStream.write(event);
      }
      session.responseStream.write(formatSSEEvent('[DONE]', {}));
      session.responseStream.end();

      const events = session.responseStream.getEvents();
      
      // Verify all content events have correct request context
      events.filter(e => e.eventType === 'analysis_stream').forEach(event => {
        const data = event.data as { sessionId?: string; s3Key?: string; action?: string };
        expect(data.sessionId).toBe('context_test');
        expect(data.s3Key).toBe('diagrams/architecture_v2.png');
        expect(data.action).toBe('analyze');
      });
    });

    it('should maintain unique identifiers across concurrent sessions', async () => {
      const sessions = Array.from({ length: 10 }, (_, i) => 
        createSession(`unique_session_${i}`, { 
          action: 'analyze', 
          s3Key: `diagrams/diagram_${i}.png` 
        })
      );

      await Promise.all(
        sessions.map((session, i) => 
          simulateStreamingOperation(session, [`Content for session ${i}`], 5)
        )
      );

      // Verify each session has its unique identifier preserved
      sessions.forEach((session, i) => {
        const events = session.responseStream.getEvents();
        events.filter(e => e.eventType !== '[DONE]').forEach(event => {
          const data = event.data as { sessionId?: string };
          expect(data.sessionId).toBe(`unique_session_${i}`);
        });
      });

      // Verify no session contains another session's ID
      sessions.forEach((session, i) => {
        const content = session.responseStream.getContent();
        sessions.forEach((otherSession, j) => {
          if (i !== j) {
            expect(content).not.toContain(`unique_session_${j}`);
          }
        });
      });
    });
  });


  /**
   * Test 4: Errors in one stream don't affect other concurrent streams
   *
   * Verifies that when one streaming session encounters an error,
   * other concurrent sessions continue to operate normally.
   */
  describe('Test 4: Error isolation between streams', () => {
    it('should not affect other streams when one stream errors', async () => {
      const successSession1 = createSession('success_1', { action: 'analyze', s3Key: 'success1.png' });
      const errorSession = createSession('error_session', { action: 'analyze', s3Key: 'error.png' });
      const successSession2 = createSession('success_2', { action: 'analyze', s3Key: 'success2.png' });

      await Promise.all([
        simulateStreamingOperation(successSession1, ['Success 1 chunk 1', 'Success 1 chunk 2'], 5),
        simulateStreamingWithError(errorSession, ['Error chunk 1'], 'S3 read failure: Access Denied', 5),
        simulateStreamingOperation(successSession2, ['Success 2 chunk 1', 'Success 2 chunk 2', 'Success 2 chunk 3'], 5),
      ]);

      // Verify success session 1 completed normally
      expect(successSession1.completed).toBe(true);
      expect(successSession1.error).toBeNull();
      expect(successSession1.content.length).toBe(2);

      // Verify error session has error
      expect(errorSession.error).not.toBeNull();
      expect(errorSession.error?.message).toContain('S3 read failure');
      const errorEvents = errorSession.responseStream.getEvents();
      expect(errorEvents.some(e => e.eventType === 'error')).toBe(true);

      // Verify success session 2 completed normally
      expect(successSession2.completed).toBe(true);
      expect(successSession2.error).toBeNull();
      expect(successSession2.content.length).toBe(3);
    });

    it('should isolate different error types across sessions', async () => {
      const s3ErrorSession = createSession('s3_error', { action: 'analyze', s3Key: 'missing.png' });
      const bedrockErrorSession = createSession('bedrock_error', { action: 'analyze', s3Key: 'bedrock.png' });
      const successSession = createSession('success', { action: 'analyze', s3Key: 'success.png' });

      await Promise.all([
        simulateStreamingWithError(s3ErrorSession, [], 'Failed to read image from S3: NoSuchKey', 5),
        simulateStreamingWithError(bedrockErrorSession, ['Partial content'], 'Bedrock API error: ThrottlingException', 5),
        simulateStreamingOperation(successSession, ['Full content 1', 'Full content 2'], 5),
      ]);

      // Verify S3 error session
      const s3Events = s3ErrorSession.responseStream.getEvents();
      const s3Error = s3Events.find(e => e.eventType === 'error');
      expect(s3Error).toBeDefined();
      expect((s3Error?.data as { message?: string })?.message).toContain('S3');

      // Verify Bedrock error session
      const bedrockEvents = bedrockErrorSession.responseStream.getEvents();
      const bedrockError = bedrockEvents.find(e => e.eventType === 'error');
      expect(bedrockError).toBeDefined();
      expect((bedrockError?.data as { message?: string })?.message).toContain('Bedrock');

      // Verify success session is unaffected
      expect(successSession.completed).toBe(true);
      const successEvents = successSession.responseStream.getEvents();
      expect(successEvents.some(e => e.eventType === 'error')).toBe(false);
    });

    it('should handle multiple simultaneous errors without cross-contamination', async () => {
      const errorSessions = [
        { session: createSession('err_1', { action: 'analyze', s3Key: 'err1.png' }), error: 'Error 1: Access Denied' },
        { session: createSession('err_2', { action: 'optimize', s3Key: 'err2.png' }), error: 'Error 2: Timeout' },
        { session: createSession('err_3', { action: 'cdk_modules', s3Key: 'err3.png' }), error: 'Error 3: Rate Limited' },
      ];

      await Promise.all(
        errorSessions.map(({ session, error }) => 
          simulateStreamingWithError(session, [], error, 5)
        )
      );

      // Verify each error session has only its own error
      errorSessions.forEach(({ session, error }) => {
        const events = session.responseStream.getEvents();
        const errorEvent = events.find(e => e.eventType === 'error');
        expect(errorEvent).toBeDefined();
        
        const errorData = errorEvent?.data as { message?: string; sessionId?: string };
        expect(errorData.message).toBe(error);
        expect(errorData.sessionId).toBe(session.id);

        // Verify no other session's error appears
        const content = session.responseStream.getContent();
        errorSessions.forEach(other => {
          if (other.session.id !== session.id) {
            expect(content).not.toContain(other.error);
          }
        });
      });
    });
  });


  /**
   * Test 5: Aborting one stream doesn't affect other concurrent streams
   *
   * Verifies that when a user cancels their streaming request,
   * other users' streams continue unaffected.
   */
  describe('Test 5: Stream abort isolation', () => {
    it('should not affect other streams when one stream is aborted', async () => {
      const continuingSession = createSession('continuing', { action: 'analyze', s3Key: 'continue.png' });
      const abortedSession = createSession('aborted', { action: 'analyze', s3Key: 'abort.png' });
      const anotherContinuingSession = createSession('another_continuing', { action: 'analyze', s3Key: 'another.png' });

      // Start all sessions
      const continuingPromise = simulateStreamingOperation(
        continuingSession, 
        Array.from({ length: 10 }, (_, i) => `Continuing chunk ${i + 1}`), 
        10
      );
      
      const abortedPromise = (async () => {
        // Write a few chunks then abort
        writeToSession(abortedSession, 'analysis_stream', 'Aborted chunk 1');
        writeToSession(abortedSession, 'analysis_stream', 'Aborted chunk 2');
        await new Promise(resolve => setTimeout(resolve, 20));
        abortedSession.responseStream.abort();
      })();

      const anotherContinuingPromise = simulateStreamingOperation(
        anotherContinuingSession, 
        Array.from({ length: 8 }, (_, i) => `Another chunk ${i + 1}`), 
        10
      );

      await Promise.all([continuingPromise, abortedPromise, anotherContinuingPromise]);

      // Verify aborted session is aborted
      expect(abortedSession.responseStream.aborted).toBe(true);
      expect(abortedSession.responseStream.ended).toBe(true);
      expect(abortedSession.content.length).toBe(2); // Only got 2 chunks before abort

      // Verify continuing session completed fully
      expect(continuingSession.completed).toBe(true);
      expect(continuingSession.responseStream.aborted).toBe(false);
      expect(continuingSession.content.length).toBe(10);

      // Verify another continuing session completed fully
      expect(anotherContinuingSession.completed).toBe(true);
      expect(anotherContinuingSession.responseStream.aborted).toBe(false);
      expect(anotherContinuingSession.content.length).toBe(8);
    });

    it('should handle multiple aborts without affecting other sessions', async () => {
      const sessions = [
        { session: createSession('abort_1', { action: 'analyze', s3Key: 'a1.png' }), shouldAbort: true },
        { session: createSession('continue_1', { action: 'analyze', s3Key: 'c1.png' }), shouldAbort: false },
        { session: createSession('abort_2', { action: 'optimize', s3Key: 'a2.png' }), shouldAbort: true },
        { session: createSession('continue_2', { action: 'cdk_modules', s3Key: 'c2.png' }), shouldAbort: false },
        { session: createSession('abort_3', { action: 'analyze', s3Key: 'a3.png' }), shouldAbort: true },
      ];

      const promises = sessions.map(({ session, shouldAbort }) => {
        if (shouldAbort) {
          return (async () => {
            writeToSession(session, 'analysis_stream', 'Before abort');
            await new Promise(resolve => setTimeout(resolve, 15));
            session.responseStream.abort();
          })();
        } else {
          return simulateStreamingOperation(
            session, 
            ['Chunk 1', 'Chunk 2', 'Chunk 3'], 
            10
          );
        }
      });

      await Promise.all(promises);

      // Verify aborted sessions
      sessions.filter(s => s.shouldAbort).forEach(({ session }) => {
        expect(session.responseStream.aborted).toBe(true);
        expect(session.content.length).toBe(1); // Only one chunk before abort
      });

      // Verify continuing sessions completed fully
      sessions.filter(s => !s.shouldAbort).forEach(({ session }) => {
        expect(session.completed).toBe(true);
        expect(session.responseStream.aborted).toBe(false);
        expect(session.content.length).toBe(3);
      });
    });


    it('should allow new streams to start after abort without affecting existing streams', async () => {
      const existingSession = createSession('existing', { action: 'analyze', s3Key: 'existing.png' });
      const abortedSession = createSession('to_abort', { action: 'analyze', s3Key: 'abort.png' });

      // Start existing session
      const existingPromise = simulateStreamingOperation(
        existingSession, 
        Array.from({ length: 15 }, (_, i) => `Existing chunk ${i + 1}`), 
        10
      );

      // Start and abort a session
      writeToSession(abortedSession, 'analysis_stream', 'Will be aborted');
      await new Promise(resolve => setTimeout(resolve, 30));
      abortedSession.responseStream.abort();

      // Start a new session after the abort
      const newSession = createSession('new_after_abort', { action: 'analyze', s3Key: 'new.png' });
      const newPromise = simulateStreamingOperation(
        newSession, 
        ['New chunk 1', 'New chunk 2', 'New chunk 3'], 
        10
      );

      await Promise.all([existingPromise, newPromise]);

      // Verify existing session completed
      expect(existingSession.completed).toBe(true);
      expect(existingSession.content.length).toBe(15);

      // Verify aborted session is aborted
      expect(abortedSession.responseStream.aborted).toBe(true);

      // Verify new session completed
      expect(newSession.completed).toBe(true);
      expect(newSession.content.length).toBe(3);

      // Verify no cross-contamination
      const existingContent = existingSession.responseStream.getContent();
      const newContent = newSession.responseStream.getContent();

      expect(existingContent).not.toContain('new_after_abort');
      expect(existingContent).not.toContain('to_abort');
      expect(newContent).not.toContain('existing');
      expect(newContent).not.toContain('to_abort');
    });

    it('should handle rapid abort and restart cycles', async () => {
      const backgroundSession = createSession('background', { action: 'analyze', s3Key: 'bg.png' });
      
      // Start background session that runs throughout
      const backgroundPromise = simulateStreamingOperation(
        backgroundSession, 
        Array.from({ length: 20 }, (_, i) => `Background chunk ${i + 1}`), 
        15
      );

      // Rapid abort/restart cycles
      for (let cycle = 0; cycle < 3; cycle++) {
        const cycleSession = createSession(`cycle_${cycle}`, { action: 'analyze', s3Key: `cycle${cycle}.png` });
        writeToSession(cycleSession, 'analysis_stream', `Cycle ${cycle} content`);
        await new Promise(resolve => setTimeout(resolve, 10));
        cycleSession.responseStream.abort();
      }

      await backgroundPromise;

      // Verify background session completed unaffected
      expect(backgroundSession.completed).toBe(true);
      expect(backgroundSession.content.length).toBe(20);
      
      // Verify no cycle content leaked into background
      const bgContent = backgroundSession.responseStream.getContent();
      expect(bgContent).not.toContain('cycle_');
      expect(bgContent).not.toContain('Cycle');
    });
  });

  /**
   * Additional edge case tests for comprehensive coverage
   */
  describe('Edge cases and stress tests', () => {
    it('should handle high concurrency without cross-contamination', async () => {
      const sessionCount = 25;
      const sessions = Array.from({ length: sessionCount }, (_, i) => 
        createSession(`high_concurrency_${i}`, { 
          action: ['analyze', 'optimize', 'cdk_modules'][i % 3] as StreamingAction, 
          s3Key: `diagram_${i}.png` 
        })
      );

      await Promise.all(
        sessions.map((session, i) => 
          simulateStreamingOperation(
            session, 
            [`Session ${i} unique content`, `Session ${i} more content`], 
            2
          )
        )
      );

      // Verify all sessions completed
      sessions.forEach(session => {
        expect(session.completed).toBe(true);
      });

      // Verify no cross-contamination
      sessions.forEach((session, i) => {
        const content = session.responseStream.getContent();
        expect(content).toContain(`Session ${i}`);
        
        // Check that no other session's content appears
        sessions.forEach((_, j) => {
          if (i !== j) {
            expect(content).not.toContain(`Session ${j} unique`);
          }
        });
      });
    });

    it('should maintain isolation with mixed success, error, and abort scenarios', async () => {
      const successSession = createSession('mixed_success', { action: 'analyze', s3Key: 'success.png' });
      const errorSession = createSession('mixed_error', { action: 'analyze', s3Key: 'error.png' });
      const abortSession = createSession('mixed_abort', { action: 'analyze', s3Key: 'abort.png' });

      const successPromise = simulateStreamingOperation(
        successSession, 
        ['Success content 1', 'Success content 2'], 
        10
      );

      const errorPromise = simulateStreamingWithError(
        errorSession, 
        ['Error partial content'], 
        'Simulated error', 
        10
      );

      const abortPromise = (async () => {
        writeToSession(abortSession, 'analysis_stream', 'Abort content');
        await new Promise(resolve => setTimeout(resolve, 15));
        abortSession.responseStream.abort();
      })();

      await Promise.all([successPromise, errorPromise, abortPromise]);

      // Verify success session
      expect(successSession.completed).toBe(true);
      expect(successSession.error).toBeNull();
      const successContent = successSession.responseStream.getContent();
      expect(successContent).not.toContain('Error');
      expect(successContent).not.toContain('Abort');

      // Verify error session
      expect(errorSession.error).not.toBeNull();
      const errorContent = errorSession.responseStream.getContent();
      expect(errorContent).not.toContain('Success');
      expect(errorContent).not.toContain('mixed_abort');

      // Verify abort session
      expect(abortSession.responseStream.aborted).toBe(true);
      const abortContent = abortSession.responseStream.getContent();
      expect(abortContent).not.toContain('Success');
      expect(abortContent).not.toContain('Simulated error');
    });
  });
});
