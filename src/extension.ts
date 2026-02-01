import * as vscode from 'vscode';
import { OllamaService } from './services/ollama';
import { LanceDBService } from './services/lancedb';
import { FileDiscoveryService } from './services/fileDiscovery';
import { ChunkerService } from './services/chunker';
import { IndexerService } from './services/indexer';
import { RAGService } from './services/ragService';
import { SetupViewProvider } from './providers/SetupViewProvider';
import { ChatViewProvider } from './providers/ChatViewProvider';

export function activate(context: vscode.ExtensionContext) {
    console.log('Open Repo Chat is active!');

    // Initialize Services
    const ollamaService = new OllamaService();
    
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
    const chatProvider = new ChatViewProvider(context.extensionUri, ragService, indexerService);

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
}

export function deactivate() {}
