import * as vscode from 'vscode';
import { RAGService } from '../services/ragService';
import { IndexerService } from '../services/indexer';

export class ChatViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'openRepoChat.chatView';
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly ragService: RAGService,
        private readonly indexerService: IndexerService
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            console.log(`Received command: ${data.command}`);
            switch (data.command) {
                case 'chat':
                    await this.handleChat(data.text, data.messageId);
                    break;
                case 'index':
                    console.log('Triggering index handler...');
                    try {
                        await this.handleIndex();
                    } catch (e) {
                         console.error('Index handler error:', e);
                         vscode.window.showErrorMessage(`Index failed: ${e}`);
                    }
                    break;
                case 'apply-edit':
                    await this.handleApplyEdit(data.data as { filePath: string, content: string });
                    break;
            }
        });
    }

    private async handleChat(text: string, messageId: string) {
        if (!this._view) return;

        try {
            for await (const chunk of this.ragService.ask(text)) {
                this._view.webview.postMessage({
                    type: 'chat-response',
                    messageId: messageId,
                    chunk: chunk,
                    done: false
                });
            }
            this._view.webview.postMessage({
                type: 'chat-response',
                messageId: messageId,
                chunk: '',
                done: true
            });
        } catch (error) {
            this._view.webview.postMessage({
                type: 'chat-response',
                messageId: messageId,
                chunk: `\n[Error: ${error}]`,
                done: true
            });
        }
    }

    private async handleIndex() {
        if (!this._view) return;

        this._view.webview.postMessage({ type: 'index-start' });

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Indexing Codebase",
            cancellable: true
        }, async (progress, token) => {
            
            // Proxy progress to webview
            const webviewProgress = {
                report: (value: { message?: string; increment?: number }) => {
                    progress.report(value);
                    this._view?.webview.postMessage({
                        type: 'index-progress',
                        data: value
                    });
                }
            };

            await this.indexerService.indexWorkspace(webviewProgress, token);
        });

        this._view.webview.postMessage({ type: 'index-end' });
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // In a real build, we might read this from a file. 
        // For now, I'll return a placeholder that loads the CSS/JS.
        // Actually, to make it work, I need to serve the content I created in webview/chat.html
        // But since I cannot read Sync easily here (or I can ignore it and just duplicate minimal HTML),
        // I will stick to what I wrote in media/chat.js assuming the HTML structure matches.
        
        // Let's create the HTML string here to ensure it's correct and avoids fs.readFileSync issues in some envs.
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'chat.css'));
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css'));
        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline' https://cdnjs.cloudflare.com; script-src 'nonce-${nonce}' https://cdnjs.cloudflare.com; font-src ${webview.cspSource};">
                <link href="${styleUri}" rel="stylesheet">
                <link href="${codiconsUri}" rel="stylesheet">
                <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/github-dark.min.css">
                <script src="https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/highlight.min.js"></script>
                <title>Open Repo Chat</title>
            </head>
            <body>
                <div id="app">
                    <header>
                        <div class="header-status">
                            <span id="index-status">Ready</span>
                        </div>
                        <div class="header-actions">
                            <button id="btn-reindex" class="icon-btn" title="Re-index Codebase">
                                <i class="codicon codicon-refresh"></i>
                            </button>
                        </div>
                    </header>
            
                    <div id="chat-container">
                        <div class="message assistant">
                            <div class="bubble">
                                Hi! I'm Open Repo Chat. Index your codebase and ask me anything!
                                <br><br>
                                <button id="btn-index-init">Index Codebase</button>
                            </div>
                        </div>
                    </div>
            
                    <div id="input-area">
                        <textarea id="prompt-input" placeholder="Ask about your code... (Enter to send)"></textarea>
                        <button id="btn-send" title="Send message">
                            <i class="codicon codicon-arrow-up"></i>
                        </button>
                    </div>
                    
                    <div id="index-overlay" class="hidden">
                        <div class="overlay-content">
                            <h3>Indexing Codebase...</h3>
                            <div class="progress-bar">
                                <div class="fill" id="index-progress-fill"></div>
                            </div>
                            <p id="index-progress-text">scanning...</p>
                        </div>
                    </div>
                </div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
    }
    private async handleApplyEdit(data: { filePath: string, content: string }) {
        if (!data.filePath || !data.content) {
            return;
        }

        try {
            let uri: vscode.Uri;
            
            // Simple check for absolute path
            const isAbsolute = data.filePath.startsWith('/') || /^[a-zA-Z]:/.test(data.filePath);

            if (isAbsolute) {
                 uri = vscode.Uri.file(data.filePath);
            } else {
                const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
                if (!workspaceFolder) {
                    vscode.window.showErrorMessage('No workspace open to apply edits.');
                    return;
                }
                let relativePath = data.filePath;
                if (relativePath.startsWith('/') || relativePath.startsWith('\\')) {
                    relativePath = relativePath.substring(1);
                }
                uri = vscode.Uri.joinPath(workspaceFolder.uri, relativePath);
            }

            // Ensure directory exists
            try {
                 await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(uri, '..'));
            } catch {}

            await vscode.workspace.fs.writeFile(uri, Buffer.from(data.content));
            vscode.window.showInformationMessage(`Applied code to ${data.filePath}`);
            
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc);

        } catch (error) {
            console.error('Failed to apply edit:', error);
            vscode.window.showErrorMessage(`Failed to write file: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}

function getNonce() {
    let text = '';
    const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
