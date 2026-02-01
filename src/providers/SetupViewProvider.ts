import * as vscode from 'vscode';
import { OllamaService } from '../services/ollama';

export class SetupViewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'openRepoChat.setupView';
    private _view?: vscode.WebviewView;

    constructor(
        private readonly _extensionUri: vscode.Uri,
        private readonly _ollamaService: OllamaService
    ) {}

    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                this._extensionUri
            ]
        };

        webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.command) {
                case 'checkStatus':
                    await this.checkStatus();
                    break;
                case 'pullModel':
                    await this.pullModel(data.model);
                    break;
            }
        });

        // Initial check
        this.checkStatus();
    }

    private async checkStatus() {
        if (!this._view) { return; }

        const isOllamaRunning = await this._ollamaService.isRunning();
        let models: string[] = [];
        
        if (isOllamaRunning) {
            const modelList = await this._ollamaService.listModels();
            models = modelList.map(m => m.name);
        }

        const hasEmbedModel = models.some(m => m.includes('nomic-embed-text'));
        const hasChatModel = models.some(m => m.includes('llama3.2:3b')); // Simplistic check

        this._view.webview.postMessage({
            type: 'status',
            ollama: isOllamaRunning,
            embedModel: hasEmbedModel,
            chatModel: hasChatModel
        });
    }

    private async pullModel(modelName: string) {
        if (!this._view) { return; }
        
        try {
            await this._ollamaService.pullModel(modelName, (progress) => {
                this._view?.webview.postMessage({
                    type: 'progress',
                    model: modelName,
                    data: progress
                });
            });
            
            // Re-check status after pull
            await this.checkStatus();
             this._view?.webview.postMessage({
                    type: 'pullComplete',
                    model: modelName
                });
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to pull ${modelName}: ${error}`);
            this._view?.webview.postMessage({
                type: 'error',
                message: String(error)
            });
        }
    }

    private _getHtmlForWebview(webview: vscode.Webview) {
        // We will load the HTML from a file for better separation
        // But for now, since I can't easily readSync in this tool without extra steps, 
        // I'll inline the logic to load from disk or just return a string.
        // The plan said explicit file. Let's try to assume we can use the file.
        
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'setup.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'media', 'setup.css')); // if we have css
        const codiconsUri = webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, 'node_modules', '@vscode/codicons', 'dist', 'codicon.css'));

        const nonce = getNonce();

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource};">
                <link href="${styleUri}" rel="stylesheet">
                <link href="${codiconsUri}" rel="stylesheet">
                <title>Setup Open Repo Chat</title>
                <style>
                    body { font-family: var(--vscode-font-family); padding: 20px; color: var(--vscode-foreground); }
                    .step { margin-bottom: 20px; padding: 15px; border: 1px solid var(--vscode-widget-border); border-radius: 5px; background: var(--vscode-editor-background); }
                    .step-header { display: flex; align-items: center; justify-content: space-between; font-weight: bold; margin-bottom: 10px; }
                    .status-icon { margin-right: 10px; }
                    .codicon-check { color: var(--vscode-testing-iconPassed); }
                    .codicon-error { color: var(--vscode-testing-iconFailed); }
                    .codicon-circle-large-outline { color: var(--vscode-descriptionForeground); }
                    button { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: none; padding: 8px 12px; cursor: pointer; }
                    button:hover { background: var(--vscode-button-hoverBackground); }
                    button:disabled { opacity: 0.5; cursor: default; }
                    .progress-bar { height: 4px; background: var(--vscode-progressBar-background); margin-top: 10px; width: 0%; transition: width 0.3s; }
                    .hidden { display: none; }
                </style>
            </head>
            <body>
                <h2>Setup Open Repo Chat</h2>
                
                <div class="step" id="step-ollama">
                    <div class="step-header">
                        <span><i class="codicon codicon-circle-large-outline status-icon"></i> 1. Ollama Installation</span>
                        <span class="status-text">Checking...</span>
                    </div>
                    <div class="step-content">
                        <p>Ollama must be running locally.</p>
                        <a href="https://ollama.com" target="_blank">Download Ollama</a>
                        <button id="btn-check-ollama">Check Again</button>
                    </div>
                </div>

                <div class="step" id="step-embed">
                    <div class="step-header">
                        <span><i class="codicon codicon-circle-large-outline status-icon"></i> 2. Embedding Model</span>
                        <span class="status-text">Waiting...</span>
                    </div>
                    <div class="step-content">
                        <p>Model: <code>nomic-embed-text</code></p>
                        <button id="btn-pull-embed" disabled>Download Model</button>
                        <div class="progress-container hidden">
                            <div class="progress-bar" id="progress-embed"></div>
                            <small id="progress-text-embed"></small>
                        </div>
                    </div>
                </div>

                <div class="step" id="step-chat">
                    <div class="step-header">
                        <span><i class="codicon codicon-circle-large-outline status-icon"></i> 3. Chat Model</span>
                        <span class="status-text">Waiting...</span>
                    </div>
                    <div class="step-content">
                        <p>Model: <code>llama3.2:3b</code></p>
                        <button id="btn-pull-chat" disabled>Download Model</button>
                         <div class="progress-container hidden">
                            <div class="progress-bar" id="progress-chat"></div>
                            <small id="progress-text-chat"></small>
                        </div>
                    </div>
                </div>
                
                <div id="setup-complete" class="hidden">
                    <h3>✅ Setup Complete!</h3>
                    <p>You can now start indexing your codebase.</p>
                </div>

                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>`;
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
