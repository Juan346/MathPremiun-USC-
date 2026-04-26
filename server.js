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

// Verificar API key
if (!process.env.GEMINI_API_KEY) {
  console.error('❌ ERROR: No se encontró GEMINI_API_KEY en .env');
  process.exit(1);
}

// Configurar Gemini
const genAI = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
const MODEL_NAME = 'gemini-2.5-flash';

// ============ SISTEMA DE PREMIOS (SOLO 3) ============
const rewardsCatalog = [
  { 
    id: 1, 
    name: "🍭 Bananas", 
    description: "Gana uno de nuestros deliciosos premios comestibles, acercate y pregunta por nuestras opciones disponibles. ¡Un premio delicioso te espera!",
    pointsRequired: 500,
    icon: "🍬​",
    iconBg: "#FF6B35",
    color: "#FF6B35",
    realValue: "$ -",
    code: "FOOD_1000",
    image: "🍬🍭"
  },
  { 
    id: 2, 
    name: "🎵 Spotify Premium", 
    description: "1 mes de Spotify Premium - Música sin anuncios",
    pointsRequired: 10000,
    icon: "🎵",
    iconBg: "#1DB954",
    color: "#1DB954",
    realValue: "$18.500",
    code: "SPOTIFY_1500",
    image: "🎵🎧🎶"
  },
  { 
    id: 3, 
    name: "📺 Netflix Standard", 
    description: "1 mes de Netflix Standard - Series y películas en HD",
    pointsRequired: 15000,
    icon: "📺",
    iconBg: "#E50914",
    color: "#E50914",
    realValue: "$19.000",
    code: "NETFLIX_2000",
    image: "📺🎬🍿"
  }
];

// Premios canjeados por usuarios
const redeemedRewards = new Map();

// ============ FUNCIÓN PARA FORMATEAR NOTACIÓN MATEMÁTICA ============
// ============ FUNCIÓN PARA FORMATEAR NOTACIÓN MATEMÁTICA ============
// ============ FUNCIÓN CORREGIDA PARA FRACCIONES NEGATIVAS ============
// ============ FUNCIÓN CON NUEVO FORMATO DE FRACCIONES ============
// ============ FUNCIÓN ACTUALIZADA ============
function formatMathNotation(text) {
  if (!text) return '';
  
  let formatted = text;
  
  // Proteger HTML existente
  let htmlPlaceholders = [];
  let counter = 0;
  
  formatted = formatted.replace(/<[^>]+>/g, (match) => {
    const placeholder = `__HTML_${counter}__`;
    htmlPlaceholders.push({ placeholder, html: match });
    counter++;
    return placeholder;
  });
  
  // ============ 1. CONVERTIR LaTeX A FRACCIONES HTML ============
  // \frac{11}{4} → fracción HTML
  formatted = formatted.replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, 
    '<span class="fraction-large"><span class="numerator">$1</span><span class="denominator">$2</span></span>');
  
  // \frac{11}{4} con números negativos
  formatted = formatted.replace(/\\frac\{-([^{}]+)\}\{([^{}]+)\}/g, 
    '<span class="fraction-large-negative">-<span class="fraction-large"><span class="numerator">$1</span><span class="denominator">$2</span></span></span>');
  
  // ============ 2. FRACCIONES CON PARÉNTESIS ============
  formatted = formatted.replace(/\((\d+)\/(\d+)\)/g, 
    '<span class="fraction-large"><span class="numerator">$1</span><span class="denominator">$2</span></span>');
  
  formatted = formatted.replace(/\(-(\d+)\/(\d+)\)/g, 
    '<span class="fraction-large-negative">-<span class="fraction-large"><span class="numerator">$1</span><span class="denominator">$2</span></span></span>');
  
  // ============ 3. FRACCIONES NORMALES ============
  formatted = formatted.replace(/(\d+)\/(\d+)/g, 
    '<span class="fraction-large"><span class="numerator">$1</span><span class="denominator">$2</span></span>');
  
  formatted = formatted.replace(/-(\d+)\/(\d+)/g, 
    '<span class="fraction-large-negative">-<span class="fraction-large"><span class="numerator">$1</span><span class="denominator">$2</span></span></span>');
  
  // ============ 4. RAÍCES ============
  formatted = formatted.replace(/√(\d+)/g, 
    '<span class="sqrt">√<span class="sqrt-inner">$1</span></span>');
  
  formatted = formatted.replace(/√\(([^)]+)\)/g, 
    '<span class="sqrt">√<span class="sqrt-inner">($1)</span></span>');
  
  // ============ 5. POTENCIAS ============
  formatted = formatted.replace(/([a-zA-Z0-9])\^(\d+)/g, '$1<sup>$2</sup>');
  formatted = formatted.replace(/([a-zA-Z0-9])\^-(\d+)/g, '$1<sup>-$2</sup>');
  
  // ============ 6. SÍMBOLOS ============
  formatted = formatted.replace(/\*/g, '×');
  formatted = formatted.replace(/π/g, '<span class="symbol">π</span>');
  formatted = formatted.replace(/∞/g, '<span class="symbol">∞</span>');
  
  // ============ 7. NÚMEROS NEGATIVOS ============
  formatted = formatted.replace(/-(\d+(?:\.\d+)?)(?![\/\d])/g, '<span class="negative-number">-$1</span>');
  
  // Restaurar HTML protegido
  htmlPlaceholders.forEach(({ placeholder, html }) => {
    formatted = formatted.replace(placeholder, html);
  });
  
  return formatted;
}
// ============ GENERADOR DE PREGUNTAS ============
async function generateSingleQuestion(level, category, previousQuestions = []) {
  try {
    const categoryName = getCategoryName(category);
    const difficulty = getDifficultyText(level);
    
    const previousContext = previousQuestions.length > 0 
      ? `\nNO repitas estos temas:\n${previousQuestions.map((q, i) => `${i+1}. ${q.text}`).join('\n')}\n`
      : '';
    
    const isGeometry = category === 'geometria';
    const geometry3DInstruction = isGeometry ? `
      Incluye un campo "geometry3D" con:
      - "type": "cube" | "sphere" | "cylinder" | "pyramid"
      - "params": { tamaño, radio, altura, etc. }
    ` : '';
    
    const prompt = `Eres un experto en matemáticas. Genera UNA SOLA pregunta de ${categoryName} nivel ${difficulty}.
    
    IMPORTANTE: 
    1. Usa la notación √ para raíces cuadradas (ejemplo: "√16" o "√(x+2)")
    2. Usa ^ para potencias (ejemplo: "x^2", "2^3")
    3. Usa / para fracciones (ejemplo: "1/2", "3/4")
    4. Responde SOLO con JSON válido.
    
    ${previousContext}
    ${geometry3DInstruction}
    
    Formato:
    {
      "text": "pregunta clara usando √, ^, /",
      "options": ["opción A", "opción B", "opción C", "opción D"],
      "correct": "opción correcta",
      "explanation": "explicación detallada",
      "steps": ["paso1", "paso2", "paso3"],
      "hint": "pista útil",
      "geometry3D": ${isGeometry ? '{"type": "cube", "params": {"size": 5}}' : 'null'}
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
    
    // Formatear notación matemática en el texto y opciones
    return {
      id: Date.now(),
      text: formatMathNotation(data.text),
      options: data.options.map(opt => formatMathNotation(opt)),
      correct: data.correct,
      points: 10 * Math.min(level, 5),
      timeLimit: 45,
      explanation: formatMathNotation(data.explanation),
      steps: (data.steps || ['Lee con atención', 'Identifica los datos', 'Aplica la fórmula']).map(s => formatMathNotation(s)),
      hint: formatMathNotation(data.hint || 'Revisa los conceptos básicos'),
      geometry3D: data.geometry3D || null
    };
    
  } catch (error) {
    console.error('Error generando pregunta:', error.message);
    return generateFallbackQuestion(level, category);
  }
}

async function getVoiceAssistance(question, userAnswer, isCorrect, explanation) {
  try {
    const prompt = `Eres un tutor virtual motivador. El estudiante respondió:
Pregunta: ${question}
Respuesta: ${userAnswer}
Resultado: ${isCorrect ? 'CORRECTO' : 'INCORRECTO'}
${!isCorrect ? `Respuesta correcta: ${explanation.split('.')[0]}` : ''}

Genera una respuesta corta, AMABLE y MOTIVADORA (máximo 2 oraciones).`;

    const result = await genAI.models.generateContent({
      model: MODEL_NAME,
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.7, maxOutputTokens: 100 }
    });
    return result.text;
  } catch (error) {
    return isCorrect ? "🎉 ¡Excelente trabajo! Sigue así." : "💪 ¡No te rindas! Con práctica mejorarás.";
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
  const fallbacks = {
    // ============ MATEMÁTICA BÁSICA (15 preguntas) ============
    'matematica_basica': [
      {
        text: "¿Cuánto es √64? (raíz cuadrada de 64)",
        correct: "8",
        options: ["6", "7", "8", "9"],
        explanation: "√64 = 8, porque 8 × 8 = 64",
        steps: ["Busca un número que multiplicado por sí mismo dé 64", "8 × 8 = 64", "Por lo tanto √64 = 8"],
        hint: "¿Qué número multiplicado por sí mismo da 64?",
        geometry3D: null
      },
      {
        text: "¿Cuánto es 25 × 4?",
        correct: "100",
        options: ["80", "90", "100", "110"],
        explanation: "25 × 4 = 100. Es una multiplicación básica.",
        steps: ["Multiplica 20 × 4 = 80", "Multiplica 5 × 4 = 20", "Suma: 80 + 20 = 100"],
        hint: "Descompón 25 en 20 + 5",
        geometry3D: null
      },
      {
        text: "¿Cuál es el 20% de 150?",
        correct: "30",
        options: ["20", "25", "30", "35"],
        explanation: "20% de 150 = (20/100) × 150 = 30",
        steps: ["Divide 150 entre 10 = 15", "Multiplica por 2 = 30"],
        hint: "El 10% es 15, entonces el 20% es el doble",
        geometry3D: null
      },
      {
        text: "¿Cuánto es 144 ÷ 12?",
        correct: "12",
        options: ["10", "11", "12", "13"],
        explanation: "144 ÷ 12 = 12, porque 12 × 12 = 144",
        steps: ["Divide 144 entre 12", "12 × 12 = 144", "Resultado: 12"],
        hint: "Es una división exacta de la tabla del 12",
        geometry3D: null
      },
      {
        text: "¿Cuánto es 7 × 8?",
        correct: "56",
        options: ["48", "54", "56", "64"],
        explanation: "7 × 8 = 56 (tabla de multiplicar)",
        steps: ["Recuerda la tabla del 7", "7 × 8 = 56"],
        hint: "Siete veces ocho es cincuenta y seis",
        geometry3D: null
      },
      {
        text: "¿Cuánto es 3⁴? (3 elevado a la 4)",
        correct: "81",
        options: ["27", "64", "81", "243"],
        explanation: "3⁴ = 3 × 3 × 3 × 3 = 81",
        steps: ["3² = 9", "9 × 3 = 27", "27 × 3 = 81"],
        hint: "Multiplica 3 cuatro veces por sí mismo",
        geometry3D: null
      },
      {
        text: "¿Cuánto es 5/8 + 3/8?",
        correct: "1",
        options: ["1", "5/4", "8/8", "1/2"],
        explanation: "5/8 + 3/8 = 8/8 = 1",
        steps: ["Suma los numeradores: 5 + 3 = 8", "8/8 = 1"],
        hint: "Los denominadores son iguales, suma los numeradores",
        geometry3D: null
      },
      {
        text: "¿Cuánto es 0.75 × 100?",
        correct: "75",
        options: ["7.5", "75", "750", "0.075"],
        explanation: "Multiplicar por 100 mueve el punto decimal dos lugares a la derecha",
        steps: ["0.75 × 100 = 75"],
        hint: "Multiplicar por 100 es mover la coma decimal",
        geometry3D: null
      },
      {
        text: "¿Cuál es el MCD de 12 y 18?",
        correct: "6",
        options: ["3", "6", "9", "12"],
        explanation: "MCD(12,18) = 6",
        steps: ["Divisores de 12: 1,2,3,4,6,12", "Divisores de 18: 1,2,3,6,9,18", "Máximo común: 6"],
        hint: "Es el número más grande que divide a ambos",
        geometry3D: null
      },
      {
        text: "¿Cuánto es 4/5 de 100?",
        correct: "80",
        options: ["75", "80", "85", "90"],
        explanation: "4/5 de 100 = (4 × 100) ÷ 5 = 80",
        steps: ["100 ÷ 5 = 20", "20 × 4 = 80"],
        hint: "Divide entre el denominador y multiplica por el numerador",
        geometry3D: null
      },
      {
        text: "¿Cuánto es 2³ + 3²?",
        correct: "17",
        options: ["13", "15", "17", "19"],
        explanation: "2³ = 8, 3² = 9, 8 + 9 = 17",
        steps: ["2³ = 2×2×2 = 8", "3² = 3×3 = 9", "8 + 9 = 17"],
        hint: "Calcula las potencias primero",
        geometry3D: null
      },
      {
        text: "¿Cuál es el 15% de 200?",
        correct: "30",
        options: ["20", "25", "30", "35"],
        explanation: "200 × 0.15 = 30",
        steps: ["10% = 20", "5% = 10", "15% = 20 + 10 = 30"],
        hint: "Calcula el 10% y el 5%",
        geometry3D: null
      },
      {
        text: "¿Cuánto es 2.5 × 1.5?",
        correct: "3.75",
        options: ["3", "3.5", "3.75", "4"],
        explanation: "2.5 × 1.5 = 3.75",
        steps: ["25 × 15 = 375", "Cuenta decimales: 2 → 3.75"],
        hint: "Multiplica como si fueran enteros y luego pon el decimal",
        geometry3D: null
      },
      {
        text: "¿Cuánto es 10! / 9!? (factoriales)",
        correct: "10",
        options: ["9", "10", "11", "12"],
        explanation: "10! = 10 × 9!, por lo tanto 10! / 9! = 10",
        steps: ["Recuerda que 10! = 10 × 9!", "Cancelamos 9! del numerador y denominador", "Resultado: 10"],
        hint: "El factorial de n es n × (n-1)!",
        geometry3D: null
      },
      {
        text: "¿Cuál es la raíz cúbica de 27?",
        correct: "3",
        options: ["2", "3", "4", "9"],
        explanation: "∛27 = 3 porque 3³ = 27",
        steps: ["3 × 3 = 9", "9 × 3 = 27", "Por lo tanto ∛27 = 3"],
        hint: "¿Qué número multiplicado tres veces por sí mismo da 27?",
        geometry3D: null
      }
    ],

    // ============ GEOMETRÍA 3D (15 preguntas) ============
    'geometria': [
      {
        text: "Calcula el volumen de un cubo de lado 5 cm",
        correct: "125",
        options: ["100", "125", "150", "175"],
        explanation: "Volumen = lado³ = 5³ = 125 cm³",
        steps: ["Fórmula: V = a³", "5³ = 125"],
        hint: "Eleva el lado al cubo",
        geometry3D: { type: "cube", params: { size: 5 }, description: "Cubo de lado 5 unidades" }
      },
      {
        text: "Calcula el volumen de una esfera de radio 3 cm",
        correct: "113.1",
        options: ["113.1", "100", "125.6", "150"],
        explanation: "Volumen = (4/3)πr³ ≈ 113.1 cm³",
        steps: ["Fórmula: V = 4/3 π r³", "r³ = 27", "4/3 × 3.14 × 27 = 113.1"],
        hint: "Usa π ≈ 3.14",
        geometry3D: { type: "sphere", params: { radius: 3 }, description: "Esfera de radio 3 unidades" }
      },
      {
        text: "Calcula el volumen de un cilindro de radio 2 cm y altura 10 cm",
        correct: "125.66",
        options: ["100", "125.66", "150", "175"],
        explanation: "Volumen = πr²h = 3.14 × 4 × 10 = 125.66 cm³",
        steps: ["Fórmula: V = π r² h", "r² = 4", "3.14 × 4 × 10 = 125.66"],
        hint: "Área de la base por altura",
        geometry3D: { type: "cylinder", params: { radius: 2, height: 10 }, description: "Cilindro de radio 2 y altura 10" }
      },
      {
        text: "Calcula el volumen de una pirámide de base cuadrada de lado 4 cm y altura 9 cm",
        correct: "48",
        options: ["36", "48", "54", "72"],
        explanation: "Volumen = (1/3) × Área base × altura = (1/3) × 16 × 9 = 48 cm³",
        steps: ["Área base = 4×4 = 16", "(1/3) × 16 × 9 = 48"],
        hint: "El volumen de una pirámide es un tercio del área de la base por la altura",
        geometry3D: { type: "pyramid", params: { size: 4, height: 9 }, description: "Pirámide de base cuadrada" }
      },
      {
        text: "Calcula el área de superficie de un cubo de lado 3 cm",
        correct: "54",
        options: ["36", "48", "54", "72"],
        explanation: "Área = 6 × lado² = 6 × 9 = 54 cm²",
        steps: ["Área de una cara = 3² = 9", "6 caras × 9 = 54"],
        hint: "Un cubo tiene 6 caras cuadradas",
        geometry3D: { type: "cube", params: { size: 3 }, description: "Cubo de lado 3 unidades" }
      },
      {
        text: "Calcula el área de superficie de una esfera de radio 4 cm",
        correct: "201.06",
        options: ["150", "180", "201.06", "250"],
        explanation: "Área = 4πr² = 4 × 3.14 × 16 = 201.06 cm²",
        steps: ["Fórmula: A = 4πr²", "r² = 16", "4 × 3.14 × 16 = 201.06"],
        hint: "Un globo es una esfera",
        geometry3D: { type: "sphere", params: { radius: 4 }, description: "Esfera de radio 4" }
      },
      {
        text: "Calcula el volumen de un cono de radio 3 cm y altura 8 cm",
        correct: "75.4",
        options: ["75.4", "80", "90", "100"],
        explanation: "Volumen = (1/3)πr²h = (1/3) × 3.14 × 9 × 8 = 75.4 cm³",
        steps: ["Fórmula: V = (1/3)πr²h", "r² = 9", "(1/3) × 3.14 × 9 × 8 = 75.4"],
        hint: "El cono es un tercio de un cilindro",
        geometry3D: { type: "cone", params: { radius: 3, height: 8 }, description: "Cono de radio 3 y altura 8" }
      },
      {
        text: "¿Cuál es la diagonal espacial de un cubo de lado 4 cm?",
        correct: "6.93",
        options: ["5.66", "6.93", "8", "10"],
        explanation: "Diagonal = lado × √3 = 4 × 1.732 = 6.93 cm",
        steps: ["Fórmula: d = a√3", "4 × 1.732 = 6.93"],
        hint: "Es la distancia entre vértices opuestos",
        geometry3D: { type: "cube", params: { size: 4 }, description: "Cubo de lado 4" }
      },
      {
        text: "Calcula el volumen de un prisma rectangular de 5×3×2 cm",
        correct: "30",
        options: ["20", "25", "30", "35"],
        explanation: "Volumen = largo × ancho × alto = 5 × 3 × 2 = 30 cm³",
        steps: ["Multiplica 5 × 3 = 15", "15 × 2 = 30"],
        hint: "El volumen de un prisma es área base por altura",
        geometry3D: { type: "prism", params: { length: 5, width: 3, height: 2 }, description: "Prisma rectangular 5×3×2" }
      },
      {
        text: "Calcula el volumen de un tetraedro regular de arista 6 cm",
        correct: "25.46",
        options: ["20", "25.46", "30", "36"],
        explanation: "Volumen = a³/(6√2) ≈ 216/(6×1.414) = 25.46 cm³",
        steps: ["Fórmula: V = a³/(6√2)", "216/(8.485) = 25.46"],
        hint: "Es la pirámide de caras triangulares",
        geometry3D: { type: "tetrahedron", params: { edge: 6 }, description: "Tetraedro de arista 6" }
      },
      {
        text: "Calcula el área de superficie de un cilindro de radio 2 cm y altura 10 cm",
        correct: "150.8",
        options: ["120", "150.8", "180", "200"],
        explanation: "Área = 2πr² + 2πrh = 2πr(r+h) = 2×3.14×2×12 = 150.8 cm²",
        steps: ["Fórmula: A = 2πr(r+h)", "r+h = 12", "2×3.14×2×12 = 150.8"],
        hint: "Suma de las dos tapas más el área lateral",
        geometry3D: { type: "cylinder", params: { radius: 2, height: 10 }, description: "Cilindro radio 2 altura 10" }
      },
      {
        text: "¿Cuál es el radio de una esfera que tiene volumen 523.6 cm³?",
        correct: "5",
        options: ["4", "5", "6", "7"],
        explanation: "V = (4/3)πr³ → r³ = (3V)/(4π) = 125 → r = 5",
        steps: ["Despeja r³", "r³ = (3×523.6)/(4×3.14) = 125", "r = ∛125 = 5"],
        hint: "Usa la fórmula del volumen de la esfera",
        geometry3D: { type: "sphere", params: { radius: 5 }, description: "Esfera de radio 5" }
      },
      {
        text: "Calcula el volumen de un octaedro regular de arista 4 cm",
        correct: "30.17",
        options: ["25", "30.17", "35", "40"],
        explanation: "Volumen = (√2/3) × a³ = 0.471 × 64 = 30.17 cm³",
        steps: ["Fórmula: V = (√2/3)a³", "a³ = 64", "0.471 × 64 = 30.17"],
        hint: "El octaedro tiene 8 caras triangulares",
        geometry3D: { type: "octahedron", params: { edge: 4 }, description: "Octaedro de arista 4" }
      },
      {
        text: "Calcula el área de superficie de un cono de radio 3 cm y generatriz 10 cm",
        correct: "122.52",
        options: ["100", "122.52", "150", "180"],
        explanation: "Área = πr² + πrg = 3.14×9 + 3.14×3×10 = 28.26 + 94.2 = 122.46 cm²",
        steps: ["Área base: πr² = 28.26", "Área lateral: πrg = 94.2", "Suma total: 122.46"],
        hint: "La generatriz es la distancia desde el vértice hasta el borde",
        geometry3D: { type: "cone", params: { radius: 3, slantHeight: 10 }, description: "Cono de radio 3" }
      },
      {
        text: "¿Cuál es la relación entre el volumen de una esfera y el volumen del cilindro que la circunscribe?",
        correct: "2/3",
        options: ["1/2", "2/3", "3/4", "4/5"],
        explanation: "Volumen esfera = 4/3πr³, Volumen cilindro = 2πr³ → Relación = (4/3πr³)/(2πr³) = 2/3",
        steps: ["Esfera: V = 4/3πr³", "Cilindro circunscrito: V = πr² × 2r = 2πr³", "Relación = (4/3)/(2) = 2/3"],
        hint: "El cilindro circunscrito tiene altura 2r",
        geometry3D: { type: "sphere", params: { radius: "r" }, description: "Esfera inscrita en cilindro" }
      }
    ],

    // ============ ÁLGEBRA (15 preguntas) ============
    'algebra': [
      {
        text: "Resuelve: 2x + 5 = 15",
        correct: "5",
        options: ["3", "4", "5", "6"],
        explanation: "2x + 5 = 15 → 2x = 10 → x = 5",
        steps: ["Resta 5: 2x = 10", "Divide entre 2: x = 5"],
        hint: "Aísla la variable x",
        geometry3D: null
      },
      {
        text: "Resuelve: x² - 9 = 0",
        correct: "3",
        options: ["2", "3", "4", "5"],
        explanation: "x² = 9 → x = ±3, el positivo es 3",
        steps: ["Suma 9: x² = 9", "Saca raíz cuadrada: x = ±3"],
        hint: "Es una diferencia de cuadrados",
        geometry3D: null
      },
      {
        text: "Resuelve: 3(x - 2) = 12",
        correct: "6",
        options: ["4", "5", "6", "7"],
        explanation: "3x - 6 = 12 → 3x = 18 → x = 6",
        steps: ["Distribuye: 3x - 6 = 12", "Suma 6: 3x = 18", "Divide: x = 6"],
        hint: "Distribuye el 3 primero",
        geometry3D: null
      },
      {
        text: "Resuelve el sistema: x + y = 10, x - y = 4",
        correct: "7",
        options: ["5", "6", "7", "8"],
        explanation: "Sumando: 2x = 14 → x = 7, y = 3",
        steps: ["Suma las ecuaciones: (x+y)+(x-y)=14", "2x = 14 → x = 7"],
        hint: "La pregunta pide el valor de x",
        geometry3D: null
      },
      {
        text: "Factoriza: x² + 5x + 6",
        correct: "(x+2)(x+3)",
        options: ["(x+1)(x+6)", "(x+2)(x+3)", "(x+3)(x+2)", "(x+1)(x+5)"],
        explanation: "Buscamos dos números que sumen 5 y multipliquen 6: 2 y 3",
        steps: ["Identifica a=1, b=5, c=6", "Números que suman 5 y multiplican 6: 2 y 3", "Factor: (x+2)(x+3)"],
        hint: "Dos números que sumen 5 y multiplicados den 6",
        geometry3D: null
      },
      {
        text: "Resuelve: x² - 5x + 6 = 0",
        correct: "3",
        options: ["2", "3", "4", "5"],
        explanation: "Factoriza: (x-2)(x-3)=0 → x=2 o x=3",
        steps: ["Factoriza: (x-2)(x-3)=0", "Iguala a 0: x=2 o x=3"],
        hint: "El producto es cero cuando uno de los factores es cero",
        geometry3D: null
      },
      {
        text: "Resuelve: 2x² - 8 = 0",
        correct: "2",
        options: ["1", "2", "3", "4"],
        explanation: "2x² = 8 → x² = 4 → x = ±2",
        steps: ["Suma 8: 2x² = 8", "Divide: x² = 4", "x = ±2"],
        hint: "Primero despeja x²",
        geometry3D: null
      },
      {
        text: "Simplifica: (x² - 4)/(x - 2)",
        correct: "x+2",
        options: ["x-2", "x+2", "x+4", "x-4"],
        explanation: "x² - 4 = (x-2)(x+2) → (x-2)(x+2)/(x-2) = x+2",
        steps: ["Factoriza numerador: (x-2)(x+2)", "Cancela (x-2)", "Resultado: x+2"],
        hint: "Diferencia de cuadrados",
        geometry3D: null
      },
      {
        text: "Resuelve: 4x - 7 = 2x + 9",
        correct: "8",
        options: ["6", "7", "8", "9"],
        explanation: "4x - 2x = 9 + 7 → 2x = 16 → x = 8",
        steps: ["Lleva términos: 4x - 2x = 9 + 7", "2x = 16", "x = 8"],
        hint: "Agrupa términos semejantes",
        geometry3D: null
      },
      {
        text: "Despeja y: 3x + 2y = 10",
        correct: "5",
        options: ["4", "5", "6", "7"],
        explanation: "2y = 10 - 3x → y = (10 - 3x)/2 → cuando x=0, y=5",
        steps: ["Resta 3x: 2y = 10 - 3x", "Divide entre 2: y = (10 - 3x)/2"],
        hint: "Aísla y en un lado",
        geometry3D: null
      },
      {
        text: "Resuelve: 5^(x) = 125",
        correct: "3",
        options: ["2", "3", "4", "5"],
        explanation: "125 = 5³, por lo tanto x = 3",
        steps: ["125 = 5 × 5 × 5 = 5³", "Comparando exponentes: x = 3"],
        hint: "Escribe 125 como potencia de 5",
        geometry3D: null
      },
      {
        text: "Resuelve: log₂(8) = x",
        correct: "3",
        options: ["2", "3", "4", "5"],
        explanation: "log₂(8) significa 2 elevado a qué da 8 → 2³ = 8 → x = 3",
        steps: ["Pregunta: ¿2^? = 8", "2³ = 8", "Por lo tanto x = 3"],
        hint: "El logaritmo es el exponente",
        geometry3D: null
      },
      {
        text: "Resuelve: √(x+4) = 5",
        correct: "21",
        options: ["21", "25", "20", "22"],
        explanation: "x+4 = 25 → x = 21",
        steps: ["Eleva al cuadrado: x+4 = 25", "Resta 4: x = 21"],
        hint: "Elimina la raíz elevando al cuadrado",
        geometry3D: null
      },
      {
        text: "Resuelve: x² + 2x - 8 = 0",
        correct: "2",
        options: ["-4", "2", "-2", "4"],
        explanation: "Factoriza: (x+4)(x-2)=0 → x=2 o x=-4",
        steps: ["Factoriza: (x+4)(x-2)=0", "Soluciones: x=2, x=-4"],
        hint: "La solución positiva es 2",
        geometry3D: null
      },
      {
        text: "Resuelve: 1/x + 1/2 = 3/4",
        correct: "4",
        options: ["2", "3", "4", "5"],
        explanation: "1/x = 3/4 - 1/2 = 1/4 → x = 4",
        steps: ["Resta 1/2: 1/x = 3/4 - 2/4 = 1/4", "Invierte: x = 4"],
        hint: "Despeja primero 1/x",
        geometry3D: null
      }
    ],

    // ============ CÁLCULO (15 preguntas) ============
    'calculo': [
      {
        text: "¿Cuál es la derivada de f(x) = 3x²?",
        correct: "6x",
        options: ["3x", "6x", "3x²", "6x²"],
        explanation: "Derivada de xⁿ = n·xⁿ⁻¹ → 3×2×x¹ = 6x",
        steps: ["Multiplica coeficiente por exponente: 3×2 = 6", "Resta 1 al exponente: 2-1=1", "Resultado: 6x"],
        hint: "Usa la regla de la potencia",
        geometry3D: null
      },
      {
        text: "¿Cuál es la derivada de f(x) = x⁵?",
        correct: "5x⁴",
        options: ["4x⁴", "5x⁴", "x⁴", "5x⁵"],
        explanation: "d/dx(xⁿ) = n·xⁿ⁻¹ → 5x⁴",
        steps: ["Baja el exponente: 5", "Resta 1 al exponente: 5-1=4", "Resultado: 5x⁴"],
        hint: "Aplica regla de la potencia",
        geometry3D: null
      },
      {
        text: "¿Cuál es la derivada de f(x) = 8?",
        correct: "0",
        options: ["0", "8", "1", "8x"],
        explanation: "La derivada de una constante es 0",
        steps: ["8 es una constante", "Derivada de constante = 0"],
        hint: "Las constantes no cambian",
        geometry3D: null
      },
      {
        text: "¿Cuál es la integral ∫ 2x dx?",
        correct: "x² + C",
        options: ["2x² + C", "x² + C", "x²/2 + C", "2x + C"],
        explanation: "∫ xⁿ dx = xⁿ⁺¹/(n+1) + C → ∫ 2x dx = 2·x²/2 = x² + C",
        steps: ["Aumenta exponente: x¹ → x²", "Divide por nuevo exponente: x²/2", "Multiplica por coeficiente: 2 × x²/2 = x²", "Agrega constante C"],
        hint: "La integral es la operación inversa de la derivada",
        geometry3D: null
      },
      {
        text: "Calcula el límite: lim_{x→2} (x² - 4)/(x - 2)",
        correct: "4",
        options: ["2", "3", "4", "indefinido"],
        explanation: "Factoriza: (x-2)(x+2)/(x-2) = x+2, límite = 4",
        steps: ["Factoriza x²-4 = (x-2)(x+2)", "Cancela (x-2)", "Evalúa en x=2: 2+2=4"],
        hint: "Simplifica la expresión primero",
        geometry3D: null
      },
      {
        text: "¿Cuál es la derivada de f(x) = e^x?",
        correct: "e^x",
        options: ["e^x", "x·e^x⁻¹", "ln(x)", "1/e^x"],
        explanation: "La derivada de e^x es ella misma",
        steps: ["d/dx(e^x) = e^x"],
        hint: "e^x es su propia derivada",
        geometry3D: null
      },
      {
        text: "¿Cuál es la derivada de f(x) = ln(x)?",
        correct: "1/x",
        options: ["ln(x)", "1/x", "x", "1/x²"],
        explanation: "d/dx(ln x) = 1/x",
        steps: ["Derivada ln(x) = 1/x"],
        hint: "La derivada del logaritmo natural es la inversa",
        geometry3D: null
      },
      {
        text: "¿Cuál es la integral ∫ 1/x dx?",
        correct: "ln|x| + C",
        options: ["ln|x| + C", "1/x² + C", "x + C", "e^x + C"],
        explanation: "∫ 1/x dx = ln|x| + C",
        steps: ["La integral de 1/x es el logaritmo natural"],
        hint: "Es la integral básica del logaritmo",
        geometry3D: null
      },
      {
        text: "Deriva: f(x) = sen(x)",
        correct: "cos(x)",
        options: ["sen(x)", "cos(x)", "-sen(x)", "-cos(x)"],
        explanation: "La derivada del seno es coseno",
        steps: ["d/dx(sen x) = cos x"],
        hint: "Derivada de sen es cos",
        geometry3D: null
      },
      {
        text: "Deriva: f(x) = cos(x)",
        correct: "-sen(x)",
        options: ["sen(x)", "-sen(x)", "cos(x)", "-cos(x)"],
        explanation: "La derivada del coseno es -seno",
        steps: ["d/dx(cos x) = -sen x"],
        hint: "Derivada de cos es -sen",
        geometry3D: null
      },
      {
        text: "Calcula el límite: lim_{x→0} sen(x)/x",
        correct: "1",
        options: ["0", "1", "∞", "indefinido"],
        explanation: "Este es un límite fundamental: lim_{x→0} sen(x)/x = 1",
        steps: ["Es un límite trigonométrico fundamental", "El resultado es 1"],
        hint: "Es uno de los límites más famosos",
        geometry3D: null
      },
      {
        text: "Encuentra la derivada de f(x) = (x² + 1)³",
        correct: "6x(x²+1)²",
        options: ["3(x²+1)²", "6x(x²+1)²", "2x·3(x²+1)²", "3x(x²+1)²"],
        explanation: "Usa regla de la cadena: 3(x²+1)² × 2x = 6x(x²+1)²",
        steps: ["Derivada externa: 3(x²+1)²", "Derivada interna: 2x", "Multiplica: 6x(x²+1)²"],
        hint: "Aplica la regla de la cadena",
        geometry3D: null
      },
      {
        text: "Calcula la integral ∫ (3x² + 2x) dx",
        correct: "x³ + x² + C",
        options: ["x³ + x² + C", "3x³/3 + 2x²/2 + C", "x³ + x²", "3x³/3 + x²"],
        explanation: "∫3x² dx = x³, ∫2x dx = x² → x³ + x² + C",
        steps: ["Integra 3x²: 3·x³/3 = x³", "Integra 2x: 2·x²/2 = x²", "Suma + C"],
        hint: "Integra término por término",
        geometry3D: null
      },
      {
        text: "Deriva: f(x) = 1/x",
        correct: "-1/x²",
        options: ["1/x²", "-1/x²", "ln(x)", "-ln(x)"],
        explanation: "1/x = x⁻¹ → derivada = -1·x⁻² = -1/x²",
        steps: ["Reescribe: x⁻¹", "Derivada: -1·x⁻²", "Resultado: -1/x²"],
        hint: "Usa la regla de la potencia con exponente negativo",
        geometry3D: null
      },
      {
        text: "Calcula la derivada de f(x) = tan(x)",
        correct: "sec²(x)",
        options: ["sec²(x)", "csc²(x)", "sen²(x)", "cos²(x)"],
        explanation: "d/dx(tan x) = sec² x",
        steps: ["Derivada de tangente = secante al cuadrado"],
        hint: "1/cos² = sec²",
        geometry3D: null
      }
    ],

    // ============ MATEMÁTICA DISCRETA (15 preguntas) ============
    'matematica_discreta': [
      {
        text: "¿Cuántos subconjuntos tiene un conjunto de 3 elementos?",
        correct: "8",
        options: ["3", "6", "8", "9"],
        explanation: "Un conjunto de n elementos tiene 2ⁿ subconjuntos. Para n=3, 2³ = 8",
        steps: ["Fórmula: 2ⁿ", "Sustituye n=3: 2³", "Resultado: 8"],
        hint: "Cada elemento puede estar o no estar",
        geometry3D: null
      },
      {
        text: "¿Cuántas formas hay de ordenar 4 libros en un estante?",
        correct: "24",
        options: ["12", "16", "24", "32"],
        explanation: "Permutaciones de 4 elementos: P(4) = 4! = 24",
        steps: ["Fórmula: n! = 4×3×2×1", "Resultado: 24"],
        hint: "Es una permutación de 4 elementos",
        geometry3D: null
      },
      {
        text: "¿Cuál es el valor de verdad de p ∨ q si p = F, q = F?",
        correct: "Falso",
        options: ["Verdadero", "Falso", "Indeterminado", "No definido"],
        explanation: "La disyunción (∨) es verdadera si al menos una es verdadera. Ambas falsas → Falso",
        steps: ["p = Falso, q = Falso", "Falso OR Falso = Falso"],
        hint: "OR solo es falso cuando ambas son falsas",
        geometry3D: null
      },
      {
        text: "¿Cuántas combinaciones de 2 elementos se pueden hacer con un conjunto de 5 elementos?",
        correct: "10",
        options: ["5", "10", "15", "20"],
        explanation: "C(5,2) = 5!/(2!×3!) = 10",
        steps: ["Fórmula: C(n,k) = n!/(k!(n-k)!)", "C(5,2) = (5×4)/(2×1) = 20/2 = 10"],
        hint: "El orden no importa",
        geometry3D: null
      },
      {
        text: "Si P(A) = 0.3, P(B) = 0.4, y son independientes, ¿P(A∩B)?",
        correct: "0.12",
        options: ["0", "0.12", "0.7", "0.5"],
        explanation: "Para eventos independientes: P(A∩B) = P(A) × P(B) = 0.3 × 0.4 = 0.12",
        steps: ["Multiplica probabilidades: 0.3 × 0.4 = 0.12"],
        hint: "Independientes significa que se multiplican",
        geometry3D: null
      },
      {
        text: "¿Cuántas diagonales tiene un pentágono?",
        correct: "5",
        options: ["3", "4", "5", "6"],
        explanation: "Diagonales = n(n-3)/2 = 5(2)/2 = 5",
        steps: ["Fórmula: n(n-3)/2", "5×2/2 = 5"],
        hint: "Un pentágono tiene 5 lados",
        geometry3D: null
      },
      {
        text: "¿Cuál es el valor de verdad de p → q si p = V, q = F?",
        correct: "Falso",
        options: ["Verdadero", "Falso", "Indeterminado", "No definido"],
        explanation: "La implicación p→q es falsa solo cuando p es verdadero y q es falso",
        steps: ["p = Verdadero, q = Falso", "Verdadero → Falso = Falso"],
        hint: "La implicación solo es falsa cuando el antecedente es verdadero y el consecuente falso",
        geometry3D: null
      },
      {
        text: "¿Cuántos números de 3 cifras se pueden formar con los dígitos 1,2,3,4 sin repetir?",
        correct: "24",
        options: ["12", "24", "36", "48"],
        explanation: "Permutaciones de 4 elementos tomados de 3: P(4,3) = 4×3×2 = 24",
        steps: ["Primera cifra: 4 opciones", "Segunda: 3 opciones", "Tercera: 2 opciones", "Total: 4×3×2 = 24"],
        hint: "Importa el orden y no hay repetición",
        geometry3D: null
      },
      {
        text: "¿Cuál es el valor de 4! ?",
        correct: "24",
        options: ["12", "20", "24", "28"],
        explanation: "4! = 4 × 3 × 2 × 1 = 24",
        steps: ["Multiplica: 4×3=12", "12×2=24", "24×1=24"],
        hint: "Factorial de 4",
        geometry3D: null
      },
      {
        text: "¿Cuál es la probabilidad de obtener un 6 al lanzar un dado?",
        correct: "1/6",
        options: ["1/2", "1/3", "1/6", "1/4"],
        explanation: "Hay 1 resultado favorable de 6 posibles",
        steps: ["Casos favorables: 1", "Casos posibles: 6", "Probabilidad = 1/6"],
        hint: "Un dado tiene 6 caras",
        geometry3D: null
      },
      {
        text: "¿Cuántos elementos tiene el conjunto potencia de un conjunto con 4 elementos?",
        correct: "16",
        options: ["8", "16", "32", "64"],
        explanation: "El conjunto potencia tiene 2ⁿ elementos, con n=4 → 16",
        steps: ["Fórmula: 2ⁿ", "2⁴ = 16"],
        hint: "Cada subconjunto se forma eligiendo incluir o no cada elemento",
        geometry3D: null
      },
      {
        text: "¿Cuántas aristas tiene un grafo completo con 5 vértices?",
        correct: "10",
        options: ["5", "8", "10", "12"],
        explanation: "K₅ tiene n(n-1)/2 = 5×4/2 = 10 aristas",
        steps: ["Fórmula: n(n-1)/2", "5×4=20", "20/2=10"],
        hint: "Cada vértice se conecta con los otros",
        geometry3D: null
      },
      {
        text: "¿Cuántas formas de elegir 2 cartas de una baraja de 52?",
        correct: "1326",
        options: ["1326", "2652", "52", "104"],
        explanation: "C(52,2) = 52×51/2 = 1326",
        steps: ["Fórmula: C(52,2) = (52×51)/(2×1)", "2652/2 = 1326"],
        hint: "Combinación de 52 en 2",
        geometry3D: null
      },
      {
        text: "¿Cuántos anagramas tiene la palabra 'AMOR'?",
        correct: "24",
        options: ["12", "24", "48", "96"],
        explanation: "4 letras distintas → 4! = 24 anagramas",
        steps: ["4! = 4×3×2×1 = 24"],
        hint: "Son permutaciones de 4 elementos",
        geometry3D: null
      },
      {
        text: "¿Cuál es el valor de verdad de ¬(Verdadero)?",
        correct: "Falso",
        options: ["Verdadero", "Falso", "Indeterminado", "No definido"],
        explanation: "La negación invierte el valor de verdad",
        steps: ["¬(Verdadero) = Falso"],
        hint: "La negación cambia Verdadero a Falso",
        geometry3D: null
      }
    ],

    // ============ RAZONAMIENTO CUANTITATIVO (15 preguntas) ============
    'razonamiento_cuantitativo': [
      {
        text: "Si 3 camisas cuestan $60, ¿cuánto cuestan 5 camisas?",
        correct: "100",
        options: ["80", "90", "100", "120"],
        explanation: "Cada camisa cuesta $20, 5 camisas = $100",
        steps: ["Precio unitario: 60÷3=20", "5 camisas: 20×5=100"],
        hint: "Calcula primero el precio unitario",
        geometry3D: null
      },
      {
        text: "Un tren viaja a 60 km/h. ¿Cuánto tarda en recorrer 180 km?",
        correct: "3",
        options: ["2", "3", "4", "5"],
        explanation: "Tiempo = distancia/velocidad = 180/60 = 3 horas",
        steps: ["Fórmula: t = d/v", "180 ÷ 60 = 3"],
        hint: "Usa la fórmula de velocidad",
        geometry3D: null
      },
      {
        text: "El 25% de qué número es 50?",
        correct: "200",
        options: ["150", "175", "200", "225"],
        explanation: "0.25 × N = 50 → N = 50/0.25 = 200",
        steps: ["Divide 50 entre 0.25", "50 ÷ 0.25 = 200"],
        hint: "Multiplica 50 por 4",
        geometry3D: null
      },
      {
        text: "Si a = 3 y b = 4, ¿cuánto es a² + b²?",
        correct: "25",
        options: ["7", "25", "12", "16"],
        explanation: "3² + 4² = 9 + 16 = 25",
        steps: ["3² = 9", "4² = 16", "9 + 16 = 25"],
        hint: "Es el teorema de Pitágoras",
        geometry3D: null
      },
      {
        text: "Un rectángulo tiene área 24 m² y ancho 4 m. ¿Cuánto mide el largo?",
        correct: "6",
        options: ["4", "5", "6", "7"],
        explanation: "Largo = área/ancho = 24/4 = 6 m",
        steps: ["Fórmula: Área = largo × ancho", "largo = 24 ÷ 4 = 6"],
        hint: "Despeja el largo de la fórmula del área",
        geometry3D: null
      },
      {
        text: "Si 5 trabajadores hacen una obra en 6 días, ¿cuánto tardan 3 trabajadores?",
        correct: "10",
        options: ["8", "10", "12", "15"],
        explanation: "Proporción inversa: 5×6 = 3×t → t = 30/3 = 10 días",
        steps: ["5×6 = 30 días-persona", "30 ÷ 3 = 10 días"],
        hint: "Es una relación inversa",
        geometry3D: null
      },
      {
        text: "¿Cuál es el siguiente número: 2, 4, 8, 16, ?",
        correct: "32",
        options: ["24", "32", "36", "48"],
        explanation: "Cada número se multiplica por 2: 16 × 2 = 32",
        steps: ["Patrón: ×2", "16 × 2 = 32"],
        hint: "Es una progresión geométrica",
        geometry3D: null
      },
      {
        text: "¿Cuál es el promedio de 5, 10, 15, 20?",
        correct: "12.5",
        options: ["10", "12.5", "15", "17.5"],
        explanation: "Suma = 50, cantidad = 4, promedio = 50/4 = 12.5",
        steps: ["Suma: 5+10+15+20=50", "Divide entre 4: 50÷4=12.5"],
        hint: "Suma todos y divide entre cuántos son",
        geometry3D: null
      },
      {
        text: "Si el 40% de un número es 80, ¿cuál es el número?",
        correct: "200",
        options: ["160", "180", "200", "220"],
        explanation: "0.4 × N = 80 → N = 80/0.4 = 200",
        steps: ["80 ÷ 0.4 = 800 ÷ 4 = 200"],
        hint: "Divide 80 entre 0.4",
        geometry3D: null
      },
      {
        text: "En una fiesta hay 4 hombres y 6 mujeres. ¿Qué porcentaje son hombres?",
        correct: "40%",
        options: ["30%", "35%", "40%", "45%"],
        explanation: "Total = 10, hombres = 4, porcentaje = (4/10)×100 = 40%",
        steps: ["4/10 = 0.4", "0.4 × 100 = 40%"],
        hint: "Divide los hombres entre el total",
        geometry3D: null
      },
      {
        text: "¿Cuántos minutos hay en 2.5 horas?",
        correct: "150",
        options: ["120", "150", "180", "210"],
        explanation: "2.5 × 60 = 150 minutos",
        steps: ["Cada hora tiene 60 minutos", "2.5 × 60 = 150"],
        hint: "Multiplica las horas por 60",
        geometry3D: null
      },
      {
        text: "Si x + 5 = 12, ¿cuánto es x - 3?",
        correct: "4",
        options: ["2", "4", "6", "8"],
        explanation: "x = 7, entonces x - 3 = 4",
        steps: ["x = 12 - 5 = 7", "7 - 3 = 4"],
        hint: "Primero encuentra x",
        geometry3D: null
      },
      {
        text: "Un conductor carga 40 pasajeros por viaje. ¿Cuántos viajes para 200 pasajeros?",
        correct: "5",
        options: ["4", "5", "6", "7"],
        explanation: "200 ÷ 40 = 5 viajes",
        steps: ["Divide 200 entre 40", "Resultado: 5"],
        hint: "Reparto equitativo",
        geometry3D: null
      },
      {
        text: "La razón ancho:alto de un cuadro es 3:4. Si el ancho es 60 cm, ¿cuánto mide el alto?",
        correct: "80",
        options: ["60", "70", "80", "100"],
        explanation: "3/4 = 60/a → a = (60×4)/3 = 240/3 = 80",
        steps: ["Proporción: 3/4 = 60/a", "a = (60×4)/3 = 240/3 = 80"],
        hint: "Usa una regla de tres directa",
        geometry3D: null
      },
      {
        text: "Si compras algo con 15% de descuento y pagas $85, ¿cuál era el precio original?",
        correct: "100",
        options: ["85", "95", "100", "115"],
        explanation: "Pagaste el 85% del original: 0.85P = 85 → P = 100",
        steps: ["0.85P = 85", "P = 85/0.85 = 100"],
        hint: "El descuento del 15% significa que pagas el 85%",
        geometry3D: null
      }
    ]
  };

  // Seleccionar la categoría correspondiente, si no existe usar matemática_basica
  const categoryQuestions = fallbacks[category] || fallbacks['matematica_basica'];
  
  // Seleccionar pregunta aleatoria basada en el nivel para variar
  const index = (level - 1) % categoryQuestions.length;
  const selectedQuestion = categoryQuestions[index];
  
  // Ajustar puntos según nivel
  const adjustedPoints = 10 * Math.min(level, 5);
  
  return {
    id: Date.now(),
    text: selectedQuestion.text,
    options: selectedQuestion.options,
    correct: selectedQuestion.correct,
    points: adjustedPoints,
    timeLimit: 45,
    explanation: selectedQuestion.explanation,
    steps: selectedQuestion.steps,
    hint: selectedQuestion.hint,
    geometry3D: selectedQuestion.geometry3D,
    category: category || 'general'
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
        gamesPlayed: 0,
        redeemedRewards: []
      };
      users.set(demoUser.id, demoUser);
      
      const testUser = {
        id: uuidv4(),
        username: 'test',
        password: 'test123',
        score: 0,
        level: 1,
        gamesPlayed: 0,
        redeemedRewards: []
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
  users.set(userId, { id: userId, username, password, score: 0, level: 1, gamesPlayed: 0, redeemedRewards: [] });
  saveUsers();
  res.json({ id: userId, username });
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  const user = Array.from(users.values()).find(u => u.username === username);
  if (!user || user.password !== password) return res.status(401).json({ error: 'Credenciales inválidas' });
  
  const token = uuidv4();
  activeSessions.set(token, { userId: user.id, username: user.username });
  res.json({ token, user: { 
    id: user.id, 
    username: user.username, 
    score: user.score, 
    level: user.level, 
    gamesPlayed: user.gamesPlayed,
    redeemedRewards: user.redeemedRewards || []
  } });
});

app.get('/api/leaderboard', (req, res) => {
  const leaderboard = Array.from(users.values()).sort((a, b) => b.score - a.score).slice(0, 10);
  res.json(leaderboard);
});

app.get('/api/categories', (req, res) => {
  res.json(['matematica_basica', 'algebra', 'geometria', 'calculo', 'matematica_discreta', 'razonamiento_cuantitativo']);
});

// ============ API DE PREMIOS ============
app.get('/api/rewards', (req, res) => {
  res.json(rewardsCatalog);
});

app.post('/api/redeem', (req, res) => {
  const { userId, rewardId } = req.body;
  const user = users.get(userId);
  const reward = rewardsCatalog.find(r => r.id === rewardId);
  
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  if (!reward) return res.status(404).json({ error: 'Premio no encontrado' });
  if (user.score < reward.pointsRequired) return res.status(400).json({ error: 'Puntos insuficientes' });
  if (user.redeemedRewards?.some(r => r.rewardId === rewardId)) return res.status(400).json({ error: 'Premio ya canjeado' });
  
  const redeemCode = `${reward.code}_${userId.slice(0,4)}_${Date.now()}`;
  
  user.score -= reward.pointsRequired;
  if (!user.redeemedRewards) user.redeemedRewards = [];
  user.redeemedRewards.push({ 
    rewardId: reward.id, 
    rewardName: reward.name, 
    date: new Date().toISOString(),
    code: redeemCode
  });
  
  saveUsers();
  
  const leaderboard = Array.from(users.values()).sort((a, b) => b.score - a.score).slice(0, 10);
  io.emit('leaderboard_update', leaderboard);
  
  res.json({ 
    success: true, 
    message: `¡Premio canjeado! Revisa tu código: ${redeemCode}`,
    code: redeemCode,
    newScore: user.score
  });
});

app.get('/api/user/rewards/:userId', (req, res) => {
  const user = users.get(req.params.userId);
  if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
  res.json({ redeemedRewards: user.redeemedRewards || [] });
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
  
  socket.on('player_ready', ({ roomId, ready }) => {
    const readyMap = readyStates.get(roomId);
    if (readyMap) {
      readyMap.set(socket.userId, ready);
      sendRoomState(roomId);
    }
  });
  
  socket.on('request_voice_assistance', async ({ roomId, question, userAnswer, isCorrect }) => {
    const room = rooms.get(roomId);
    if (!room) return;
    const questionObj = room.currentQuestion;
    const explanation = questionObj?.explanation || '';
    const voiceResponse = await getVoiceAssistance(question, userAnswer, isCorrect, explanation);
    socket.emit('voice_assistance', { message: voiceResponse });
  });
  
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
    
    room.players.forEach(p => { p.answers = []; });
    
    io.to(roomId).emit('game_started', { totalQuestions: room.maxQuestions });
    await generateAndSendQuestion(roomId);
  });
  
  async function generateAndSendQuestion(roomId) {
    const room = rooms.get(roomId);
    if (!room || room.gameState !== 'playing') return;
    
    if (room.currentQuestionNumber >= room.maxQuestions) {
      endGame(roomId);
      return;
    }
    
    const newQuestion = await generateSingleQuestion(room.level, room.category, room.askedQuestions);
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
      
      const updatedUser = users.get(socket.userId);
      const availableRewards = rewardsCatalog.filter(r => r.pointsRequired <= updatedUser.score && !updatedUser.redeemedRewards?.some(rr => rr.rewardId === r.id));
      if (availableRewards.length > 0) {
        socket.emit('new_reward_available', { rewards: availableRewards, userScore: updatedUser.score });
      }
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
      winner: { username: winner.username, score: room.scores[winner.id] || 0 }
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
  console.log(`🎁 PREMIOS: 🍕 Comida(1000) | 🎵 Spotify(1500) | 📺 Netflix(2000)`);
  console.log(`📐 NOTACIÓN MATEMÁTICA: √, ², ³, fracciones, etc.`);
  console.log(`🎨 SOPORTE 3D para geometría`);
  console.log(`🎤 ASISTENTE DE VOZ con IA`);
  console.log(`${'='.repeat(55)}\n`);
});