/**
 * Property-Based Tests for Event Type Mapping
 *
 * **Property 2: Event Type Mapping Correctness**
 * **Validates: Requirements 3.4, 3.5, 3.6, 3.7**
 *
 * For any content chunk from an AI service (Bedrock thinking, Bedrock analysis,
 * Perplexity CDK modules, Bedrock optimization), the SSE event type in the output
 * should match the expected type for that content source:
 * - Bedrock thinking → `thinking_stream`
 * - Bedrock analysis → `analysis_stream`
 * - Perplexity CDK modules → `cdk_modules_stream`
 * - Bedrock optimization → `optimization_stream`
 */

import * as fc from 'fast-check';
import { mapSourceToEventType, ContentSource } from '../bedrockClient';

describe('Event Type Mapping Property Tests', () => {
  /**
   * The complete mapping of content sources to expected event types
   * as defined in the design document and requirements
   */
  const expectedMappings: Record<ContentSource, string> = {
    thinking: 'thinking_stream',
    analysis: 'analysis_stream',
    optimization: 'optimization_stream',
  };

  /**
   * All valid content sources that the system must handle
   */
  const allContentSources: ContentSource[] = ['thinking', 'analysis', 'optimization'];

  /**
   * Property: All valid content sources map to correct event types
   *
   * For any valid content source, the mapSourceToEventType function
   * should return the expected SSE event type as defined in the spec.
   */
  it('should map all valid content sources to correct event types', () => {
    const contentSourceArb = fc.constantFrom<ContentSource>(...allContentSources);

    fc.assert(
      fc.property(contentSourceArb, (source: ContentSource) => {
        const eventType = mapSourceToEventType(source);
        const expectedEventType = expectedMappings[source];

        // Verify the mapping produces the expected event type
        expect(eventType).toBe(expectedEventType);

        // Verify the event type follows the naming convention (*_stream)
        expect(eventType).toMatch(/_stream$/);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Mapping is deterministic (same input always produces same output)
   *
   * For any content source, calling mapSourceToEventType multiple times
   * with the same input should always produce the same output.
   */
  it('should be deterministic - same input always produces same output', () => {
    const contentSourceArb = fc.constantFrom<ContentSource>(...allContentSources);
    const callCountArb = fc.integer({ min: 2, max: 10 });

    fc.assert(
      fc.property(contentSourceArb, callCountArb, (source: ContentSource, callCount: number) => {
        const results: string[] = [];

        // Call the function multiple times
        for (let i = 0; i < callCount; i++) {
          results.push(mapSourceToEventType(source));
        }

        // All results should be identical
        const firstResult = results[0];
        expect(results.every((r) => r === firstResult)).toBe(true);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Mapping covers all required event types
   *
   * The set of event types produced by mapping all content sources
   * should include all required event types from the spec.
   */
  it('should cover all required event types from the spec', () => {
    // Required event types as per Requirements 3.4, 3.5, 3.6, 3.7
    const requiredEventTypes = new Set([
      'thinking_stream',    // Requirement 3.4
      'analysis_stream',    // Requirement 3.5
      'optimization_stream', // Requirement 3.7
    ]);

    // Note: cdk_modules_stream (Requirement 3.6) is handled by Perplexity integration,
    // not by the Bedrock mapSourceToEventType function

    fc.assert(
      fc.property(fc.constant(null), () => {
        // Map all content sources to event types
        const producedEventTypes = new Set(
          allContentSources.map((source) => mapSourceToEventType(source))
        );

        // Verify all required event types are covered
        for (const requiredType of requiredEventTypes) {
          expect(producedEventTypes.has(requiredType)).toBe(true);
        }

        // Verify the count matches (no extra or missing mappings)
        expect(producedEventTypes.size).toBe(requiredEventTypes.size);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Each content source maps to a unique event type
   *
   * No two different content sources should map to the same event type.
   * This ensures proper routing of content to the correct display.
   */
  it('should map each content source to a unique event type', () => {
    fc.assert(
      fc.property(fc.constant(null), () => {
        const eventTypes = allContentSources.map((source) => mapSourceToEventType(source));
        const uniqueEventTypes = new Set(eventTypes);

        // Number of unique event types should equal number of content sources
        expect(uniqueEventTypes.size).toBe(allContentSources.length);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Property: Event type format is consistent
   *
   * All event types should follow the same naming convention:
   * lowercase with underscores, ending in '_stream'.
   */
  it('should produce event types with consistent format', () => {
    const contentSourceArb = fc.constantFrom<ContentSource>(...allContentSources);

    fc.assert(
      fc.property(contentSourceArb, (source: ContentSource) => {
        const eventType = mapSourceToEventType(source);

        // Should be lowercase with underscores
        expect(eventType).toMatch(/^[a-z_]+$/);

        // Should end with '_stream'
        expect(eventType).toMatch(/_stream$/);

        // Should not be empty
        expect(eventType.length).toBeGreaterThan(0);

        // Should not have consecutive underscores
        expect(eventType).not.toMatch(/__/);
      }),
      { numRuns: 100 }
    );
  });

  /**
   * Specific test cases for each requirement
   */
  describe('Requirement-specific mappings', () => {
    /**
     * Requirement 3.4: Bedrock thinking → thinking_stream
     */
    it('should map thinking source to thinking_stream (Requirement 3.4)', () => {
      expect(mapSourceToEventType('thinking')).toBe('thinking_stream');
    });

    /**
     * Requirement 3.5: Bedrock analysis → analysis_stream
     */
    it('should map analysis source to analysis_stream (Requirement 3.5)', () => {
      expect(mapSourceToEventType('analysis')).toBe('analysis_stream');
    });

    /**
     * Requirement 3.7: Bedrock optimization → optimization_stream
     */
    it('should map optimization source to optimization_stream (Requirement 3.7)', () => {
      expect(mapSourceToEventType('optimization')).toBe('optimization_stream');
    });
  });
});
