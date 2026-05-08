import { create } from 'zustand';

export interface Message {
  id: string;
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  timestamp: number;
  toolCallId?: string;
  toolName?: string;
}

interface AIStore {
  messages: Message[];
  isLoading: boolean;
  apiKey: string;
  autoComplete: boolean;
  addMessage: (message: Omit<Message, 'id' | 'timestamp'>, customId?: string) => void;
  setMessages: (messages: Message[]) => void;
  updateMessage: (id: string, content: string) => void;
  setLoading: (loading: boolean) => void;
  setApiKey: (key: string) => void;
  setAutoComplete: (enabled: boolean) => void;
  clearMessages: () => void;
}

function getInitialApiKey(): string {
  try {
    return localStorage.getItem('ai-ide:apiKey') || '';
  } catch {
    return '';
  }
}

function getInitialAutoComplete(): boolean {
  try {
    const stored = localStorage.getItem('ai-ide:autoComplete');
    return stored === null ? true : stored === 'true';
  } catch {
    return true;
  }
}

export const useAIStore = create<AIStore>((set) => ({
  messages: [],
  isLoading: false,
  apiKey: getInitialApiKey(),
  autoComplete: getInitialAutoComplete(),
  addMessage: (message, customId) =>
    set((state) => {
      const newMessage = {
        ...message,
        id: customId || crypto.randomUUID(),
        timestamp: Date.now(),
      };
      return {
        messages: [...state.messages, newMessage],
      };
    }),
  setMessages: (messages) => set({ messages }),
  updateMessage: (id, content) =>
    set((state) => {
      return {
        messages: state.messages.map((m) =>
          m.id === id ? { ...m, content } : m
        ),
      };
    }),
  setLoading: (isLoading) => set({ isLoading }),
  setApiKey: (apiKey) => {
    try {
      localStorage.setItem('ai-ide:apiKey', apiKey);
    } catch {}
    set({ apiKey });
  },
  setAutoComplete: (autoComplete) => {
    try {
      localStorage.setItem('ai-ide:autoComplete', String(autoComplete));
    } catch {}
    set({ autoComplete });
  },
  clearMessages: () => set({ messages: [] }),
}));
