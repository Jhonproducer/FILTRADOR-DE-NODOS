const { createApp, ref, computed, watch, onMounted } = Vue;

const generateUid = () => Date.now().toString(36) + Math.random().toString(36).substring(2);

// Función auxiliar para pausar y evitar saturar la API
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

createApp({
    setup() {
        const currentTab = ref('iplookup'); // Nuevo tab por defecto
        const syncStatus = ref('');
        const bulkBlacklistText = ref('');
        
        // Estado del Módulo IP Lookup
        const lookupAccounts = ref([]);
        const isAnalyzingAll = ref(false);

        // Estado Módulo Pool / Blacklist
        const pool = ref([]);
        const blacklist = ref([]);
        const filters = ref({ nodeId: '', city: '', isp: '' });
        const sortDesc = ref(true); 
        const toggleSortScore = () => { sortDesc.value = !sortDesc.value; };

        const clearFilters = () => { 
            filters.value.nodeId = ''; 
            filters.value.city = ''; 
            filters.value.isp = ''; 
        };

        const filteredPool = computed(() => {
            let result = pool.value;
            result = result.filter(n => {
                const inBlacklist = blacklist.value.some(b => b.nodeId === n.id);
                return !inBlacklist;
            });
            if (filters.value.nodeId) result = result.filter(n => n.id.toLowerCase().includes(filters.value.nodeId.toLowerCase().trim()));
            if (filters.value.city) result = result.filter(n => (n.city || '').toLowerCase().includes(filters.value.city.toLowerCase().trim()));
            if (filters.value.isp) result = result.filter(n => (n.asn_isp || '').toLowerCase().includes(filters.value.isp.toLowerCase().trim()));
            
            return result.sort((a, b) => sortDesc.value ? b.q_score - a.q_score : a.q_score - b.q_score);
        });

        // ==========================================
        // 💾 SISTEMA DE GUARDADO
        // ==========================================
        const saveData = () => {
            localStorage.setItem('vpnerp_lookup_master', JSON.stringify(lookupAccounts.value));
            localStorage.setItem('vpnerp_pool_master_v14', JSON.stringify(pool.value));
            localStorage.setItem('vpnerp_blk_master_v14', JSON.stringify(blacklist.value));
        };

        const loadData = () => {
            let savedLookup = JSON.parse(localStorage.getItem('vpnerp_lookup_master'));
            let savedPool = JSON.parse(localStorage.getItem('vpnerp_pool_master_v14'));
            let savedBlk = JSON.parse(localStorage.getItem('vpnerp_blk_master_v14'));

            if (savedLookup && savedLookup.length > 0) {
                lookupAccounts.value = savedLookup;
            } else {
                // Crear 28 filas por defecto si está vacío
                const initial = [];
                for(let i = 1; i <= 28; i++) {
                    const num = i < 10 ? '0'+i : i;
                    initial.push({ uid: generateUid(), name: `LON-${num}`, nodeId: '', ip: '', analyzing: false, geo: null });
                }
                lookupAccounts.value = initial;
            }
            pool.value = savedPool || [];
            blacklist.value = savedBlk || [];
        };

        watch([lookupAccounts, pool, blacklist], saveData, { deep: true });

        // ==========================================
        // 🛰️ MOTOR DE INTELIGENCIA (IPINFO + NOMINATIM)
        // ==========================================
        const cleanIspName = (orgString) => {
            if(!orgString) return '-';
            // Quitar el "ASXXXXX " del inicio si existe
            return orgString.replace(/^AS\d+\s+/, '').trim();
        };

        const analyzeSingle = async (acc) => {
            if(!acc.ip || acc.ip.trim() === '') return;
            
            acc.analyzing = true;
            syncStatus.value = `Analizando IP: ${acc.ip}...`;

            try {
                // 1. IPInfo.io (Con tu API Key)
                const ipRes = await fetch(`https://ipinfo.io/${acc.ip.trim()}/json`, {
                    headers: { 'Authorization': 'Bearer 8c97cc52a98a48' }
                });
                
                if (!ipRes.ok) throw new Error("Error IPInfo");
                const ipData = await ipRes.json();

                let district = 'No detectado';
                let borough = 'No detectado';

                // 2. Extracción profunda satelital con OpenStreetMap (Gratuita)
                if(ipData.loc) {
                    const [lat, lng] = ipData.loc.split(',');
                    // Zoom 14 apunta al nivel de barrio/suburbio/distrito
                    const geoRes = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14`, {
                        headers: { 'Accept-Language': 'en' } // Pedir datos en inglés para coincidir con UK
                    });
                    
                    if(geoRes.ok) {
                        const geoData = await geoRes.json();
                        if(geoData && geoData.address) {
                            // Mapeo inteligente de jerarquías de UK
                            district = geoData.address.city_district || geoData.address.suburb || geoData.address.neighbourhood || geoData.address.village || 'No detectado';
                            borough = geoData.address.borough || geoData.address.county || geoData.address.state_district || 'No detectado';
                        }
                    }
                }

                // 3. Cálculo de Subred (/24)
                const octets = acc.ip.trim().split('.');
                const subnet = octets.length === 4 ? `${octets[0]}.${octets[1]}.${octets[2]}.x` : 'Inválida';

                // 4. Guardar Data
                acc.geo = {
                    isp: cleanIspName(ipData.org || ipData.asn?.name),
                    city: ipData.city || 'Desconocida',
                    district: district,
                    borough: borough,
                    subnet: subnet
                };

                syncStatus.value = `¡${acc.ip} Analizada!`;

            } catch (err) {
                console.error(err);
                syncStatus.value = `Error analizando ${acc.ip}`;
                acc.geo = { isp: 'Error API', city: '-', district: '-', borough: '-', subnet: '-' };
            }
            
            acc.analyzing = false;
            setTimeout(() => { syncStatus.value = ''; }, 3000);
        };

        const analyzeAll = async () => {
            isAnalyzingAll.value = true;
            syncStatus.value = 'Iniciando escaneo masivo...';

            const toAnalyze = lookupAccounts.value.filter(a => a.ip && a.ip.trim() !== '');
            
            for (let i = 0; i < toAnalyze.length; i++) {
                await analyzeSingle(toAnalyze[i]);
                // Esperamos 1.5 segundos entre cada consulta a Nominatim para evitar ban de la API satelital (es gratuita y limita a 1req/s)
                if (i < toAnalyze.length - 1) {
                    await sleep(1500); 
                }
            }

            isAnalyzingAll.value = false;
            syncStatus.value = '¡Análisis de red completado!';
            setTimeout(() => { syncStatus.value = ''; }, 4000);
        };

        // ==========================================
        // 🚨 RADAR DE CHOQUES Y PROXIMIDAD
        // ==========================================
        const hasSubnetCollision = (acc) => {
            if(!acc.geo || !acc.geo.subnet || acc.geo.subnet === 'Inválida' || acc.geo.subnet === '-') return false;
            return lookupAccounts.value.some(other => 
                other.uid !== acc.uid && 
                other.geo && 
                other.geo.subnet === acc.geo.subnet
            );
        };

        const hasIspCollision = (acc) => {
            if(!acc.geo || !acc.geo.isp || acc.geo.isp === '-' || acc.geo.isp === 'Error API') return false;
            return lookupAccounts.value.some(other => 
                other.uid !== acc.uid && 
                other.geo && 
                other.geo.isp === acc.geo.isp
            );
        };

        // ==========================================
        // MÉTODOS DE LA TABLA
        // ==========================================
        const addLookupRow = () => {
            const num = lookupAccounts.value.length + 1;
            lookupAccounts.value.push({ uid: generateUid(), name: `LON-${num < 10 ? '0'+num : num}`, nodeId: '', ip: '', analyzing: false, geo: null });
        };
        const removeLookupRow = (uid) => { if(confirm("¿Eliminar fila?")) lookupAccounts.value = lookupAccounts.value.filter(a => a.uid !== uid); };


        // ==========================================
        // LOGICA DE POOL Y BLACKLIST ORIGINAL MANTENIDA
        // ==========================================
        const burnDirectlyFromPool = (node) => {
            if(node && node.id) {
                if(!blacklist.value.some(b => b.nodeId === node.id)) {
                    blacklist.value.unshift({ nodeId: node.id, ip: 'Quemado desde Pool' });
                }
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

        const processNodeData = (data) => {
            const rawPool = [];
            const seenIds = new Set(); 
            data.forEach(nodo => {
                if (nodo.service_type !== "wireguard" || !nodo.provider_id) return;
                
                const idCorto = nodo.provider_id.substring(0, 14);
                if(seenIds.has(idCorto)) return;
                
                const isBlacklisted = blacklist.value.some(b => b.nodeId === idCorto);
                
                if (!isBlacklisted) {
                    seenIds.add(idCorto);
                    rawPool.push({
                        id: idCorto,
                        city: nodo.location?.city || 'N/A',
                        asn_isp: `${nodo.location?.asn || ''} - ${nodo.location?.isp || 'N/A'}`,
                        q_score: (nodo.quality?.quality || 0).toFixed(2)
                    });
                }
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
                    const res = await fetch(attempt.url, { 
                        headers: { 'Accept': 'application/json' },
                        cache: 'no-store'
                    });
                    
                    if (res.ok) {
                        const text = await res.text();
                        try {
                            const parsed = JSON.parse(text);
                            if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].provider_id) {
                                data = parsed;
                                console.log(`¡Éxito usando: ${attempt.name}!`);
                                break; 
                            }
                        } catch (err) { }
                    }
                } catch (e) { }
            }

            if (data && Array.isArray(data)) {
                processNodeData(data);
            } else {
                alert("🚫 BLOQUEO SEVERO CORS DETECTADO\n\nPor favor, usa tu consola (curl ... > nodos.json) y súbelo usando el botón 'Importar JSON'.");
                syncStatus.value = 'Error de conexión.';
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

        const copyToClipboard = async (text, type = 'Dato') => {
            try { 
                await navigator.clipboard.writeText(text); 
                showStatus(`¡${type} Copiado!`); 
                setTimeout(() => { syncStatus.value = ''; }, 3000);
            } catch (err) { console.error(err); }
        };

        const exportDatabase = () => {
            const dataStr = JSON.stringify({ lookupAccounts: lookupAccounts.value, pool: pool.value, blacklist: blacklist.value }, null, 2);
            const blob = new Blob([dataStr], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `VPN_Radar_Respaldo_${new Date().toISOString().slice(0,10)}.json`;
            a.click();
        };

        const showStatus = (msg) => { syncStatus.value = msg; setTimeout(() => { syncStatus.value = ''; }, 3000); };
        
        onMounted(() => { loadData(); });

        return {
            currentTab, pool, blacklist, syncStatus, bulkBlacklistText, 
            filters, filteredPool, toggleSortScore, clearFilters, 
            burnDirectlyFromPool, processBulkBlacklist, removeBlacklistNode, 
            importPoolJSON, fetchAPI, copyToClipboard, exportDatabase,
            // Módulo Lookup
            lookupAccounts, isAnalyzingAll, addLookupRow, removeLookupRow, analyzeSingle, analyzeAll,
            hasSubnetCollision, hasIspCollision
        };
    },
    updated() { if(window.lucide) { lucide.createIcons(); } }
}).mount('#app');
