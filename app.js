const { createApp, ref, computed, watch, onMounted, nextTick } = Vue;

const generateUid = () => Date.now().toString(36) + Math.random().toString(36).substring(2);

createApp({
    setup() {
        const currentTab = ref('accounts');
        const syncStatus = ref('');
        const bulkBlacklistText = ref('');
        
        const showPoolModal = ref(false);
        const selectedAccountUid = ref(null);

        const showAccountSelectModal = ref(false);
        const nodeToAssign = ref(null);
        
        const accounts = ref([]);
        const pool = ref([]);
        const blacklist = ref([]);

        // --- NUEVO: ESTADO ESTRATÉGICO ---
        const lastWorkedIsp = ref('');
        
        const markAsWorked = (ispString) => {
            if(!ispString) return;
            // Extraer el nombre base (Ej: "BT Group" -> "BT")
            const baseIsp = ispString.split('-')[1]?.trim() || ispString.trim();
            // Limpiamos un poco el nombre para que el banner sea elegante
            let cleanName = baseIsp.split(' ')[0]; 
            if(cleanName.toLowerCase() === 'virgin') cleanName = 'Virgin Media';
            if(cleanName.toLowerCase() === 'bt') cleanName = 'BT';
            
            lastWorkedIsp.value = cleanName;
        };

        const safeSuggestion = computed(() => {
            // Buscamos una cuenta que tenga nodo, que no choque con el último ISP y que esté activa
            const available = accounts.value.filter(a => {
                if(!a.nodeId || !a.asn_isp) return false;
                if(!lastWorkedIsp.value) return true; // Si no hay historial, sugiere cualquiera
                return !a.asn_isp.toLowerCase().includes(lastWorkedIsp.value.toLowerCase());
            });
            
            if(available.length > 0) {
                // Selecciona una aleatoria de la lista filtrada
                const randIndex = Math.floor(Math.random() * available.length);
                return available[randIndex];
            }
            return null;
        });

        const generateSafeSuggestion = () => {
            if(accounts.value.length === 0) return;
            // Solo para forzar el re-render de la computed property, podemos hacer un pequeño truco
            const temp = lastWorkedIsp.value;
            lastWorkedIsp.value = temp + ' '; 
            setTimeout(() => { lastWorkedIsp.value = temp; }, 10);
        };


        // --- FILTROS POOL ---
        const filters = ref({ nodeId: '', city: '', isp: '', minQuality: '' });
        const sortDesc = ref(true); 
        const toggleSortScore = () => { sortDesc.value = !sortDesc.value; };
        const clearFilters = () => { filters.value.nodeId = ''; filters.value.city = ''; filters.value.isp = ''; filters.value.minQuality = ''; };

        const filteredPool = computed(() => {
            let result = pool.value;
            
            // Ocultar los que ya están en uso o quemados
            result = result.filter(n => {
                const inBlacklist = blacklist.value.some(b => b.nodeId === n.id);
                const inUse = accounts.value.some(a => (a.nodeId || '').trim() === n.id);
                return !inBlacklist && !inUse;
            });

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
            // FILTRO DE CALIDAD DINÁMICO
            if (filters.value.minQuality) {
                const min = parseFloat(filters.value.minQuality);
                if(!isNaN(min)) {
                    result = result.filter(n => parseFloat(n.q_score) >= min);
                }
            }

            return result.sort((a, b) => sortDesc.value ? b.q_score - a.q_score : a.q_score - b.q_score);
        });

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
                    (a.asn_isp || '').toLowerCase().includes(s)
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

        // ==========================================
        // 💾 MOTOR DE GUARDADO Y RESTAURACIÓN
        // ==========================================
        const saveData = () => {
            localStorage.setItem('vpnerp_master_data', JSON.stringify({
                accounts: accounts.value,
                pool: pool.value,
                blacklist: blacklist.value,
                lastWorkedIsp: lastWorkedIsp.value
            }));
        };

        const loadData = () => {
            const masterData = JSON.parse(localStorage.getItem('vpnerp_master_data'));

            if (masterData && masterData.accounts && masterData.accounts.length > 0) {
                accounts.value = masterData.accounts.map(a => ({ 
                    ...a, 
                    uid: a.uid || generateUid(),
                    previousIp: a.previousIp || null
                }));
                pool.value = masterData.pool || [];
                blacklist.value = masterData.blacklist || [];
                lastWorkedIsp.value = masterData.lastWorkedIsp || '';
            } else {
                // Fallback a inicializar en cero
                const initial = [];
                for(let i = 1; i <= 28; i++) {
                    const num = i < 10 ? '0'+i : i;
                    initial.push({ uid: generateUid(), name: `LON-${num}`, nodeId: '', ip: '', q_score: '', asn_isp: '', previousIp: null });
                }
                accounts.value = initial;
            }
        };

        const restoreDatabase = (event) => {
            const file = event.target.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = (e) => {
                try {
                    const data = JSON.parse(e.target.result);
                    if(data.accounts) accounts.value = data.accounts.map(a => ({ ...a, uid: a.uid || generateUid() }));
                    if(data.pool) pool.value = data.pool;
                    if(data.blacklist) blacklist.value = data.blacklist;
                    showStatus('¡Base de Datos Restaurada con Éxito!');
                } catch (err) { 
                    alert("Error: El archivo no es un Backup válido del VPN ERP."); 
                }
                event.target.value = null; 
            };
            reader.readAsText(file);
        };

        watch([accounts, pool, blacklist, lastWorkedIsp], saveData, { deep: true });

        // ==========================================
        // ⚡ LA CASCADA DE IP PÚBLICA (Limpia y Funcional)
        // ==========================================
        const fetchCurrentIP = async (uid) => {
            const acc = accounts.value.find(a => a.uid === uid);
            if(!acc) return;

            syncStatus.value = 'Detectando IP...';
            let newIp = null;

            try {
                const r1 = await fetch("https://api.ipify.org?format=json");
                if(r1.ok) { const d1 = await r1.json(); newIp = d1.ip; }
            } catch(e) {}

            if(!newIp) {
                try {
                    const r2 = await fetch("https://ipinfo.io/json", {
                        headers: { 'Authorization': 'Bearer 8c97cc52a98a48' }
                    });
                    if(r2.ok) { const d2 = await r2.json(); newIp = d2.ip; }
                } catch(e) {}
            }

            if(!newIp) {
                try {
                    const r3 = await fetch("https://api.myip.com");
                    if(r3.ok) { const d3 = await r3.json(); newIp = d3.ip; }
                } catch(e) {}
            }

            if(newIp) {
                if(acc.ip === newIp) { 
                    syncStatus.value = 'Misma IP.'; 
                    setTimeout(() => { syncStatus.value = ''; }, 3000);
                    return; 
                }
                const collides = accounts.value.some(a => a.uid !== uid && a.ip === newIp);
                if(collides) {
                    const proceed = confirm(`⚠️ ALERTA DE COLISIÓN\n\nLa IP detectada (${newIp}) YA ESTÁ en otra cuenta.\n¿Sobrescribir de todos modos?`);
                    if(!proceed) { 
                        syncStatus.value = 'Cancelado.'; 
                        setTimeout(() => { syncStatus.value = ''; }, 3000);
                        return; 
                    }
                }
                acc.previousIp = acc.ip; 
                acc.ip = newIp;
                triggerCollisionCheck(acc);
                syncStatus.value = '¡IP extraída!';
            } else {
                alert("Bloqueo de red total. Tus extensiones de privacidad impiden leer la IP desde el navegador.");
                syncStatus.value = '';
            }
            setTimeout(() => { syncStatus.value = ''; }, 3000);
        };

        const undoIp = (uid) => {
            const acc = accounts.value.find(a => a.uid === uid);
            if(acc && acc.previousIp) {
                acc.ip = acc.previousIp; 
                acc.previousIp = null; 
                triggerCollisionCheck(acc); 
                syncStatus.value = 'IP Restaurada.';
                setTimeout(() => { syncStatus.value = ''; }, 3000);
            }
        };


        const openPoolModal = (uid) => { selectedAccountUid.value = uid; clearFilters(); showPoolModal.value = true; };
        const closePoolModal = () => { showPoolModal.value = false; selectedAccountUid.value = null; };
        const openAccountSelectModal = (node) => { nodeToAssign.value = node; showAccountSelectModal.value = true; };
        const closeAccountSelectModal = () => { showAccountSelectModal.value = false; nodeToAssign.value = null; };
        
        const triggerCollisionCheck = (currentAccount) => {
            if(hasCollision(currentAccount)) {
                alert(`¡ALERTA CRÍTICA!\n\nEl Nodo o IP ingresado YA EXISTE en otra cuenta activa.`);
            }
        };

        const hasCollision = (currentAccount) => {
            if (!currentAccount.ip && !currentAccount.nodeId) return false;
            return accounts.value.some(acc => {
                if (acc.uid === currentAccount.uid) return false;
                const curIp = (currentAccount.ip || '').trim();
                const accIp = (acc.ip || '').trim();
                const curNode = (currentAccount.nodeId || '').trim();
                const accNode = (acc.nodeId || '').trim();
                return (accIp !== '' && curIp !== '' && accIp === curIp) || 
                       (accNode !== '' && curNode !== '' && accNode === curNode);
            });
        };

        const collisionCount = computed(() => accounts.value.filter(acc => hasCollision(acc)).length);

        const assignNodeToAccount = (nodeId) => {
            if (selectedAccountUid.value) {
                const acc = accounts.value.find(a => a.uid === selectedAccountUid.value);
                if (acc) {
                    const nodeData = pool.value.find(n => n.id === nodeId);
                    acc.nodeId = nodeId; acc.ip = ''; acc.previousIp = null; 
                    if(nodeData) { acc.q_score = nodeData.q_score; acc.asn_isp = nodeData.asn_isp; }
                    closePoolModal(); triggerCollisionCheck(acc);
                }
            }
        };

        const confirmAssignFromPool = (accountUid) => {
            const acc = accounts.value.find(a => a.uid === accountUid);
            if (acc && nodeToAssign.value) {
                acc.nodeId = nodeToAssign.value.id;
                acc.ip = ''; acc.previousIp = null;
                acc.q_score = nodeToAssign.value.q_score;
                acc.asn_isp = nodeToAssign.value.asn_isp;
                closeAccountSelectModal(); triggerCollisionCheck(acc); showStatus(`Asignado a ${acc.name}`);
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
            accounts.value.push({ uid: generateUid(), name: `LON-${num < 10 ? '0'+num : num}`, nodeId: '', ip: '', q_score: '', asn_isp: '', previousIp: null });
        };
        const removeAccount = (uid) => { if(confirm("¿Eliminar cuenta?")) accounts.value = accounts.value.filter(a => a.uid !== uid); };
        const releaseNode = (uid) => { const acc = accounts.value.find(a => a.uid === uid); if(acc) { acc.nodeId = ''; acc.ip = ''; acc.q_score = ''; acc.asn_isp = ''; acc.previousIp = null; } };
        
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
                acc.nodeId = ''; acc.ip = ''; acc.q_score = ''; acc.asn_isp = ''; acc.previousIp = null;
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


        // ==========================================
        // 💎 FILTRO TOP 5 ISP DE UK + MYSTERIUM API
        // ==========================================
        // Los proveedores más grandes y confiables de Reino Unido.
        const topUK_ISPs = ['bt ', 'bt group', 'virgin', 'sky', 'talktalk', 'vodafone', 'ee ', 'plusnet', 'three', 'o2'];
        
        const isTopISP = (ispString) => {
            if (!ispString) return false;
            const str = ispString.toLowerCase();
            return topUK_ISPs.some(top => str.includes(top));
        };

        const processNodeData = (data) => {
            const rawPool = [];
            const seenIds = new Set(); 
            let discardedCount = 0;

            data.forEach(nodo => {
                if (nodo.service_type !== "wireguard" || !nodo.provider_id) return;
                const idCorto = nodo.provider_id.substring(0, 14);
                if(seenIds.has(idCorto)) return;
                
                // 1. Aplicar el Filtro Élite: Si no es un ISP TOP de UK, se ignora.
                const fullIsp = `${nodo.location?.asn || ''} - ${nodo.location?.isp || ''}`;
                if (!isTopISP(fullIsp)) {
                    discardedCount++;
                    return; 
                }

                // 2. Cruzar con Blacklist y Uso Actual
                const isBlacklisted = blacklist.value.some(b => b.nodeId === idCorto);
                const isUsed = accounts.value.some(a => (a.nodeId || '').trim() === idCorto);
                
                if (!isBlacklisted && !isUsed) {
                    seenIds.add(idCorto);
                    rawPool.push({
                        id: idCorto,
                        city: nodo.location?.city || 'N/A',
                        asn_isp: fullIsp,
                        q_score: (nodo.quality?.quality || 0).toFixed(2)
                    });
                }
            });
            
            pool.value = rawPool.sort((a, b) => b.q_score - a.q_score);
            showStatus(`Pool Actualizado. Descartados ${discardedCount} nodos raros.`);
        };

        const fetchAPI = async () => {
            syncStatus.value = 'Conectando a Mysterium...';
            try {
                const url = "https://discovery.mysterium.network/api/v3/proposals?location_country=GB&ip_type=residential";
                const response = await fetch(url, { headers: { 'accept': 'application/json' } });
                
                if(!response.ok) throw new Error("Error HTTP " + response.status);
                
                const data = await response.json();
                processNodeData(data);
                
            } catch (err) {
                console.error("Error API:", err);
                alert("Error conectando a la API de Mysterium. \nVerifica tu conexión a internet o usa 'Importar JSON'.");
                syncStatus.value = '';
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
            } catch (err) { console.error(err); }
        };

        const exportDatabase = () => {
            const dataStr = JSON.stringify({ accounts: accounts.value, pool: pool.value, blacklist: blacklist.value, lastWorkedIsp: lastWorkedIsp.value }, null, 2);
            const blob = new Blob([dataStr], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `VPN_ERP_Respaldo_${new Date().toISOString().slice(0,10)}.json`;
            a.click();
        };

        const showStatus = (msg) => { syncStatus.value = msg; setTimeout(() => { syncStatus.value = ''; }, 4000); };
        
        onMounted(() => { loadData(); });

        return {
            currentTab, accounts, pool, blacklist, syncStatus, bulkBlacklistText, 
            showPoolModal, selectedAccountUid, showAccountSelectModal, nodeToAssign,
            collisionCount, accountSearch, accountSort, processedAccounts, toggleAccountSort, 
            filters, filteredPool, toggleSortScore, clearFilters, hasCollision, triggerCollisionCheck, 
            addAccount, removeAccount, releaseNode, burnNode, processBulkBlacklist, removeBlacklistNode, 
            importPoolJSON, fetchAPI, copyToClipboard, exportDatabase, restoreDatabase,
            openPoolModal, closePoolModal, assignNodeToAccount,
            openAccountSelectModal, closeAccountSelectModal, confirmAssignFromPool, burnDirectlyFromPool,
            fetchCurrentIP, undoIp, lastWorkedIsp, markAsWorked, safeSuggestion, generateSafeSuggestion
        };
    },
    updated() { if(window.lucide) { lucide.createIcons(); } }
}).mount('#app');
