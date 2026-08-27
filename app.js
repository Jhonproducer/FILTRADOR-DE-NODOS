// Inicializar Lucide Icons
lucide.createIcons();

// --- ESTADO GLOBAL ---
let cuentas = JSON.parse(localStorage.getItem('motor_cuentas')) || [];
let blacklist = JSON.parse(localStorage.getItem('motor_blacklist')) || [];

// --- NAVEGACIÓN ---
function showTab(tabId) {
    document.querySelectorAll('section').forEach(s => s.classList.add('hidden'));
    document.getElementById(tabId).classList.remove('hidden');
    
    document.querySelectorAll('nav button').forEach(b => {
        b.classList.remove('bg-indigo-600', 'text-white');
        b.classList.add('text-gray-300');
    });
    const btn = document.getElementById(`btn-${tabId}`);
    btn.classList.remove('text-gray-300');
    btn.classList.add('bg-indigo-600', 'text-white');
}

// --- PROCESAR CARGA MASIVA DE TEXTO ---
function procesarCargaMasiva() {
    const texto = document.getElementById('texto-carga').value.trim();
    if (!texto) return alert("Pega los datos primero.");

    const lineas = texto.split('\n');
    let nuevasCuentas = [];

    lineas.forEach(linea => {
        // Separa por espacios o tabulaciones
        const partes = linea.trim().split(/\s+/);
        if (partes.length >= 2) {
            nuevasCuentas.push({
                id: partes[0], // LON-01
                fecha: partes[1], // 26/8/2026
                nodo: partes.length >= 3 ? partes[2] : "", // Si no hay, queda en blanco
                ip: partes.length >= 4 ? partes[3] : ""
            });
        }
    });

    cuentas = nuevasCuentas;
    localStorage.setItem('motor_cuentas', JSON.stringify(cuentas));
    
    document.getElementById('modalCarga').classList.add('hidden');
    document.getElementById('texto-carga').value = '';
    renderDashboard();
    alert(`¡Éxito! Se cargaron ${cuentas.length} cuentas en el Motor.`);
}

// --- RENDERIZAR DASHBOARD ---
function renderDashboard() {
    const tbody = document.getElementById('tabla-cuentas');
    tbody.innerHTML = '';

    if (cuentas.length === 0) {
        tbody.innerHTML = `<tr><td colspan="5" class="p-8 text-center text-gray-500">No hay cuentas. Presiona "Pegar Datos".</td></tr>`;
        return;
    }

    cuentas.forEach(c => {
        let estado = c.ip && c.nodo 
            ? `<span class="bg-emerald-500/20 text-emerald-400 px-3 py-1 rounded-full text-xs font-bold border border-emerald-500/30">Activa</span>`
            : `<span class="bg-amber-500/20 text-amber-400 px-3 py-1 rounded-full text-xs font-bold border border-amber-500/30">Falta Nodo/IP</span>`;

        tbody.innerHTML += `
            <tr class="hover:bg-gray-800/50">
                <td class="p-4 font-bold text-white">${c.id}</td>
                <td class="p-4 text-gray-400">${c.fecha}</td>
                <td class="p-4 font-mono text-indigo-400">${c.nodo || '-'}</td>
                <td class="p-4 font-mono text-indigo-400">${c.ip || '-'}</td>
                <td class="p-4 text-center">${estado}</td>
            </tr>
        `;
    });
}

// --- MOTOR ESTRICTO DE COLISIÓN (TU REGLA) ---
function verificarProximidad(ipNueva, nodoNuevo) {
    if (blacklist.includes(ipNueva) || blacklist.includes(nodoNuevo)) return false;

    let octetosNueva = ipNueva.split('.');

    for (let acc of cuentas) {
        // Bloquear si el Nodo es el mismo
        if (acc.nodo && acc.nodo === nodoNuevo) return false;

        if (!acc.ip) continue;
        
        let octetosAcc = acc.ip.split('.');

        // Regla: 2 primeros aceptables, pero si los 3 primeros coinciden (Subred /24), BLOQUEAR.
        // Ejemplo: 86.172.94.10 y 86.172.94.50 -> CHOCAN (Falso).
        // Ejemplo: 86.172.100.10 y 86.172.94.50 -> PASAN (Verdadero).
        if (octetosNueva[0] === octetosAcc[0] && 
            octetosNueva[1] === octetosAcc[1] && 
            octetosNueva[2] === octetosAcc[2]) {
            return false; // CHOCAN MUY CERCA
        }
    }
    return true; // LA IP ES SEGURA
}

// --- OBTENER POOL (API MYSTERIUM) ---
async function buscarPool() {
    const tbody = document.getElementById('tabla-pool');
    tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-indigo-400">Analizando miles de nodos y aplicando Motor de Colisión...</td></tr>`;
    
    const minCalidad = parseFloat(document.getElementById('filtro-calidad').value);
    const url = "https://discovery.mysterium.network/api/v3/proposals?location_country=GB&ip_type=residential";
    
    try {
        // Usamos AllOrigins para saltar CORS
        const res = await fetch(`https://api.allorigins.win/get?url=${encodeURIComponent(url)}`, { cache: 'no-store' });
        const proxyData = await res.json();
        const nodos = JSON.parse(proxyData.contents);
        
        tbody.innerHTML = '';
        let aprobados = 0;

        // Ordenar por calidad
        nodos.sort((a, b) => (b.quality?.quality || 0) - (a.quality?.quality || 0));

        for (let nodo of nodos) {
            if (aprobados >= 30) break; // Mostramos maximo los 30 mejores limpios

            let calidad = nodo.quality?.quality || 0;
            if (calidad < minCalidad || !nodo.provider_id) continue;

            let idCorto = nodo.provider_id.substring(0, 14);
            let ip = nodo.endpoint ? nodo.endpoint.split(':')[0] : null;
            
            if (!ip) continue;

            // PASAMOS LA IP Y NODO POR EL MOTOR
            if (verificarProximidad(ip, idCorto)) {
                let ciudad = nodo.location?.city || 'UK';
                let isp = nodo.location?.isp || 'ISP';
                
                tbody.innerHTML += `
                    <tr class="hover:bg-gray-700/50">
                        <td class="p-4 font-mono font-bold text-white uppercase">${idCorto}</td>
                        <td class="p-4 font-mono text-gray-300">${ip}</td>
                        <td class="p-4 text-gray-400">${ciudad} <span class="text-xs text-gray-500">(${isp})</span></td>
                        <td class="p-4 text-center">
                            <span class="bg-indigo-500/20 text-indigo-400 px-3 py-1 rounded-full text-xs font-black border border-indigo-500/30">${calidad.toFixed(2)}</span>
                        </td>
                    </tr>
                `;
                aprobados++;
            }
        }

        if (aprobados === 0) {
            tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-rose-400">Ningún nodo cumplió las reglas. Todos chocan con tus 27 cuentas actuales.</td></tr>`;
        }

    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="4" class="p-8 text-center text-rose-500 font-bold">Error conectando con la API de Mysterium.</td></tr>`;
    }
}

// --- BLACKLIST ---
function renderBlacklist() {
    const lista = document.getElementById('lista-blacklist');
    lista.innerHTML = '';
    blacklist.forEach((item, i) => {
        lista.innerHTML += `
            <li class="flex justify-between items-center bg-gray-800 p-4 rounded-xl border border-gray-700">
                <span class="font-mono text-rose-400 font-bold">${item}</span>
                <button onclick="quitarBlacklist(${i})" class="text-gray-500 hover:text-white">Perdonar</button>
            </li>
        `;
    });
}

function agregarBlacklist() {
    const val = document.getElementById('input-blacklist').value.trim();
    if (val && !blacklist.includes(val)) {
        blacklist.unshift(val);
        localStorage.setItem('motor_blacklist', JSON.stringify(blacklist));
        document.getElementById('input-blacklist').value = '';
        renderBlacklist();
    }
}

function quitarBlacklist(index) {
    blacklist.splice(index, 1);
    localStorage.setItem('motor_blacklist', JSON.stringify(blacklist));
    renderBlacklist();
}

// Iniciar aplicación
renderDashboard();
renderBlacklist();
