import * as vscode from 'vscode';
import { FileDiscoveryService } from './fileDiscovery';
import { ChunkerService } from './chunker';
import { LanceDBService, CodeChunk } from './lancedb';
import { OllamaService } from './ollama';

export class IndexerService {
    constructor(
        private fileDiscovery: FileDiscoveryService,
        private chunker: ChunkerService,
        private lancedb: LanceDBService,
        private ollama: OllamaService
    ) {}

    async indexWorkspace(progress: vscode.Progress<{ message?: string; increment?: number }>, token: vscode.CancellationToken): Promise<void> {
        console.log('Starting indexWorkspace...');
        // 1. Discovery
        progress.report({ message: 'Discovering files...' });
        const files = await this.fileDiscovery.findFiles();
        console.log(`Found ${files.length} files.`);
        
        if (files.length === 0) {
            vscode.window.showWarningMessage('No supported source files found to index.');
            return;
        }

        progress.report({ message: `Found ${files.length} files. Starting parsing...` });

        // 2. Clear old index
        await this.lancedb.clearIndex();
        await this.lancedb.connect();

        const totalFiles = files.length;
        let processedFiles = 0;

        // BATCH SIZE for embeddings
        const BATCH_SIZE = 10;
        let pendingChunks: any[] = [];

        for (const file of files) {
            if (token.isCancellationRequested) {break;}

            const fsPath = file.fsPath;
            const chunks = await this.chunker.chunkFile(fsPath);

            processedFiles++;
            progress.report({
                message: `Parsing ${processedFiles}/${totalFiles}: ${file.fsPath.split('/').pop()}`,
                increment: 0
            });

            for (const chunk of chunks) {
                pendingChunks.push(chunk);

                if (pendingChunks.length >= BATCH_SIZE) {
                    await this.processBatch(pendingChunks, token);
                    pendingChunks = [];
                }
            }
            
            progress.report({
                 increment: (1 / totalFiles) * 100 
            });
        }

        // Final batch
        if (pendingChunks.length > 0 && !token.isCancellationRequested) {
            await this.processBatch(pendingChunks, token);
        }
    }

    private async processBatch(chunks: any[], token: vscode.CancellationToken) {
        if (token.isCancellationRequested) {return;}

        try {
            const contents = chunks.map(c => `search_document: ${c.content}`);
            // Get current embedding model from config if needed, but for now use default or service handles it
            const config = vscode.workspace.getConfiguration('openRepoChat');
            const embedModel = config.get<string>('embeddingModel') || 'nomic-embed-text';

            const vectors = await this.ollama.generateEmbeddings(contents, embedModel);

            const chunksToAdd: CodeChunk[] = chunks.map((chunk, i) => ({
                id: chunk.id,
                vector: vectors[i],
                content: chunk.content,
                filePath: chunk.filePath,
                type: chunk.type,
                startLine: chunk.startLine,
                endLine: chunk.endLine
            }));

            await this.lancedb.addChunks(chunksToAdd);
        } catch (e) {
            console.error(`Failed to process batch:`, e);
        }
    }
}
