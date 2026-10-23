const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const moment = require('moment-timezone');
const path = require('path');
const fs = require('fs');

const TIMEZONE = 'America/El_Salvador';
const MAX_TEXTO = 20;

// Ruta de la sesión en el Volume de Railway (/data/whatsapp-session)
const SESSION_PATH = process.env.SESSION_PATH || path.join(__dirname, 'whatsapp-session');

// Estados en memoria por usuario
const userStates = new Map();

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
        `Envía el número de la opción.`
    );
}

function textoMenuCriterios() {
    return (
        `🏆 *CRITERIOS*\n\n` +
        `¿Qué criterios de embajador quieres revisar el día de hoy?\n\n` +
        `1️⃣ - Embajador de Calidad\n` +
        `2️⃣ - Embajador de Seguridad\n` +
        `3️⃣ - Embajador de Medio Ambiente\n` +
        `4️⃣ - Embajador de Montacarguista\n` +
        `5️⃣ - Ideas Fantásticas\n` +
        `6️⃣ - Menciones Honoríficas\n` +
        `7️⃣ - Embajador de Principios\n` +
        `8️⃣ - Dashboard de Liderazgo\n\n` +
        `Envía el número (1-8).\n` +
        `Envía *0* para volver al menú principal.`
    );
}

client.on('message', async message => {
    try {
        const texto = message.body.trim().toLowerCase();
        const userId = message.author || message.from;

        if (message.from === 'status@broadcast') return;

        const estado = userStates.get(userId);

        if (texto === '/menu' || texto === '/menú') {
            userStates.set(userId, 'menu_principal');
            await message.reply(textoMenuPrincipal());
            return;
        }

        if (!estado) {
            userStates.set(userId, 'menu_principal');
            await message.reply(textoMenuPrincipal());
            return;
        }

        if (estado === 'silenciado') return;
        if (!texto) return;

        if (texto.length > MAX_TEXTO) {
            userStates.set(userId, 'silenciado');
            return;
        }

        if (texto === 'cancelar' || texto === 'salir') {
            userStates.set(userId, 'silenciado');
            await message.reply('👋 Listo. Escribe */menu* cuando quieras volver.');
            return;
        }

        if (estado === 'menu_principal') {
            if (texto === '1') {
                userStates.set(userId, 'menu_criterios');
                await message.reply(textoMenuCriterios());
            } else if (texto === '2') {
                await message.reply(
                    `📱 *APP de Equipos Autónomos*\n\n` +
                    `Entra al siguiente link:\n` +
                    `https://fasedeequipos.web.app/\n\n` +
                    `Envía *1* o *2* para otra opción, o *cancelar* para salir.`
                );
            } else {
                await message.reply('❌ Opción inválida. Envía *1* o *2*, o *cancelar* para salir.');
            }
            return;
        }

        if (estado === 'menu_criterios') {
            if (texto === '0') {
                userStates.set(userId, 'menu_principal');
                await message.reply(textoMenuPrincipal());
                return;
            }

            const opcion = parseInt(texto);
            if (CRITERIOS[opcion] && String(opcion) === texto) {
                await message.reply(CRITERIOS[opcion]);
                await message.reply(
                    `¿Quieres revisar otro?\n\n` +
                    `• Envía otro número (1-8)\n` +
                    `• Envía *0* para volver al menú principal\n` +
                    `• Envía *cancelar* para salir`
                );
            } else {
                await message.reply('❌ Opción inválida. Envía un número del 1 al 8, o *0* para volver.');
            }
            return;
        }
    } catch (error) {
        console.error('❌ Error al manejar mensaje:', error);
    }
});

client.on('qr', qr => {
    // Genera un link directo a una imagen limpia del QR
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
