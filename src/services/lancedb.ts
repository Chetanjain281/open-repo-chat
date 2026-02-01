import * as lancedb from '@lancedb/lancedb';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

export interface CodeChunk {
    id: string;
    vector: number[];
    content: string;
    filePath: string;
    type: string;
    startLine: number;
    endLine: number;
    metadata?: any;
}

export class LanceDBService {
    private db?: lancedb.Connection;
    private table?: lancedb.Table;
    private readonly tableName = 'code_chunks';

    constructor(private readonly context: vscode.ExtensionContext) {}

    private async getDbPath(): Promise<string> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            throw new Error('No workspace open');
        }
        const workspaceHash = workspaceFolders[0].uri.fsPath.replace(/\//g, '_').replace(/:/g, ''); // Simple hash
        const dbDir = path.join(this.context.globalStorageUri.fsPath, 'lancedb', workspaceHash);
        
        if (!fs.existsSync(dbDir)) {
             fs.mkdirSync(dbDir, { recursive: true });
        }
        return dbDir;
    }

    async connect(): Promise<void> {
        const dbPath = await this.getDbPath();
        this.db = await lancedb.connect(dbPath);
        
        // Check if table exists
        const tableNames = await this.db.tableNames();
        if (tableNames.includes(this.tableName)) {
            this.table = await this.db.openTable(this.tableName);
        } else {
            // Create table with dummy data to enforce schema? 
            // LanceDB infers schema from data.
            // We'll create it on first add.
        }
    }

    async addChunks(chunks: CodeChunk[]): Promise<void> {
        if (!this.db) await this.connect();
        
        // Ensure vector is present and correct dimension if we were to enforce it.
        // LanceDB handles this.

        if (!this.table) {
            // @ts-ignore: LanceDB type mismatch workarounds
            this.table = await this.db!.createTable(this.tableName, chunks);
        } else {
            // @ts-ignore
            await this.table.add(chunks);
        }
    }

    // search method
    async search(queryVector: number[], limit: number = 5): Promise<CodeChunk[]> {
        if (!this.db) await this.connect();
        if (!this.table) return [];

        const results = await this.table.vectorSearch(queryVector)
            .limit(limit)
            .toArray();
            
        // Map back to CodeChunk interface
        return results.map(r => ({
            id: r.id as string,
            vector: r.vector as number[],
            content: r.content as string,
            filePath: r.filePath as string,
            type: r.type as string,
            startLine: r.startLine as number,
            endLine: r.endLine as number,
            metadata: r.metadata
        }));
    }

    async clearIndex(): Promise<void> {
        if (!this.db) await this.connect();
        try {
            await this.db!.dropTable(this.tableName);
            this.table = undefined;
        } catch (e) {
            // Ignore if table doesn't exist
        }
    }
}
