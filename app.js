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

        // --- FILTROS POOL ---
        const filters = ref({ nodeId: '', city: '', isp: '' });
        const sortDesc = ref(true); 
        const toggleSortScore = () => { sortDesc.value = !sortDesc.value; };
        const clearFilters = () => { filters.value.nodeId = ''; filters.value.city = ''; filters.value.isp = ''; };

        const filteredPool = computed(() => {
            let result = pool.value;
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

        // --- PERSISTENCIA ---
        const saveData = () => {
            localStorage.setItem('vpnerp_acc_v7', JSON.stringify(accounts.value));
            localStorage.setItem('vpnerp_pool_v7', JSON.stringify(pool.value));
            localStorage.setItem('vpnerp_blk_v7', JSON.stringify(blacklist.value));
        };

        const loadData = () => {
            const savedAcc = JSON.parse(localStorage.getItem('vpnerp_acc_v7'));
            if (savedAcc && savedAcc.length > 0) {
                accounts.value = savedAcc.map(a => ({ ...a, uid: a.uid || generateUid() }));
            } else {
                const initial = [];
                for(let i = 1; i <= 28; i++) {
                    const num = i < 10 ? '0'+i : i;
                    initial.push({ uid: generateUid(), name: `LON-${num}`, nodeId: '', ip: '', q_score: '', asn_isp: '' });
                }
                accounts.value = initial;
            }
            pool.value = JSON.parse(localStorage.getItem('vpnerp_pool_v7')) || [];
            blacklist.value = JSON.parse(localStorage.getItem('vpnerp_blk_v7')) || [];
        };

        watch([accounts, pool, blacklist], saveData, { deep: true });

        const openPoolModal = (uid) => { selectedAccountUid.value = uid; clearFilters(); showPoolModal.value = true; };
        const closePoolModal = () => { showPoolModal.value = false; selectedAccountUid.value = null; };

        const triggerCollisionCheck = (currentAccount) => {
            if(hasCollision(currentAccount)) {
                alert(`¡ALERTA CRÍTICA!\n\nEl Nodo o IP ingresado YA EXISTE en otra cuenta activa.\nCámbialo o libéralo inmediatamente.`);
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
                    acc.nodeId = nodeId; acc.ip = ''; 
                    if(nodeData) { acc.q_score = nodeData.q_score; acc.asn_isp = nodeData.asn_isp; }
                    closePoolModal();
                    triggerCollisionCheck(acc);
                }
            }
        };

        const addAccount = () => {
            const num = accounts.value.length + 1;
            accounts.value.push({ uid: generateUid(), name: `LON-${num < 10 ? '0'+num : num}`, nodeId: '', ip: '', q_score: '', asn_isp: '' });
        };

        const removeAccount = (uid) => { if(confirm("¿Eliminar cuenta?")) accounts.value = accounts.value.filter(a => a.uid !== uid); };
        const releaseNode = (uid) => { const acc = accounts.value.find(a => a.uid === uid); if(acc) { acc.nodeId = ''; acc.ip = ''; acc.q_score = ''; acc.asn_isp = ''; } };
        
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
                acc.nodeId = ''; acc.ip = ''; acc.q_score = ''; acc.asn_isp = '';
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

        // --- MOTOR CENTRAL DE ACTUALIZACIÓN DE POOL (BORRÓN Y CUENTA NUEVA) ---
        const processNodeData = (data) => {
            const rawPool = [];
            const seenIds = new Set(); // Para no duplicar dentro del mismo JSON/API

            data.forEach(nodo => {
                if (nodo.service_type !== "wireguard" || !nodo.provider_id) return;
                
                const idCorto = nodo.provider_id.substring(0, 14);
                
                // Evitar duplicados del propio documento
                if(seenIds.has(idCorto)) return;
                
                // Cruzar con Lista Negra y Cuentas Activas
                const isBlacklisted = blacklist.value.some(b => b.nodeId === idCorto);
                const isUsed = accounts.value.some(a => (a.nodeId || '').trim() === idCorto);
                
                // Si el nodo está limpio, entra al nuevo Pool
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

            // REEMPLAZO ABSOLUTO: Destruye el pool viejo y pone el nuevo depurado
            pool.value = rawPool.sort((a, b) => b.q_score - a.q_score);
            showStatus(`Pool Actualizado: ${pool.value.length} nodos`);
        };

        // LLAMADA A LA API CON CORS PROXY (Infalible)
        const fetchAPI = async () => {
            syncStatus.value = 'Conectando API...';
            try {
                // Forzamos el salto del bloqueo CORS del navegador usando un Proxy público fiable
                const targetUrl = encodeURIComponent("https://discovery.mysterium.network/api/v3/proposals?location_country=GB&ip_type=residential");
                const proxyUrl = `https://corsproxy.io/?${targetUrl}`;
                
                const response = await fetch(proxyUrl);
                if(!response.ok) throw new Error("Error en Proxy");
                const data = await response.json();
                
                processNodeData(data);
                
            } catch (err) {
                console.error(err);
                alert("Bloqueo de red detectado. Usa la importación por JSON.");
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
                    processNodeData(data); // Pasa por el mismo motor de limpieza
                    event.target.value = null; 
                } catch (err) { 
                    alert("Error leyendo el archivo JSON."); 
                    event.target.value = null; 
                }
            };
            reader.readAsText(file);
        };

        const copyToClipboard = async (text) => {
            try { await navigator.clipboard.writeText(text); showStatus('¡Copiado!'); } catch (err) { console.error(err); }
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
            currentTab, accounts, pool, blacklist, syncStatus, bulkBlacklistText, showPoolModal, collisionCount, accountSearch, accountSort, processedAccounts, toggleAccountSort, filters, filteredPool, toggleSortScore, clearFilters, hasCollision, triggerCollisionCheck, addAccount, removeAccount, releaseNode, burnNode, processBulkBlacklist, removeBlacklistNode, importPoolJSON, fetchAPI, copyToClipboard, exportDatabase, openPoolModal, closePoolModal, assignNodeToAccount
        };
    },
    updated() { if(window.lucide) { lucide.createIcons(); } }
}).mount('#app');
