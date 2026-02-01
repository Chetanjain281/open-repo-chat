import * as vscode from 'vscode';
import { OllamaService } from './services/ollama';
import { LanceDBService } from './services/lancedb';
import { FileDiscoveryService } from './services/fileDiscovery';
import { ChunkerService } from './services/chunker';
import { IndexerService } from './services/indexer';
import { RAGService } from './services/ragService';
import { SetupViewProvider } from './providers/SetupViewProvider';
import { ChatViewProvider } from './providers/ChatViewProvider';

let ollamaService: OllamaService;

export function activate(context: vscode.ExtensionContext) {
    console.log('Open Repo Chat is active!');

    const config = vscode.workspace.getConfiguration('openRepoChat');
    const ollamaUrl = config.get<string>('ollamaUrl') || 'http://localhost:11434';

    // Initialize Services
    ollamaService = new OllamaService(ollamaUrl);
    
    const lancedbService = new LanceDBService(context);
    const fileDiscoveryService = new FileDiscoveryService();
    const chunkerService = new ChunkerService();
    
    const indexerService = new IndexerService(
        fileDiscoveryService,
        chunkerService,
        lancedbService,
        ollamaService
    );

    const ragService = new RAGService(ollamaService, lancedbService);

    // Providers
    const setupProvider = new SetupViewProvider(context.extensionUri, ollamaService);
    const chatProvider = new ChatViewProvider(context.extensionUri, ragService, indexerService, ollamaService);

    // Register Views
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(SetupViewProvider.viewType, setupProvider),
        vscode.window.registerWebviewViewProvider(ChatViewProvider.viewType, chatProvider)
    );

    // Register Commands
    context.subscriptions.push(
        vscode.commands.registerCommand('open-repo-chat.index', async () => {
             vscode.commands.executeCommand('workbench.view.extension.openRepoChat');
             vscode.window.showInformationMessage('Please use the Index button in the Chat sidebar.');
        })
    );

    // Listen for config changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('openRepoChat.ollamaUrl')) {
                const newUrl = vscode.workspace.getConfiguration('openRepoChat').get<string>('ollamaUrl');
                if (newUrl) {
                    ollamaService.setBaseUrl(newUrl);
                }
            }
        })
    );
}

export async function deactivate() {
    if (ollamaService) {
        const config = vscode.workspace.getConfiguration('openRepoChat');
        const chatModel = config.get<string>('chatModel') || 'llama3.2:3b';
        const embedModel = config.get<string>('embeddingModel') || 'nomic-embed-text';

        // Try to unload models on shutdown
        await ollamaService.unloadModel(chatModel);
        await ollamaService.unloadModel(embedModel);
    }
}
