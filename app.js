const { createApp, ref, computed, watch, onMounted, nextTick } = Vue;

const generateUid = () => Date.now().toString(36) + Math.random().toString(36).substring(2);
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

createApp({
    setup() {
        const currentTab = ref('radar');
        const syncStatus = ref('');
        
        // Arrays principales
        const accounts = ref([]);
        const pool = ref([]);
        const blacklist = ref([]);

        // Textareas masivos
        const bulkImportText = ref('');
        const bulkBlacklistText = ref('');

        // ==========================================
        // 🚀 MÓDULO 1: RADAR E IP LOOKUP EN VIVO
        // ==========================================

        // 1. Procesador Masivo de Cuentas (Copia y Pega)
        const processBulkAccounts = async () => {
            if(!bulkImportText.value.trim()) return;
            const lines = bulkImportText.value.trim().split('\n');
            
            for (let line of lines) {
                if (!line.trim()) continue;
                // Detecta espacios múltiples, tabulaciones o comas
                const parts = line.trim().split(/[\t,]+|\s{2,}/);
                
                let name = '', nodeId = '', ip = '';
                
                if (parts.length >= 3) {
                    name = parts[0].trim();
                    nodeId = parts[1].trim().substring(0, 14);
                    ip = parts[2].trim();
                } else {
                    // Si pegaron con un solo espacio separador
                    const spaceParts = line.trim().split(' ');
                    name = spaceParts[0] || '';
                    nodeId = spaceParts.length > 1 ? spaceParts[1].substring(0, 14) : '';
                    ip = spaceParts.length > 2 ? spaceParts[2] : '';
                }

                // Si ya existe la actualiza, si no la crea
                let existing = accounts.value.find(a => a.name === name);
                if (existing) {
                    existing.nodeId = nodeId;
                    if(existing.ip !== ip) {
                        existing.ip = ip;
                        existing.isp = ''; // Reseteamos info vieja
                        existing.district = '';
                    }
                } else {
                    accounts.value.push({ 
                        uid: generateUid(), name, nodeId, ip, 
                        isp: '', city: '', borough: '', district: '', loc: '', subnet: '', loading: false 
                    });
                }
            }
            
            bulkImportText.value = '';
            saveData();
            
            // Dispara el satélite (APIs) en segundo plano
            enrichAllAccounts();
        };

        // 2. Disparador en Cola para las APIs (Respeta rate limits)
        const enrichAllAccounts = async () => {
            for (let acc of accounts.value) {
                // Solo investiga las que tienen IP y les falta el ISP o el Distrito
                if (acc.ip && (!acc.isp || !acc.district)) {
                    await enrichSingleAccount(acc);
                    await sleep(600); // 600ms para no saturar a Nominatim OpenStreetMap
                }
            }
        };

        // Cuando editas una IP a mano en la tabla, re-investiga solo esa
        const reEnrichAccount = (acc) => {
            acc.isp = ''; acc.district = ''; acc.borough = ''; acc.city = ''; acc.subnet = '';
            saveData();
            enrichSingleAccount(acc);
        };

        // 3. LA MAGIA DE INGENIERÍA: IPInfo + OpenStreetMap (Nominatim)
        const enrichSingleAccount = async (acc) => {
            acc.loading = true;
            try {
                // PRIMER PASO: Tu API de IPInfo (Exactamente tu curl)
                let ipData = null;
                try {
                    const ipRes = await fetch(`https://api.ipinfo.io/lite/${acc.ip}`, {
                        headers: { 'Authorization': 'Bearer 8c97cc52a98a48', 'Accept': 'application/json' }
                    });
                    if(ipRes.ok) ipData = await ipRes.json();
                } catch(e) {}

                // Respaldo de ipinfo por si acaso "lite" falla
                if(!ipData) {
                    const ipResFall = await fetch(`https://ipinfo.io/${acc.ip}/json?token=8c97cc52a98a48`);
                    if(ipResFall.ok) ipData = await ipResFall.json();
                }

                if(ipData) {
                    // Limpia el ASN+ISP (ej: "AS1234 British Telecommunications" -> "BT")
                    acc.isp = ipData.org || ipData.asn || 'Desconocido';
                    // Extrae Subred /24
                    const ipParts = acc.ip.split('.');
                    acc.subnet = ipParts.length === 4 ? `${ipParts[0]}.${ipParts[1]}.${ipParts[2]}.x` : '';
                    
                    // SEGUNDO PASO: Si hay coordenadas, llamamos al Satélite Público para el County/Borough
                    if (ipData.loc) {
                        const [lat, lon] = ipData.loc.split(',');
                        // API gratuita de Geocodificación inversa
                        const nomRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lon}&zoom=14`);
                        if (nomRes.ok) {
                            const nomData = await nomRes.json();
                            const addr = nomData.address || {};
                            
                            // Mapeo inteligente sin inventar nada
                            acc.district = addr.suburb || addr.neighbourhood || addr.city_district || addr.quarter || '';
                            acc.borough = addr.borough || addr.county || addr.state_district || '';
                            acc.city = addr.city || addr.town || addr.village || ipData.city || '';
                        }
                    } else {
                        acc.city = ipData.city || '';
                    }
                }
            } catch (err) {
                console.error("Error en radar para IP:", acc.ip, err);
            }
            acc.loading = false;
            saveData();
        };

        // 4. EL RADAR DE RIESGO TÁCTICO (Cálculo en vivo)
        const analyzedAccounts = computed(() => {
            return accounts.value.map((acc, index, arr) => {
                let warnings = [];
                let isCollision = false;

                // Regla 1: Choque EXACTO Crítico (Mismo Nodo o Misma IP en otra cuenta)
                const hasExactCollision = arr.some(other => 
                    other.uid !== acc.uid && 
                    ( (other.nodeId && other.nodeId === acc.nodeId) || (other.ip && other.ip === acc.ip) )
                );
                
                if (hasExactCollision && (acc.nodeId || acc.ip)) {
                    isCollision = true;
                }

                // Regla 2: Proximidad de Subred /24 (Peligroso si están vivas al mismo tiempo)
                const sameSubnetCount = arr.filter(other => other.uid !== acc.uid && other.subnet && other.subnet === acc.subnet).length;
                if (sameSubnetCount > 0 && !isCollision && acc.subnet) {
                    warnings.push(`Comparte Subred con ${sameSubnetCount} cta(s)`);
                }

                // Regla 3: Rotación de ISP Sospechosa (Si la cuenta INMEDIATAMENTE ANTERIOR tiene el mismo proveedor)
                if (index > 0 && acc.isp && arr[index-1].isp && !isCollision) {
                    // Extrae la palabra principal del ISP para comparar
                    const getCoreISP = (ispStr) => ispStr.toLowerCase().split(' ').pop();
                    if (getCoreISP(acc.isp) === getCoreISP(arr[index-1].isp) && getCoreISP(acc.isp) !== 'desconocido') {
                        warnings.push(`ISP Secuencial idéntico al anterior`);
                    }
                }

                return { ...acc, warnings, isCollision };
            });
        });

        // Contadores del Dashboard
        const totalCollisions = computed(() => analyzedAccounts.value.filter(a => a.isCollision).length);
        const totalWarnings = computed(() => analyzedAccounts.value.reduce((acc, curr) => acc + curr.warnings.length, 0));

        const clearAccounts = () => {
            if(confirm("¿Borrar toda la tabla del radar?")) accounts.value = [];
        };

        // ==========================================
        // 💾 PERSISTENCIA DE DATOS
        // ==========================================
        const saveData = () => {
            localStorage.setItem('vpnerp_v15_acc', JSON.stringify(accounts.value));
            localStorage.setItem('vpnerp_v15_pool', JSON.stringify(pool.value));
            localStorage.setItem('vpnerp_v15_blk', JSON.stringify(blacklist.value));
        };

        const loadData = () => {
            let savedAcc = JSON.parse(localStorage.getItem('vpnerp_v15_acc'));
            let savedPool = JSON.parse(localStorage.getItem('vpnerp_v15_pool'));
            let savedBlk = JSON.parse(localStorage.getItem('vpnerp_v15_blk'));

            if (savedAcc && savedAcc.length > 0) {
                accounts.value = savedAcc.map(a => ({ ...a, loading: false }));
            }
            pool.value = savedPool || [];
            blacklist.value = savedBlk || [];
        };

        watch([accounts, pool, blacklist], saveData, { deep: true });


        // ==========================================
        // 🔒 MÓDULOS DE RESERVA Y BLOQUEADOS (Simples y conservados)
        // ==========================================
        
        const burnDirectlyFromPool = (node) => {
            if(node && node.id && !blacklist.value.some(b => b.nodeId === node.id)) {
                blacklist.value.unshift({ nodeId: node.id, ip: 'Quemado desde Pool' });
                pool.value = pool.value.filter(n => n.id !== node.id);
            }
        };

        const processBulkBlacklist = () => {
            if(!bulkBlacklistText.value.trim()) return;
            const rawItems = bulkBlacklistText.value.split(/[\n,\s]+/);
            rawItems.forEach(item => {
                const limpio = item.trim();
                if(limpio.length >= 10) { 
                    const truncado = limpio.substring(0, 14); 
                    if(!blacklist.value.some(b => b.nodeId === truncado)) {
                        blacklist.value.unshift({ nodeId: truncado, ip: 'Carga Masiva' });
                    }
                }
            });
            bulkBlacklistText.value = ''; 
        };

        const removeBlacklistNode = (index) => { blacklist.value.splice(index, 1); };

        const importPoolJSON = (event) => {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    const rawPool = [];
                    const seenIds = new Set(); 
                    data.forEach(nodo => {
                        if (nodo.service_type !== "wireguard" || !nodo.provider_id) return;
                        const idCorto = nodo.provider_id.substring(0, 14);
                        if(seenIds.has(idCorto) || blacklist.value.some(b => b.nodeId === idCorto)) return;
                        seenIds.add(idCorto);
                        rawPool.push({
                            id: idCorto,
                            city: nodo.location?.city || 'N/A',
                            asn_isp: `${nodo.location?.asn || ''} - ${nodo.location?.isp || 'N/A'}`
                        });
                    });
                    pool.value = rawPool;
                    showStatus(`Reserva Actualizada: ${pool.value.length} nodos`);
                    event.target.value = null; 
                } catch (err) { alert("Error JSON."); event.target.value = null; }
            };
            reader.readAsText(file);
        };

        const exportDatabase = () => {
            const dataStr = JSON.stringify({ accounts: accounts.value, pool: pool.value, blacklist: blacklist.value }, null, 2);
            const blob = new Blob([dataStr], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `VPN_Radar_Export_${new Date().toISOString().slice(0,10)}.json`;
            a.click();
        };

        const restoreBackup = (event) => {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    if(data.accounts) accounts.value = data.accounts;
                    if(data.pool) pool.value = data.pool;
                    if(data.blacklist) blacklist.value = data.blacklist;
                    showStatus('¡Base Restaurada!');
                    event.target.value = null;
                } catch (err) {
                    alert("Archivo inválido.");
                    event.target.value = null;
                }
            };
            reader.readAsText(file);
        };

        const showStatus = (msg) => { syncStatus.value = msg; setTimeout(() => { syncStatus.value = ''; }, 3000); };
        
        onMounted(() => { loadData(); });

        return {
            currentTab, accounts, pool, blacklist, syncStatus, bulkImportText, bulkBlacklistText, 
            processBulkAccounts, reEnrichAccount, clearAccounts, analyzedAccounts,
            totalCollisions, totalWarnings,
            burnDirectlyFromPool, processBulkBlacklist, removeBlacklistNode, importPoolJSON,
            exportDatabase, restoreBackup, saveData
        };
    },
    updated() { if(window.lucide) { lucide.createIcons(); } }
}).mount('#app');
