const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const moment = require('moment-timezone');
const path = require('path');
const fs = require('fs');

const TIMEZONE = 'America/El_Salvador';

// Ruta de la sesión en el Volume de Railway (/data/whatsapp-session)
const SESSION_PATH = process.env.SESSION_PATH || path.join(__dirname, 'whatsapp-session');

// Estados en memoria por usuario
const userStates = new Map();
// Control para evitar procesar dos eventos simultáneos de la misma persona
const processingUsers = new Set();

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
        `2️⃣ - APP de Equipos Autónomos\n\n` +
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

client.on('message', async message => {
    try {
        // Descartar mensajes propios, estados o difusiones
        if (message.fromMe) return;
        if (message.from === 'status@broadcast') return;
        if (message.broadcast) return;

        // Solo procesar mensajes de texto
        if (message.type !== 'chat') return;

        const texto = message.body ? message.body.trim().toLowerCase() : '';
        if (!texto) return;

        const userId = message.author || message.from;

        // Evitar procesar dos peticiones a la vez del mismo usuario
        if (processingUsers.has(userId)) return;
        processingUsers.add(userId);

        // Regex para detectar "gracia", "gracias", repetición de letras (graciaas), con signos o emojis
        const esAgradecimiento = /gracia+s*/i.test(texto);

        if (esAgradecimiento) {
            userStates.delete(userId); // Reinicia el estado para que su siguiente mensaje active el menú principal
            await message.reply(obtenerDespedida());
            processingUsers.delete(userId);
            return;
        }

        const estadoActual = userStates.get(userId);

        // Primer mensaje o saludo explícito
        if (texto === 'hola' || !estadoActual) {
            userStates.set(userId, 'menu_principal');
            await message.reply(textoMenuPrincipal());
            processingUsers.delete(userId);
            return;
        }

        // Menú Principal
        if (estadoActual === 'menu_principal') {
            if (texto === '1') {
                userStates.set(userId, 'menu_criterios');
                await message.reply(textoMenuCriterios());
            } else if (texto === '2') {
                await message.reply(
                    `📱 *APP de Equipos Autónomos*\n\n` +
                    `Entra al siguiente link:\n` +
                    `https://fasedeequipos.web.app/\n\n` +
                    `_Envía *1* para el catálogo o escribe *hola* para volver al menú._`
                );
            } else {
                await message.reply(
                    `❌ Opción no reconocida.\n\n` + textoMenuPrincipal()
                );
            }
            processingUsers.delete(userId);
            return;
        }

        // Menú de Criterios
        if (estadoActual === 'menu_criterios') {
            if (texto === '0') {
                userStates.set(userId, 'menu_principal');
                await message.reply(textoMenuPrincipal());
                processingUsers.delete(userId);
                return;
            }

            const opcion = parseInt(texto, 10);
            if (CRITERIOS[opcion] && String(opcion) === texto) {
                const respuestaCriterio = 
                    `${CRITERIOS[opcion]}\n\n` +
                    `────────────────────\n` +
                    `¿Quieres revisar otro?\n` +
                    `• Envía un número (*1-8*)\n` +
                    `• Envía *0* para volver al menú principal`;

                await message.reply(respuestaCriterio);
            } else {
                await message.reply(
                    `❌ Opción no válida.\n\n` + textoMenuCriterios()
                );
            }
            processingUsers.delete(userId);
            return;
        }

        processingUsers.delete(userId);
    } catch (error) {
        console.error('❌ Error al manejar mensaje:', error);
        if (message && (message.author || message.from)) {
            processingUsers.delete(message.author || message.from);
        }
    }
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

client.on('ready', () => {
    console.log(`🤖 Noti Bot listo | ${moment().tz(TIMEZONE).format('DD/MM/YYYY HH:mm:ss')}`);
});

client.on('disconnected', reason => {
    console.log('❌ Desconectado:', reason);
    setTimeout(() => client.initialize(), 5000);
});

client.initialize();
