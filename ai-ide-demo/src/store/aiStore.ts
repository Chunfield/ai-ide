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
  addMessage: (message: Omit<Message, 'id' | 'timestamp'>, customId?: string) => void;
  setMessages: (messages: Message[]) => void;
  updateMessage: (id: string, content: string) => void;
  setLoading: (loading: boolean) => void;
  setApiKey: (key: string) => void;
  clearMessages: () => void;
}

function getInitialApiKey(): string {
  try {
    return localStorage.getItem('ai-ide:apiKey') || '';
  } catch {
    return '';
  }
}

export const useAIStore = create<AIStore>((set) => ({
  messages: [],
  isLoading: false,
  apiKey: getInitialApiKey(),
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
  clearMessages: () => set({ messages: [] }),
}));
