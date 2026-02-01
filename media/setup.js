(function() {
    const vscode = acquireVsCodeApi();
    
    // Elements
    const stepOllama = document.getElementById('step-ollama');
    const stepEmbed = document.getElementById('step-embed');
    const stepChat = document.getElementById('step-chat');
    
    const btnCheckOllama = document.getElementById('btn-check-ollama');
    const btnPullEmbed = document.getElementById('btn-pull-embed');
    const btnPullChat = document.getElementById('btn-pull-chat');

    const progressEmbed = document.getElementById('progress-embed');
    const progressChat = document.getElementById('progress-chat');
    const progressTextEmbed = document.getElementById('progress-text-embed');
    const progressTextChat = document.getElementById('progress-text-chat');

    // UI Updaters
    function updateStep(element, status) { // status: 'pending' | 'success' | 'error'
        const icon = element.querySelector('.status-icon');
        const text = element.querySelector('.status-text');
        
        icon.className = 'codicon status-icon';
        if (status === 'success') {
            icon.classList.add('codicon-check');
            text.textContent = 'Installed';
             element.classList.add('completed');
        } else if (status === 'error') {
            icon.classList.add('codicon-error');
            text.textContent = 'Not Found';
        } else {
             icon.classList.add('codicon-circle-large-outline');
             text.textContent = 'Pending';
        }
    }

    // Event Listeners
    btnCheckOllama.addEventListener('click', () => {
        vscode.postMessage({ command: 'checkStatus' });
    });

    btnPullEmbed.addEventListener('click', () => {
        btnPullEmbed.disabled = true;
        document.querySelector('#step-embed .progress-container').classList.remove('hidden');
        vscode.postMessage({ command: 'pullModel', model: 'nomic-embed-text' });
    });

    btnPullChat.addEventListener('click', () => {
        btnPullChat.disabled = true;
        document.querySelector('#step-chat .progress-container').classList.remove('hidden');
        vscode.postMessage({ command: 'pullModel', model: 'llama3.2:3b' });
    });

    // Handle Messages
    window.addEventListener('message', event => {
        const message = event.data;
        
        switch (message.type) {
            case 'status':
                handleStatus(message);
                break;
            case 'progress':
                handleProgress(message);
                break;
            case 'pullComplete':
                handlePullComplete(message);
                break;
             case 'error':
                console.error(message.message);
                break;
        }
    });

    function handleStatus(status) {
        // 1. Ollama
        updateStep(stepOllama, status.ollama ? 'success' : 'error');
        
        // 2. Embed Model
        if (status.ollama) {
            updateStep(stepEmbed, status.embedModel ? 'success' : 'pending');
            btnPullEmbed.disabled = status.embedModel;
            if (status.embedModel) btnPullEmbed.textContent = 'Installed';
        } else {
             btnPullEmbed.disabled = true;
        }

        // 3. Chat Model
        if (status.ollama) {
            updateStep(stepChat, status.chatModel ? 'success' : 'pending');
             btnPullChat.disabled = status.chatModel;
             if (status.chatModel) btnPullChat.textContent = 'Installed';
        } else {
            btnPullChat.disabled = true;
        }

        if (status.ollama && status.embedModel && status.chatModel) {
            document.getElementById('setup-complete').classList.remove('hidden');
        }
    }

    function handleProgress(msg) {
        let bar, text;
        if (msg.model === 'nomic-embed-text') {
            bar = progressEmbed;
            text = progressTextEmbed;
        } else {
            bar = progressChat;
            text = progressTextChat;
        }

        if (msg.data.total && msg.data.completed) {
            const percent = Math.round((msg.data.completed / msg.data.total) * 100);
            bar.style.width = `${percent}%`;
            text.textContent = `${percent}% - ${msg.data.status}`;
        } else {
            text.textContent = msg.data.status;
        }
    }
    
    function handlePullComplete(msg) {
         // Trigger status check to update UI
         vscode.postMessage({ command: 'checkStatus' });
    }

    // Initial load
    vscode.postMessage({ command: 'checkStatus' });

})();
