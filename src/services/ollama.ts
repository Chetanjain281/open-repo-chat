// VS Code node environment usually has global fetch (Node 18+)

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
    private baseUrl: string;

    constructor(baseUrl: string = 'http://localhost:11434') {
        this.baseUrl = baseUrl.endsWith('/') ? baseUrl.slice(0, -1) : baseUrl;
    }

    setBaseUrl(url: string) {
        this.baseUrl = url.endsWith('/') ? url.slice(0, -1) : url;
    }

    async isRunning(): Promise<boolean> {
        try {
            const response = await fetch(`${this.baseUrl}/api/version`);
            return response.ok;
        } catch (error) {
            return false;
        }
    }

    async listModels(): Promise<OllamaModel[]> {
        try {
            const response = await fetch(`${this.baseUrl}/api/tags`);
            if (!response.ok) {return [];}
            const data = await response.json() as { models: OllamaModel[] };
            return data.models || [];
        } catch (error) {
            return [];
        }
    }

    async pullModel(modelName: string, onProgress?: (progress: any) => void): Promise<void> {
        const response = await fetch(`${this.baseUrl}/api/pull`, {
            method: 'POST',
            body: JSON.stringify({ name: modelName, stream: true }),
        });

        if (!response.body) {throw new Error('Failed to pull model: No response body');}

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) {break;}
            
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n').filter(Boolean);
            
            for (const line of lines) {
                try {
                    const status = JSON.parse(line);
                    if (onProgress) {onProgress(status);}
                } catch (e) {
                    console.error('Error parsing pull progress:', e);
                }
            }
        }
    }

    async embed(prompt: string, model: string = 'nomic-embed-text'): Promise<number[]> {
        const embeddings = await this.generateEmbeddings(prompt, model);
        return embeddings[0];
    }

    async generateEmbeddings(input: string | string[], model: string = 'nomic-embed-text', signal?: AbortSignal): Promise<number[][]> {
        try {
            const response = await fetch(`${this.baseUrl}/api/embed`, {
                method: 'POST',
                body: JSON.stringify({ model, input }),
                signal
            });
            
            if (response.ok) {
                 const data = await response.json() as { embeddings: number[][] };
                 return data.embeddings;
            } else {
                // Fallback to /api/embeddings (older) - only supports single string
                if (Array.isArray(input)) {
                    const allEmbeddings: number[][] = [];
                    for (const text of input) {
                        const res = await fetch(`${this.baseUrl}/api/embeddings`, {
                            method: 'POST',
                            body: JSON.stringify({ model, prompt: text }),
                            signal
                        });
                        const data = await res.json() as { embedding: number[] };
                        allEmbeddings.push(data.embedding);
                    }
                    return allEmbeddings;
                } else {
                    const fallbackResponse = await fetch(`${this.baseUrl}/api/embeddings`, {
                        method: 'POST',
                        body: JSON.stringify({ model, prompt: input }),
                        signal
                    });
                    const data = await fallbackResponse.json() as { embedding: number[] };
                    return [data.embedding];
                }
            }
        } catch (e) {
            if ((e as Error).name === 'AbortError') {
                throw e;
            }
            console.error('Embedding failed:', e);
            throw e;
        }
    }

    async *chatGenerator(messages: ChatMessage[], model: string = 'llama3.2:3b', signal?: AbortSignal): AsyncGenerator<string, void, unknown> {
        const response = await fetch(`${this.baseUrl}/api/chat`, {
            method: 'POST',
            body: JSON.stringify({ model, messages, stream: true }),
            signal
        });

        if (!response.body) {throw new Error('Chat failed: No response body');}

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) {break;}
            
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n').filter(Boolean);
            
            for (const line of lines) {
                try {
                    const json = JSON.parse(line);
                    if (json.done) {return;}
                    if (json.message?.content) {
                        yield json.message.content;
                    }
                } catch (e) {
                    // Ignore incomplete JSON chunks
                }
            }
        }
    }

    async chat(messages: ChatMessage[], model: string, onToken: (token: string) => void, signal?: AbortSignal): Promise<void> {
        for await (const token of this.chatGenerator(messages, model, signal)) {
            onToken(token);
        }
    }
}
