export type AICompletionRequest = {
  activePath: string;
  language: string;
  prefix: string;
  suffix?: string;
  contextPaths?: string[];
  maxCandidates: number;
  explicit?: boolean;
};

export type AICompletionItem = {
  label: string;
  insertText: string;
  detail?: string;
};

