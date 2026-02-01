// VS Code node environment usually has global fetch (Node 18+)
const OLLAMA_BASE_URL = 'http://localhost:11434';

export interface OllamaModel {
    name: string;
    size: number;
    digest: string;
    details: {
        format: string;
        family: string;
        families: string[];
        parameter_size: string;
        quantization_level: string;
    }
}

export interface ChatMessage {
    role: 'system' | 'user' | 'assistant';
    content: string;
}

export class OllamaService {
    // Singleton removed for easier instantiation in extension.ts
    constructor() {}

    async isRunning(): Promise<boolean> {
        try {
            const response = await fetch(`${OLLAMA_BASE_URL}/api/version`);
            return response.ok;
        } catch (error) {
            return false;
        }
    }

    async listModels(): Promise<OllamaModel[]> {
        try {
            const response = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
            if (!response.ok) return [];
            const data = await response.json() as { models: OllamaModel[] };
            return data.models || [];
        } catch (error) {
            return [];
        }
    }

    async pullModel(modelName: string, onProgress?: (progress: any) => void): Promise<void> {
        const response = await fetch(`${OLLAMA_BASE_URL}/api/pull`, {
            method: 'POST',
            body: JSON.stringify({ name: modelName, stream: true }),
        });

        if (!response.body) throw new Error('Failed to pull model: No response body');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n').filter(Boolean);
            
            for (const line of lines) {
                try {
                    const status = JSON.parse(line);
                    if (onProgress) onProgress(status);
                } catch (e) {
                    console.error('Error parsing pull progress:', e);
                }
            }
        }
    }

    async embed(prompt: string, model: string = 'nomic-embed-text'): Promise<number[]> {
        return this.generateEmbeddings(prompt, model);
    }

    async generateEmbeddings(prompt: string, model: string = 'nomic-embed-text'): Promise<number[]> {
        // Handle "search_query:" or "search_document:" mapping if needed, but usually caller handles it
        // Note: Ollama /api/embed (new) or /api/embeddings (old)
        // /api/embed is preferred for newer versions
        try {
            const response = await fetch(`${OLLAMA_BASE_URL}/api/embed`, {
                method: 'POST',
                body: JSON.stringify({ model, input: prompt }),
            });
            
            if (response.ok) {
                 const data = await response.json() as { embeddings: number[][] };
                 // /api/embed returns array of embeddings if input is array, or single
                 // actually input can be string or array
                 // if input is string, embeddings is number[][] with one element
                 return data.embeddings[0];
            } else {
                // Fallback to /api/embeddings (older)
                const fallbackResponse = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
                    method: 'POST',
                    body: JSON.stringify({ model, prompt }),
                });
                const data = await fallbackResponse.json() as { embedding: number[] };
                return data.embedding;
            }
        } catch (e) {
            console.error('Embedding failed:', e);
            throw e;
        }
    }

    async *chatGenerator(messages: ChatMessage[], model: string = 'llama3.2:3b'): AsyncGenerator<string, void, unknown> {
        const response = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
            method: 'POST',
            body: JSON.stringify({ model, messages, stream: true }),
        });

        if (!response.body) throw new Error('Chat failed: No response body');

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n').filter(Boolean);
            
            for (const line of lines) {
                try {
                    const json = JSON.parse(line);
                    if (json.done) return;
                    if (json.message?.content) {
                        yield json.message.content;
                    }
                } catch (e) {
                    // Ignore incomplete JSON chunks
                }
            }
        }
    }

    async chat(messages: ChatMessage[], model: string, onToken: (token: string) => void): Promise<void> {
        for await (const token of this.chatGenerator(messages, model)) {
            onToken(token);
        }
    }
}
