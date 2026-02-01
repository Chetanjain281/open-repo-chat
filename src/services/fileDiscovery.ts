import * as vscode from 'vscode';

export class FileDiscoveryService {
    
    // Extensions to include
    private readonly includePattern = '**/*.{js,ts,jsx,tsx,py,md}';
    
    // Pattern to exclude
    private readonly excludePattern = '**/{node_modules,dist,build,.git,__pycache__,venv,coverage,out}/**';

    async findFiles(): Promise<vscode.Uri[]> {
        return vscode.workspace.findFiles(this.includePattern, this.excludePattern);
    }
}
