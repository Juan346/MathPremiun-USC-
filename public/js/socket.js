// public/js/socket.js - Configuración centralizada de Socket.io
class SocketManager {
    constructor() {
        this.socket = null;
        this.token = localStorage.getItem('token');
        this.connected = false;
        this.eventHandlers = new Map();
    }
    
    connect() {
        if (!this.token) {
            console.error('No hay token de autenticación');
            return null;
        }
        
        this.socket = io({
            auth: { token: this.token },
            transports: ['websocket', 'polling'],
            reconnection: true,
            reconnectionAttempts: 5,
            reconnectionDelay: 1000
        });
        
        this.socket.on('connect', () => {
            console.log('🔌 Socket conectado');
            this.connected = true;
            this.triggerEvent('connect');
        });
        
        this.socket.on('disconnect', () => {
            console.log('🔌 Socket desconectado');
            this.connected = false;
            this.triggerEvent('disconnect');
        });
        
        this.socket.on('error', (error) => {
            console.error('Socket error:', error);
            this.triggerEvent('error', error);
        });
        
        return this.socket;
    }
    
    on(event, callback) {
        if (!this.eventHandlers.has(event)) {
            this.eventHandlers.set(event, []);
        }
        this.eventHandlers.get(event).push(callback);
        
        if (this.socket) {
            this.socket.on(event, callback);
        }
    }
    
    off(event, callback) {
        if (this.eventHandlers.has(event)) {
            const handlers = this.eventHandlers.get(event);
            const index = handlers.indexOf(callback);
            if (index !== -1) handlers.splice(index, 1);
        }
        
        if (this.socket) {
            this.socket.off(event, callback);
        }
    }
    
    emit(event, data) {
        if (this.socket && this.connected) {
            this.socket.emit(event, data);
        } else {
            console.warn(`No se pudo emitir ${event}: socket no conectado`);
        }
    }
    
    triggerEvent(event, data) {
        if (this.eventHandlers.has(event)) {
            this.eventHandlers.get(event).forEach(callback => callback(data));
        }
    }
    
    disconnect() {
        if (this.socket) {
            this.socket.disconnect();
            this.socket = null;
        }
        this.connected = false;
    }
}

// Crear instancia global
const socketManager = new SocketManager();