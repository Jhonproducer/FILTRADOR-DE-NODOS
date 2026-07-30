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

        // --- FILTROS POOL ---
        const filters = ref({ nodeId: '', city: '', isp: '' });
        const sortDesc = ref(true); 
        const toggleSortScore = () => { sortDesc.value = !sortDesc.value; };
        const clearFilters = () => { filters.value.nodeId = ''; filters.value.city = ''; filters.value.isp = ''; };

        const filteredPool = computed(() => {
            let result = pool.value;
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
            return result.sort((a, b) => sortDesc.value ? b.q_score - a.q_score : a.q_score - b.q_score);
        });

        // --- CUENTAS ---
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
        // 🛡️ MOTOR DE RECUPERACIÓN DE DATOS (NO MORE WIPES)
        // ==========================================
        const saveData = () => {
            // A PARTIR DE AHORA, LA LLAVE SERÁ "MASTER" Y NUNCA CAMBIARÁ
            localStorage.setItem('vpnerp_acc_master', JSON.stringify(accounts.value));
            localStorage.setItem('vpnerp_pool_master', JSON.stringify(pool.value));
            localStorage.setItem('vpnerp_blk_master', JSON.stringify(blacklist.value));
        };

        const loadData = () => {
            let savedAcc = JSON.parse(localStorage.getItem('vpnerp_acc_master'));
            let savedPool = JSON.parse(localStorage.getItem('vpnerp_pool_master'));
            let savedBlk = JSON.parse(localStorage.getItem('vpnerp_blk_master'));

            // Si "master" está vacío (es la primera vez que se ejecuta este nuevo código),
            // BUSCAMOS EN LAS VERSIONES VIEJAS PARA RESCATAR TUS DATOS.
            if (!savedAcc || savedAcc.length === 0) {
                const oldKeys = ['v8', 'v7', 'v6', 'v5', 'v4'];
                for (let v of oldKeys) {
                    const oldAcc = JSON.parse(localStorage.getItem(`vpnerp_acc_${v}`));
                    if (oldAcc && oldAcc.length > 0) {
                        savedAcc = oldAcc;
                        savedPool = JSON.parse(localStorage.getItem(`vpnerp_pool_${v}`));
                        savedBlk = JSON.parse(localStorage.getItem(`vpnerp_blk_${v}`));
                        showStatus('¡Datos antiguos recuperados con éxito!');
                        break; // Se encontró data, salimos del loop
                    }
                }
            }

            // Aplicar datos o crear 28 cuentas vacías
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
            pool.value = savedPool || [];
            blacklist.value = savedBlk || [];
        };

        watch([accounts, pool, blacklist], saveData, { deep: true });

        // ==========================================
        // ⚡ AUTO IP INFO & SCAMALYTICS
        // ==========================================
        const fetchCurrentIP = async (uid) => {
            const acc = accounts.value.find(a => a.uid === uid);
            if(!acc) return;

            showStatus('Extrayendo IP...');
            try {
                const res = await fetch("https://ipinfo.io/json?token=8c97cc52a98a48");
                if(!res.ok) throw new Error("API Error");
                const data = await res.json();
                
                if(data && data.ip) {
                    const newIp = data.ip;
                    
                    if(acc.ip === newIp) {
                        showStatus('La IP se mantiene igual.');
                        return;
                    }

                    // Chequeo Anti-Errores Humanos
                    const collides = accounts.value.some(a => a.uid !== uid && a.ip === newIp);
                    if(collides) {
                        const proceed = confirm(`⚠️ ALERTA DE COLISIÓN INTERNA\n\nLa IP extraída (${newIp}) YA ESTÁ siendo usada en otra de tus cuentas.\n\n¿Estás seguro de que quieres forzar esta actualización?`);
                        if(!proceed) {
                            showStatus('Operación cancelada.');
                            return;
                        }
                    }

                    // Guardar el salvavidas (Backup de la IP anterior)
                    acc.previousIp = acc.ip;
                    acc.ip = newIp;
                    
                    triggerCollisionCheck(acc);
                    showStatus('IP Actualizada automáticamente.');
                }
            } catch (err) {
                alert("Error al extraer la IP. Asegúrate de estar conectado al nodo.");
                showStatus('');
            }
        };

        const undoIp = (uid) => {
            const acc = accounts.value.find(a => a.uid === uid);
            if(acc && acc.previousIp !== undefined) {
                acc.ip = acc.previousIp;
                acc.previousIp = undefined; // Limpiar el salvavidas
                triggerCollisionCheck(acc);
                showStatus('Cambio de IP deshecho.');
            }
        };

        const openScamalytics = (ip) => {
            if(!ip) {
                alert("La cuenta no tiene ninguna IP asignada para analizar.");
                return;
            }
            // Abre una nueva pestaña mágicamente directo al reporte
            window.open(`https://scamalytics.com/ip/${ip}`, '_blank');
            showStatus('Abriendo Scamalytics...');
        };


        // --- MODALES ---
        const openPoolModal = (uid) => { selectedAccountUid.value = uid; clearFilters(); showPoolModal.value = true; };
        const closePoolModal = () => { showPoolModal.value = false; selectedAccountUid.value = null; };

        const openAccountSelectModal = (node) => { nodeToAssign.value = node; showAccountSelectModal.value = true; };
        const closeAccountSelectModal = () => { showAccountSelectModal.value = false; nodeToAssign.value = null; };
        
        // --- COLISIONES ---
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

        // --- ASIGNACIONES ---
        const assignNodeToAccount = (nodeId) => {
            if (selectedAccountUid.value) {
                const acc = accounts.value.find(a => a.uid === selectedAccountUid.value);
                if (acc) {
                    const nodeData = pool.value.find(n => n.id === nodeId);
                    acc.nodeId = nodeId; acc.ip = ''; acc.previousIp = undefined; 
                    if(nodeData) { acc.q_score = nodeData.q_score; acc.asn_isp = nodeData.asn_isp; }
                    closePoolModal();
                    triggerCollisionCheck(acc);
                }
            }
        };

        const confirmAssignFromPool = (accountUid) => {
            const acc = accounts.value.find(a => a.uid === accountUid);
            if (acc && nodeToAssign.value) {
                acc.nodeId = nodeToAssign.value.id;
                acc.ip = ''; acc.previousIp = undefined;
                acc.q_score = nodeToAssign.value.q_score;
                acc.asn_isp = nodeToAssign.value.asn_isp;
                closeAccountSelectModal();
                triggerCollisionCheck(acc);
                showStatus(`Asignado a ${acc.name}`);
            }
        };

        const burnDirectlyFromPool = (node) => {
            if(node && node.id) {
                if(!blacklist.value.some(b => b.nodeId === node.id)) {
                    blacklist.value.unshift({ nodeId: node.id, ip: 'Quemado desde Pool' });
                    showStatus('Nodo bloqueado.');
                }
            }
        };

        // --- GESTIÓN DE CUENTAS ---
        const addAccount = () => {
            const num = accounts.value.length + 1;
            accounts.value.push({ uid: generateUid(), name: `LON-${num < 10 ? '0'+num : num}`, nodeId: '', ip: '', q_score: '', asn_isp: '' });
        };
        const removeAccount = (uid) => { if(confirm("¿Eliminar cuenta?")) accounts.value = accounts.value.filter(a => a.uid !== uid); };
        const releaseNode = (uid) => { const acc = accounts.value.find(a => a.uid === uid); if(acc) { acc.nodeId = ''; acc.ip = ''; acc.q_score = ''; acc.asn_isp = ''; acc.previousIp = undefined; } };
        
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
                acc.nodeId = ''; acc.ip = ''; acc.q_score = ''; acc.asn_isp = ''; acc.previousIp = undefined;
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
            showStatus(`Pool Actualizado: ${pool.value.length} nodos`);
        };

        const fetchAPI = async () => {
            syncStatus.value = 'Conectando API...';
            try {
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
                    processNodeData(data); 
                    event.target.value = null; 
                } catch (err) { alert("Error JSON."); event.target.value = null; }
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

        onMounted(() => { loadData(); });

        return {
            currentTab, accounts, pool, blacklist, syncStatus, bulkBlacklistText, 
            showPoolModal, selectedAccountUid, showAccountSelectModal, nodeToAssign,
            collisionCount, accountSearch, accountSort, processedAccounts, toggleAccountSort, 
            filters, filteredPool, toggleSortScore, clearFilters, hasCollision, triggerCollisionCheck, 
            addAccount, removeAccount, releaseNode, burnNode, processBulkBlacklist, removeBlacklistNode, 
            importPoolJSON, fetchAPI, copyToClipboard, exportDatabase, 
            openPoolModal, closePoolModal, assignNodeToAccount,
            openAccountSelectModal, closeAccountSelectModal, confirmAssignFromPool, burnDirectlyFromPool,
            fetchCurrentIP, undoIp, openScamalytics // Nuevas funciones exportadas
        };
    },
    updated() { if(window.lucide) { lucide.createIcons(); } }
}).mount('#app');
