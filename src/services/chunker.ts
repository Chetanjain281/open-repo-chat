import Parser from 'tree-sitter';
import JavaScript from 'tree-sitter-javascript';
import TypeScript from 'tree-sitter-typescript';
import Python from 'tree-sitter-python';
import * as fs from 'fs';

export interface Chunk {
    id: string; // unique
    content: string;
    filePath: string;
    type: string; // 'function' | 'class' | 'markdown' | 'other'
    startLine: number;
    endLine: number;
}

export class ChunkerService {
    private parser: Parser;
    private jsLang = JavaScript;
    private tsLang = TypeScript.typescript;
    private tsxLang = TypeScript.tsx;
    private pyLang = Python;

    constructor() {
        this.parser = new Parser();
    }

    async chunkFile(filePath: string): Promise<Chunk[]> {
        const content = await fs.promises.readFile(filePath, 'utf8');
        const ext = filePath.split('.').pop()?.toLowerCase();

        if (ext === 'md') {
            return this.chunkMarkdown(content, filePath);
        }

        // Set Language
        try {
            if (ext === 'js' || ext === 'jsx' || ext === 'mjs') {
                this.parser.setLanguage(this.jsLang);
            } else if (ext === 'ts') {
                this.parser.setLanguage(this.tsLang);
            } else if (ext === 'tsx') {
                this.parser.setLanguage(this.tsxLang);
            } else if (ext === 'py') {
                this.parser.setLanguage(this.pyLang);
            } else {
                return []; // Unsupported
            }
        } catch (e) {
            console.warn(`Could not set language for ${filePath}: ${e}`);
            return [];
        }

        const tree = this.parser.parse(content);
        return this.extractNodeChunks(tree.rootNode, content, filePath);
    }

    private chunkMarkdown(content: string, filePath: string): Chunk[] {
        // Simple header splitting
        const lines = content.split('\n');
        const chunks: Chunk[] = [];
        let currentChunkLines: string[] = [];
        let startLine = 0;

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (line.startsWith('## ') || line.startsWith('### ') || line.startsWith('# ')) {
                if (currentChunkLines.length > 0) {
                    chunks.push({
                        id: `${filePath}#${startLine}`,
                        content: currentChunkLines.join('\n'),
                        filePath,
                        type: 'markdown',
                        startLine,
                        endLine: i - 1
                    });
                    currentChunkLines = [];
                }
                startLine = i; // New chunk starts
            }
            currentChunkLines.push(line);
        }

        // Push last chunk
        if (currentChunkLines.length > 0) {
            chunks.push({
                id: `${filePath}#${startLine}`,
                content: currentChunkLines.join('\n'),
                filePath,
                type: 'markdown',
                startLine,
                endLine: lines.length - 1
            });
        }

        return chunks;
    }

    private extractNodeChunks(root: Parser.SyntaxNode, source: string, filePath: string): Chunk[] {
        const chunks: Chunk[] = [];
        
        // Strategy: Look for class_declaration, function_declaration, method_definition
        // We will traverse the tree
        
        const meaningfulTypes = [
            'function_declaration',
            'function_definition', // Python
            'class_declaration',
            'class_definition', // Python
            'method_definition',
            'arrow_function'
        ];

        // Helper to recursively finding nodes
        const traverse = (node: Parser.SyntaxNode) => {
            if (meaningfulTypes.includes(node.type)) {
                // Check size. If too small, maybe ignore? Or combine?
                // For now, just take it.
                chunks.push({
                    id: `${filePath}#${node.startPosition.row}-${node.endPosition.row}`,
                    content: node.text,
                    filePath,
                    type: node.type,
                    startLine: node.startPosition.row + 1, // 1-based
                    endLine: node.endPosition.row + 1
                });
                // We typically stop traversing into children if we picked the parent block for simplicity
                // OR we can perform hierarchical chunking. 
                // Let's stop here for simplicity (granularity: function/class level).
            } else {
                for (const child of node.children) {
                    traverse(child);
                }
            }
        };

        traverse(root);
        return chunks;
    }
}
