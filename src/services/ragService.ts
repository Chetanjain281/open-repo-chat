import { OllamaService, ChatMessage } from './ollama';
import { LanceDBService } from './lancedb';
import { SYSTEM_PROMPT } from '../prompts/systemPrompt';
import * as vscode from 'vscode';

export class RAGService {
    constructor(
        private ollama: OllamaService,
        private lancedb: LanceDBService
    ) {}

    async *ask(question: string, signal?: AbortSignal): AsyncGenerator<string, void, unknown> {
        const config = vscode.workspace.getConfiguration('openRepoChat');
        const chatModel = config.get<string>('chatModel') || 'llama3.2:3b';
        const embedModel = config.get<string>('embeddingModel') || 'nomic-embed-text';

        // 1. Embed Question
        const vectors = await this.ollama.generateEmbeddings(`search_query: ${question}`, embedModel, signal);
        const vector = vectors[0];

        // 2. Search
        const results = await this.lancedb.search(vector, 7);
        
        // 3. Build Context
        const contextText = results.map(r => 
            `File: ${r.filePath} (Lines ${r.startLine}-${r.endLine})\n\`\`\`${r.type === 'markdown' ? 'markdown' : 'typescript'}\n${r.content}\n\`\`\``
        ).join('\n\n');

        // 4. Prompt
        const prompt = SYSTEM_PROMPT
            .replace('{{CONTEXT}}', contextText)
            .replace('{{QUESTION}}', question);

        // 5. Chat
        const messages: ChatMessage[] = [
            { role: 'user', content: prompt }
        ];

        // Yield tokens
        for await (const chunk of this.ollama.chatGenerator(messages, chatModel, signal)) {
            yield chunk;
        }
    }
}
