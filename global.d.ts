declare module 'prompt-utils' {
  /**
   * Wraps rawText in the correct chat prefix/suffix for the given modelId.
   */
  export function wrapPrompt(modelId: string, rawText: string): Promise<string>;
}