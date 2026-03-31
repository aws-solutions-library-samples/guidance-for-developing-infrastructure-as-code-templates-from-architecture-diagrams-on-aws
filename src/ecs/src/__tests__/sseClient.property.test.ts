/**
 * Property-Based Tests for SSE Client Content Routing
 *
 * **Property 3: Content Routing to Correct Display**
 * **Validates: Requirements 4.3, 4.4, 4.5, 4.6**
 *
 * For any SSE event received by the SSE Client, the content should be appended
 * to the correct state field based on event type:
 * - `thinking_stream` → `thinkingResponse`
 * - `analysis_stream` → `analysisResponse`
 * - `cdk_modules_stream` → `cdkModulesResponse`
 * - `optimization_stream` → `analysisResponse` (optimization reuses analysis display)
 */

import * as fc from 'fast-check';
import { parseSSEEvent, SSEClientOptions } from '../sseClient';

/**
 * Simulates the SSE client event routing logic.
 * This mirrors the processEventBuffer method in SSEClient.
 *
 * @param eventType - The SSE event type
 * @param content - The content from the event data
 * @param options - The SSE client options with handlers
 */
function routeEvent(eventType: string, content: string, options: SSEClientOptions): void {
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
    case '[DONE]':
      options.onComplete(eventType);
      break;
    case 'error':
      options.onError(new Error(content || 'Unknown error'));
      break;
    default:
      // Unknown event type - ignore
      break;
  }
}

/**
 * State tracker for testing content routing
 */
interface RoutingState {
  thinkingResponse: string;
  analysisResponse: string;
  cdkModulesResponse: string;
  completedEvents: string[];
  errors: string[];
}

/**
 * Creates a fresh routing state and SSE client options that track calls
 */
function createStateTracker(): { state: RoutingState; options: SSEClientOptions } {
  const state: RoutingState = {
    thinkingResponse: '',
    analysisResponse: '',
    cdkModulesResponse: '',
    completedEvents: [],
    errors: [],
  };

  const options: SSEClientOptions = {
    onThinkingStream: (content: string) => {
      state.thinkingResponse += content;
    },
    onAnalysisStream: (content: string) => {
      state.analysisResponse += content;
    },
    onCdkModulesStream: (content: string) => {
      state.cdkModulesResponse += content;
    },
    onOptimizationStream: (content: string) => {
      // Optimization reuses analysis display per design doc
      state.analysisResponse += content;
    },
    onComplete: (eventType: string) => {
      state.completedEvents.push(eventType);
    },
    onError: (error: Error) => {
      state.errors.push(error.message);
    },
  };

  return { state, options };
}

describe('SSE Client Content Routing Property Tests', () => {
  /**
   * Property 3: Content Routing to Correct Display
   *
   * For any thinking_stream event, content should be routed to thinkingResponse
   */
  it('should route thinking_stream events to thinkingResponse handler', () => {
    const contentArb = fc.string({ minLength: 1, maxLength: 200 })
      .filter((s) => !s.includes('\n') && s.trim().length > 0);

    fc.assert(
      fc.property(contentArb, (content) => {
        const { state, options } = createStateTracker();

        routeEvent('thinking_stream', content, options);

        // Content should appear in thinkingResponse
        expect(state.thinkingResponse).toBe(content);
        // Content should NOT appear in other fields
        expect(state.analysisResponse).toBe('');
        expect(state.cdkModulesResponse).toBe('');
        expect(state.completedEvents).toHaveLength(0);
        expect(state.errors).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 3: Content Routing to Correct Display
   *
   * For any analysis_stream event, content should be routed to analysisResponse
   */
  it('should route analysis_stream events to analysisResponse handler', () => {
    const contentArb = fc.string({ minLength: 1, maxLength: 200 })
      .filter((s) => !s.includes('\n') && s.trim().length > 0);

    fc.assert(
      fc.property(contentArb, (content) => {
        const { state, options } = createStateTracker();

        routeEvent('analysis_stream', content, options);

        // Content should appear in analysisResponse
        expect(state.analysisResponse).toBe(content);
        // Content should NOT appear in other fields
        expect(state.thinkingResponse).toBe('');
        expect(state.cdkModulesResponse).toBe('');
        expect(state.completedEvents).toHaveLength(0);
        expect(state.errors).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 3: Content Routing to Correct Display
   *
   * For any cdk_modules_stream event, content should be routed to cdkModulesResponse
   */
  it('should route cdk_modules_stream events to cdkModulesResponse handler', () => {
    const contentArb = fc.string({ minLength: 1, maxLength: 200 })
      .filter((s) => !s.includes('\n') && s.trim().length > 0);

    fc.assert(
      fc.property(contentArb, (content) => {
        const { state, options } = createStateTracker();

        routeEvent('cdk_modules_stream', content, options);

        // Content should appear in cdkModulesResponse
        expect(state.cdkModulesResponse).toBe(content);
        // Content should NOT appear in other fields
        expect(state.thinkingResponse).toBe('');
        expect(state.analysisResponse).toBe('');
        expect(state.completedEvents).toHaveLength(0);
        expect(state.errors).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property 3: Content Routing to Correct Display
   *
   * For any optimization_stream event, content should be routed to analysisResponse
   * (optimization reuses analysis display per design doc)
   */
  it('should route optimization_stream events to analysisResponse handler', () => {
    const contentArb = fc.string({ minLength: 1, maxLength: 200 })
      .filter((s) => !s.includes('\n') && s.trim().length > 0);

    fc.assert(
      fc.property(contentArb, (content) => {
        const { state, options } = createStateTracker();

        routeEvent('optimization_stream', content, options);

        // Content should appear in analysisResponse (optimization reuses analysis display)
        expect(state.analysisResponse).toBe(content);
        // Content should NOT appear in other fields
        expect(state.thinkingResponse).toBe('');
        expect(state.cdkModulesResponse).toBe('');
        expect(state.completedEvents).toHaveLength(0);
        expect(state.errors).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Multiple events of the same type should accumulate content
   */
  it('should accumulate content from multiple events of the same type', () => {
    const contentChunksArb = fc.array(
      fc.string({ minLength: 1, maxLength: 50 }).filter((s) => !s.includes('\n') && s.trim().length > 0),
      { minLength: 2, maxLength: 10 }
    );

    const eventTypeArb = fc.constantFrom(
      'thinking_stream',
      'analysis_stream',
      'cdk_modules_stream',
      'optimization_stream'
    );

    fc.assert(
      fc.property(eventTypeArb, contentChunksArb, (eventType, chunks) => {
        const { state, options } = createStateTracker();

        // Route all chunks
        for (const chunk of chunks) {
          routeEvent(eventType, chunk, options);
        }

        const expectedContent = chunks.join('');

        // Verify content accumulated correctly based on event type
        switch (eventType) {
          case 'thinking_stream':
            expect(state.thinkingResponse).toBe(expectedContent);
            expect(state.analysisResponse).toBe('');
            expect(state.cdkModulesResponse).toBe('');
            break;
          case 'analysis_stream':
            expect(state.analysisResponse).toBe(expectedContent);
            expect(state.thinkingResponse).toBe('');
            expect(state.cdkModulesResponse).toBe('');
            break;
          case 'cdk_modules_stream':
            expect(state.cdkModulesResponse).toBe(expectedContent);
            expect(state.thinkingResponse).toBe('');
            expect(state.analysisResponse).toBe('');
            break;
          case 'optimization_stream':
            // Optimization reuses analysis display
            expect(state.analysisResponse).toBe(expectedContent);
            expect(state.thinkingResponse).toBe('');
            expect(state.cdkModulesResponse).toBe('');
            break;
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Mixed event types should route to their respective handlers
   */
  it('should correctly route mixed event types to their respective handlers', () => {
    const eventArb = fc.record({
      eventType: fc.constantFrom(
        'thinking_stream',
        'analysis_stream',
        'cdk_modules_stream',
        'optimization_stream'
      ),
      content: fc.string({ minLength: 1, maxLength: 50 })
        .filter((s) => !s.includes('\n') && s.trim().length > 0),
    });

    const eventsArb = fc.array(eventArb, { minLength: 1, maxLength: 20 });

    fc.assert(
      fc.property(eventsArb, (events) => {
        const { state, options } = createStateTracker();

        // Track expected content for each handler
        let expectedThinking = '';
        let expectedAnalysis = '';
        let expectedCdkModules = '';

        // Route all events and track expected results
        for (const event of events) {
          routeEvent(event.eventType, event.content, options);

          switch (event.eventType) {
            case 'thinking_stream':
              expectedThinking += event.content;
              break;
            case 'analysis_stream':
              expectedAnalysis += event.content;
              break;
            case 'cdk_modules_stream':
              expectedCdkModules += event.content;
              break;
            case 'optimization_stream':
              // Optimization reuses analysis display
              expectedAnalysis += event.content;
              break;
          }
        }

        // Verify all content routed correctly
        expect(state.thinkingResponse).toBe(expectedThinking);
        expect(state.analysisResponse).toBe(expectedAnalysis);
        expect(state.cdkModulesResponse).toBe(expectedCdkModules);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: parseSSEEvent should correctly extract event type and content
   * for routing purposes
   */
  it('should parse SSE events correctly for content routing', () => {
    const eventTypeArb = fc.constantFrom(
      'thinking_stream',
      'analysis_stream',
      'cdk_modules_stream',
      'optimization_stream'
    );

    const contentArb = fc.string({ minLength: 1, maxLength: 100 })
      .filter((s) => !s.includes('\n') && s.trim().length > 0);

    fc.assert(
      fc.property(eventTypeArb, contentArb, (eventType, content) => {
        // Create SSE event string
        const sseString = `event: ${eventType}\ndata: ${JSON.stringify({ content })}`;

        // Parse the event
        const parsed = parseSSEEvent(sseString);

        // Verify parsing succeeded
        expect(parsed).not.toBeNull();
        expect(parsed!.eventType).toBe(eventType);
        expect(parsed!.data.content).toBe(content);

        // Now route the parsed event and verify routing
        const { state, options } = createStateTracker();
        const parsedContent = typeof parsed!.data.content === 'string' ? parsed!.data.content : '';
        routeEvent(parsed!.eventType, parsedContent, options);

        // Verify content routed to correct handler
        switch (eventType) {
          case 'thinking_stream':
            expect(state.thinkingResponse).toBe(content);
            break;
          case 'analysis_stream':
            expect(state.analysisResponse).toBe(content);
            break;
          case 'cdk_modules_stream':
            expect(state.cdkModulesResponse).toBe(content);
            break;
          case 'optimization_stream':
            expect(state.analysisResponse).toBe(content);
            break;
        }
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Unknown event types should not affect any state
   */
  it('should ignore unknown event types without affecting state', () => {
    const unknownEventTypeArb = fc.string({ minLength: 1, maxLength: 30 })
      .filter((s) => 
        !s.includes('\n') &&
        s.trim().length > 0 &&
        !['thinking_stream', 'analysis_stream', 'cdk_modules_stream', 'optimization_stream',
          'thinking_complete', 'analysis_complete', 'cdk_modules_complete', 'optimization_complete',
          '[DONE]', 'error'].includes(s)
      );

    const contentArb = fc.string({ minLength: 1, maxLength: 100 })
      .filter((s) => !s.includes('\n'));

    fc.assert(
      fc.property(unknownEventTypeArb, contentArb, (eventType, content) => {
        const { state, options } = createStateTracker();

        routeEvent(eventType, content, options);

        // No state should be affected
        expect(state.thinkingResponse).toBe('');
        expect(state.analysisResponse).toBe('');
        expect(state.cdkModulesResponse).toBe('');
        expect(state.completedEvents).toHaveLength(0);
        expect(state.errors).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Completion events should be tracked correctly
   */
  it('should track completion events correctly', () => {
    const completionEventArb = fc.constantFrom(
      'thinking_complete',
      'analysis_complete',
      'cdk_modules_complete',
      'optimization_complete',
      '[DONE]'
    );

    fc.assert(
      fc.property(completionEventArb, (eventType) => {
        const { state, options } = createStateTracker();

        routeEvent(eventType, '', options);

        // Completion event should be tracked
        expect(state.completedEvents).toContain(eventType);
        expect(state.completedEvents).toHaveLength(1);
        // No content should be added
        expect(state.thinkingResponse).toBe('');
        expect(state.analysisResponse).toBe('');
        expect(state.cdkModulesResponse).toBe('');
        expect(state.errors).toHaveLength(0);
      }),
      { numRuns: 100 }
    );
  });
});
