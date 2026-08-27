// --- CONFIGURACIÓN INICIAL ---
const IPINFO_TOKEN = "8c97cc52a98a48"; 
let accounts = JSON.parse(localStorage.getItem('node_accounts')) || generateInitialAccounts();
let blacklist = JSON.parse(localStorage.getItem('node_blacklist')) || [];

// Generar lon-01 a lon-27 si es la primera vez
function generateInitialAccounts() {
    let accs = [];
    for (let i = 1; i <= 27; i++) {
        let name = "lon-" + String(i).padStart(2, '0');
        accs.push({ id: name, nodeId: "Sin Asignar", ip: "0.0.0.0", location: "Desconocida" });
    }
    return accs;
}

// Guardar en LocalStorage
function saveData() {
    localStorage.setItem('node_accounts', JSON.stringify(accounts));
    localStorage.setItem('node_blacklist', JSON.stringify(blacklist));
    renderAccounts();
    renderBlacklist();
}

// Navegación de pestañas
function showTab(tabId) {
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    document.getElementById(tabId).classList.add('active');
}

// --- RENDERIZAR CUENTAS ---
function renderAccounts() {
    const grid = document.getElementById('accountsGrid');
    grid.innerHTML = '';
    accounts.forEach(acc => {
        grid.innerHTML += `
            <div class="account-card">
                <h3>${acc.id}</h3>
                <p>Nodo ID: <span class="data">${acc.nodeId}</span></p>
                <p>IP: <span class="data">${acc.ip}</span></p>
                <p>Ubicación: <span>${acc.location}</span></p>
                <button onclick="liberarCuenta('${acc.id}')">Liberar / Quemar Nodo</button>
            </div>
        `;
    });
}

function liberarCuenta(accountId) {
    let acc = accounts.find(a => a.id === accountId);
    if(confirm(`¿Deseas desechar el nodo de ${accountId} y enviarlo a la blacklist?`)) {
        if(acc.nodeId !== "Sin Asignar") {
            blacklist.push(acc.nodeId);
            blacklist.push(acc.ip);
        }
        acc.nodeId = "Sin Asignar";
        acc.ip = "0.0.0.0";
        acc.location = "Desconocida";
        saveData();
    }
}

// --- LÓGICA DE PROXIMIDAD DE IP ---
function verificarProximidadIP(nuevaIp) {
    let octetosNueva = nuevaIp.split('.');
    
    // 1. Verificar Blacklist
    if (blacklist.includes(nuevaIp)) return { valid: false, msg: "IP está en la Blacklist." };

    // 2. Verificar choques con otras cuentas
    for (let acc of accounts) {
        if (acc.ip === "0.0.0.0") continue;
        
        let octetosAcc = acc.ip.split('.');
        
        // Mismo bloque /24 (3 primeros octetos iguales) - RECHAZO TOTAL
        if (octetosNueva[0] === octetosAcc[0] && 
            octetosNueva[1] === octetosAcc[1] && 
            octetosNueva[2] === octetosAcc[2]) {
            return { valid: false, msg: `Choque crítico (/24) con la cuenta ${acc.id}. ¡Muy cerca!` };
        }
    }
    return { valid: true, msg: "IP Limpia y Distanciada" };
}

// --- MÓDULO POOL Y MYSTERIUM ---
async function fetchMysteriumNodes() {
    const tbody = document.getElementById('poolBody');
    tbody.innerHTML = '<tr><td colspan="5">Buscando y triangulando nodos...</td></tr>';
    
    const qualityMin = parseFloat(document.getElementById('qualityFilter').value);
    
    // Usamos AllOrigins como proxy CORS
    const url = encodeURIComponent(`https://discovery.mysterium.network/api/v3/proposals?location_country=GB&ip_type=residential`);
    const proxyUrl = `https://api.allorigins.win/get?url=${url}`;

    try {
        const res = await fetch(proxyUrl);
        const data = await res.json();
        const proposals = JSON.parse(data.contents); 
        
        tbody.innerHTML = '';
        let validos = 0;

        for (let p of proposals) {
            if (validos >= 15) break; // Límite para no saturar la API al buscar
            
            if (p.quality >= qualityMin && p.provider_id) {
                let idCorto = p.provider_id.substring(0, 14);
                let ip = p.endpoint ? p.endpoint.split(':')[0] : "Sin IP"; 
                
                // Si la IP o ID están en blacklist, saltar
                if(blacklist.includes(idCorto) || blacklist.includes(ip)) continue;

                // Validación de proximidad
                let ipCheck = verificarProximidadIP(ip);
                if (!ipCheck.valid) continue; 

                // Añadir a la tabla con botón para triangular
                tbody.innerHTML += `
                    <tr id="row-${idCorto}">
                        <td style="font-family: monospace;">${idCorto}</td>
                        <td>${ip}</td>
                        <td>${p.quality}</td>
                        <td id="loc-${idCorto}"><button onclick="triangularIP('${ip}', '${idCorto}')">🗺️ Triangular Datos</button></td>
                        <td><button onclick="asignarACuenta('${idCorto}', '${ip}')">Asignar a Cuenta</button></td>
                    </tr>
                `;
                validos++;
            }
        }
        if(validos === 0) tbody.innerHTML = '<tr><td colspan="5">No se encontraron nodos que cumplan tus reglas de IP/Calidad.</td></tr>';
    } catch (error) {
        tbody.innerHTML = `<tr><td colspan="5" style="color:red;">Error de conexión: ${error.message}</td></tr>`;
    }
}

// --- TRIANGULACIÓN (IPInfo + Nominatim) ---
async function triangularIP(ip, idCorto) {
    const tdLoc = document.getElementById(`loc-${idCorto}`);
    tdLoc.innerHTML = "Consultando...";
    
    try {
        // 1. Obtener Lat/Lon de IPInfo
        const resIp = await fetch(`https://api.ipinfo.io/lite/${ip}`, {
            headers: { 'Authorization': `Bearer ${IPINFO_TOKEN}` }
        });
        const dataIp = await resIp.json();
        
        if (!dataIp.loc) throw new Error("Sin coordenadas");
        const [lat, lon] = dataIp.loc.split(',');

        // 2. Triangular con OpenStreetMap (Nominatim)
        const resNom = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}`);
        const dataNom = await resNom.json();
        
        let district = dataNom.address.city_district || dataNom.address.suburb || dataNom.address.county || "";
        let borough = dataNom.address.borough || dataNom.address.city || dataIp.city;
        
        let locationFinal = `${district}, ${borough}`.replace(/^, | ,/g, '').trim();
        tdLoc.innerHTML = locationFinal;
        tdLoc.dataset.loc = locationFinal; 

    } catch (e) {
        tdLoc.innerHTML = "Error al triangular";
        tdLoc.dataset.loc = "Solo IP";
    }
}

// --- ASIGNAR NODO A CUENTA ---
function asignarACuenta(nodeId, ip) {
    let location = document.getElementById(`loc-${nodeId}`).dataset.loc || "Triangulación pendiente";
    
    // Buscar la primera cuenta vacía
    let cuentaLibre = accounts.find(a => a.nodeId === "Sin Asignar");
    if (!cuentaLibre) {
        alert("¡No tienes cuentas libres! Ve a 'Mis Cuentas' y libera una.");
        return;
    }

    cuentaLibre.nodeId = nodeId;
    cuentaLibre.ip = ip;
    cuentaLibre.location = location;
    saveData();
    alert(`Asignado exitosamente a ${cuentaLibre.id}`);
    
    // Quitar de la tabla visualmente
    document.getElementById(`row-${nodeId}`).remove();
}

// --- MÓDULO BLACKLIST ---
function renderBlacklist() {
    const ul = document.getElementById('blacklistUl');
    ul.innerHTML = '';
    blacklist.forEach((item, index) => {
        ul.innerHTML += `<li>${item} <button style="background: #ff4c4c; padding: 5px 10px;" onclick="quitarBlacklist(${index})">Eliminar</button></li>`;
    });
}
function addToBlacklist() {
    const val = document.getElementById('newBlacklist').value.trim();
    if (val && !blacklist.includes(val)) {
        blacklist.push(val);
        document.getElementById('newBlacklist').value = '';
        saveData();
    }
}
function quitarBlacklist(index) {
    blacklist.splice(index, 1);
    saveData();
}

// --- JSON IMPORT/EXPORT ---
function exportJSON() {
    const dataStr = JSON.stringify({ accounts, blacklist }, null, 2);
    const blob = new Blob([dataStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = "node_backup.json";
    a.click();
}

function importJSON() {
    const file = document.getElementById('importFile').files[0];
    if (!file) return alert("Selecciona un archivo");
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const data = JSON.parse(e.target.result);
            if (data.accounts && data.blacklist) {
                accounts = data.accounts;
                blacklist = data.blacklist;
                saveData();
                alert("Respaldo restaurado con éxito.");
            } else {
                alert("El archivo JSON no tiene el formato correcto.");
            }
        } catch(err) {
            alert("Error leyendo el archivo.");
        }
    };
    reader.readAsText(file);
}

// Inicializar
renderAccounts();
renderBlacklist();
