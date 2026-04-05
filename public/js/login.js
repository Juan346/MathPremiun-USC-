// public/js/login.js
const API_URL = '';

// Mostrar/ocultar tabs de login/registro
function showTab(tab) {
    const loginTab = document.querySelector('.tab-btn:first-child');
    const registerTab = document.querySelector('.tab-btn:last-child');
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');
    
    if (tab === 'login') {
        loginTab.classList.add('active');
        registerTab.classList.remove('active');
        loginForm.classList.add('active');
        registerForm.classList.remove('active');
    } else {
        loginTab.classList.remove('active');
        registerTab.classList.add('active');
        loginForm.classList.remove('active');
        registerForm.classList.add('active');
    }
}

// Función de login
async function login() {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errorDiv = document.getElementById('login-error');
    
    if (!username || !password) {
        errorDiv.textContent = '❌ Por favor complete todos los campos';
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            // Guardar token y datos del usuario
            localStorage.setItem('token', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));
            window.location.href = '/dashboard.html';
        } else {
            errorDiv.textContent = '❌ ' + (data.error || 'Credenciales inválidas');
        }
    } catch (error) {
        console.error('Error:', error);
        errorDiv.textContent = '❌ Error de conexión con el servidor';
    }
}

// Función de registro
async function register() {
    const username = document.getElementById('register-username').value.trim();
    const password = document.getElementById('register-password').value;
    const confirm = document.getElementById('register-confirm').value;
    const errorDiv = document.getElementById('register-error');
    
    if (!username || !password) {
        errorDiv.textContent = '❌ Por favor complete todos los campos';
        return;
    }
    
    if (password !== confirm) {
        errorDiv.textContent = '❌ Las contraseñas no coinciden';
        return;
    }
    
    if (password.length < 4) {
        errorDiv.textContent = '❌ La contraseña debe tener al menos 4 caracteres';
        return;
    }
    
    if (username.length < 3) {
        errorDiv.textContent = '❌ El usuario debe tener al menos 3 caracteres';
        return;
    }
    
    try {
        const response = await fetch(`${API_URL}/api/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            alert('✅ ¡Usuario registrado exitosamente! Ahora puedes iniciar sesión.');
            showTab('login');
            document.getElementById('register-username').value = '';
            document.getElementById('register-password').value = '';
            document.getElementById('register-confirm').value = '';
            document.getElementById('login-username').value = username;
        } else {
            errorDiv.textContent = '❌ ' + (data.error || 'Error al registrar usuario');
        }
    } catch (error) {
        console.error('Error:', error);
        errorDiv.textContent = '❌ Error de conexión con el servidor';
    }
}

// Permitir enviar con Enter
document.addEventListener('DOMContentLoaded', () => {
    const loginInputs = document.querySelectorAll('#login-form input');
    const registerInputs = document.querySelectorAll('#register-form input');
    
    loginInputs.forEach(input => {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') login();
        });
    });
    
    registerInputs.forEach(input => {
        input.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') register();
        });
    });
});