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

        // 2. Clear old index? 
        // For simple MVP without file tracking, yes, clear and rebuild.
        await this.lancedb.clearIndex();
        await this.lancedb.connect(); // Re-init table

        const totalFiles = files.length;
        let processedFiles = 0;

        // Process in batches to batch embeddings? 
        // Ollama might handle single embeddings better or small batches.
        // We'll process file by file.

        for (const file of files) {
            if (token.isCancellationRequested) break;

            const fsPath = file.fsPath;
            const chunks = await this.chunker.chunkFile(fsPath);

            processedFiles++;
            const percent = Math.floor((processedFiles / totalFiles) * 50); // First 50% is parsing/embedding
            progress.report({ message: `Parsing ${processedFiles}/${totalFiles}`, increment: 0 }); // Increment manually if needed

            if (chunks.length === 0) continue;

            const chunksToAdd: CodeChunk[] = [];
            
            for (const chunk of chunks) {
                 if (token.isCancellationRequested) break;
                 try {
                     // 3. Embed
                     // Prefix search_document: for Nomic
                     const vector = await this.ollama.embed(`search_document: ${chunk.content}`);
                     
                     chunksToAdd.push({
                         id: chunk.id,
                         vector: vector,
                         content: chunk.content,
                         filePath: chunk.filePath,
                         type: chunk.type,
                         startLine: chunk.startLine,
                         endLine: chunk.endLine
                     });
                 } catch (e) {
                     console.error(`Failed to embed chunk ${chunk.id}:`, e);
                 }
            }

            // 4. Store
            if (chunksToAdd.length > 0) {
                await this.lancedb.addChunks(chunksToAdd);
            }
            
             progress.report({ 
                 message: `Indexed ${processedFiles}/${totalFiles} files`, 
                 increment: (1 / totalFiles) * 100 
            });
        }
    }
}
