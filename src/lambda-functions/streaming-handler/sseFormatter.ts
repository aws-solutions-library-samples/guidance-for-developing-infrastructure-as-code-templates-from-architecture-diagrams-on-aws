/**
 * SSE Event Formatter Utility
 *
 * Formats data into Server-Sent Events (SSE) format for streaming responses.
 * SSE format: event: <type>\ndata: <json>\n\n
 *
 * @module sseFormatter
 */

/**
 * Valid SSE event types for the streaming API
 */
export type SSEEventType =
  | 'thinking_stream'
  | 'analysis_stream'
  | 'cdk_modules_stream'
  | 'optimization_stream'
  | 'analysis_complete'
  | 'cdk_modules_complete'
  | 'optimization_complete'
  | 'error'
  | '[DONE]';

/**
 * Formats an SSE event with the given event type and data payload.
 *
 * @param eventType - The type of SSE event (e.g., 'analysis_stream', 'error')
 * @param data - The data payload to include in the event (will be JSON stringified)
 * @returns Formatted SSE event string with event type, data, and double newline terminator
 *
 * @example
 * formatSSEEvent('analysis_stream', { content: 'Hello' })
 * // Returns: 'event: analysis_stream\ndata: {"content":"Hello"}\n\n'
 */
export function formatSSEEvent(eventType: string, data: object): string {
  const jsonData = JSON.stringify(data);
  return `event: ${eventType}\ndata: ${jsonData}\n\n`;
}

/**
 * Parses an SSE event string back into its components.
 * Useful for testing round-trip serialization.
 *
 * @param sseEvent - The SSE event string to parse
 * @returns Object containing eventType and data, or null if parsing fails
 */
export function parseSSEEvent(sseEvent: string): { eventType: string; data: object } | null {
  const eventMatch = sseEvent.match(/^event: (.+)\n/);
  const dataMatch = sseEvent.match(/\ndata: (.+)\n\n$/);

  if (!eventMatch || !dataMatch) {
    return null;
  }

  try {
    const eventType = eventMatch[1];
    const data = JSON.parse(dataMatch[1]);
    return { eventType, data };
  } catch {
    return null;
  }
}
