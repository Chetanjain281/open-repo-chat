(function() {
    const vscode = acquireVsCodeApi();
    
    // State
    let isGenerating = false;

    // Elements
    const chatContainer = document.getElementById('chat-container');
    const promptInput = document.getElementById('prompt-input');
    const btnSend = document.getElementById('btn-send');
    const btnReindex = document.getElementById('btn-reindex');
    const btnIndexInit = document.getElementById('btn-index-init');
    const indexOverlay = document.getElementById('index-overlay');
    const progressFill = document.getElementById('index-progress-fill');
    const progressText = document.getElementById('index-progress-text');

    // Restore state
    const previousState = vscode.getState();
    if (previousState && previousState.html) {
        chatContainer.innerHTML = previousState.html;
    }

    // Attach listener to init button if it exists (fresh load or restored state with it)
    // Use delegation or re-attach
    chatContainer.addEventListener('click', (e) => {
        const target = e.target.closest('#btn-index-init');
        if (target) {
            console.log('Index button clicked in Webview');
            vscode.postMessage({ command: 'index' });
        }
    });

    // Auto-resize textarea
    promptInput.addEventListener('input', function() {
        this.style.height = 'auto';
        const newHeight = Math.min(this.scrollHeight, 150);
        this.style.height = newHeight + 'px';
        if (this.value === '') this.style.height = '40px';
    });

    // Send on Enter (Shift+Enter for newline)
    promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    btnSend.addEventListener('click', sendMessage);

    btnReindex.addEventListener('click', () => {
        vscode.postMessage({ command: 'index' });
    });

    function sendMessage() {
        const text = promptInput.value.trim();
        if (!text || isGenerating) return;

        appendMessage('user', text);
        promptInput.value = '';
        promptInput.style.height = '40px';
        
        isGenerating = true;
        // Add placeholder for assistant with typing indicator
        const assistantMsgId = Date.now().toString();
        appendMessage('assistant', '<div class="typing-indicator"><span></span><span></span><span></span></div>', assistantMsgId);
        
        vscode.postMessage({ command: 'chat', text, messageId: assistantMsgId });
    }

    function appendMessage(role, content, id) {
        const div = document.createElement('div');
        div.className = `message ${role}`;
        if (id) div.id = `msg-${id}`;
        
        const bubble = document.createElement('div');
        bubble.className = 'bubble';
        bubble.innerHTML = content;
        
        // Add timestamp
        const timestamp = document.createElement('span');
        timestamp.className = 'timestamp';
        const now = new Date();
        timestamp.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        div.appendChild(bubble);
        div.appendChild(timestamp);
        chatContainer.appendChild(div);
        scrollToBottom();
        
        // Save state
        vscode.setState({ html: chatContainer.innerHTML });
    }

    function updateMessage(id, content, done) {
        const msgDiv = document.getElementById(`msg-${id}`);
        if (msgDiv) {
            const bubble = msgDiv.querySelector('.bubble');
            // Clear typing indicator
            if (bubble.querySelector('.typing-indicator')) bubble.innerHTML = '';
            
            if (!msgDiv.dataset.fullContent) msgDiv.dataset.fullContent = '';
            msgDiv.dataset.fullContent += content;
            
            bubble.innerHTML = renderSimpleMarkdown(msgDiv.dataset.fullContent);
            
            // Highlight code blocks
            if (window.hljs) {
                bubble.querySelectorAll('pre code').forEach((block) => {
                    window.hljs.highlightElement(block);
                });
            }
        }
        
        if (done) {
            isGenerating = false;
            vscode.setState({ html: chatContainer.innerHTML });
        }
        scrollToBottom();
    }

    function renderSimpleMarkdown(text) {
        // 1. Escape HTML (partial, we trust our own regexes mostly but input needs sanitizing)
        // We actually want to preserve existing HTML tags we added? 
        // No, we are rendering from raw text again.
        
        // Basic escaping
        let html = text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;");

        // 2. Code Blocks with Headers, Copy and Apply Button
        // Regex to capture: ```lang:path/to/file
        html = html.replace(/```([\w\-\+\.]+)(?::([\w\-\+\.\/\\ ]+))?\n([\s\S]*?)```/g, function(match, lang, filePath, code) {
            const language = lang || 'plaintext';
            if (filePath) filePath = filePath.trim();
            const pathInfo = filePath ? `<span class="file-path">${filePath}</span>` : '';
            const applyBtn = filePath ? `<button class="apply-btn" onclick="applyCode(this, '${filePath}')">Apply</button>` : '';
            
            return `
            <div class="code-block">
                <div class="code-header">
                    <div class="header-left">
                        <span class="lang-label">${language}</span>
                        ${pathInfo}
                    </div>
                    <div class="header-right">
                        ${applyBtn}
                        <button class="copy-btn" onclick="copyCode(this)">Copy</button>
                    </div>
                </div>
                <pre><code class="input-code language-${language}">${code}</code></pre>
            </div>`;
        });

        // 3. Inline Code
        html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

        // 4. Bold
        html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

        // 5. Newlines to <br> (Simple)
        // Check if inside a tag? No, regex replace is naive.
        // We rely on block replacing happening first.
        // But wait, the <pre> content is already replaced. It has newlines.
        // We should replace newlines ONLY if they are not inside the code block HTML we just generated.
        
        // Split by code block placeholder?
        // Let's use a simpler split approach for safety.
        
        // Actually, just replace \n with <br> globally, UNLESS it's inside the 'code' attribute we just made?
        // Since we are setting innerHTML, browsing the DOM to highlight is easier.
        
        // For now, let's just do the replace, but be careful.
        // Simplest hack: Since I know the structure, I can just replace \n with <br> 
        // passing through the parts that are NOT part of the logic.
        
        // Let's defer \n replacement to CSS `white-space: pre-wrap` on the bubble?
        // That makes everything easier!
        
        return html; 
    }

    // Expose copy function
    window.copyCode = function(btn) {
        const pre = btn.closest('.code-block').querySelector('pre');
        const code = pre.textContent;
        navigator.clipboard.writeText(code).then(() => {
            const original = btn.textContent;
            btn.textContent = 'Copied!';
            btn.classList.add('copied');
            setTimeout(() => {
                btn.textContent = original;
                btn.classList.remove('copied');
            }, 2000);
        });
    };

    // Expose apply function
    window.applyCode = function(btn, filePath) {
        const pre = btn.closest('.code-block').querySelector('pre');
        const code = pre.textContent;
        vscode.postMessage({
            command: 'apply-edit',
            data: {
                filePath: filePath,
                content: code
            }
        });
        
        // Visual feedback (optimistic)
        const original = btn.textContent;
        btn.textContent = 'Sent!';
        setTimeout(() => {
            btn.textContent = original;
        }, 2000);
    };

    function scrollToBottom() {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

    // Handle incoming messages
    window.addEventListener('message', event => {
        const message = event.data;
        switch (message.type) {
            case 'chat-response':
                updateMessage(message.messageId, message.chunk, message.done);
                break;
            case 'index-start':
                indexOverlay.classList.remove('hidden');
                progressFill.style.width = '0%';
                progressText.textContent = 'Starting...';
                break;
            case 'index-progress':
                if (message.data.increment) {
                    // This is relative increment, complicated without total state.
                    // Let's assume message.data has percent if possible or just show spinner.
                    // Actually IndexerService sends increment.
                } 
                progressText.textContent = message.data.message;
                break;
            case 'index-end':
                indexOverlay.classList.add('hidden');
                break;
        }
    });

})();
