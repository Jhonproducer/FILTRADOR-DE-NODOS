const { createApp, ref, computed, watch, onMounted } = Vue;

const generateUid = () => Date.now().toString(36) + Math.random().toString(36).substring(2);

createApp({
    setup() {
        const currentTab = ref('analyzer');
        const syncStatus = ref('');
        const bulkBlacklistText = ref('');
        const bulkInput = ref('');
        const isAnalyzing = ref(false);
        
        // Data Principal
        const accounts = ref([]);
        const pool = ref([]);
        const blacklist = ref([]);

        // ==========================================
        // 🧩 MÓDULO 1: ANALIZADOR DE INTELIGENCIA IP
        // ==========================================

        // Procesa el texto pegado usando Regex Inteligente
        const processBulkInput = () => {
            if(!bulkInput.value.trim()) return;
            const lines = bulkInput.value.split('\n');
            let added = 0;

            lines.forEach(line => {
                // Busca una IP
                const ipMatch = line.match(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/);
                // Busca un Nodo (14 chars alfanuméricos después de 0x, o sueltos)
                let nodeMatch = line.match(/\b0x[a-fA-F0-9]{12}\b/i) || line.match(/\b[a-zA-Z0-9]{14}\b/);
                // Busca el nombre de la cuenta (Ej: LON-01)
                const accMatch = line.match(/(LON-\d+)/i) || line.match(/\b(C-\d+)\b/i);

                if (ipMatch || nodeMatch || accMatch) {
                    let finalNode = nodeMatch ? nodeMatch[0].toLowerCase() : '';
                    if(finalNode.length > 14) finalNode = finalNode.substring(0, 14); // Normalizar a 14

                    accounts.value.push({
                        uid: generateUid(),
                        name: accMatch ? accMatch[0].toUpperCase() : `ACC-${accounts.value.length + 1}`,
                        nodeId: finalNode,
                        ip: ipMatch ? ipMatch[0] : '',
                        subnet: '',
                        isp: '',
                        city: '',
                        district: '',
                        county: '',
                        analyzed: false,
                        loading: false
                    });
                    added++;
                }
            });

            bulkInput.value = '';
            showStatus(`${added} filas cargadas. Listo para escanear.`);
        };

        const clearAnalyzer = () => {
            if(confirm("¿Borrar todos los datos del analizador?")) {
                accounts.value = [];
            }
        };

        // Reglas de Detección de Riesgos
        const hasCollision = (acc) => {
            if (!acc.ip && !acc.nodeId) return false;
            return accounts.value.some(other => {
                if (other.uid === acc.uid) return false;
                const matchIp = acc.ip && other.ip && acc.ip === other.ip;
                const matchNode = acc.nodeId && other.nodeId && acc.nodeId === other.nodeId;
                return matchIp || matchNode;
            });
        };

        const hasRangeProximity = (acc) => {
            if (!acc.subnet || !acc.analyzed) return false;
            return accounts.value.some(other => {
                if (other.uid === acc.uid || !other.analyzed) return false;
                return acc.subnet === other.subnet;
            });
        };

        const collisionCount = computed(() => accounts.value.filter(a => hasCollision(a)).length);
        const rangeWarningCount = computed(() => accounts.value.filter(a => !hasCollision(a) && hasRangeProximity(a)).length);

        // MOTOR DE ESCANEO PROFUNDO (ipinfo + Nominatim)
        const analyzeAll = async () => {
            isAnalyzing.value = true;
            
            for (let i = 0; i < accounts.value.length; i++) {
                const acc = accounts.value[i];
                if (!acc.ip || acc.analyzed) continue;
                
                acc.loading = true;
                syncStatus.value = `Analizando IP ${i+1}/${accounts.value.length}...`;

                try {
                    // 1. Llamada a ipinfo.io (Tu API con token)
                    const ipRes = await fetch(`https://ipinfo.io/${acc.ip}/json`, {
                        headers: { 'Authorization': 'Bearer 8c97cc52a98a48' }
                    });
                    const ipData = await ipRes.json();

                    acc.isp = ipData.org || 'ISP Desconocido';
                    acc.city = ipData.city || '';
                    acc.subnet = acc.ip.split('.').slice(0,3).join('.') + '.0/24';

                    // 2. Triangulación Inversa (Satelital) via OpenStreetMap (Nominatim)
                    if (ipData.loc) {
                        const [lat, lon] = ipData.loc.split(',');
                        
                        // Retraso intencional de 800ms para no saturar la API pública de Nominatim (anti-baneo)
                        await new Promise(r => setTimeout(r, 800));
                        
                        const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&accept-language=en`, {
                            headers: { 'User-Agent': 'VPN-GeoIntelligence/1.0' }
                        });
                        const geoData = await geoRes.json();

                        if (geoData && geoData.address) {
                            acc.county = geoData.address.county || geoData.address.state_district || '';
                            acc.district = geoData.address.borough || geoData.address.city_district || geoData.address.suburb || '';
                            if (!acc.city) acc.city = geoData.address.city || geoData.address.town || '';
                        }
                    }
                    acc.analyzed = true;

                } catch (err) {
                    console.error(`Error escaneando ${acc.ip}:`, err);
                } finally {
                    acc.loading = false;
                }
            }

            isAnalyzing.value = false;
            showStatus('¡Escaneo Profundo Completado!');
        };


        // ==========================================
        // 🧩 MÓDULO 2: POOL DE NODOS (CASCADA 5 CAPAS INTACTA)
        // ==========================================
        const filters = ref({ nodeId: '', city: '', isp: '', minQuality: '' });
        const clearFilters = () => { filters.value.nodeId = ''; filters.value.city = ''; filters.value.isp = ''; filters.value.minQuality = ''; };

        const filteredPool = computed(() => {
            let result = pool.value;
            result = result.filter(n => !blacklist.value.some(b => b.nodeId === n.id));
            
            if (filters.value.nodeId) {
                const s = filters.value.nodeId.toLowerCase().trim();
                result = result.filter(n => n.id.toLowerCase().includes(s));
            }
            if (filters.value.city) {
                const c = filters.value.city.toLowerCase().trim();
                result = result.filter(n => (n.city || '').toLowerCase().includes(c));
            }
            if (filters.value.isp) {
                const i = filters.value.isp.toLowerCase().trim();
                result = result.filter(n => (n.asn_isp || '').toLowerCase().includes(i));
            }
            return result.sort((a, b) => b.q_score - a.q_score);
        });

        const processNodeData = (data) => {
            const rawPool = [];
            const seenIds = new Set(); 
            data.forEach(nodo => {
                if (nodo.service_type !== "wireguard" || !nodo.provider_id) return;
                const idCorto = nodo.provider_id.substring(0, 14);
                if(seenIds.has(idCorto)) return;
                
                seenIds.add(idCorto);
                rawPool.push({
                    id: idCorto,
                    city: nodo.location?.city || 'N/A',
                    asn_isp: `${nodo.location?.asn || ''} - ${nodo.location?.isp || 'N/A'}`,
                    q_score: (nodo.quality?.quality || 0).toFixed(2)
                });
            });
            pool.value = rawPool.sort((a, b) => b.q_score - a.q_score);
            showStatus(`Pool Actualizado: ${pool.value.length} nodos guardados`);
        };

        const fetchAPI = async () => {
            syncStatus.value = 'Conectando a Mysterium...';
            const targetUrl = "https://discovery.mysterium.network/api/v3/proposals?location_country=GB&ip_type=residential";
            let data = null;

            const attempts = [
                { name: 'Directo', url: targetUrl },
                { name: 'Proxy 1 (CORS Proxy)', url: `https://corsproxy.io/?${encodeURIComponent(targetUrl)}` },
                { name: 'Proxy 2 (AllOrigins)', url: `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}` },
                { name: 'Proxy 3 (ThingProxy)', url: `https://thingproxy.freeboard.io/fetch/${targetUrl}` },
                { name: 'Proxy 4 (CodeTabs)', url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}` }
            ];

            for (let attempt of attempts) {
                syncStatus.value = `Intentando: ${attempt.name}...`;
                try {
                    const res = await fetch(attempt.url, { headers: { 'Accept': 'application/json' }, cache: 'no-store' });
                    if (res.ok) {
                        const text = await res.text();
                        try {
                            const parsed = JSON.parse(text);
                            if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].provider_id) {
                                data = parsed;
                                break; 
                            }
                        } catch (err) { }
                    }
                } catch (e) { }
            }

            if (data && Array.isArray(data)) {
                processNodeData(data);
            } else {
                alert("🚫 BLOQUEO SEVERO CORS DETECTADO\n\nUsa tu comando en la consola (curl ... > nodos.json) y cárgalo usando el botón 'Importar JSON'.");
                syncStatus.value = 'Error.';
            }
        };

        const importPoolJSON = (event) => {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    processNodeData(data); 
                    event.target.value = null; 
                } catch (err) { alert("Error JSON."); event.target.value = null; }
            };
            reader.readAsText(file);
        };

        // ==========================================
        // 🧩 MÓDULO 3: BLOQUEADOS (INTACTO)
        // ==========================================
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


        // ==========================================
        // 💾 PERSISTENCIA Y UTILIDADES
        // ==========================================
        const saveData = () => {
            localStorage.setItem('vpnerp_intel_acc', JSON.stringify(accounts.value));
            localStorage.setItem('vpnerp_pool_master_v14', JSON.stringify(pool.value));
            localStorage.setItem('vpnerp_blk_master_v14', JSON.stringify(blacklist.value));
        };

        const loadData = () => {
            const savedAcc = JSON.parse(localStorage.getItem('vpnerp_intel_acc'));
            const savedPool = JSON.parse(localStorage.getItem('vpnerp_pool_master_v14'));
            const savedBlk = JSON.parse(localStorage.getItem('vpnerp_blk_master_v14'));

            if (savedAcc) accounts.value = savedAcc;
            if (savedPool) pool.value = savedPool;
            if (savedBlk) blacklist.value = savedBlk;
        };

        watch([accounts, pool, blacklist], saveData, { deep: true });

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
                    alert("El archivo de respaldo es inválido.");
                    event.target.value = null;
                }
            };
            reader.readAsText(file);
        };

        const exportDatabase = () => {
            const dataStr = JSON.stringify({ accounts: accounts.value, pool: pool.value, blacklist: blacklist.value }, null, 2);
            const blob = new Blob([dataStr], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `VPN_Intel_Backup_${new Date().toISOString().slice(0,10)}.json`;
            a.click();
        };

        const copyToClipboard = async (text, type = 'Dato') => {
            try { 
                await navigator.clipboard.writeText(text); 
                showStatus(`¡${type} Copiado!`); 
                setTimeout(() => { syncStatus.value = ''; }, 3000);
            } catch (err) { console.error(err); }
        };

        const showStatus = (msg) => { syncStatus.value = msg; setTimeout(() => { syncStatus.value = ''; }, 4000); };
        
        onMounted(() => { loadData(); });

        return {
            currentTab, accounts, pool, blacklist, syncStatus, bulkBlacklistText, 
            bulkInput, processBulkInput, analyzeAll, isAnalyzing, clearAnalyzer,
            collisionCount, rangeWarningCount, hasCollision, hasRangeProximity,
            filters, filteredPool, clearFilters, toggleSortScore,
            processBulkBlacklist, removeBlacklistNode, 
            importPoolJSON, fetchAPI, copyToClipboard, exportDatabase, restoreBackup
        };
    },
    updated() { if(window.lucide) { lucide.createIcons(); } }
}).mount('#app');
