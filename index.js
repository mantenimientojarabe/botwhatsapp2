const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const moment = require('moment-timezone');
const path = require('path');
const fs = require('fs');

const TIMEZONE = 'America/El_Salvador';

// Ruta de la sesión en el Volume de Railway (/data/whatsapp-session)
const SESSION_PATH = process.env.SESSION_PATH || path.join(__dirname, 'whatsapp-session');

// Carpeta donde se guardan las fotos de "Resultado de planta".
// Por defecto queda al lado de la sesión (ej: /data/resultados-planta) para que también viva en el Volume
// y no se borre en cada deploy. Dentro hay una carpeta por mes: 2026-10, 2026-11, etc.
const RESULTADOS_PATH = process.env.RESULTADOS_PATH || path.join(path.dirname(SESSION_PATH), 'resultados-planta');
// Carpeta de las imágenes de "Cumpleañeros". Una carpeta por mes, sin año: 01, 02 ... 12
const CUMPLEANEROS_PATH = process.env.CUMPLEANEROS_PATH || path.join(path.dirname(SESSION_PATH), 'cumpleaneros');

// Contraseña de "Subir archivos" (se puede cambiar con la variable CLAVE_ARCHIVOS en Railway)
const CLAVE_ARCHIVOS = process.env.CLAVE_ARCHIVOS || '2003';
const MAX_INTENTOS_CLAVE = 3;
// Si el usuario se queda callado este tiempo dentro de "Subir archivos", se le cierra el acceso
const EXPIRACION_ARCHIVOS_MS = 10 * 60 * 1000;
// Espera después de la última foto antes de preguntar "¿es la última?" (por si manda varias juntas)
const ESPERA_CONFIRMACION_MS = 4000;

// Sesión (estado) en memoria por usuario
const sesiones = new Map();
// Cola por usuario: los mensajes de una misma persona se procesan uno por uno y en orden
// (antes se descartaban, pero al subir varias fotos juntas se perderían)
const colas = new Map();
// IDs ya procesados, para no responder dos veces al mismo evento
const mensajesProcesados = new Set();

// Limpiar locks de Chromium antes de inicializar
function limpiarLocks(dir) {
    if (!fs.existsSync(dir)) return;
    try {
        const archivos = fs.readdirSync(dir);
        for (const f of archivos) {
            const p = path.join(dir, f);
            if (fs.statSync(p).isDirectory()) {
                limpiarLocks(p);
            } else if (['SingletonLock', 'SingletonCookie', 'SingletonSocket'].includes(f)) {
                fs.rmSync(p, { force: true });
            }
        }
    } catch (err) {
        console.warn('⚠️ Advertencia al limpiar locks:', err.message);
    }
}
limpiarLocks(SESSION_PATH);

for (const carpeta of [RESULTADOS_PATH, CUMPLEANEROS_PATH]) {
    try {
        fs.mkdirSync(carpeta, { recursive: true });
    } catch (err) {
        console.warn(`⚠️ No se pudo crear la carpeta ${carpeta}:`, err.message);
    }
}

// Configuración del cliente
const client = new Client({
    authStrategy: new LocalAuth({
        clientId: 'nixapa-bot',
        dataPath: SESSION_PATH
    }),
    puppeteer: {
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-gpu',
            '--no-first-run',
            '--no-zygote',
            '--single-process'
        ]
    }
});

function obtenerSaludo() {
    const hora = moment().tz(TIMEZONE).hour();
    if (hora >= 6 && hora < 12) return 'Buenos días';
    if (hora >= 12 && hora < 18) return 'Buenas tardes';
    return 'Buenas noches';
}

const CRITERIOS = {
    1: `🏅 *EMBAJADOR DE CALIDAD*

*¿Qué es?*
Es una persona que pone la calidad en cada decisión y acción, entendiendo que su trabajo impacta en el producto, en el negocio y en todos los que forman parte del proceso.

*Criterios:*

*Criterio 1:*
• Realizó una acción relacionada con la Calidad.

*Criterio 2:*
1. Esta acción cuidó la imagen de la compañía.
2. Es una idea o mejora innovadora.
3. Lideró una acción o iniciativa hacia la calidad.

*Criterio 3:*
1. ¿Cerró hallazgos de PRP en su área?
2. La nota de PRP para su área es mayor a 95%.
3. Realiza sus pruebas con la frecuencia y metodología correcta.
4. ¿El técnico se encuentra validado? (Sensory)
5. Nota de Auditoría de 5S arriba de 85%.
6. Impactó directamente a un KPI de Calidad.

*⚠️ Penalización:*
• Ha sido reportado por incumplimiento de alguna regla de oro o incumplimiento a las BPM en Guardian Q.`,

    2: `🦺 *EMBAJADOR DE SEGURIDAD*

*¿Qué es?*
Hace de la seguridad una prioridad en cada actividad, identifica los riesgos, toma acción y promueve una cultura donde la seguridad es un valor en la compañía.

*Criterios:*
• ¿Cumple reporte de actos inseguros en el mes?
• ¿Cumple reporte de condiciones inseguras en el mes?
• ¿Cumple el llenado de checklist de Seguridad Territorial?
• ¿Técnico cumple con el llenado de sus PIs de seguridad?
• ¿Técnico maneja y tiene conocimiento de su tablero de Seguridad Territorial? (Peligros dinámicos)
• Nota de Auditoría de 5S arriba de 85%.
• Reporte de accidentes o incidentes en el área.

*✅ Bonos:*
• Cierre de condiciones de seguridad.
• Efectividad de Monitoreo de IAL.

*⚠️ Penalización:*
• No tenga reportes de actos inseguros.
• Abordajes positivos sin identificar quién comete la acción insegura.`,

    3: `🌱 *EMBAJADOR DE MEDIO AMBIENTE*

*¿Qué es?*
Es quien entiende que cada acción cuenta y busca que la operación sea más eficiente, responsable y amigable con el medio ambiente.

*Criterios:*
• ¿Cumple la cantidad de reporte de riesgos ambientales en el mes?
• ¿Técnico realiza seguimiento y cierre de riesgos ambientales?
• ¿Es dueño, champion de área o equipo con PIs definidos de E&F?
• ¿Técnico cumple con la capacitación de modulación 100%? (NO NEGOCIABLE)
• Implementación de modulación en una línea o área contando con Lay Out.
• Definir y conocer el T-minute del área / por paro.
• ¿Cumple la efectividad de monitoreo IAL?
• Los resultados de PI de E&F del mes cumplen meta o están mejor que la meta.

*✅ Bonos:*
• ¿Técnico implementó proyecto con impacto positivo en mejora a indicadores de E&F?
• Crear SOPs incluyendo T-minutes.

*⚠️ Penalización:*
• No tenga comportamientos ambientales inseguros a su nombre.`,

    4: `🚜 *EMBAJADOR DE MONTACARGUISTA*

*¿Qué es?*
Es quien demuestra con su forma de trabajar que la seguridad, el cuidado del equipo y la responsabilidad van siempre primero.

*Champions de Montacarguista:*

*DB FMS*
• Productividad total
• Cantidad de pallets
• Tiempo de utilización

*SMARTLIFT*
• Impacto
• Frenada
• Velocidad
• Aceleración

*✅ Bono:*
• Ralentí

*⚠️ Penalización (reportes AI & CI):*
• Reportado por AI`,

    5: `💡 *IDEAS FANTÁSTICAS*

*¿Qué es?*
Es quien se atreve a pensar diferente, propone soluciones que generan valor y convierte sus ideas en mejoras que pueden hacer la diferencia.

*Criterios:*
• Cumple con todos los estándares de Seguridad, Calidad y Medio Ambiente.
• Es nueva e innovadora.
• Es aplicable en múltiples áreas.
• Ha sido implementada y ha dado resultados.`,

    6: `🎖️ *MENCIONES HONORÍFICAS*

*¿Qué es?*
Reconoce a quien da la milla extra, toma iniciativa y logra que su esfuerzo genere un impacto positivo para todos.`,

    7: `⭐ *EMBAJADOR DE PRINCIPIOS*

*¿Qué es?*
Es quien convierte los valores de la compañía en acciones y se convierte en un ejemplo positivo para quienes lo rodean.`,

    8: `📊 *DASHBOARD DE LIDERAZGO*

*¿Qué es?*
Este reconocimiento destaca a quienes, desde su rol, demuestran un liderazgo activo y constante, impulsando la seguridad, la calidad, el cumplimiento y el trabajo en equipo.

*Criterios:*
• Reportes Guardian (100%)
• % de cierre de plan de guardas (90%)
• Cierre de condiciones inseguras / avisos de seguridad (95%)
• Efectividad de MCRs (75%)
• % de cierre de ocurrencias SPLAN (90%)
• Efectividad de escapadas (100%)
• Efectividad de monitoreo (95%)
• Cumplimiento del PAE (95%)
• Cumplimiento del PAE Safety (95%)
• Reporte de Guardian Q (1 x mes)`
};

function textoMenuPrincipal() {
    return (
        `*${obtenerSaludo()}*, soy *Noti Bot* 🤖\n` +
        `¿En qué te puedo ayudar?\n\n` +
        `1️⃣ - Catálogo de reconocimientos\n` +
        `2️⃣ - APP de Equipos Autónomos\n` +
        `3️⃣ - Número de Stellar\n` +
        `4️⃣ - Número de People Hub\n` +
        `5️⃣ - Resultado de planta\n` +
        `6️⃣ - Cumpleañeros\n` +
        `7️⃣ - Subir archivos\n\n` +
        `_Envía el número de la opción deseada._`
    );
}

function textoMenuCriterios() {
    return (
        `🏆 *Catálogo de reconocimiento*\n\n` +
        `¿Qué criterios de embajador quieres revisar el día de hoy?\n\n` +
        `1️⃣ - Embajador de Calidad\n` +
        `2️⃣ - Embajador de Seguridad\n` +
        `3️⃣ - Embajador de Medio Ambiente\n` +
        `4️⃣ - Embajador de Montacarguista\n` +
        `5️⃣ - Ideas Fantásticas\n` +
        `6️⃣ - Menciones Honoríficas\n` +
        `7️⃣ - Embajador de Principios\n` +
        `8️⃣ - Dashboard de Liderazgo\n\n` +
        `_Envía un número (1-8) o envía *0* para volver al menú principal._`
    );
}

// Lista de respuestas sutiles y amables
const RESPUESTAS_DESPEDIDA = [
    '¡Con gusto! 😊 Que tengas un excelente día. Si necesitas algo más, aquí estaré.',
    '¡De nada! 🙌 Un placer ayudarte. Escríbeme cuando quieras.',
    '¡Para servirte! ✨ Que todo salga muy bien en tu turno.',
    '¡A la orden! 👍 Saludos y que pases un gran día.'
];

function obtenerDespedida() {
    return RESPUESTAS_DESPEDIDA[Math.floor(Math.random() * RESPUESTAS_DESPEDIDA.length)];
}

// ═════════════════════════════════════════════
// Textos de las opciones del menú principal
// ═════════════════════════════════════════════
const PIE_MENU = `_Envía otro número del menú (1-7) o escribe *hola* para verlo de nuevo._`;

const TEXTO_APP_EQUIPOS =
    `📱 *APP de Equipos Autónomos*\n\n` +
    `Entra al siguiente link:\n` +
    `https://fasedeequipos.web.app/\n\n` +
    PIE_MENU;

const TEXTO_STELLAR =
    `📲 *Número de Stellar*\n\n` +
    `Tus recibos, constancias y más a un Whats de distancia.\n\n` +
    `📞 +1 (915) 666-7395\n` +
    `👉 Escríbeles aquí: https://wa.me/19156667395\n\n` +
    `*Puedes solicitar:*\n` +
    `• Constancia laboral con sueldo fijo\n` +
    `• Constancia laboral sin sueldo\n` +
    `• Recibos de nómina\n` +
    `• Y más...\n\n` +
    PIE_MENU;

const TEXTO_PEOPLE_HUB =
    `☎️ *Número de People Hub*\n\n` +
    `Si deseas hablar con un asistente de People, por favor llamar al siguiente número:\n\n` +
    `📞 (503) 2231-5454\n\n` +
    PIE_MENU;

const TEXTO_PEDIR_CLAVE =
    `🔒 *Subir archivos*\n\n` +
    `Esta opción está protegida.\n` +
    `Ingresa la *contraseña*:\n\n` +
    `_Envía *0* para volver al menú principal._`;

const TEXTO_AVISO_CUMPLE =
    `En caso tu fecha se encuentre equivocada, favor de enviarnos tu fecha correcta. ` +
    `Agradecemos tu comprensión. 🙏`;

// ═════════════════════════════════════════════
// Utilidades de texto y de meses
// ═════════════════════════════════════════════
const MESES = [
    'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
    'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'
];

function quitarAcentos(t) {
    return t.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

// Minúsculas, sin acentos, sin signos ni emojis
function normalizar(t) {
    return quitarAcentos(String(t || '').toLowerCase())
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function plural(n, singular, pluralTxt) {
    return `${n} ${n === 1 ? singular : pluralTxt}`;
}

function rango(total) {
    return total === 1 ? '1' : `1-${total}`;
}

function indiceMes(palabra) {
    if (palabra.length < 3) return -1;
    if (palabra.startsWith('set')) return 8; // "setiembre"
    return MESES.findIndex(m => m.startsWith(palabra));
}

function nombreMes(numero) {
    const nombre = MESES[numero - 1];
    return `${nombre.charAt(0).toUpperCase()}${nombre.slice(1)}`;
}

function etiquetaMesAnio(clave) {
    const [anio, mes] = clave.split('-').map(Number);
    return `${nombreMes(mes)} ${anio}`;
}

function claveSoloMes(mes) {
    return String(mes).padStart(2, '0');
}

// Acepta: "octubre 2026", "Octubre del 2026", "oct 2026", "10/2026", "10-2026", "10 26", "2026-10"
// Devuelve { clave: '2026-10', etiqueta: 'Octubre 2026' } o null si no se entiende
function parsearMesAnio(entrada) {
    const partes = normalizar(entrada).split(' ').filter(p => p && p !== 'de' && p !== 'del');
    if (partes.length !== 2) return null;

    let [a, b] = partes;
    if (/^\d{4}$/.test(a)) [a, b] = [b, a]; // el año vino primero

    const mes = /^\d{1,2}$/.test(a) ? parseInt(a, 10) : indiceMes(a) + 1;
    if (!/^(\d{2}|\d{4})$/.test(b)) return null;
    let anio = parseInt(b, 10);
    if (anio < 100) anio += 2000;

    if (!(mes >= 1 && mes <= 12) || anio < 2000 || anio > 2100) return null;

    const clave = `${anio}-${String(mes).padStart(2, '0')}`;
    return { clave, etiqueta: etiquetaMesAnio(clave) };
}

// Solo mes (para Cumpleañeros): "noviembre", "nov", "11", "mes 11". Si ponen año, se ignora.
// Devuelve { clave: '11', etiqueta: 'Noviembre' } o null
function parsearSoloMes(entrada) {
    let mes;
    const conAnio = parsearMesAnio(entrada);
    if (conAnio) {
        mes = Number(conAnio.clave.slice(5));
    } else {
        const partes = normalizar(entrada).split(' ').filter(p => p && !['de', 'del', 'mes'].includes(p));
        if (partes.length !== 1) return null;
        const p = partes[0];
        mes = /^\d{1,2}$/.test(p) ? parseInt(p, 10) : indiceMes(p) + 1;
    }
    if (!(mes >= 1 && mes <= 12)) return null;
    return { clave: claveSoloMes(mes), etiqueta: nombreMes(mes) };
}

// Detecta si alguien mandó una fecha (ej: "15 de noviembre", "15/11") para corregir su cumpleaños
function pareceFecha(texto) {
    const crudo = quitarAcentos(String(texto || '').toLowerCase());
    if (/\b\d{1,2}\s*[\/\-.]\s*\d{1,2}\b/.test(crudo)) return true;
    const palabras = normalizar(texto).split(' ');
    const tieneMes = palabras.some(p => /^[a-z]{3,}$/.test(p) && indiceMes(p) !== -1);
    const tieneDia = palabras.some(p => /^\d{1,2}$/.test(p));
    return tieneMes && tieneDia;
}

// ═════════════════════════════════════════════
// Categorías de imágenes
// ═════════════════════════════════════════════
const CATEGORIAS = {
    resultados: {
        nombre: 'Resultado de planta',
        emoji: '📊',
        ruta: RESULTADOS_PATH,
        regexCarpeta: /^\d{4}-\d{2}$/,
        masRecientePrimero: true,
        queMes: '*mes y año*',
        ejemplo: 'Ejemplo: *octubre 2026* o *10/2026*',
        parsear: parsearMesAnio,
        etiqueta: etiquetaMesAnio,
        titulo: etiqueta => `Resultados de ${etiqueta}`
    },
    cumpleaneros: {
        nombre: 'Cumpleañeros',
        emoji: '🎂',
        ruta: CUMPLEANEROS_PATH,
        regexCarpeta: /^(0[1-9]|1[0-2])$/,
        masRecientePrimero: false,
        queMes: '*mes*',
        ejemplo: 'Ejemplo: *noviembre* o *11*',
        parsear: parsearSoloMes,
        etiqueta: clave => nombreMes(Number(clave)),
        titulo: etiqueta => `Cumpleañeros de ${etiqueta}`
    }
};

// ═════════════════════════════════════════════
// Utilidades de archivos (fotos por mes)
// ═════════════════════════════════════════════
const MIMES_PERMITIDOS = { 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png' };
const REGEX_IMAGEN = /^img-(\d+)\.(jpg|jpeg|png)$/i;

function carpetaMes(cat, clave) {
    return path.join(cat.ruta, clave);
}

function numeroDeArchivo(archivo) {
    const m = path.basename(archivo).match(REGEX_IMAGEN);
    return m ? parseInt(m[1], 10) : 0;
}

// Lista las fotos de un mes, ordenadas como se subieron
function listarImagenes(cat, clave) {
    const dir = carpetaMes(cat, clave);
    if (!fs.existsSync(dir)) return [];
    return fs.readdirSync(dir)
        .filter(f => REGEX_IMAGEN.test(f))
        .sort((x, y) => numeroDeArchivo(x) - numeroDeArchivo(y))
        .map(f => path.join(dir, f));
}

function siguienteNumero(cat, clave) {
    const imgs = listarImagenes(cat, clave);
    return imgs.length ? numeroDeArchivo(imgs[imgs.length - 1]) + 1 : 1;
}

async function guardarImagen(cat, clave, foto, numero) {
    const dir = carpetaMes(cat, clave);
    await fs.promises.mkdir(dir, { recursive: true });
    const destino = path.join(dir, `img-${String(numero).padStart(3, '0')}.${MIMES_PERMITIDOS[foto.mimetype]}`);
    await fs.promises.writeFile(destino, Buffer.from(foto.data, 'base64'));
    return destino;
}

async function borrarCarpetaMes(cat, clave) {
    await fs.promises.rm(carpetaMes(cat, clave), { recursive: true, force: true });
}

function mesesDisponibles(cat) {
    if (!fs.existsSync(cat.ruta)) return [];
    const meses = fs.readdirSync(cat.ruta)
        .filter(d => cat.regexCarpeta.test(d) && listarImagenes(cat, d).length > 0)
        .sort();
    return cat.masRecientePrimero ? meses.reverse() : meses;
}

function textoMesesDisponibles(cat) {
    const meses = mesesDisponibles(cat);
    if (!meses.length) return `_Aún no hay imágenes guardadas._`;
    return `*Meses disponibles:*\n` + meses.slice(0, 12).map(m => `• ${cat.etiqueta(m)}`).join('\n');
}

function mimeDeMensaje(message) {
    return (((message._data && message._data.mimetype) || '').split(';')[0]).toLowerCase();
}

// Solo fotos: imagen normal o imagen enviada como documento (JPG/PNG)
function esFoto(message) {
    if (message.type === 'image') return true;
    return message.type === 'document' && Boolean(MIMES_PERMITIDOS[mimeDeMensaje(message)]);
}

async function descargarFoto(message) {
    try {
        const media = await message.downloadMedia();
        if (!media || !media.data) return null;
        const mimetype = (media.mimetype || '').split(';')[0].toLowerCase();
        if (!MIMES_PERMITIDOS[mimetype]) return null;
        return { mimetype, data: media.data };
    } catch (err) {
        console.error('❌ Error al descargar imagen:', err.message);
        return null;
    }
}

const esperar = ms => new Promise(resolve => setTimeout(resolve, ms));

async function enviarImagenes(chatId, archivos, crearCaption) {
    for (let i = 0; i < archivos.length; i++) {
        const media = MessageMedia.fromFilePath(archivos[i]);
        await client.sendMessage(chatId, media, { caption: crearCaption(i + 1, archivos.length) });
        await esperar(700); // pequeña pausa para no saturar WhatsApp
    }
}

// ═════════════════════════════════════════════
// Sesiones y cola por usuario
// ═════════════════════════════════════════════
function limpiarTimer(sesion) {
    if (sesion && sesion.timer) {
        clearTimeout(sesion.timer);
        sesion.timer = null;
    }
}

function crearSesion(userId, estado) {
    limpiarTimer(sesiones.get(userId));
    const sesion = {
        estado,
        ultimaActividad: Date.now(),
        intentosClave: 0,
        categoria: null,       // CATEGORIAS.resultados o CATEGORIAS.cumpleaneros
        mes: null,             // { clave, etiqueta } del mes con el que se trabaja
        pendientes: [],        // fotos recibidas que aún no se han guardado
        volverA: 'arch_menu',  // a dónde regresar al terminar una subida
        numeroReemplazo: null,
        timer: null
    };
    sesiones.set(userId, sesion);
    return sesion;
}

function reiniciarSesion(userId) {
    limpiarTimer(sesiones.get(userId));
    sesiones.delete(userId);
}

function enFlujoArchivos(sesion) {
    return Boolean(sesion && sesion.estado.startsWith('arch_'));
}

function imagenesDeSesion(sesion) {
    return listarImagenes(sesion.categoria, sesion.mes.clave);
}

function tituloDeSesion(sesion) {
    return sesion.categoria.titulo(sesion.mes.etiqueta);
}

function encolar(userId, tarea) {
    const anterior = colas.get(userId) || Promise.resolve();
    const actual = anterior.then(tarea).catch(err => console.error('❌ Error en la cola:', err));
    colas.set(userId, actual);
    actual.then(() => {
        if (colas.get(userId) === actual) colas.delete(userId);
    });
    return actual;
}

function yaProcesado(id) {
    if (!id) return false;
    if (mensajesProcesados.has(id)) return true;
    mensajesProcesados.add(id);
    if (mensajesProcesados.size > 1000) {
        mensajesProcesados.delete(mensajesProcesados.values().next().value);
    }
    return false;
}

// ═════════════════════════════════════════════
// Menús y navegación
// ═════════════════════════════════════════════
function textoMenuCategorias() {
    return (
        `📁 *Subir archivos*\n\n` +
        `¿Qué vas a subir o editar?\n\n` +
        `1️⃣ - ${CATEGORIAS.resultados.emoji} ${CATEGORIAS.resultados.nombre}\n` +
        `2️⃣ - ${CATEGORIAS.cumpleaneros.emoji} ${CATEGORIAS.cumpleaneros.nombre}\n\n` +
        `_Envía *0* para volver al menú principal._`
    );
}

function textoMenuArchivos(cat) {
    return (
        `${cat.emoji} *${cat.nombre}*\n\n` +
        `¿Qué deseas hacer?\n\n` +
        `1️⃣ - Subir imágenes\n` +
        `2️⃣ - Editar o eliminar imágenes\n\n` +
        `_Envía *0* para volver._`
    );
}

function textoMenuEditar(sesion) {
    const total = imagenesDeSesion(sesion).length;
    return (
        `✏️ *Editar ${tituloDeSesion(sesion)}* (${plural(total, 'imagen', 'imágenes')})\n\n` +
        `1️⃣ - Ver las imágenes\n` +
        `2️⃣ - Agregar más imágenes\n` +
        `3️⃣ - Reemplazar una imagen\n` +
        `4️⃣ - Eliminar una o varias imágenes\n` +
        `5️⃣ - Eliminar todas las imágenes del mes\n\n` +
        `_Envía *0* para volver._`
    );
}

function textoPedirMesResultado() {
    const cat = CATEGORIAS.resultados;
    return (
        `📊 *Resultado de planta*\n\n` +
        `¿De qué *mes y año* quieres consultar los resultados?\n` +
        `${cat.ejemplo}\n\n` +
        `${textoMesesDisponibles(cat)}\n\n` +
        `_Envía *0* para volver al menú principal._`
    );
}

// Mes actual y mes siguiente según la hora de El Salvador
function mesesCumple() {
    const actual = moment().tz(TIMEZONE).month() + 1; // 1-12
    const siguiente = actual === 12 ? 1 : actual + 1;
    return {
        actual: { clave: claveSoloMes(actual), etiqueta: nombreMes(actual) },
        siguiente: { clave: claveSoloMes(siguiente), etiqueta: nombreMes(siguiente) }
    };
}

function textoMenuCumple() {
    const { actual, siguiente } = mesesCumple();
    return (
        `🎂 *Cumpleañeros*\n\n` +
        `¿Qué mes quieres ver?\n\n` +
        `1️⃣ - Mes actual (${actual.etiqueta})\n` +
        `2️⃣ - Mes siguiente (${siguiente.etiqueta})\n\n` +
        `_Envía *0* para volver al menú principal._`
    );
}

function textoPreguntaConfirmacion(sesion) {
    const n = sesion.pendientes.length;
    return (
        `📥 Recibí *${plural(n, 'imagen', 'imágenes')}* para *${tituloDeSesion(sesion)}*.\n\n` +
        (n === 1 ? `¿Solo sería esa o enviarás más?\n\n` : `¿Son todas o enviarás más?\n\n`) +
        `1️⃣ - ${n === 1 ? 'Solo esa' : 'Son todas'}, guardar\n` +
        `2️⃣ - Enviaré más\n\n` +
        `_Envía *0* para cancelar sin guardar._`
    );
}

async function volverMenuPrincipal(message, userId, prefijo = '') {
    crearSesion(userId, 'menu_principal');
    await message.reply(prefijo + textoMenuPrincipal());
}

async function irAMenuCategorias(message, sesion, prefijo = '') {
    limpiarTimer(sesion);
    sesion.pendientes = [];
    sesion.mes = null;
    sesion.categoria = null;
    sesion.estado = 'arch_categoria';
    await message.reply(prefijo + textoMenuCategorias());
}

// Menú "Subir / Editar" de la categoría elegida
async function irAMenuArchivos(message, sesion, prefijo = '') {
    limpiarTimer(sesion);
    sesion.pendientes = [];
    sesion.mes = null;
    sesion.estado = 'arch_menu';
    await message.reply(prefijo + textoMenuArchivos(sesion.categoria));
}

async function volverMenuEditar(message, sesion, prefijo = '') {
    if (imagenesDeSesion(sesion).length === 0) {
        return irAMenuArchivos(message, sesion, prefijo + `Ya no quedan imágenes en *${tituloDeSesion(sesion)}*.\n\n`);
    }
    sesion.estado = 'arch_editar_menu';
    await message.reply(prefijo + textoMenuEditar(sesion));
}

// ═════════════════════════════════════════════
// Menú principal y catálogo
// ═════════════════════════════════════════════
async function manejarMenuPrincipal({ message, sesion, texto }) {
    switch (texto) {
        case '1':
            sesion.estado = 'menu_criterios';
            return message.reply(textoMenuCriterios());
        case '2':
            return message.reply(TEXTO_APP_EQUIPOS);
        case '3':
            return message.reply(TEXTO_STELLAR);
        case '4':
            return message.reply(TEXTO_PEOPLE_HUB);
        case '5':
            sesion.estado = 'resultado_mes';
            return message.reply(textoPedirMesResultado());
        case '6':
            sesion.estado = 'cumple_menu';
            return message.reply(textoMenuCumple());
        case '7':
            sesion.estado = 'arch_clave';
            sesion.intentosClave = 0;
            return message.reply(TEXTO_PEDIR_CLAVE);
        default:
            return message.reply(`❌ Opción no reconocida.\n\n` + textoMenuPrincipal());
    }
}

async function manejarMenuCriterios({ message, sesion, texto }) {
    if (texto === '0') {
        sesion.estado = 'menu_principal';
        return message.reply(textoMenuPrincipal());
    }

    const opcion = parseInt(texto, 10);
    if (CRITERIOS[opcion] && String(opcion) === texto) {
        const respuestaCriterio =
            `${CRITERIOS[opcion]}\n\n` +
            `────────────────────\n` +
            `¿Quieres revisar otro?\n` +
            `• Envía un número (*1-8*)\n` +
            `• Envía *0* para volver al menú principal`;

        return message.reply(respuestaCriterio);
    }
    return message.reply(`❌ Opción no válida.\n\n` + textoMenuCriterios());
}

// ═════════════════════════════════════════════
// 5️⃣ Resultado de planta (consulta, sin contraseña)
// ═════════════════════════════════════════════
async function manejarResultadoMes({ message, sesion, texto }) {
    if (texto === '0') {
        sesion.estado = 'menu_principal';
        return message.reply(textoMenuPrincipal());
    }

    const cat = CATEGORIAS.resultados;
    const mes = cat.parsear(texto);
    if (!mes) {
        return message.reply(
            `❌ No reconocí el mes y año.\n${cat.ejemplo}\n\n` +
            `_Envía *0* para volver al menú principal._`
        );
    }

    const archivos = listarImagenes(cat, mes.clave);
    if (!archivos.length) {
        return message.reply(
            `😕 Aún no hay resultados de planta para *${mes.etiqueta}*.\n\n` +
            `${textoMesesDisponibles(cat)}\n\n` +
            `_Envía otro mes y año o *0* para volver al menú principal._`
        );
    }

    await message.reply(
        `📊 *Resultado de planta — ${mes.etiqueta}*\n` +
        `Te envío ${archivos.length === 1 ? 'la imagen' : `las ${archivos.length} imágenes`} 👇`
    );
    await enviarImagenes(message.from, archivos, (i, n) => (n > 1 ? `${mes.etiqueta} (${i}/${n})` : mes.etiqueta));
    await client.sendMessage(
        message.from,
        `¿Quieres consultar otro mes? Envía el *mes y año* o *0* para volver al menú principal.`
    );
}

// ═════════════════════════════════════════════
// 6️⃣ Cumpleañeros (consulta, sin contraseña)
// ═════════════════════════════════════════════
async function manejarCumpleMenu({ message, userId, sesion, texto, textoOriginal }) {
    if (texto === '0') {
        sesion.estado = 'menu_principal';
        return message.reply(textoMenuPrincipal());
    }

    const pieCumple = `_Envía *1* o *2* para ver otro mes, o *0* para volver al menú principal._`;

    if (texto === '1' || texto === '2') {
        const cat = CATEGORIAS.cumpleaneros;
        const meses = mesesCumple();
        const mes = texto === '1' ? meses.actual : meses.siguiente;
        const archivos = listarImagenes(cat, mes.clave);

        if (!archivos.length) {
            return message.reply(`😕 Aún no hay cumpleañeros cargados para *${mes.etiqueta}*.\n\n${pieCumple}`);
        }

        await message.reply(`🎂 *Cumpleañeros de ${mes.etiqueta}* 🎉`);
        await enviarImagenes(message.from, archivos, (i, n) =>
            (n > 1 ? `Cumpleañeros de ${mes.etiqueta} (${i}/${n})` : `Cumpleañeros de ${mes.etiqueta}`)
        );
        await client.sendMessage(message.from, `${TEXTO_AVISO_CUMPLE}\n\n${pieCumple}`);
        return;
    }

    // Alguien mandó su fecha correcta: se agradece y queda en el chat y en los logs
    if (pareceFecha(textoOriginal)) {
        console.log(`📝 Corrección de cumpleaños de ${ocultarNumero(userId)}: "${textoOriginal}"`);
        return message.reply(`📝 ¡Gracias! Recibimos tu fecha y la vamos a revisar.\n\n${pieCumple}`);
    }

    return message.reply(`❌ Opción no válida.\n\n` + textoMenuCumple());
}

// ═════════════════════════════════════════════
// 7️⃣ Subir archivos (con contraseña)
// ═════════════════════════════════════════════
async function manejarClave({ message, userId, sesion, texto, textoOriginal }) {
    if (texto === '0') return volverMenuPrincipal(message, userId);

    if (textoOriginal === CLAVE_ARCHIVOS) {
        sesion.intentosClave = 0;
        return irAMenuCategorias(message, sesion, `✅ Contraseña correcta.\n\n`);
    }

    sesion.intentosClave += 1;
    const restantes = MAX_INTENTOS_CLAVE - sesion.intentosClave;
    if (restantes <= 0) {
        return volverMenuPrincipal(message, userId, `❌ Contraseña incorrecta. Se agotaron los intentos.\n\n`);
    }
    return message.reply(
        `❌ Contraseña incorrecta. Te ${restantes === 1 ? 'queda *1* intento' : `quedan *${restantes}* intentos`}.\n\n` +
        `Ingresa la contraseña o envía *0* para volver al menú principal.`
    );
}

// ¿Resultado de planta o Cumpleañeros?
async function manejarCategoria({ message, userId, sesion, texto }) {
    if (texto === '0') return volverMenuPrincipal(message, userId);
    if (texto === '1' || texto === '2') {
        sesion.categoria = texto === '1' ? CATEGORIAS.resultados : CATEGORIAS.cumpleaneros;
        return irAMenuArchivos(message, sesion);
    }
    return message.reply(`❌ Opción no válida.\n\n` + textoMenuCategorias());
}

async function manejarMenuArchivos({ message, sesion, texto }) {
    if (texto === '0') return irAMenuCategorias(message, sesion);

    const cat = sesion.categoria;
    if (texto === '1') {
        sesion.estado = 'arch_subir_mes';
        return message.reply(
            `📤 *Subir imágenes — ${cat.nombre}*\n\n` +
            `¿De qué ${cat.queMes} son las imágenes que vas a subir?\n${cat.ejemplo}\n\n` +
            `_Envía *0* para volver._`
        );
    }
    if (texto === '2') {
        sesion.estado = 'arch_editar_mes';
        return message.reply(
            `✏️ *Editar o eliminar — ${cat.nombre}*\n\n` +
            `¿Qué ${cat.queMes} quieres editar o eliminar?\n${cat.ejemplo}\n\n` +
            `${textoMesesDisponibles(cat)}\n\n` +
            `_Envía *0* para volver._`
        );
    }
    return message.reply(`❌ Opción no válida.\n\n` + textoMenuArchivos(cat));
}

function textoMesNoReconocido(cat) {
    return `❌ No reconocí el ${cat.queMes}.\n${cat.ejemplo}\n\n_Envía *0* para volver._`;
}

// ── Subida de fotos ──────────────────────────
function iniciarSubida(sesion, mes, volverA) {
    limpiarTimer(sesion);
    sesion.mes = mes;
    sesion.pendientes = [];
    sesion.volverA = volverA;
    sesion.estado = 'arch_subir_imagen';
}

async function terminarSubida(message, sesion, prefijo) {
    limpiarTimer(sesion);
    sesion.pendientes = [];
    if (sesion.volverA === 'arch_editar_menu') return volverMenuEditar(message, sesion, prefijo);
    return irAMenuArchivos(message, sesion, prefijo);
}

const RESPUESTAS_ULTIMA = new Set([
    '1', 'si', 'ya', 'listo', 'guardar', 'guardala', 'guardalas', 'ultima', 'es la ultima', 'ya es la ultima',
    'solo esa', 'solo esas', 'es la unica', 'solo esa seria', 'son todas', 'ya son todas', 'es todo', 'ya es todo'
]);
const RESPUESTAS_MAS = new Set([
    '2', 'no', 'mas', 'enviare mas', 'voy a enviar mas', 'mandare mas', 'otra', 'otras', 'faltan', 'falta',
    'no es la ultima', 'no son todas', 'hay mas'
]);

// Quita palabras de cortesía para entender "sí, gracias", "solo esa por favor", "ok ya es la última", etc.
function limpiarRespuesta(texto) {
    return normalizar(texto)
        .replace(/\b(muchas |mil )?gracia+s*\b/g, ' ')
        .replace(/\b(por favor|porfa|porfavor|ok|okay|okey|va|dale|bueno|amigo|amiga)\b/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function respuestaEsUltima(texto) {
    return RESPUESTAS_ULTIMA.has(limpiarRespuesta(texto));
}

function respuestaEnviaraMas(texto) {
    return RESPUESTAS_MAS.has(limpiarRespuesta(texto));
}

// Después de recibir fotos se espera un momento; si no llegan más, se pregunta si es la última
function programarConfirmacion(userId, chatId, sesion) {
    limpiarTimer(sesion);
    sesion.timer = setTimeout(() => {
        sesion.timer = null;
        encolar(userId, async () => {
            if (sesiones.get(userId) !== sesion || sesion.estado !== 'arch_subir_confirmar') return;
            await client.sendMessage(chatId, textoPreguntaConfirmacion(sesion));
        });
    }, ESPERA_CONFIRMACION_MS);
}

async function guardarPendientes(message, sesion) {
    limpiarTimer(sesion);
    const cat = sesion.categoria;
    const clave = sesion.mes.clave;
    const cantidad = sesion.pendientes.length;
    let numero = siguienteNumero(cat, clave);
    for (const foto of sesion.pendientes) {
        await guardarImagen(cat, clave, foto, numero++);
    }
    const total = listarImagenes(cat, clave).length;
    console.log(`💾 ${cantidad} imagen(es) guardada(s) en ${cat.nombre} / ${clave}`);
    return terminarSubida(
        message,
        sesion,
        `✅ ¡Listo! Se ${cantidad === 1 ? 'guardó *1 imagen*' : `guardaron *${cantidad} imágenes*`} en *${tituloDeSesion(sesion)}*.\n` +
        `Total en ese mes: *${total}*.\n\n`
    );
}

async function cancelarSubida(message, sesion) {
    const habiaFotos = sesion.pendientes.length > 0;
    return terminarSubida(
        message,
        sesion,
        habiaFotos ? `🗑️ Subida cancelada, no se guardó nada.\n\n` : `↩️ Subida cancelada.\n\n`
    );
}

async function manejarSubirMes({ message, sesion, texto }) {
    if (texto === '0') return irAMenuArchivos(message, sesion);

    const cat = sesion.categoria;
    const mes = cat.parsear(texto);
    if (!mes) return message.reply(textoMesNoReconocido(cat));

    iniciarSubida(sesion, mes, 'arch_menu');
    const existentes = imagenesDeSesion(sesion).length;
    let aviso = '';
    if (existentes) {
        aviso = `Ya hay ${plural(existentes, 'imagen guardada', 'imágenes guardadas')} en ese mes; las nuevas se agregarán.\n`;
        if (cat === CATEGORIAS.cumpleaneros) {
            aviso += `_Si son del año pasado, puedes borrarlas en *Editar o eliminar*._\n`;
        }
    }
    return message.reply(
        `📷 Perfecto, *${tituloDeSesion(sesion)}*.\n` +
        aviso +
        `\nEnvía la *foto* (solo se permiten imágenes).\n\n` +
        `_Envía *0* para cancelar._`
    );
}

// Texto recibido mientras se espera una foto
async function manejarSubirImagenTexto({ message, sesion, texto }) {
    if (texto === '0') return cancelarSubida(message, sesion);

    const n = sesion.pendientes.length;
    if (n > 0 && respuestaEsUltima(texto)) return guardarPendientes(message, sesion);

    return message.reply(
        `📷 Estoy esperando una *foto* para *${tituloDeSesion(sesion)}*.\n\n` +
        (n > 0
            ? `Envía *1* para guardar ${n === 1 ? 'la que ya enviaste' : `las ${n} que ya enviaste`} o *0* para cancelar.`
            : `Envía la foto o *0* para cancelar.`)
    );
}

// Respuesta a "¿Solo sería esa o enviarás más?"
async function manejarSubirConfirmar({ message, sesion, texto }) {
    if (texto === '0') return cancelarSubida(message, sesion);
    if (respuestaEsUltima(texto)) return guardarPendientes(message, sesion);

    limpiarTimer(sesion);
    if (respuestaEnviaraMas(texto)) {
        sesion.estado = 'arch_subir_imagen';
        return message.reply(`👍 Va, envía la siguiente foto.`);
    }
    return message.reply(`🤔 No te entendí.\n\n` + textoPreguntaConfirmacion(sesion));
}

// ── Editar / eliminar ────────────────────────
async function mostrarImagenesEditar(message, sesion) {
    const archivos = imagenesDeSesion(sesion);
    await message.reply(`🖼️ Estas son las imágenes de *${tituloDeSesion(sesion)}*:`);
    await enviarImagenes(message.from, archivos, (i, n) => `Imagen ${i} de ${n}`);
    await client.sendMessage(message.from, textoMenuEditar(sesion));
}

async function manejarEditarMes({ message, sesion, texto }) {
    if (texto === '0') return irAMenuArchivos(message, sesion);

    const cat = sesion.categoria;
    const mes = cat.parsear(texto);
    if (!mes) return message.reply(textoMesNoReconocido(cat));

    if (!listarImagenes(cat, mes.clave).length) {
        return message.reply(
            `😕 No hay imágenes guardadas en *${cat.titulo(mes.etiqueta)}*.\n\n` +
            `${textoMesesDisponibles(cat)}\n\n` +
            `_Envía otro ${cat.queMes} o *0* para volver._`
        );
    }

    sesion.mes = mes;
    sesion.estado = 'arch_editar_menu';
    return mostrarImagenesEditar(message, sesion);
}

async function manejarEditarMenu({ message, sesion, texto }) {
    if (texto === '0') return irAMenuArchivos(message, sesion);

    const total = imagenesDeSesion(sesion).length;
    if (total === 0) {
        return irAMenuArchivos(message, sesion, `😕 Ya no hay imágenes en *${tituloDeSesion(sesion)}*.\n\n`);
    }

    switch (texto) {
        case '1':
            return mostrarImagenesEditar(message, sesion);
        case '2':
            iniciarSubida(sesion, sesion.mes, 'arch_editar_menu');
            return message.reply(
                `📷 Envía las *fotos* que quieres agregar a *${tituloDeSesion(sesion)}*.\n\n_Envía *0* para cancelar._`
            );
        case '3':
            sesion.estado = 'arch_reemplazar_num';
            return message.reply(
                `🔁 ¿Qué número de imagen quieres *reemplazar*? (${rango(total)})\n\n_Envía *0* para volver._`
            );
        case '4':
            sesion.estado = 'arch_eliminar_num';
            return message.reply(
                `🗑️ ¿Qué número de imagen quieres *eliminar*? (${rango(total)})\n` +
                `Puedes enviar varios separados por coma, ej: *1,3*\n\n` +
                `_Envía *0* para volver._`
            );
        case '5':
            sesion.estado = 'arch_eliminar_todo';
            return message.reply(
                `⚠️ ¿Seguro que quieres eliminar ${total === 1 ? 'la *única imagen*' : `las *${total} imágenes*`} ` +
                `de *${tituloDeSesion(sesion)}*? Esto no se puede deshacer.\n\n` +
                `Escribe *SI* para confirmar o *0* para cancelar.`
            );
        default:
            return message.reply(`❌ Opción no válida.\n\n` + textoMenuEditar(sesion));
    }
}

async function manejarReemplazarNumero({ message, sesion, texto }) {
    if (texto === '0') return volverMenuEditar(message, sesion);

    const total = imagenesDeSesion(sesion).length;
    const n = Number(texto);
    if (!/^\d+$/.test(texto) || n < 1 || n > total) {
        return message.reply(`❌ Número no válido. Envía un número del *${rango(total)}* o *0* para volver.`);
    }

    sesion.numeroReemplazo = n;
    sesion.estado = 'arch_reemplazar_imagen';
    return message.reply(`📷 Envía la nueva *foto* que reemplazará la *Imagen ${n}*.\n\n_Envía *0* para cancelar._`);
}

async function manejarReemplazarImagenTexto({ message, sesion, texto }) {
    if (texto === '0') return volverMenuEditar(message, sesion, `↩️ No se reemplazó nada.\n\n`);
    return message.reply(
        `📷 Estoy esperando la nueva *foto* para la *Imagen ${sesion.numeroReemplazo}*.\n\n` +
        `Envíala o envía *0* para cancelar.`
    );
}

async function manejarEliminarNumeros({ message, sesion, texto }) {
    if (texto === '0') return volverMenuEditar(message, sesion);

    const archivos = imagenesDeSesion(sesion);
    const numeros = [...new Set(texto.split(/[^0-9]+/).filter(Boolean).map(Number))].sort((a, b) => a - b);
    const valido =
        /^[\d\s,y]+$/.test(texto) && numeros.length > 0 && numeros.every(n => n >= 1 && n <= archivos.length);

    if (!valido) {
        return message.reply(
            `❌ Número no válido. Envía números del *${rango(archivos.length)}* (ej: *1,3*) o *0* para volver.`
        );
    }

    for (const n of numeros) {
        await fs.promises.rm(archivos[n - 1], { force: true });
    }
    console.log(`🗑️ Eliminadas imágenes ${numeros.join(', ')} de ${sesion.categoria.nombre} / ${sesion.mes.clave}`);

    const resumen = numeros.length === 1
        ? `✅ Se eliminó la *Imagen ${numeros[0]}*.`
        : `✅ Se eliminaron las imágenes *${numeros.join(', ')}*.`;
    const restantes = imagenesDeSesion(sesion).length;

    if (restantes === 0) {
        const titulo = tituloDeSesion(sesion);
        await borrarCarpetaMes(sesion.categoria, sesion.mes.clave);
        return irAMenuArchivos(message, sesion, `${resumen}\nYa no quedan imágenes en *${titulo}*.\n\n`);
    }
    return volverMenuEditar(
        message,
        sesion,
        `${resumen}\nQuedan *${plural(restantes, 'imagen', 'imágenes')}* ` +
        `(la numeración se actualizó, envía *1* para verlas).\n\n`
    );
}

async function manejarEliminarTodo({ message, sesion, texto }) {
    const t = normalizar(texto);
    if (t === 'si') {
        const total = imagenesDeSesion(sesion).length;
        const titulo = tituloDeSesion(sesion);
        await borrarCarpetaMes(sesion.categoria, sesion.mes.clave);
        console.log(`🗑️ Eliminado el mes completo ${sesion.categoria.nombre} / ${sesion.mes.clave}`);
        return irAMenuArchivos(message, sesion, `🗑️ Se eliminaron ${plural(total, 'imagen', 'imágenes')} de *${titulo}*.\n\n`);
    }
    if (t === '0' || t === 'no') return volverMenuEditar(message, sesion, `↩️ No se eliminó nada.\n\n`);
    return message.reply(`Escribe *SI* para confirmar o *0* para cancelar.`);
}

// ── Fotos (u otros archivos) recibidas dentro de "Subir archivos" ──
const ESTADOS_QUE_ACEPTAN_FOTOS = ['arch_subir_imagen', 'arch_subir_confirmar', 'arch_reemplazar_imagen'];

async function manejarArchivoRecibido(message, userId, sesion) {
    if (!ESTADOS_QUE_ACEPTAN_FOTOS.includes(sesion.estado)) {
        return message.reply(
            `⚠️ En este paso no estoy esperando una imagen.\n` +
            `Sigue las instrucciones del mensaje anterior o envía *0* para volver.`
        );
    }

    if (!esFoto(message)) {
        return message.reply(`⚠️ Solo se permiten *fotos* (JPG o PNG). Envía una foto, por favor.`);
    }

    const foto = await descargarFoto(message);
    if (!foto) {
        return message.reply(`⚠️ No pude procesar esa imagen. Envíala como *foto* (JPG o PNG) e intenta de nuevo.`);
    }

    // Reemplazar una imagen existente
    if (sesion.estado === 'arch_reemplazar_imagen') {
        const archivos = imagenesDeSesion(sesion);
        const anterior = archivos[sesion.numeroReemplazo - 1];
        if (!anterior) return volverMenuEditar(message, sesion, `⚠️ Esa imagen ya no existe.\n\n`);

        const nuevo = await guardarImagen(sesion.categoria, sesion.mes.clave, foto, numeroDeArchivo(anterior));
        if (nuevo !== anterior) await fs.promises.rm(anterior, { force: true });
        console.log(`🔁 Reemplazada imagen ${sesion.numeroReemplazo} de ${sesion.categoria.nombre} / ${sesion.mes.clave}`);
        return volverMenuEditar(message, sesion, `✅ La *Imagen ${sesion.numeroReemplazo}* fue reemplazada.\n\n`);
    }

    // Subida normal: se acumula y luego se pregunta si es la última
    sesion.pendientes.push(foto);
    sesion.estado = 'arch_subir_confirmar';
    programarConfirmacion(userId, message.from, sesion);
}

// ═════════════════════════════════════════════
// Manejador principal de mensajes
// ═════════════════════════════════════════════
const MANEJADORES = {
    menu_principal: manejarMenuPrincipal,
    menu_criterios: manejarMenuCriterios,
    resultado_mes: manejarResultadoMes,
    cumple_menu: manejarCumpleMenu,
    arch_clave: manejarClave,
    arch_categoria: manejarCategoria,
    arch_menu: manejarMenuArchivos,
    arch_subir_mes: manejarSubirMes,
    arch_subir_imagen: manejarSubirImagenTexto,
    arch_subir_confirmar: manejarSubirConfirmar,
    arch_editar_mes: manejarEditarMes,
    arch_editar_menu: manejarEditarMenu,
    arch_reemplazar_num: manejarReemplazarNumero,
    arch_reemplazar_imagen: manejarReemplazarImagenTexto,
    arch_eliminar_num: manejarEliminarNumeros,
    arch_eliminar_todo: manejarEliminarTodo
};

async function manejarMensaje(message, userId) {
    const esTexto = message.type === 'chat';
    if (!esTexto && !message.hasMedia) return; // reacciones, ubicaciones, etc.

    let sesion = sesiones.get(userId);

    // Cerrar "Subir archivos" si estuvo inactivo mucho tiempo
    if (enFlujoArchivos(sesion) && Date.now() - sesion.ultimaActividad > EXPIRACION_ARCHIVOS_MS) {
        const habiaPendientes = sesion.pendientes.length > 0;
        await volverMenuPrincipal(
            message,
            userId,
            `⏱️ El acceso a *Subir archivos* se cerró por inactividad` +
            (habiaPendientes ? ` y las imágenes sin confirmar no se guardaron` : '') +
            `.\n\n`
        );
        return;
    }
    if (sesion) sesion.ultimaActividad = Date.now();

    // Fotos y otros archivos: solo se usan dentro de "Subir archivos" (fuera de ahí se ignoran, como antes)
    if (!esTexto) {
        if (enFlujoArchivos(sesion)) await manejarArchivoRecibido(message, userId, sesion);
        return;
    }

    const textoOriginal = message.body ? message.body.trim() : '';
    const texto = textoOriginal.toLowerCase();
    if (!texto) return;

    // Regex para detectar "gracia", "gracias", repetición de letras (graciaas), con signos o emojis
    // (dentro de "Subir archivos" no se usa, para no perder fotos pendientes por un "sí, gracias")
    const esAgradecimiento = /gracia+s*/i.test(texto);
    if (esAgradecimiento && !enFlujoArchivos(sesion)) {
        reiniciarSesion(userId); // su siguiente mensaje vuelve a mostrar el menú principal
        await message.reply(obtenerDespedida());
        return;
    }

    // Primer mensaje o saludo explícito
    if (texto === 'hola' || !sesion) {
        await volverMenuPrincipal(message, userId);
        return;
    }

    const manejador = MANEJADORES[sesion.estado];
    if (manejador) {
        await manejador({ message, userId, sesion, texto, textoOriginal });
    } else {
        await volverMenuPrincipal(message, userId);
    }
}

// Muestra solo los últimos 4 dígitos del número en los logs de Railway
function ocultarNumero(id) {
    const numero = String(id || '').split('@')[0];
    return numero.length > 4 ? `…${numero.slice(-4)}` : numero;
}

client.on('message', message => {
    // Descartar mensajes propios, estados o difusiones
    if (message.fromMe) return;
    if (message.from === 'status@broadcast') return;
    if (message.broadcast) return;

    const id = message.id && (message.id._serialized || message.id.$1);
    if (yaProcesado(id)) return;

    const userId = message.author || message.from;
    if (!userId) {
        // Pasa cuando WhatsApp Web cambia algo interno y la versión de whatsapp-web.js quedó vieja
        console.error('❌ Llegó un mensaje sin remitente: hay que actualizar whatsapp-web.js en package.json');
        return;
    }
    console.log(`📩 Mensaje de ${ocultarNumero(userId)} (${message.type})`);

    encolar(userId, async () => {
        try {
            await manejarMensaje(message, userId);
        } catch (error) {
            console.error('❌ Error al manejar mensaje:', error);
            try {
                await message.reply('⚠️ Ocurrió un error procesando tu mensaje. Intenta de nuevo.');
            } catch (_) {
                // si tampoco se puede responder, solo queda el log
            }
        }
    });
});

client.on('qr', qr => {
    const qrImageUrl = `https://quickchart.io/qr?text=${encodeURIComponent(qr)}&size=300`;

    console.log('\n================== CÓDIGO QR WHATSAPP ==================');
    console.log('👉 ABRE ESTE ENLACE EN TU NAVEGADOR PARA ESCANEAR EL QR:');
    console.log(qrImageUrl);
    console.log('========================================================\n');
});

client.on('authenticated', () => console.log('✅ Autenticación exitosa'));
client.on('auth_failure', msg => console.error('❌ Error de autenticación:', msg));
client.on('loading_screen', (porcentaje, mensaje) => console.log(`⏳ Cargando WhatsApp ${porcentaje}% ${mensaje || ''}`));
client.on('change_state', estado => console.log('🔄 Estado de WhatsApp:', estado));

client.on('ready', () => {
    console.log(`🤖 Noti Bot listo | ${moment().tz(TIMEZONE).format('DD/MM/YYYY HH:mm:ss')}`);
    console.log(`📁 Resultados de planta guardados en: ${RESULTADOS_PATH}`);
    console.log(`🎂 Cumpleañeros guardados en: ${CUMPLEANEROS_PATH}`);
});

client.on('disconnected', reason => {
    console.log('❌ Desconectado:', reason);
    setTimeout(() => client.initialize(), 5000);
});

client.initialize();
