const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const { GoogleGenAI } = require('@google/genai');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

const io = socketIo(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling'],
  pingTimeout: 120000,
  pingInterval: 25000
});

app.use(cors());
app.use(express.json());
app.use(express.static('public'));
app.use('/models', express.static(path.join(__dirname, 'public/models')));

// Verificar API key
if (!process.env.GEMINI_API_KEY) {
  console.error('❌ ERROR: No se encontró GEMINI_API_KEY en .env');
  process.exit(1);
}

// Configurar Gemini
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL_NAME = 'gemini-2.5-flash';

// ============ GENERADOR DE PREGUNTAS CON SOPORTE 3D ============
async function generateSingleQuestion(level, category, previousQuestions = []) {
  try {
    const categoryName = getCategoryName(category);
    const difficulty = getDifficultyText(level);
    
    const previousContext = previousQuestions.length > 0 
      ? `\nNO repitas estos temas o preguntas:\n${previousQuestions.map((q, i) => `${i+1}. ${q.text}`).join('\n')}\n`
      : '';
    
    const isGeometry = category === 'geometria';
    const geometry3DInstruction = isGeometry ? `
      Si es posible, genera una pregunta que pueda visualizarse en 3D (cubos, esferas, prismas, pirámides, etc.).
      Incluye un campo "geometry3D" con:
      - "type": "cube" | "sphere" | "cylinder" | "pyramid" | "prism"
      - "params": { dimensiones como size, radius, height, etc. }
      - "description": descripción de la figura en 3D
    ` : '';
    
    const prompt = `Eres un experto en matemáticas. Genera UNA SOLA pregunta de ${categoryName} con nivel ${difficulty}.
    
    IMPORTANTE: Responde SOLO con un objeto JSON válido.
    ${previousContext}
    ${geometry3DInstruction}
    
    Formato exacto:
    {
      "text": "pregunta matemática clara y precisa",
      "options": ["opción A", "opción B", "opción C", "opción D"],
      "correct": "opción correcta exactamente como aparece en options",
      "explanation": "explicación detallada de por qué es correcta",
      "steps": ["paso 1 detallado", "paso 2 detallado", "paso 3 detallado"],
      "hint": "pista útil sin dar la respuesta completa",
      "geometry3D": ${isGeometry ? '{ "type": "cube", "params": { "size": 5 }, "description": "Cubo de lado 5 unidades" }' : 'null'}
    }`;

    console.log(`🤖 Generando pregunta (nivel ${level}, categoría: ${categoryName})`);
    
    const result = await genAI.models.generateContent({
      model: MODEL_NAME,
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.85,
        topP: 0.95,
        topK: 40,
        maxOutputTokens: 1024,
      }
    });
    
    const text = result.text;
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const data = JSON.parse(jsonMatch ? jsonMatch[0] : text);
    
    return {
      id: Date.now(),
      text: data.text,
      options: data.options,
      correct: data.correct,
      points: 10 * Math.min(level, 5),
      timeLimit: 45,
      explanation: data.explanation,
      steps: data.steps || ['Lee con atención', 'Identifica los datos', 'Aplica la fórmula'],
      hint: data.hint || 'Revisa los conceptos básicos',
      geometry3D: data.geometry3D || null
    };
    
  } catch (error) {
    console.error('Error generando pregunta:', error.message);
    return generateFallbackQuestion(level, category);
  }
}

// ============ ASISTENTE DE VOZ CON IA ============
async function getVoiceAssistance(question, userAnswer, isCorrect, explanation) {
  try {
    const prompt = `Eres un tutor virtual de matemáticas. El estudiante respondió a la siguiente pregunta:
    
Pregunta: ${question}
Respuesta del estudiante: ${userAnswer}
Resultado: ${isCorrect ? 'CORRECTO' : 'INCORRECTO'}
${!isCorrect ? `Respuesta correcta: ${explanation.split('.')[0]}` : ''}

Genera una respuesta AMABLE y MOTIVADORA (máximo 2 oraciones) que:
- Felicite si acertó
- Anime si falló
- Dé un consejo rápido y útil
- Sea cálido y alentador`;

    const result = await genAI.models.generateContent({
      model: MODEL_NAME,
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        temperature: 0.7,
        maxOutputTokens: 100,
      }
    });
    
    return result.text;
  } catch (error) {
    console.error('Error generando asistente de voz:', error.message);
    return isCorrect 
      ? "¡Excelente trabajo! Sigue así." 
      : "¡No te preocupes! Con práctica mejorarás. ¡Sigue intentándolo!";
  }
}

function getCategoryName(category) {
  const names = {
    'matematica_basica': 'matemática básica',
    'algebra': 'álgebra',
    'geometria': 'geometría 3D',
    'calculo': 'cálculo',
    'matematica_discreta': 'matemática discreta',
    'razonamiento_cuantitativo': 'razonamiento cuantitativo'
  };
  return names[category] || 'matemáticas';
}

function getDifficultyText(level) {
  if (level <= 2) return 'fácil';
  if (level <= 4) return 'intermedio';
  if (level <= 6) return 'avanzado';
  return 'experto';
}

function generateFallbackQuestion(level, category) {
  const geometryFallbacks = {
    'cube': { text: "Calcula el volumen de un cubo de lado 5 cm", correct: "125", options: ["100", "125", "150", "175"], explanation: "Volumen = lado³ = 5³ = 125 cm³", steps: ["Fórmula: V = a³", "5³ = 125"], hint: "Eleva el lado al cubo", geometry3D: { type: "cube", params: { size: 5 }, description: "Cubo de lado 5 unidades" } },
    'sphere': { text: "Calcula el volumen de una esfera de radio 3 cm", correct: "113.1", options: ["113.1", "100", "125", "150"], explanation: "Volumen = (4/3)πr³ ≈ 113.1 cm³", steps: ["Fórmula: V = 4/3 π r³", "r³ = 27", "4/3 × 3.14 × 27 = 113.1"], hint: "Usa π ≈ 3.14", geometry3D: { type: "sphere", params: { radius: 3 }, description: "Esfera de radio 3 unidades" } }
  };
  
  const fallbacks = {
    'matematica_basica': {
      text: "¿Cuánto es 25 × 4?",
      correct: "100",
      options: ["80", "90", "100", "110"],
      explanation: "25 × 4 = 100",
      steps: ["20×4=80", "5×4=20", "80+20=100"],
      hint: "Descompón 25 en 20+5",
      geometry3D: null
    },
    'geometria': geometryFallbacks.cube,
    'algebra': {
      text: "Resuelve: 2x + 5 = 15",
      correct: "5",
      options: ["3", "4", "5", "6"],
      explanation: "x = 5",
      steps: ["2x = 10", "x = 5"],
      hint: "Aísla la variable",
      geometry3D: null
    }
  };
  
  const source = (category && fallbacks[category]) ? fallbacks[category] : fallbacks['matematica_basica'];
  
  return {
    id: Date.now(),
    text: source.text,
    options: source.options,
    correct: source.correct,
    points: 10,
    timeLimit: 30,
    explanation: source.explanation,
    steps: source.steps,
    hint: source.hint,
    geometry3D: source.geometry3D || null
  };
}

// ============ ALMACENAMIENTO ============
const users = new Map();
const rooms = new Map();
const activeSessions = new Map();
const readyStates = new Map();
const userRooms = new Map();

if (!fs.existsSync('./data')) {
  fs.mkdirSync('./data');
}

// ============ CARGA DE USUARIOS ============
const loadUsers = () => {
  try {
    if (fs.existsSync('./data/users.json')) {
      const data = fs.readFileSync('./data/users.json', 'utf8');
      const usersData = JSON.parse(data);
      usersData.forEach(user => users.set(user.id, user));
      console.log(`✅ Cargados ${users.size} usuarios`);
    } else {
      const demoUser = {
        id: uuidv4(),
        username: 'demo',
        password: 'demo123',
        score: 0,
        level: 1,
        gamesPlayed: 0
      };
      users.set(demoUser.id, demoUser);
      
      const testUser = {
        id: uuidv4(),
        username: 'test',
        password: 'test123',
        score: 0,
        level: 1,
        gamesPlayed: 0
      };
      users.set(testUser.id, testUser);
      
      saveUsers();
      console.log('✅ Usuario demo: demo / demo123');
      console.log('✅ Usuario test: test / test123');
    }
  } catch (err) {
    console.error('Error:', err);
  }
};

const saveUsers = () => {
  try {
    const usersArray = Array.from(users.values());
    fs.writeFileSync('./data/users.json', JSON.stringify(usersArray, null, 2));
  } catch (err) {
    console.error('Error:', err);
  }
};

loadUsers();

// ============ API ============
app.post('/api/register', (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ error: 'Campos requeridos' });
  
  const existing = Array.from(users.values()).find(u => u.username === username);
  if (existing) return res.status(400).json({ error: 'Usuario ya existe' });
  
  const userId = uuidv4();
  users.set(userId, { id: userId, username, password, score: 0, level: 1, gamesPlayed: 0 });
  saveUsers();
  res.json({ id: userId, username });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = Array.from(users.values()).find(u => u.username === username);
  if (!user || user.password !== password) return res.status(401).json({ error: 'Credenciales inválidas' });
  
  const token = uuidv4();
  activeSessions.set(token, { userId: user.id, username: user.username });
  res.json({ token, user: { id: user.id, username: user.username, score: user.score, level: user.level, gamesPlayed: user.gamesPlayed } });
});

app.get('/api/leaderboard', (req, res) => {
  const leaderboard = Array.from(users.values()).sort((a, b) => b.score - a.score).slice(0, 10);
  res.json(leaderboard);
});

app.get('/api/categories', (req, res) => {
  res.json(['matematica_basica', 'algebra', 'geometria', 'calculo', 'matematica_discreta', 'razonamiento_cuantitativo']);
});

// ============ FUNCIONES ============
function sendRoomsToAll() {
  const list = Array.from(rooms.values())
    .filter(r => r.gameState === 'waiting')
    .map(r => ({ id: r.id, name: r.name, players: r.players.length, maxPlayers: r.maxPlayers, category: r.category }));
  io.emit('room_list_update', list);
}

function sendRoomState(roomId) {
  const room = rooms.get(roomId);
  if (!room) return;
  const ready = readyStates.get(roomId) || new Map();
  const readyPlayers = Array.from(ready.entries()).filter(([_, r]) => r).map(([id]) => id);
  io.to(roomId).emit('room_state_update', {
    players: room.players.map(p => ({ id: p.id, username: p.username, score: room.scores[p.id] || 0 })),
    readyPlayers,
    hostId: room.host,
    gameState: room.gameState,
    currentQuestionNumber: room.currentQuestionNumber || 0,
    maxQuestions: room.maxQuestions || 10
  });
}

// ============ WEBSOCKETS ============
io.use((socket, next) => {
  const token = socket.handshake.auth.token;
  if (!token) return next(new Error('No token'));
  const session = activeSessions.get(token);
  if (!session) return next(new Error('Invalid token'));
  socket.userId = session.userId;
  socket.username = session.username;
  next();
});

io.on('connection', (socket) => {
  console.log(`✅ Conectado: ${socket.username}`);
  
  const leaderboard = Array.from(users.values()).sort((a, b) => b.score - a.score).slice(0, 10);
  socket.emit('leaderboard_update', leaderboard);
  sendRoomsToAll();
  
  const previousRoom = userRooms.get(socket.userId);
  if (previousRoom) {
    const room = rooms.get(previousRoom);
    if (room && room.gameState === 'waiting') {
      socket.join(previousRoom);
      socket.emit('room_joined', { roomId: previousRoom });
      sendRoomState(previousRoom);
    } else {
      userRooms.delete(socket.userId);
    }
  }
  
  // ============ CREAR SALA ============
  socket.on('create_room', async (data) => {
    try {
      const roomId = uuidv4().slice(0, 6);
      const userLevel = users.get(socket.userId)?.level || 1;
      
      const room = {
        id: roomId,
        name: data.name,
        maxPlayers: data.maxPlayers || 4,
        category: data.category,
        players: [{ id: socket.userId, username: socket.username, score: 0, answers: [] }],
        gameState: 'waiting',
        currentQuestion: null,
        currentQuestionNumber: 0,
        maxQuestions: 10,
        scores: { [socket.userId]: 0 },
        host: socket.userId,
        playersAnswered: [],
        askedQuestions: [],
        level: userLevel
      };
      
      rooms.set(roomId, room);
      userRooms.set(socket.userId, roomId);
      socket.join(roomId);
      
      const ready = new Map();
      ready.set(socket.userId, false);
      readyStates.set(roomId, ready);
      
      socket.emit('room_created', { roomId });
      sendRoomsToAll();
      sendRoomState(roomId);
      console.log(`📦 Sala creada: ${roomId}`);
    } catch (error) {
      console.error('Error:', error);
      socket.emit('error', { message: 'Error al crear sala' });
    }
  });
  
  // ============ UNIRSE A SALA ============
  socket.on('join_room', ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room) return socket.emit('error', { message: 'Sala no encontrada' });
    
    if (room.players.find(p => p.id === socket.userId)) {
      socket.emit('room_joined', { roomId });
      sendRoomState(roomId);
      return;
    }
    
    if (room.players.length >= room.maxPlayers) return socket.emit('error', { message: 'Sala llena' });
    if (room.gameState !== 'waiting') return socket.emit('error', { message: 'Juego ya comenzó' });
    
    room.players.push({ id: socket.userId, username: socket.username, score: 0, answers: [] });
    room.scores[socket.userId] = 0;
    userRooms.set(socket.userId, roomId);
    
    let ready = readyStates.get(roomId);
    if (!ready) ready = new Map();
    ready.set(socket.userId, false);
    readyStates.set(roomId, ready);
    
    socket.join(roomId);
    socket.emit('room_joined', { roomId });
    sendRoomState(roomId);
    sendRoomsToAll();
    console.log(`👤 ${socket.username} unido a ${roomId}`);
  });
  
  // ============ LISTO ============
  socket.on('player_ready', ({ roomId, ready }) => {
    const readyMap = readyStates.get(roomId);
    if (readyMap) {
      readyMap.set(socket.userId, ready);
      sendRoomState(roomId);
    }
  });
  
  // ============ ASISTENTE DE VOZ ============
  socket.on('request_voice_assistance', async ({ roomId, question, userAnswer, isCorrect }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    
    const questionObj = room.currentQuestion;
    const explanation = questionObj?.explanation || '';
    
    const voiceResponse = await getVoiceAssistance(question, userAnswer, isCorrect, explanation);
    socket.emit('voice_assistance', { message: voiceResponse });
  });
  
  // ============ INICIAR JUEGO ============
  socket.on('start_game', async ({ roomId }) => {
    const room = rooms.get(roomId);
    if (!room || room.host !== socket.userId) return;
    
    const ready = readyStates.get(roomId) || new Map();
    const allReady = room.players.every(p => ready.get(p.id) === true);
    if (!allReady) return socket.emit('error', { message: 'Espera a que todos estén listos' });
    if (room.players.length < 2) return socket.emit('error', { message: 'Mínimo 2 jugadores' });
    
    room.gameState = 'playing';
    room.currentQuestionNumber = 0;
    room.playersAnswered = [];
    room.askedQuestions = [];
    
    room.players.forEach(p => {
      p.answers = [];
    });
    
    io.to(roomId).emit('game_started', { totalQuestions: room.maxQuestions });
    await generateAndSendQuestion(roomId);
  });
  
  // ============ GENERAR Y ENVIAR PREGUNTA ============
  async function generateAndSendQuestion(roomId) {
    const room = rooms.get(roomId);
    if (!room || room.gameState !== 'playing') return;
    
    if (room.currentQuestionNumber >= room.maxQuestions) {
      endGame(roomId);
      return;
    }
    
    const newQuestion = await generateSingleQuestion(
      room.level, 
      room.category, 
      room.askedQuestions
    );
    
    room.currentQuestion = newQuestion;
    room.askedQuestions.push({ text: newQuestion.text, id: newQuestion.id });
    room.playersAnswered = [];
    room.currentQuestionNumber++;
    
    console.log(`📝 Pregunta ${room.currentQuestionNumber}/${room.maxQuestions}`);
    
    io.to(roomId).emit('new_question', {
      question: newQuestion,
      questionNumber: room.currentQuestionNumber,
      totalQuestions: room.maxQuestions
    });
    
    const timeoutId = setTimeout(async () => {
      const currentRoom = rooms.get(roomId);
      if (currentRoom && currentRoom.gameState === 'playing') {
        console.log(`⏰ Timeout pregunta ${currentRoom.currentQuestionNumber}`);
        await generateAndSendQuestion(roomId);
      }
    }, newQuestion.timeLimit * 1000);
    
    if (!room.timeouts) room.timeouts = [];
    room.timeouts.push(timeoutId);
  }
  
  // ============ RECIBIR RESPUESTA ============
  socket.on('submit_answer', async ({ roomId, answer, questionId }) => {
    const room = rooms.get(roomId);
    if (!room || room.gameState !== 'playing') return;
    
    const q = room.currentQuestion;
    if (!q || q.id !== questionId) return;
    if (room.playersAnswered?.includes(socket.userId)) return;
    
    if (!room.playersAnswered) room.playersAnswered = [];
    room.playersAnswered.push(socket.userId);
    
    const isCorrect = answer.toLowerCase() === q.correct.toLowerCase();
    let pointsEarned = 0;
    
    if (isCorrect) {
      pointsEarned = q.points;
      room.scores[socket.userId] = (room.scores[socket.userId] || 0) + pointsEarned;
      const player = room.players.find(p => p.id === socket.userId);
      if (player) {
        player.score = room.scores[socket.userId];
        player.answers.push({
          question: q.text,
          userAnswer: answer,
          correctAnswer: q.correct,
          isCorrect: true,
          points: pointsEarned,
          explanation: q.explanation,
          steps: q.steps,
          hint: q.hint,
          geometry3D: q.geometry3D
        });
      }
      
      const user = users.get(socket.userId);
      if (user) {
        user.score += pointsEarned;
        saveUsers();
      }
      
      socket.emit('answer_result', { correct: true, points: pointsEarned });
      io.to(roomId).emit('score_update', { 
        scores: room.players.map(p => ({ username: p.username, score: room.scores[p.id] || 0 })) 
      });
    } else {
      const player = room.players.find(p => p.id === socket.userId);
      if (player) {
        player.answers.push({
          question: q.text,
          userAnswer: answer,
          correctAnswer: q.correct,
          isCorrect: false,
          points: 0,
          explanation: q.explanation,
          steps: q.steps,
          hint: q.hint,
          geometry3D: q.geometry3D
        });
      }
      
      socket.emit('answer_result', { correct: false, points: 0 });
    }
    
    // Generar respuesta del asistente de voz
    const voiceMessage = await getVoiceAssistance(q.text, answer, isCorrect, q.explanation);
    socket.emit('voice_assistance', { message: voiceMessage });
    
    const allAnswered = room.players.every(p => room.playersAnswered.includes(p.id));
    if (allAnswered) {
      if (room.timeouts) {
        room.timeouts.forEach(timeout => clearTimeout(timeout));
        room.timeouts = [];
      }
      await generateAndSendQuestion(roomId);
    }
  });
  
  // ============ TERMINAR JUEGO ============
  const endGame = (roomId) => {
    const room = rooms.get(roomId);
    if (!room) return;
    
    console.log(`🏆 Terminando juego en sala ${roomId}`);
    room.gameState = 'ended';
    
    const sorted = [...room.players].sort((a, b) => (room.scores[b.id] || 0) - (room.scores[a.id] || 0));
    const winner = sorted[0];
    const winnerUser = users.get(winner.id);
    if (winnerUser) winnerUser.gamesPlayed++;
    saveUsers();
    
    io.to(roomId).emit('game_ended', {
      finalScores: room.players.map(p => ({ 
        username: p.username, 
        score: room.scores[p.id] || 0,
        answers: p.answers || []
      })),
      winner: { username: winner.username, score: room.scores[winner.id] || 0 },
      allQuestions: room.askedQuestions.map((q, idx) => {
        const originalQ = room.questions?.find(qq => qq.id === q.id);
        return {
          number: idx + 1,
          text: q.text,
          correctAnswer: originalQ?.correct || 'N/A',
          explanation: originalQ?.explanation || '',
          steps: originalQ?.steps || [],
          hint: originalQ?.hint || '',
          geometry3D: originalQ?.geometry3D || null
        };
      })
    });
    
    const leaderboard = Array.from(users.values()).sort((a, b) => b.score - a.score).slice(0, 10);
    io.emit('leaderboard_update', leaderboard);
    
    setTimeout(() => {
      rooms.delete(roomId);
      readyStates.delete(roomId);
      sendRoomsToAll();
      console.log(`🗑️ Sala ${roomId} eliminada`);
    }, 30000);
  };
  
  socket.on('get_rooms', () => sendRoomsToAll());
  socket.on('pong', () => {});
  socket.on('disconnect', () => console.log(`❌ Desconectado: ${socket.username}`));
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, async () => {
  console.log(`\n${'='.repeat(55)}`);
  console.log(`🚀 Servidor: http://localhost:${PORT}`);
  console.log(`📝 demo / demo123 | test / test123`);
  console.log(`🤖 Gemini AI con modelo: ${MODEL_NAME}`);
  console.log(`🎨 SOPORTE 3D para geometría - Visualización interactiva de figuras`);
  console.log(`🎤 ASISTENTE DE VOZ con IA - Respuestas motivadoras personalizadas`);
  console.log(`✨ Preguntas generadas dinámicamente sin repetición`);
  console.log(`${'='.repeat(55)}\n`);
});