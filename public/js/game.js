// public/js/game.js
const API_URL = '';
let socket = null;
let currentRoomId = null;
let currentUser = null;
let timer = null;
let timeLeft = 0;
let canAnswer = true;
let currentQuestion = null;
let gameEndData = null;

// Verificar autenticación
const token = localStorage.getItem('token');
if (!token) {
    window.location.href = '/';
}

try {
    currentUser = JSON.parse(localStorage.getItem('user'));
} catch (e) {
    window.location.href = '/';
}

// Obtener ID de sala de la URL
function getRoomId() {
    const params = new URLSearchParams(window.location.search);
    return params.get('roomId');
}

// Conectar WebSocket
function connectSocket() {
    socket = io({
        auth: { token }
    });
    
    socket.on('connect', () => {
        console.log('✅ Conectado al servidor de juego');
        currentRoomId = getRoomId();
        
        if (currentRoomId) {
            // Unirse a la sala
            socket.emit('join_room', { roomId: currentRoomId });
            document.getElementById('room-name-display').textContent = `Sala: ${currentRoomId}`;
        }
    });
    
    socket.on('disconnect', () => {
        console.log('⚠️ Desconectado del servidor');
        showNotification('⚠️ Perdiste conexión con el servidor', 'error');
    });
    
    // Confirmación de unión a sala
    socket.on('room_joined', (data) => {
        console.log('Unido a sala:', data);
        showNotification('✅ Te has unido a la sala', 'success');
    });
    
    // Jugador se unió
    socket.on('player_joined', (data) => {
        showNotification(`👤 ${data.username} se unió a la sala`, 'info');
        updatePlayersList(data.players);
    });
    
    // Jugador se fue
    socket.on('player_left', (data) => {
        showNotification(`👋 ${data.username} abandonó la sala`, 'info');
    });
    
    // Juego iniciado
    socket.on('game_started', (data) => {
        document.getElementById('question-counter').textContent = `Pregunta 1/${data.totalQuestions}`;
        showNotification(`🎮 ¡Juego comenzado! Categorías: ${data.categories.join(', ')}`, 'success');
        document.querySelector('.game-main').style.opacity = '1';
    });
    
    // Nueva pregunta
    socket.on('new_question', (data) => {
        currentQuestion = data.question;
        displayQuestion(data);
        startTimer(data.question.timeLimit);
        canAnswer = true;
        
        // Habilitar opciones
        document.querySelectorAll('.option-btn, .submit-btn, .text-answer-input').forEach(el => {
            if (el.tagName === 'BUTTON') {
                el.disabled = false;
                el.style.opacity = '1';
            }
            if (el.tagName === 'INPUT') {
                el.disabled = false;
                el.value = '';
            }
        });
        
        // Limpiar feedback anterior
        const feedbackDiv = document.getElementById('answer-feedback');
        if (feedbackDiv && !feedbackDiv.querySelector('.interactive-explanation')) {
            feedbackDiv.innerHTML = '';
        }
    });
    
    // Resultado de respuesta
    socket.on('answer_result', (data) => {
        stopTimer();
        
        if (data.correct) {
            showFeedback(`✅ ¡Correcto! +${data.points} puntos`, 'correct');
            if (data.explanation) {
                showExplanation(data.explanation, data.steps, data.hint, data.practiceTip);
            }
            // Animación de puntos
            animatePoints(data.points);
        } else {
            showFeedback(`❌ Incorrecto. La respuesta correcta es: ${data.correctAnswer}`, 'incorrect');
            if (data.explanation) {
                showExplanation(data.explanation, data.steps, data.hint, data.practiceTip);
            }
        }
        
        canAnswer = false;
        
        // Deshabilitar opciones
        document.querySelectorAll('.option-btn, .submit-btn').forEach(btn => {
            btn.disabled = true;
            btn.style.opacity = '0.5';
        });
        document.querySelectorAll('.text-answer-input').forEach(input => {
            input.disabled = true;
        });
    });
    
    // Explicación interactiva después de cada pregunta
    socket.on('question_explanation', (data) => {
        showInteractiveExplanation(data.question, data.playersAnswers);
    });
    
    // Actualización de puntajes
    socket.on('score_update', (data) => {
        updateScores(data.scores);
    });
    
    // Tiempo agotado
    socket.on('time_out', (data) => {
        if (canAnswer) {
            showFeedback(`⏰ Tiempo agotado! La respuesta era: ${data.correctAnswer}`, 'incorrect');
            showExplanation(data.explanation, data.steps);
            canAnswer = false;
            
            // Deshabilitar opciones
            document.querySelectorAll('.option-btn, .submit-btn').forEach(btn => {
                btn.disabled = true;
            });
        }
    });
    
    // Juego terminado
    socket.on('game_ended', (data) => {
        gameEndData = data;
        showGameEndModal(data);
    });
    
    // Errores
    socket.on('error', (data) => {
        showNotification(data.message, 'error');
        if (data.message.includes('Room not found') || data.message.includes('Sala no encontrada')) {
            setTimeout(() => {
                window.location.href = '/dashboard.html';
            }, 2000);
        }
    });
}

// Mostrar pregunta
function displayQuestion(data) {
    const question = data.question;
    const container = document.getElementById('question-options');
    const questionText = document.getElementById('question-text');
    
    // Mostrar categoría y tipo
    const categoryBadge = `
        <div class="category-badge">
            📚 ${question.categoryName || getCategoryName(question.category)} | 
            ${getTypeIcon(question.type)} ${question.type}
        </div>
    `;
    
    questionText.innerHTML = `
        ${categoryBadge}
        <div class="question-content">${escapeHtml(question.text)}</div>
    `;
    
    // Generar opciones según tipo
    if (question.type === 'completar' || question.type === 'problema' || !question.options) {
        container.innerHTML = `
            <input type="text" id="text-answer" class="text-answer-input" placeholder="Escribe tu respuesta..." autocomplete="off">
            <button onclick="submitAnswer()" class="submit-btn">Responder</button>
        `;
        
        // Enfocar input
        setTimeout(() => {
            const input = document.getElementById('text-answer');
            if (input) input.focus();
        }, 100);
    } else if (question.options && question.options.length > 0) {
        container.innerHTML = question.options.map(opt => `
            <button class="option-btn" onclick="submitAnswer('${escapeHtml(opt).replace(/'/g, "\\'")}')">
                ${escapeHtml(opt)}
            </button>
        `).join('');
    }
    
    document.getElementById('question-counter').textContent = `Pregunta ${data.questionNumber}/${data.totalQuestions}`;
}

// Iniciar temporizador
function startTimer(seconds) {
    timeLeft = seconds;
    const timerBar = document.getElementById('timer-bar');
    const timerText = document.getElementById('timer-text');
    
    if (timer) clearInterval(timer);
    
    timerBar.style.width = '100%';
    timerText.textContent = `${seconds}s`;
    
    timer = setInterval(() => {
        timeLeft--;
        timerText.textContent = `${timeLeft}s`;
        const percentage = (timeLeft / seconds) * 100;
        timerBar.style.width = `${Math.max(0, percentage)}%`;
        
        // Cambiar color cuando queda poco tiempo
        if (timeLeft <= 5) {
            timerBar.style.background = '#f56565';
        } else {
            timerBar.style.background = 'rgba(255,255,255,0.3)';
        }
        
        if (timeLeft <= 0) {
            clearInterval(timer);
            timer = null;
            timerBar.style.width = '0%';
        }
    }, 1000);
}

// Detener temporizador
function stopTimer() {
    if (timer) {
        clearInterval(timer);
        timer = null;
    }
}

// Enviar respuesta
function submitAnswer(answer = null) {
    if (!canAnswer) return;
    
    let userAnswer = answer;
    if (!userAnswer) {
        const textInput = document.getElementById('text-answer');
        if (textInput) userAnswer = textInput.value;
    }
    
    if (!userAnswer && userAnswer !== 0) {
        showFeedback('✏️ Por favor ingresa una respuesta', 'error');
        return;
    }
    
    socket.emit('submit_answer', {
        roomId: currentRoomId,
        answer: userAnswer.toString().trim(),
        questionId: currentQuestion.id,
        requestExplanation: true
    });
    
    canAnswer = false;
}

// Mostrar feedback
function showFeedback(message, type) {
    const feedbackDiv = document.getElementById('answer-feedback');
    const feedbackElement = document.createElement('div');
    feedbackElement.className = `feedback ${type}`;
    feedbackElement.textContent = message;
    
    // Si ya hay explicación, insertar antes
    if (feedbackDiv.querySelector('.explanation-card')) {
        feedbackDiv.insertBefore(feedbackElement, feedbackDiv.firstChild);
    } else {
        feedbackDiv.innerHTML = '';
        feedbackDiv.appendChild(feedbackElement);
    }
    
    setTimeout(() => {
        if (feedbackElement.parentNode && !feedbackDiv.querySelector('.explanation-card')) {
            feedbackElement.remove();
        }
    }, 3000);
}

// Mostrar explicación
// En showExplanation
function showExplanation(explanation, steps, hint, funFact) {
    const div = document.getElementById('feedbackArea');
    let stepsHtml = '';
    if (steps && steps.length) {
        stepsHtml = `<div style="margin-top:15px;"><strong>📝 Pasos para resolver:</strong><ul>${steps.map(s => `<li>${s}</li>`).join('')}</ul></div>`;
    }
    let hintHtml = '';
    if (hint) {
        hintHtml = `<div class="hint-box"><strong>💡 Pista:</strong> ${hint}</div>`;
    }
    let funFactHtml = '';
    if (funFact) {
        funFactHtml = `<div class="funfact-box" style="margin-top:15px; background:#e6f7ff; padding:10px; border-radius:8px;"><strong>🎓 Dato curioso:</strong> ${funFact}</div>`;
    }
    div.innerHTML += `
        <div class="explanation">
            <strong>🤖 Explicación IA:</strong>
            <p style="margin-top:10px;">${explanation}</p>
            ${stepsHtml}
            ${hintHtml}
            ${funFactHtml}
        </div>
    `;
}
// Mostrar explicación interactiva después de cada pregunta
function showInteractiveExplanation(question, playersAnswers) {
    const feedbackDiv = document.getElementById('answer-feedback');
    
    const responsesHtml = playersAnswers.map(pa => `
        <li class="${pa.isCorrect ? 'correct-response' : 'incorrect-response'}">
            <strong>${escapeHtml(pa.username)}:</strong> ${pa.answer || 'No respondió'} 
            ${pa.isCorrect ? '✓' : '✗'}
        </li>
    `).join('');
    
    const explanationHtml = `
        <div class="interactive-explanation">
            <h3>📖 Explicación detallada</h3>
            <div class="question-review">
                <p><strong>Pregunta:</strong> ${escapeHtml(question.text)}</p>
                <p><strong>Respuesta correcta:</strong> ${escapeHtml(question.correct)}</p>
            </div>
            <div class="explanation-detailed">
                <h4>✨ ¿Por qué?</h4>
                <p>${escapeHtml(question.explanation)}</p>
            </div>
            <div class="steps-detailed">
                <h4>🔢 Resolución paso a paso:</h4>
                <ol>
                    ${question.steps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}
                </ol>
            </div>
            ${question.formula ? `<div class="formula-box">📐 Fórmula: ${escapeHtml(question.formula)}</div>` : ''}
            <div class="responses-summary">
                <h4>📊 Respuestas de los participantes:</h4>
                <ul>
                    ${responsesHtml}
                </ul>
            </div>
            <div class="next-question-timer">
                Siguiente pregunta en <span id="next-countdown">5</span> segundos...
            </div>
        </div>
    `;
    
    feedbackDiv.innerHTML = explanationHtml;
    
    // Countdown para siguiente pregunta
    let countdown = 5;
    const countdownTimer = setInterval(() => {
        countdown--;
        const countdownSpan = document.getElementById('next-countdown');
        if (countdownSpan) countdownSpan.textContent = countdown;
        if (countdown <= 0) clearInterval(countdownTimer);
    }, 1000);
}

// Actualizar puntajes
function updateScores(scores) {
    const scoresList = document.getElementById('scores-list');
    if (!scoresList) return;
    
    scoresList.innerHTML = scores
        .sort((a, b) => b.score - a.score)
        .map((score, index) => `
            <div class="score-item ${index === 0 ? 'score-leader' : ''}">
                <span class="score-rank">${index === 0 ? '👑' : index + 1}</span>
                <span class="score-name">${escapeHtml(score.username)}</span>
                <span class="score-value">${score.score} pts</span>
            </div>
        `).join('');
}

// Actualizar lista de jugadores
function updatePlayersList(players) {
    const scoresList = document.getElementById('scores-list');
    if (!scoresList) return;
    
    scoresList.innerHTML = players
        .sort((a, b) => b.score - a.score)
        .map((player, index) => `
            <div class="score-item ${index === 0 ? 'score-leader' : ''}">
                <span class="score-rank">${index === 0 ? '👑' : index + 1}</span>
                <span class="score-name">${escapeHtml(player.username)}</span>
                <span class="score-value">${player.score} pts</span>
            </div>
        `).join('');
}

// Mostrar modal al final del juego
function showGameEndModal(data) {
    const modal = document.getElementById('game-end-modal');
    const winnerInfo = document.getElementById('winner-info');
    const finalScores = document.getElementById('final-scores');
    
    winnerInfo.innerHTML = `
        <div class="winner-crown">🏆</div>
        <h3>¡${escapeHtml(data.winner.username)} es el ganador!</h3>
        <p>Puntuación: ${data.winner.score} puntos</p>
    `;
    
    // Mostrar ranking final
    finalScores.innerHTML = `
        <h4>🏅 Ranking Final:</h4>
        <div class="final-ranking">
            ${data.finalScores.map((score, idx) => `
                <div class="ranking-item">
                    <span class="rank">${idx + 1}.</span>
                    <span class="name">${escapeHtml(score.username)}</span>
                    <span class="score">${score.score} pts</span>
                </div>
            `).join('')}
        </div>
    `;
    
    // Agregar resumen de aprendizaje
    if (data.questions && data.questions.length > 0) {
        const learningSummary = document.createElement('div');
        learningSummary.className = 'learning-summary';
        learningSummary.innerHTML = `
            <h4>📚 Resumen de Aprendizaje</h4>
            <div class="questions-review">
                ${data.questions.map((q, idx) => `
                    <details class="question-detail">
                        <summary>Pregunta ${idx + 1}: ${escapeHtml(q.text.substring(0, 50))}...</summary>
                        <div class="detail-content">
                            <p><strong>✅ Respuesta correcta:</strong> ${escapeHtml(q.correctAnswer)}</p>
                            <p><strong>📖 Explicación:</strong> ${escapeHtml(q.explanation)}</p>
                            <p><strong>🔢 Pasos:</strong></p>
                            <ul>${q.steps.map(step => `<li>${escapeHtml(step)}</li>`).join('')}</ul>
                            ${q.formula ? `<p><strong>📐 Fórmula:</strong> ${escapeHtml(q.formula)}</p>` : ''}
                            ${q.practiceTip ? `<p><strong>💪 Consejo:</strong> ${escapeHtml(q.practiceTip)}</p>` : ''}
                        </div>
                    </details>
                `).join('')}
            </div>
            <button onclick="downloadLearningReport()" class="download-report-btn">
                📥 Descargar reporte de aprendizaje
            </button>
        `;
        
        finalScores.appendChild(learningSummary);
    }
    
    modal.style.display = 'flex';
    stopTimer();
}

// Animación de puntos
function animatePoints(points) {
    const scoreDisplay = document.getElementById('score-display');
    if (!scoreDisplay) return;
    
    const currentPoints = parseInt(scoreDisplay.textContent) || 0;
    const newPoints = currentPoints + points;
    scoreDisplay.textContent = `${newPoints} pts`;
    
    // Animación de pulso
    scoreDisplay.style.transform = 'scale(1.2)';
    setTimeout(() => {
        scoreDisplay.style.transform = 'scale(1)';
    }, 200);
}

// Marcar como aprendido
function markAsLearned() {
    showNotification('👍 ¡Excelente! Sigue practicando', 'success');
    const explanationCard = document.querySelector('.explanation-card');
    if (explanationCard) {
        explanationCard.style.opacity = '0.5';
        setTimeout(() => {
            explanationCard.remove();
        }, 1000);
    }
}

// Pedir más ayuda
function askForMoreHelp() {
    showNotification('🤖 Pronto un tutor virtual te ayudará con este tema', 'info');
}

// Descargar reporte de aprendizaje
function downloadLearningReport() {
    if (!gameEndData) return;
    
    const report = {
        usuario: currentUser.username,
        fecha: new Date().toISOString(),
        puntaje_total: gameEndData.finalScores.find(s => s.username === currentUser.username)?.score || 0,
        posicion: gameEndData.finalScores.findIndex(s => s.username === currentUser.username) + 1,
        ganador: gameEndData.winner.username,
        preguntas: gameEndData.questions.map(q => ({
            texto: q.text,
            respuesta_correcta: q.correctAnswer,
            explicacion: q.explanation,
            pasos: q.steps,
            formula: q.formula,
            consejo: q.practiceTip
        }))
    };
    
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `reporte_aprendizaje_${currentUser.username}_${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    
    showNotification('📄 Reporte descargado exitosamente', 'success');
}

// Mostrar notificación
function showNotification(message, type) {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
}

// Obtener nombre de categoría
function getCategoryName(category) {
    const categories = {
        'matematica_basica': 'Matemática Básica',
        'matematica_fundamental': 'Matemática Fundamental',
        'matematica_discreta': 'Matemática Discreta',
        'calculo': 'Cálculo',
        'razonamiento_cuantitativo': 'Razonamiento Cuantitativo',
        'algebra': 'Álgebra'
    };
    return categories[category] || category;
}

// Obtener ícono según tipo
function getTypeIcon(type) {
    const icons = {
        'suma': '➕', 'resta': '➖', 'multiplicacion': '✖️', 'division': '➗',
        'fraccion': '🔢', 'porcentaje': '%', 'derivada': '📈', 'integral': '∫',
        'conjuntos': '🎯', 'combinatoria': '🃏', 'ecuacion': '✖️', 'problema': '🧠'
    };
    return icons[type] || '📝';
}

// Escapar HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Volver al dashboard
function returnToDashboard() {
    if (socket) socket.disconnect();
    window.location.href = '/dashboard.html';
}

// Inicializar
document.addEventListener('DOMContentLoaded', () => {
    connectSocket();
    
    // Permitir enviar respuesta con Enter
    document.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && canAnswer) {
            const textInput = document.getElementById('text-answer');
            if (textInput && document.activeElement === textInput) {
                submitAnswer();
            }
        }
    });
});