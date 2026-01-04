"""
Studio Bridge - Frontend JavaScript for ACE Studio WebBridge API

This module contains JavaScript code that runs in the browser to communicate
with ACE Studio WebBridge. Since Studio runs on the user's local machine
(localhost:21573), the API must be called from the frontend, not the backend.

Usage in Gradio:
    from studio_bridge import STUDIO_BRIDGE_JS, JS_CONNECT_STUDIO, ...
    
    with gr.Blocks(js=STUDIO_BRIDGE_JS) as demo:
        ...
        btn.click(fn=..., js=JS_CONNECT_STUDIO)
"""

# =============================================================================
# Main Studio Bridge Object
# =============================================================================

STUDIO_BRIDGE_JS = """
// Studio Bridge - Frontend JavaScript for ACE Studio WebBridge API
window.StudioBridge = {
    BASE_URL: 'https://localhost:21573',
    token: null,
    connected: false,
    serverVersion: null,

    // Connect to Studio: check server health via /api/version and save token
    async connect(token) {
        if (!token || !token.trim()) {
            return '❌ Please enter a token';
        }
        try {
            // Check if server is running via /api/version (no auth required)
            const resp = await fetch(this.BASE_URL + '/api/version', {
                method: 'GET'
            });
            if (!resp.ok) {
                this.connected = false;
                return '❌ Server not responding: ' + resp.status;
            }
            const data = await resp.json();
            // Save token and server info
            this.token = token.trim();
            this.connected = true;
            this.serverVersion = data.version || 'unknown';
            return '✅ Connected to ACE Studio (v' + (data.appVersion || data.version || '?') + ')';
        } catch (e) {
            this.connected = false;
            this.token = null;
            if (e.message.includes('fetch') || e.name === 'TypeError') {
                return '❌ Cannot reach Studio. Is it running? (Check localhost:21573)';
            }
            return '❌ Error: ' + e.message;
        }
    },

    // Get audio from Studio clipboard
    async getAudio() {
        if (!this.token) {
            return { error: '❌ Not connected. Please connect first.' };
        }
        try {
            // First check if clipboard has audio
            const checkResp = await fetch(this.BASE_URL + '/api/audio/clipboard/check', {
                method: 'GET',
                headers: { 'Authorization': 'Bearer ' + this.token }
            });
            if (!checkResp.ok) {
                return { error: '❌ Failed to check clipboard: ' + checkResp.status };
            }
            const checkData = await checkResp.json();
            if (!checkData.hasAudio) {
                return { error: '❌ No audio in Studio clipboard' };
            }
            // Return the clipboard data URL for Gradio to fetch
            const audioUrl = this.BASE_URL + '/api/audio/clipboard/data';
            return { 
                url: audioUrl, 
                message: '✅ Got audio from Studio (' + checkData.filename + ')',
                // Include auth header info for fetching
                headers: { 'Authorization': 'Bearer ' + this.token }
            };
        } catch (e) {
            return { error: '❌ Error: ' + e.message };
        }
    },

    // Send audio to Studio via import
    async sendAudio(audioUrl, filename) {
        if (!this.token) {
            return '❌ Not connected. Please connect first.';
        }
        if (!audioUrl) {
            return '❌ No audio to send';
        }
        try {
            // Import audio to Studio via POST /api/audio/import
            const resp = await fetch(this.BASE_URL + '/api/audio/import', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': 'Bearer ' + this.token
                },
                body: JSON.stringify({
                    url: audioUrl,
                    filename: filename || 'ACEStep_Audio.mp3'
                })
            });
            if (!resp.ok) {
                return '❌ Failed to send: ' + resp.status;
            }
            const data = await resp.json();
            if (!data.success) {
                return '❌ Import failed: ' + (data.error || 'Unknown error');
            }
            // Poll for import completion via GET /api/audio/import/status?id=taskId
            const taskId = data.taskId;
            if (taskId) {
                for (let i = 0; i < 60; i++) {
                    await new Promise(r => setTimeout(r, 500));
                    const statusResp = await fetch(
                        this.BASE_URL + '/api/audio/import/status?id=' + taskId, 
                        { headers: { 'Authorization': 'Bearer ' + this.token } }
                    );
                    if (statusResp.ok) {
                        const status = await statusResp.json();
                        if (status.status === 'completed') {
                            return '✅ Audio sent to Studio';
                        } else if (status.status === 'failed') {
                            return '❌ Import failed: ' + (status.error || 'Unknown error');
                        }
                        // Still downloading/processing, continue polling
                    }
                }
                return '⏳ Import in progress (taskId: ' + taskId + ')';
            }
            return '✅ Audio sent to Studio';
        } catch (e) {
            return '❌ Error: ' + e.message;
        }
    }
};
"""


# =============================================================================
# Gradio Event Handler JavaScript Functions
# =============================================================================

JS_CONNECT_STUDIO = """
async (token) => {
    const result = await window.StudioBridge.connect(token);
    return result;
}
"""

JS_GET_AUDIO_FROM_STUDIO = """
async () => {
    const result = await window.StudioBridge.getAudio();
    if (result.error) {
        return [null, result.error];
    }
    // Return the URL - Gradio will fetch it
    return [result.url, result.message];
}
"""

JS_SEND_AUDIO_TO_STUDIO = """
async (audioData) => {
    // audioData is the Gradio audio component value
    // It could be a URL, blob URL, or file path depending on context
    if (!audioData) {
        return '❌ No audio to send';
    }
    // Get the audio URL from Gradio component
    let audioUrl = audioData;
    if (typeof audioData === 'object' && audioData.url) {
        audioUrl = audioData.url;
    }
    const result = await window.StudioBridge.sendAudio(audioUrl, 'ACEStep_Generated.mp3');
    return result;
}
"""


# =============================================================================
# Exported Constants
# =============================================================================

__all__ = [
    'STUDIO_BRIDGE_JS',
    'JS_CONNECT_STUDIO',
    'JS_GET_AUDIO_FROM_STUDIO',
    'JS_SEND_AUDIO_TO_STUDIO',
]
