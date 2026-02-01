import { OllamaService } from './ollama';
import { LanceDBService } from './lancedb';
import { SYSTEM_PROMPT } from '../prompts/systemPrompt';

export class RAGService {
    constructor(
        private ollama: OllamaService,
        private lancedb: LanceDBService
    ) {}

    async *ask(question: string): AsyncGenerator<string, void, unknown> {
        // 1. Embed Question
        const vector = await this.ollama.embed(`search_query: ${question}`);

        // 2. Search
        const results = await this.lancedb.search(vector, 5); // Start with top 5
        
        // 3. Build Context
        const contextText = results.map(r => 
            `File: ${r.filePath} (Lines ${r.startLine}-${r.endLine})\n\`\`\`${r.type === 'markdown' ? 'markdown' : 'typescript'}\n${r.content}\n\`\`\``
        ).join('\n\n');

        // 4. Prompt
        const prompt = SYSTEM_PROMPT
            .replace('{{CONTEXT}}', contextText)
            .replace('{{QUESTION}}', question);

        // 5. Chat
        const messages: { role: 'user' | 'system' | 'assistant'; content: string }[] = [
            { role: 'user', content: prompt } // Using single-turn RAG for now, or append to history
        ];

        // Yield tokens
        for await (const chunk of this.ollama.chatGenerator(messages)) {
            yield chunk;
        }
    }
}
