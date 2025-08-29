/**
 * MintProxy WebSocket Client for interacting with mint_proxy API
 * Based on the reference implementation in API_usage_examples.md
 */

class MintProxyClient {
    constructor(wsUrl) {
        // Get the dynamic host same way as tollgate helper
        const currentHost = import.meta.env.VITE_TOLLGATE_HOST || window.location.hostname;
        wsUrl = wsUrl || `ws://${currentHost}:2122/mint-proxy`;
        this.wsUrl = wsUrl;
        this.ws = null;
        this.pendingRequests = new Map();
        this.requestTimeouts = new Map();
        this.eventCallbacks = new Map();
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 5;
        this.reconnectDelay = 1000;
        this.isConnected = false;
        this.autoReconnect = true;
        
        this.connect();
    }
    
    connect() {
        try {
            this.ws = new WebSocket(this.wsUrl);
            this.setupEventHandlers();
        } catch (error) {
            console.error('Error creating WebSocket connection:', error);
            this.handleConnectionError();
        }
    }
    
    setupEventHandlers() {
        this.ws.onopen = () => {
            this.isConnected = true;
            this.reconnectAttempts = 0;
            console.log('Connected to mint_proxy');
            this.triggerCallback('open', { status: 'connected' });
        };
        
        this.ws.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                this.handleMessage(message);
            } catch (error) {
                console.error('Error parsing WebSocket message:', error);
            }
        };
        
        this.ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            this.triggerCallback('error', { 
                code: 'connection_error',
                message: 'WebSocket connection error'
            });
        };
        
        this.ws.onclose = (event) => {
            this.isConnected = false;
            console.log('Disconnected from mint_proxy');
            this.triggerCallback('close', { 
                code: event.code,
                reason: event.reason 
            });
            
            if (this.autoReconnect && this.reconnectAttempts < this.maxReconnectAttempts) {
                this.handleReconnection();
            }
        };
    }
    
    handleReconnection() {
        this.reconnectAttempts++;
        const delay = this.reconnectDelay * this.reconnectAttempts;
        
        console.log(`Reconnecting to mint_proxy... (${this.reconnectAttempts}/${this.maxReconnectAttempts})`);
        
        setTimeout(() => {
            this.connect();
        }, delay);
    }
    
    handleConnectionError() {
        this.triggerCallback('error', {
            code: 'connection_failed',
            message: 'Failed to connect to mint_proxy WebSocket server'
        });
    }
    
    handleMessage(message) {
        switch(message.type) {
            case 'invoice_ready':
                this.onInvoiceReady(message);
                break;
                
            case 'tokens_ready':
                this.onTokensReady(message);
                break;
                
            case 'error':
                this.onError(message);
                break;
                
            default:
                console.warn('Unknown message type:', message.type);
        }
    }
    
    onInvoiceReady(message) {
        console.log('Invoice ready:', message);
        
        // Store request for tracking
        this.pendingRequests.set(message.request_id, {
            invoice: message.invoice,
            expires_at: message.expires_at,
            status: 'invoice_ready'
        });
        
        // Clear timeout if set
        if (this.requestTimeouts.has(message.request_id)) {
            clearTimeout(this.requestTimeouts.get(message.request_id));
            this.requestTimeouts.delete(message.request_id);
        }
        
        this.triggerCallback('invoice_ready', message);
    }
    
    onTokensReady(message) {
        console.log('Tokens ready:', message);
        
        // Update request status
        if (this.pendingRequests.has(message.request_id)) {
            this.pendingRequests.get(message.request_id).status = 'tokens_ready';
            this.pendingRequests.get(message.request_id).tokens = message.tokens;
        }
        
        this.triggerCallback('tokens_ready', message);
        
        // Cleanup request
        this.pendingRequests.delete(message.request_id);
    }
    
    onError(message) {
        console.error('mint_proxy error:', message);
        this.triggerCallback('error', message);
        
        // Clear any pending timeouts for this request
        if (message.request_id && this.requestTimeouts.has(message.request_id)) {
            clearTimeout(this.requestTimeouts.get(message.request_id));
            this.requestTimeouts.delete(message.request_id);
            this.pendingRequests.delete(message.request_id);
        }
    }
    
    requestInvoice(mintUrl, amount, timeoutMs = 30000) {
        if (!this.isConnected) {
            this.triggerCallback('error', {
                code: 'not_connected',
                message: 'WebSocket is not connected'
            });
            return;
        }
        
        const request = {
            type: "mint_request",
            mint_url: mintUrl,
            amount: amount
        };
        
        console.log('Requesting invoice:', request);
        this.ws.send(JSON.stringify(request));
        
        // Set timeout for this request
        const timeoutId = setTimeout(() => {
            this.triggerCallback('error', {
                code: 'request_timeout',
                message: 'Request timed out'
            });
        }, timeoutMs);
        
        // Store timeout ID (in a real implementation, you'd generate proper request IDs)
        this.requestTimeouts.set('current', timeoutId);
    }
    
    // Event callback management
    on(event, callback) {
        if (!this.eventCallbacks.has(event)) {
            this.eventCallbacks.set(event, []);
        }
        this.eventCallbacks.get(event).push(callback);
    }
    
    off(event, callback) {
        if (this.eventCallbacks.has(event)) {
            const callbacks = this.eventCallbacks.get(event);
            const index = callbacks.indexOf(callback);
            if (index > -1) {
                callbacks.splice(index, 1);
            }
        }
    }
    
    triggerCallback(event, data) {
        if (this.eventCallbacks.has(event)) {
            this.eventCallbacks.get(event).forEach(callback => {
                try {
                    callback(data);
                } catch (error) {
                    console.error('Error in event callback:', error);
                }
            });
        }
    }
    
    // Cleanup method
    disconnect() {
        this.autoReconnect = false;
        
        // Clear all timeouts
        this.requestTimeouts.forEach(timeoutId => {
            clearTimeout(timeoutId);
        });
        this.requestTimeouts.clear();
        
        // Clear pending requests
        this.pendingRequests.clear();
        
        if (this.ws) {
            this.ws.close();
        }
    }
    
    // Get connection status
    getConnectionStatus() {
        return {
            isConnected: this.isConnected,
            reconnectAttempts: this.reconnectAttempts,
            pendingRequests: this.pendingRequests.size
        };
    }
}

// Hook for React components to use the mint proxy client
export const useMintProxy = (wsUrl) => {
    let client = null;
    
    const connect = () => {
        if (!client) {
            client = new MintProxyClient(wsUrl);
        }
        return client;
    };
    
    const disconnect = () => {
        if (client) {
            client.disconnect();
            client = null;
        }
    };
    
    return {
        connect,
        disconnect,
        getClient: () => client
    };
};

// Export both the class and a factory function
export { MintProxyClient };

// Factory function for creating instances
export const createMintProxyClient = (wsUrl) => {
    // Use dynamic host if no URL provided
    if (!wsUrl) {
        const currentHost = import.meta.env.VITE_TOLLGATE_HOST || window.location.hostname;
        wsUrl = `ws://${currentHost}:2122/mint-proxy`;
    }
    return new MintProxyClient(wsUrl);
};
