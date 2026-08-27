const { createApp, ref, computed, watch, onMounted } = Vue;

const generateUid = () => Date.now().toString(36) + Math.random().toString(36).substring(2);

createApp({
    setup() {
        const currentTab = ref('accounts');
        const syncStatus = ref('');
        const bulkBlacklistText = ref('');
        
        const showPoolModal = ref(false);
        const selectedAccountUid = ref(null);

        const accounts = ref([]);
        const pool = ref([]);
        const blacklist = ref([]);

        // ==========================================
        // 💎 FILTRO ELITE (Top 5 UK) PARA EL POOL
        // ==========================================
        const TOP_ISPS = ['bt', 'sky', 'virgin', 'talktalk', 'vodafone'];
        const isTopISP = (ispString) => {
            if(!ispString) return false;
            const low = ispString.toLowerCase();
            return TOP_ISPS.some(t => low.includes(t));
        };

        const getIspName = (fullString) => {
            if(!fullString) return '';
            return fullString.split('-').pop().trim().toLowerCase();
        };

        const filters = ref({ nodeId: '', city: '', isp: '', minQuality: '', onlyTopISP: false });
        const sortDesc = ref(true); 
        const toggleSortScore = () => { sortDesc.value = !sortDesc.value; };
        
        const clearFilters = () => { 
            filters.value.nodeId = ''; 
            filters.value.city = ''; 
            filters.value.isp = ''; 
            filters.value.minQuality = ''; 
            filters.value.onlyTopISP = false;
        };

        const filteredPool = computed(() => {
            let result = pool.value;
            result = result.filter(n => {
                const inBlacklist = blacklist.value.some(b => b.nodeId === n.id);
                const inUse = accounts.value.some(a => (a.nodeId || '').trim() === n.id);
                return !inBlacklist && !inUse;
            });
            
            if (filters.value.onlyTopISP) {
                result = result.filter(n => isTopISP(n.asn_isp));
            }
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
            if (filters.value.minQuality) {
                const minQ = parseFloat(filters.value.minQuality);
                if (!isNaN(minQ)) {
                    result = result.filter(n => parseFloat(n.q_score) >= minQ);
                }
            }
            return result.sort((a, b) => sortDesc.value ? b.q_score - a.q_score : a.q_score - b.q_score);
        });

        // --- CUENTAS (Buscador/Sort) ---
        const accountSearch = ref('');
        const accountSort = ref({ field: null, desc: false });

        const toggleAccountSort = (field) => {
            if (accountSort.value.field === field) {
                accountSort.value.desc = !accountSort.value.desc;
            } else {
                accountSort.value.field = field;
                accountSort.value.desc = false;
            }
        };

        const processedAccounts = computed(() => {
            let result = accounts.value;
            if (accountSearch.value) {
                const s = accountSearch.value.toLowerCase().trim();
                result = result.filter(a => 
                    a.name.toLowerCase().includes(s) || 
                    (a.nodeId || '').toLowerCase().includes(s) || 
                    (a.ip || '').toLowerCase().includes(s) ||
                    (a.asn_isp || '').toLowerCase().includes(s) ||
                    (a.geo_isp || '').toLowerCase().includes(s)
                );
            }
            if (accountSort.value.field) {
                result = [...result].sort((a, b) => {
                    let valA = a[accountSort.value.field] || '';
                    let valB = b[accountSort.value.field] || '';
                    if (accountSort.value.field === 'q_score') {
                        valA = parseFloat(valA) || 0;
                        valB = parseFloat(valB) || 0;
                    }
                    if (valA < valB) return accountSort.value.desc ? 1 : -1;
                    if (valA > valB) return accountSort.value.desc ? -1 : 1;
                    return 0;
                });
            }
            return result;
        });

        const saveData = () => {
            localStorage.setItem('vpnerp_acc_master_v15', JSON.stringify(accounts.value));
            localStorage.setItem('vpnerp_pool_master_v15', JSON.stringify(pool.value));
            localStorage.setItem('vpnerp_blk_master_v15', JSON.stringify(blacklist.value));
        };

        const loadData = () => {
            let savedAcc = JSON.parse(localStorage.getItem('vpnerp_acc_master_v15'));
            let savedPool = JSON.parse(localStorage.getItem('vpnerp_pool_master_v15'));
            let savedBlk = JSON.parse(localStorage.getItem('vpnerp_blk_master_v15'));

            if (!savedAcc || savedAcc.length === 0) {
                const oldKeys = ['v14', 'v13', 'v12', 'v11'];
                for (let v of oldKeys) {
                    let oldAcc = JSON.parse(localStorage.getItem(`vpnerp_acc_master_${v}`));
                    if (oldAcc && oldAcc.length > 0) {
                        savedAcc = oldAcc;
                        savedPool = JSON.parse(localStorage.getItem(`vpnerp_pool_master_${v}`));
                        savedBlk = JSON.parse(localStorage.getItem(`vpnerp_blk_master_${v}`));
                        break;
                    }
                }
            }

            if (savedAcc && savedAcc.length > 0) {
                accounts.value = savedAcc.map(a => ({ 
                    ...a, 
                    uid: a.uid || generateUid(),
                    geo_city: a.geo_city || '',
                    geo_region: a.geo_region || '',
                    geo_postal: a.geo_postal || '',
                    geo_isp: a.geo_isp || ''
                }));
            } else {
                const initial = [];
                for(let i = 1; i <= 27; i++) {
                    const num = i < 10 ? '0'+i : i;
                    initial.push({ uid: generateUid(), name: `LON-${num}`, nodeId: '', ip: '', q_score: '', asn_isp: '', geo_city: '', geo_region: '', geo_postal: '', geo_isp: '' });
                }
                accounts.value = initial;
            }
            pool.value = savedPool || [];
            blacklist.value = savedBlk || [];
        };

        watch([accounts, pool, blacklist], saveData, { deep: true });

        // ==========================================
        // ⚡ API IPINFO ENRIQUECIMIENTO DE RED
        // ==========================================
        const fetchCurrentIP = async (uid) => {
            const acc = accounts.value.find(a => a.uid === uid);
            if(!acc) return;

            syncStatus.value = 'Extrayendo IP y Geolocalización...';
            let extractedData = null;

            try {
                // Llamada directa usando el Token proporcionado por el arquitecto
                const res = await fetch("https://ipinfo.io/json", { 
                    headers: { 'Authorization': 'Bearer 8c97cc52a98a48', 'Accept': 'application/json' },
                    cache: 'no-store'
                });
                
                if(res.ok) { 
                    extractedData = await res.json(); 
                }
            } catch(e) {
                console.warn("Fallo IPINFO, intentando proxy alterno");
                try {
                    const res2 = await fetch("https://api.ipify.org?format=json");
                    if(res2.ok) { extractedData = await res2.json(); }
                } catch(e2) {}
            }

            if(extractedData && extractedData.ip) {
                const newIp = extractedData.ip;
                
                if(acc.ip === newIp && acc.geo_isp === extractedData.org) { 
                    syncStatus.value = 'Misma IP registrada.'; 
                    setTimeout(() => { syncStatus.value = ''; }, 3000);
                    return; 
                }

                // Detector de Colisión Activo
                const collides = accounts.value.some(a => a.uid !== uid && a.ip === newIp);
                if(collides) {
                    const proceed = confirm(`⚠️ ALERTA DE CORRELACIÓN CIBERNÉTICA\n\nLa IP detectada (${newIp}) YA EXISTE en otra cuenta activa.\nEsto causará baneo por ráfaga. ¿Forzar inyección?`);
                    if(!proceed) { syncStatus.value = 'Inyección Abortada.'; setTimeout(() => { syncStatus.value = ''; }, 3000); return; }
                }

                // Inyección de Data OSINT
                acc.ip = newIp;
                acc.geo_isp = extractedData.org || '';
                acc.geo_city = extractedData.city || '';
                acc.geo_region = extractedData.region || '';
                acc.geo_postal = extractedData.postal || '';

                triggerCollisionCheck(acc);
                syncStatus.value = '¡Extracción y Enriquecimiento Completo!';
            } else {
                alert("Bloqueo de infraestructura de red local detectado. Verifica la extensión de VPN.");
                syncStatus.value = '';
            }
            setTimeout(() => { syncStatus.value = ''; }, 3000);
        };

        // ==========================================
        // 🔄 ALGORITMO DE REORDENAMIENTO ANTICHOQUE
        // ==========================================
        const executeAntiCollisionSort = () => {
            syncStatus.value = "Ejecutando motor de reordenamiento...";
            
            // 1. Separar cuentas con Nodo/IP de las vacías
            let active = accounts.value.filter(a => a.nodeId || a.ip);
            let inactive = accounts.value.filter(a => !a.nodeId && !a.ip);

            // 2. Agrupar por ISP Normalizado
            let ispGroups = {};
            active.forEach(a => {
                let ispKey = getIspName(a.geo_isp || a.asn_isp || 'desconocido');
                if(!ispGroups[ispKey]) ispGroups[ispKey] = [];
                ispGroups[ispKey].push(a);
            });

            // 3. Ordenar grupos por tamaño para intercalarlos bien
            let sortedKeys = Object.keys(ispGroups).sort((a, b) => ispGroups[b].length - ispGroups[a].length);
            
            let interleaved = [];
            let totalActive = active.length;

            // 4. Lógica de Intercalado (Round-Robin Greedy)
            while(interleaved.length < totalActive) {
                let addedInRound = false;
                for(let key of sortedKeys) {
                    if(ispGroups[key].length > 0) {
                        let lastAdded = interleaved[interleaved.length - 1];
                        let lastIsp = lastAdded ? getIspName(lastAdded.geo_isp || lastAdded.asn_isp || 'desconocido') : null;

                        // Si el ISP es distinto al último, lo metemos
                        if (key !== lastIsp || sortedKeys.length === 1) {
                            interleaved.push(ispGroups[key].shift());
                            addedInRound = true;
                        }
                    }
                }
                // Si no pudo agregar sin chocar (quedan puros del mismo), los mete a la fuerza
                if(!addedInRound) {
                    for(let key of sortedKeys) {
                        if(ispGroups[key].length > 0) {
                             interleaved.push(ispGroups[key].shift());
                        }
                    }
                }
            }

            // 5. Unir y renombrar cuentas secuencialmente
            let finalArray = [...interleaved, ...inactive];
            finalArray.forEach((acc, index) => {
                let num = index + 1;
                acc.name = `LON-${num < 10 ? '0'+num : num}`;
            });

            accounts.value = finalArray;
            alert("✅ REESTRUCTURACIÓN COMPLETADA\n\nLas cuentas han sido reordenadas para mitigar baneos corporativos por cercanía de ISP. Revisa la tabla del LON-01 en adelante.");
            syncStatus.value = "";
        };

        const openPoolModal = (uid) => { selectedAccountUid.value = uid; clearFilters(); showPoolModal.value = true; };
        const closePoolModal = () => { showPoolModal.value = false; selectedAccountUid.value = null; };
        
        const triggerCollisionCheck = (currentAccount) => {
            if(hasCollision(currentAccount)) {
                // Alerta nativa compacta
            }
        };

        // Regla Antichoque en vivo (Subred C y D)
        const hasCollision = (currentAccount) => {
            if (!currentAccount.ip && !currentAccount.nodeId) return false;
            return accounts.value.some(acc => {
                if (acc.uid === currentAccount.uid) return false;
                
                const curIp = (currentAccount.ip || '').trim();
                const accIp = (acc.ip || '').trim();
                const curNode = (currentAccount.nodeId || '').trim();
                const accNode = (acc.nodeId || '').trim();

                // Colisión Directa de IP o Nodo
                if ((accIp !== '' && curIp !== '' && accIp === curIp) || 
                    (accNode !== '' && curNode !== '' && accNode === curNode)) {
                    return true;
                }

                // Detección de proximidad Clase C (Ej: 192.168.1.X)
                if (accIp && curIp) {
                    let accSubnet = accIp.split('.').slice(0,3).join('.');
                    let curSubnet = curIp.split('.').slice(0,3).join('.');
                    if (accSubnet === curSubnet) return true;
                }

                return false;
            });
        };

        const collisionCount = computed(() => accounts.value.filter(acc => hasCollision(acc)).length);

        const assignNodeToAccount = (nodeId) => {
            if (selectedAccountUid.value) {
                const acc = accounts.value.find(a => a.uid === selectedAccountUid.value);
                if (acc) {
                    const nodeData = pool.value.find(n => n.id === nodeId);
                    acc.nodeId = nodeId; acc.ip = ''; acc.geo_city = ''; acc.geo_isp = '';
                    if(nodeData) { acc.q_score = nodeData.q_score; acc.asn_isp = nodeData.asn_isp; }
                    closePoolModal(); triggerCollisionCheck(acc);
                }
            }
        };

        const burnDirectlyFromPool = (node) => {
            if(node && node.id) {
                if(!blacklist.value.some(b => b.nodeId === node.id)) {
                    blacklist.value.unshift({ nodeId: node.id, ip: 'Quemado desde Pool' });
                }
            }
        };

        const addAccount = () => {
            const num = accounts.value.length + 1;
            accounts.value.push({ uid: generateUid(), name: `LON-${num < 10 ? '0'+num : num}`, nodeId: '', ip: '', q_score: '', asn_isp: '', geo_city: '', geo_region: '', geo_postal: '', geo_isp: '' });
        };
        const removeAccount = (uid) => { if(confirm("¿Eliminar cuenta?")) accounts.value = accounts.value.filter(a => a.uid !== uid); };
        const releaseNode = (uid) => { const acc = accounts.value.find(a => a.uid === uid); if(acc) { acc.nodeId = ''; acc.ip = ''; acc.q_score = ''; acc.asn_isp = ''; acc.geo_city = ''; acc.geo_isp = '';} };
        
        const burnNode = (uid) => {
            const acc = accounts.value.find(a => a.uid === uid);
            if(acc) {
                const nodeStr = (acc.nodeId || '').trim();
                if(nodeStr) {
                    const truncado = nodeStr.substring(0, 14); 
                    if(!blacklist.value.some(b => b.nodeId === truncado)) {
                        blacklist.value.unshift({ nodeId: truncado, ip: acc.ip || 'Desconocida' });
                    }
                }
                acc.nodeId = ''; acc.ip = ''; acc.q_score = ''; acc.asn_isp = ''; acc.geo_city = ''; acc.geo_isp = '';
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
                const isUsed = accounts.value.some(a => (a.nodeId || '').trim() === idCorto);
                
                if (!isBlacklisted && !isUsed) {
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

        // ==========================================
        // 🚀 CASCADA MYSTERIUM 5 NIVELES
        // ==========================================
        const fetchAPI = async () => {
            syncStatus.value = 'Conectando a Mysterium...';
            const targetUrl = "https://discovery.mysterium.network/api/v3/proposals?location_country=GB&ip_type=residential";
            let data = null;

            const attempts = [
                { name: 'Directo', url: targetUrl },
                { name: 'Proxy 1', url: `https://corsproxy.io/?${encodeURIComponent(targetUrl)}` },
                { name: 'Proxy 2', url: `https://api.allorigins.win/raw?url=${encodeURIComponent(targetUrl)}` },
                { name: 'Proxy 3', url: `https://thingproxy.freeboard.io/fetch/${targetUrl}` },
                { name: 'Proxy 4', url: `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(targetUrl)}` }
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
                                break; 
                            }
                        } catch (err) { }
                    }
                } catch (e) { }
            }

            if (data && Array.isArray(data)) {
                processNodeData(data);
            } else {
                alert("🚫 BLOQUEO SEVERO CORS DETECTADO\n\nNingún proxy logró burlar la seguridad de tu red/navegador para Mysterium.\n\nSOLUCIÓN RÁPIDA: \nUsa tu comando en la consola (curl ... > nodos.json) y cárgalo usando el botón 'Importar JSON'.");
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

        const copyToClipboard = async (text, type = 'Dato') => {
            try { 
                await navigator.clipboard.writeText(text); 
                showStatus(`¡${type} Copiado!`); 
                setTimeout(() => { syncStatus.value = ''; }, 3000);
            } catch (err) { console.error(err); }
        };

        const exportDatabase = () => {
            const dataStr = JSON.stringify({ accounts: accounts.value, pool: pool.value, blacklist: blacklist.value }, null, 2);
            const blob = new Blob([dataStr], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `VPN_ERP_Respaldo_${new Date().toISOString().slice(0,10)}.json`;
            a.click();
        };

        const showStatus = (msg) => { syncStatus.value = msg; setTimeout(() => { syncStatus.value = ''; }, 3000); };
        
        onMounted(() => { loadData(); });

        return {
            currentTab, accounts, pool, blacklist, syncStatus, bulkBlacklistText, 
            showPoolModal, selectedAccountUid, showAccountSelectModal, nodeToAssign,
            collisionCount, accountSearch, accountSort, processedAccounts, toggleAccountSort, 
            filters, filteredPool, toggleSortScore, clearFilters, hasCollision, triggerCollisionCheck, 
            addAccount, removeAccount, releaseNode, burnNode, processBulkBlacklist, removeBlacklistNode, 
            importPoolJSON, fetchAPI, copyToClipboard, exportDatabase, restoreBackup,
            openPoolModal, closePoolModal, assignNodeToAccount, getIspName,
            fetchCurrentIP, executeAntiCollisionSort
        };
    },
    updated() { if(window.lucide) { lucide.createIcons(); } }
}).mount('#app');
