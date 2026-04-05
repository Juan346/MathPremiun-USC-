// public/js/dashboard.js
const API_URL = '';
let socket = null;
let currentUser = null;
let roomsUpdateInterval = null;

// Verificar autenticación
const token = localStorage.getItem('token');
if (!token) {
    window.location.href = '/';
}

try {
    currentUser = JSON.parse(localStorage.getItem('user'));
    document.getElementById('username-display').textContent = currentUser.username;
    document.getElementById('score-display').textContent = `${currentUser.score || 0} pts`;
    document.getElementById('level-display').textContent = `Nivel ${currentUser.level || 1}`;
    document.getElementById('games-played').textContent = currentUser.gamesPlayed || 0;
    document.getElementById('total-score').textContent = currentUser.score || 0;
    document.getElementById('user-level').textContent = currentUser.level || 1;
} catch (e) {
    console.error('Error parsing user data:', e);
    window.location.href = '/';
}

// Conectar WebSocket
function connectSocket() {
    socket = io({
        auth: { token }
    });
    
    socket.on('connect', () => {
        console.log('✅ Conectado al servidor de tiempo real');
        // Solicitar lista de salas
        socket.emit('get_rooms');
        
        // Actualizar salas cada 5 segundos
        if (roomsUpdateInterval) clearInterval(roomsUpdateInterval);
        roomsUpdateInterval = setInterval(() => {
            if (socket && socket.connected) {
                socket.emit('get_rooms');
            }
        }, 5000);
    });
    
    socket.on('disconnect', () => {
        console.log('⚠️ Desconectado del servidor');
        if (roomsUpdateInterval) clearInterval(roomsUpdateInterval);
    });
    
    // Actualizar ranking en tiempo real
    socket.on('leaderboard_update', (leaderboard) => {
        updateLeaderboard(leaderboard);
    });
    
    // Actualizar lista de salas
    socket.on('room_list_update', (rooms) => {
        updateRoomsList(rooms);
    });
    
    // Escuchar errores
    socket.on('error', (data) => {
        showNotification(data.message, 'error');
    });
    
    // Cuando se crea una sala
    socket.on('room_created', (data) => {
        showNotification(`✅ Sala creada exitosamente!`, 'success');
        setTimeout(() => {
            window.location.href = `/game.html?roomId=${data.roomId}`;
        }, 1000);
    });
}

// Actualizar ranking
function updateLeaderboard(leaderboard) {
    const container = document.getElementById('leaderboard-list');
    
    if (!leaderboard || leaderboard.length === 0) {
        container.innerHTML = '<div class="empty-state">🏆 Aún no hay puntuaciones</div>';
        return;
    }
    
    container.innerHTML = leaderboard.map((user, index) => `
        <div class="leaderboard-item ${index < 3 ? 'top-' + (index + 1) : ''}">
            <span class="leaderboard-rank">${getRankIcon(index + 1)}</span>
            <span class="leaderboard-name">${user.username}</span>
            <span class="leaderboard-score">${user.score} pts</span>
            <span class="leaderboard-level">Nivel ${user.level}</span>
        </div>
    `).join('');
}

// Obtener ícono según posición
function getRankIcon(rank) {
    switch(rank) {
        case 1: return '🥇';
        case 2: return '🥈';
        case 3: return '🥉';
        default: return `${rank}`;
    }
}

// Actualizar lista de salas
function updateRoomsList(rooms) {
    const container = document.getElementById('rooms-list');
    
    if (!rooms || rooms.length === 0) {
        container.innerHTML = '<div class="empty-state">🎮 No hay salas disponibles. ¡Crea una!</div>';
        return;
    }
    
    container.innerHTML = rooms.map(room => `
        <div class="room-item">
            <div class="room-info">
                <h4>🏠 ${escapeHtml(room.name)}</h4>
                <p>👥 ${room.players}/${room.maxPlayers} jugadores</p>
                ${room.category ? `<p class="room-category">📚 ${getCategoryName(room.category)}</p>` : '<p class="room-category">📚 Todas las categorías</p>'}
            </div>
            <button class="join-btn" onclick="joinRoom('${room.id}')" ${room.players >= room.maxPlayers ? 'disabled' : ''}>
                ${room.players >= room.maxPlayers ? 'Sala llena' : 'Unirse'}
            </button>
        </div>
    `).join('');
}

// Obtener nombre de categoría
function getCategoryName(category) {
    const categories = {
        'matematica_basica': '🔢 Matemática Básica',
        'matematica_fundamental': '📊 Matemática Fundamental',
        'matematica_discreta': '🎯 Matemática Discreta',
        'calculo': '📈 Cálculo',
        'razonamiento_cuantitativo': '🧠 Razonamiento Cuantitativo',
        'algebra': '✖️ Álgebra'
    };
    return categories[category] || category;
}

// Crear sala
function createRoom() {
    const roomName = document.getElementById('room-name').value.trim();
    const maxPlayers = document.getElementById('max-players').value;
    const category = document.getElementById('category-select').value;
    
    if (!roomName) {
        showNotification('❌ Por favor ingresa un nombre para la sala', 'error');
        return;
    }
    
    if (!socket || !socket.connected) {
        showNotification('❌ No hay conexión con el servidor', 'error');
        return;
    }
    
    socket.emit('create_room', {
        name: roomName,
        maxPlayers: parseInt(maxPlayers),
        category: category || null
    });
}

// Unirse a sala
function joinRoom(roomId) {
    if (!socket || !socket.connected) {
        showNotification('❌ No hay conexión con el servidor', 'error');
        return;
    }
    
    socket.emit('join_room', { roomId });
    
    // Escuchar confirmación de unión
    socket.once('room_joined', (data) => {
        window.location.href = `/game.html?roomId=${data.roomId}`;
    });
    
    // Escuchar error de unión
    socket.once('error', (data) => {
        showNotification(data.message, 'error');
    });
}

// Cerrar sesión
function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    if (socket) socket.disconnect();
    if (roomsUpdateInterval) clearInterval(roomsUpdateInterval);
    window.location.href = '/';
}

// Mostrar notificación
function showNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
}

// Escapar HTML para prevenir XSS
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Cargar estadísticas del usuario
async function loadUserStats() {
    try {
        const response = await fetch(`${API_URL}/api/user/${currentUser.id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (response.ok) {
            const userData = await response.json();
            document.getElementById('games-played').textContent = userData.gamesPlayed || 0;
            document.getElementById('total-score').textContent = userData.score || 0;
            document.getElementById('user-level').textContent = userData.level || 1;
        }
    } catch (error) {
        console.error('Error loading user stats:', error);
    }
}

// Inicializar
document.addEventListener('DOMContentLoaded', () => {
    connectSocket();
    loadUserStats();
    
    // Permitir crear sala con Enter
    const roomNameInput = document.getElementById('room-name');
    if (roomNameInput) {
        roomNameInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') createRoom();
        });
    }
});