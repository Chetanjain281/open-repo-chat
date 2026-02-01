import { marked } from 'marked';
import hljs from 'highlight.js';

(function() {
    const vscode = acquireVsCodeApi();

    // State
    let isGenerating = false;

    // Elements
    const chatContainer = document.getElementById('chat-container');
    const promptInput = document.getElementById('prompt-input');
    const btnSend = document.getElementById('btn-send');
    const btnStop = document.getElementById('btn-stop');
    const btnClear = document.getElementById('btn-clear');
    const btnReindex = document.getElementById('btn-reindex');
    const indexOverlay = document.getElementById('index-overlay');
    const progressFill = document.getElementById('index-progress-fill');
    const progressText = document.getElementById('index-progress-text');

    // Configure marked
    marked.setOptions({
        highlight: function(code, lang) {
            if (lang && hljs.getLanguage(lang)) {
                return hljs.highlight(code, { language: lang }).value;
            }
            return hljs.highlightAuto(code).value;
        },
        breaks: true,
        gfm: true
    });

    // Custom renderer for code blocks to add headers and buttons
    const renderer = new marked.Renderer();
    renderer.code = function({ text: code, lang: language, escaped }) {
        let filePath = '';
        let lang = language || 'plaintext';

        if (lang.includes(':')) {
            const parts = lang.split(':');
            lang = parts[0];
            filePath = parts[1];
        }

        const pathInfo = filePath ? `<span class="file-path">${filePath}</span>` : '';
        const applyBtn = filePath ? `<button class="code-action-btn apply-btn" data-path="${filePath}">Apply</button>` : '';

        return `
        <div class="code-block">
            <div class="code-header">
                <div class="header-left">
                    <span class="lang-label">${lang}</span>
                    ${pathInfo}
                </div>
                <div class="header-right-actions">
                    ${applyBtn}
                    <button class="code-action-btn copy-btn">Copy</button>
                </div>
            </div>
            <pre><code class="hljs language-${lang}">${code}</code></pre>
        </div>`;
    };
    marked.setOptions({ renderer });

    // Restore state
    const previousState = vscode.getState();
    if (previousState && previousState.html) {
        chatContainer.innerHTML = previousState.html;
        scrollToBottom();
    }

    // Event delegation for dynamically added buttons
    chatContainer.addEventListener('click', (e) => {
        if (e.target.closest('#btn-index-init')) {
            vscode.postMessage({ command: 'index' });
        } else if (e.target.classList.contains('copy-btn')) {
            copyCode(e.target);
        } else if (e.target.classList.contains('apply-btn')) {
            applyCode(e.target);
        }
    });

    // Auto-resize textarea
    promptInput.addEventListener('input', function() {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
    });

    // Send on Enter (Shift+Enter for newline)
    promptInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    });

    btnSend.addEventListener('click', sendMessage);
    btnStop.addEventListener('click', stopGeneration);
    btnClear.addEventListener('click', clearChat);
    btnReindex.addEventListener('click', () => {
        vscode.postMessage({ command: 'index' });
    });

    function sendMessage() {
        const text = promptInput.value.trim();
        if (!text || isGenerating) return;

        appendMessage('user', text);
        promptInput.value = '';
        promptInput.style.height = 'auto';

        setGenerating(true);
        const assistantMsgId = Date.now().toString();
        appendMessage('assistant', '<div class="typing"><span></span><span></span><span></span></div>', assistantMsgId);

        vscode.postMessage({ command: 'chat', text, messageId: assistantMsgId });
    }

    function stopGeneration() {
        vscode.postMessage({ command: 'stop' });
        setGenerating(false);
    }

    function clearChat() {
        chatContainer.innerHTML = '';
        vscode.setState({});
        // Add back welcome message
        appendMessage('assistant', 'Chat cleared. How can I help you with your code today?');
    }

    function setGenerating(generating) {
        isGenerating = generating;
        if (generating) {
            btnStop.classList.remove('hidden');
            btnSend.classList.add('hidden');
        } else {
            btnStop.classList.add('hidden');
            btnSend.classList.remove('hidden');
        }
    }

    function appendMessage(role, content, id) {
        const div = document.createElement('div');
        div.className = `message ${role}`;
        if (id) div.id = `msg-${id}`;

        const bubble = document.createElement('div');
        bubble.className = 'bubble';

        if (role === 'user') {
            bubble.textContent = content;
        } else {
            bubble.innerHTML = content;
        }

        div.appendChild(bubble);
        chatContainer.appendChild(div);
        scrollToBottom();

        if (role === 'user') {
            vscode.setState({ html: chatContainer.innerHTML });
        }
    }

    function updateMessage(id, content, done) {
        const msgDiv = document.getElementById(`msg-${id}`);
        if (msgDiv) {
            const bubble = msgDiv.querySelector('.bubble');

            if (!msgDiv.dataset.fullContent) {
                msgDiv.dataset.fullContent = '';
                bubble.innerHTML = ''; // Clear typing indicator
            }

            msgDiv.dataset.fullContent += content;
            bubble.innerHTML = marked.parse(msgDiv.dataset.fullContent);
        }

        if (done) {
            setGenerating(false);
            vscode.setState({ html: chatContainer.innerHTML });
        }
        scrollToBottom();
    }

    function copyCode(btn) {
        const code = btn.closest('.code-block').querySelector('code').textContent;
        navigator.clipboard.writeText(code).then(() => {
            const original = btn.textContent;
            btn.textContent = 'Copied!';
            setTimeout(() => btn.textContent = original, 2000);
        });
    }

    function applyCode(btn) {
        const filePath = btn.dataset.path;
        const code = btn.closest('.code-block').querySelector('code').textContent;
        vscode.postMessage({
            command: 'apply-edit',
            data: { filePath, content: code }
        });

        const original = btn.textContent;
        btn.textContent = 'Applied!';
        setTimeout(() => btn.textContent = original, 2000);
    }

    function scrollToBottom() {
        chatContainer.scrollTop = chatContainer.scrollHeight;
    }

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
                if (message.data.message) progressText.textContent = message.data.message;
                if (message.data.increment) {
                   // Calculate percent if possible or just use what we have
                }
                // Update fill based on message if it contains progress
                break;
            case 'index-end':
                indexOverlay.classList.add('hidden');
                break;
        }
    });

})();
