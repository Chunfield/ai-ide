export type SelectionRange = {
  from: number;
  to: number;
  text: string;
  lineFrom: number;
  lineTo: number;
};

export type InlineEditRequest = {
  instruction: string;
  activePath: string;
  selection: SelectionRange;
  contextPaths?: string[];
  languageHint?: string;
};

export type InlineEditResult = {
  replacementText: string;
};

